import {
  Assignment,
  DayGroup,
  Doctor,
  DoctorStats,
  GenerationConfig,
  DEFAULT_HOURS_TARGET,
  HoursTarget,
  MonthlySchedule,
  NO_ROTATION_RULE,
  OperativeRoom,
  RotationRule,
  ShiftScheme,
  Weekday,
  getRotationMode,
} from '../models/types';
import { ShiftTypeIndex, blockIndexOf } from '../domain/shiftTypes';
import { isSchemeUsable } from '../domain/schemes';
import { RotationFit, RotationTracker } from '../domain/rotation';
import {
  DoctorRules,
  LengthFit,
  ShiftLengthScale,
  buildShiftLengthScale,
  lengthFit,
} from '../domain/preferences';
import { HoursLedger, KnownRange, buildHoursReport } from '../domain/hours';
import { computeStats } from '../domain/stats';
import {
  AvailabilityRules,
  RoomSlotIndex,
  SlotRequirement,
  buildRequirements,
  findCoverageGaps,
  findViolations,
  requirementKey,
} from '../domain/validation';
import {
  addDays,
  buildISODate,
  getDaysInMonth,
  mondayFirstIndex,
  weekdayOfISODate,
} from '../utils/date';
import { generateId } from '../utils/id';

export interface GenerationProgress {
  current: number;
  total: number;
  percentage: number;
  validSchedules: number;
  bestScore: number | null;
}

/** Esito di un singolo tentativo. */
export interface ScheduleCandidate {
  schedule: MonthlySchedule;
  score: number;
  stats: DoctorStats[];
  coverageGaps: number;
  errors: number;
  warnings: number;
}

export interface GenerationResult extends ScheduleCandidate {
  attempts: number;
  /** Tentativi senza errori né turni scoperti. */
  validFound: number;
}

export interface GeneratorInput {
  rooms: OperativeRoom[];
  doctors: Doctor[];
  shiftTypes: ShiftTypeIndex;
  schemes: ShiftScheme[];
  config: GenerationConfig;
  /** Regola di rotazione del servizio, valida per tutte le sale. */
  rotationRule?: RotationRule;
  /** Ore minime e massime per medico nel periodo impostato. */
  hoursTarget?: HoursTarget;
  /** Statistiche dei mesi precedenti, per bilanciare sull'anno. */
  priorStats?: DoctorStats[];
  /**
   * Assegnazioni del mese precedente. Servono ai blocchi a rotazione che
   * scavalcano il cambio di mese e alla regola di rotazione, che riprende la
   * posizione di ciascun medico da dove l'aveva lasciata.
   */
  priorAssignments?: Assignment[];
}

export const EFFORT_PRESETS = {
  fast: { label: 'Rapida', attempts: 60 },
  standard: { label: 'Standard', attempts: 300 },
  thorough: { label: 'Accurata', attempts: 1200 },
} as const;

export type EffortLevel = keyof typeof EFFORT_PRESETS;

/** Pesi del punteggio: più basso è meglio. */
const PENALTY = {
  coverageGap: 1000,
  error: 250,
  warning: 8,
  varianceShifts: 1,
  varianceHours: 0.1,
  varianceDays: 1.2,
  varianceWeekend: 1.5,
  varianceCritical: 1.8,
  variancePerRoom: 0.8,
  variancePerShiftType: 0.6,
  // Un blocco di diurnismo pesa molto più di un turno singolo: lo squilibrio
  // fra chi ne fa due e chi nessuno va corretto con priorità.
  variancePerBlock: 6,
  // Scostamenti dalla rotazione del servizio: pesano abbastanza da orientare
  // la scelta fra tentativi, non tanto da valere più di un turno scoperto.
  offPattern: 4,
  restedOnDuty: 12,
  // Preferenze dei medici: contano, ma meno di un vincolo.
  avoidedWeekday: 6,
  againstLengthPreference: 2,
  // Ore fuori dall'intervallo richiesto, per ogni ora di scarto.
  hoursBelowMin: 3,
  // Sforamento del massimo in un singolo periodo: pesante se il massimo è un
  // tetto, leggero se è recuperabile nei periodi vicini.
  hoursAboveMax: 15,
  hoursAboveMaxRecoverable: 1,
  // Bilancio complessivo fuori dall'intervallo: è la misura che conta quando
  // gli sforamenti si possono compensare.
  hoursBalance: 8,
} as const;

export class ScheduleGeneratorService {
  private readonly rooms: OperativeRoom[];
  private readonly doctors: Doctor[];
  private readonly doctorById: Map<string, Doctor>;
  private readonly shiftTypes: ShiftTypeIndex;
  private readonly config: GenerationConfig;
  private readonly availability: AvailabilityRules;
  private readonly slotIndex: RoomSlotIndex;
  private readonly priorStats: Map<string, DoctorStats>;
  private readonly requirements: SlotRequirement[];
  private readonly requirementsByKey: Map<string, SlotRequirement>;
  /** Proprietario di un blocco a rotazione iniziato nel mese precedente. */
  private readonly inheritedBlockOwners: Map<string, string>;
  private readonly rotationRule: RotationRule;
  private readonly rules: DoctorRules;
  private readonly lengthScale: ShiftLengthScale;
  private readonly hoursTarget: HoursTarget;
  private readonly priorAssignments: Assignment[];
  /** Intervallo di date per cui conosciamo tutte le assegnazioni. */
  private readonly knownRange: KnownRange;
  /** Rotazione già avviata col mese precedente, da clonare a ogni tentativo. */
  private readonly rotationSeed: RotationTracker;

  constructor(input: GeneratorInput) {
    this.rooms = input.rooms;
    this.doctors = input.doctors;
    this.doctorById = new Map(input.doctors.map(doctor => [doctor.id, doctor]));
    this.shiftTypes = input.shiftTypes;
    this.config = input.config;
    this.availability = new AvailabilityRules(input.config);
    this.slotIndex = new RoomSlotIndex(input.rooms);
    this.priorStats = new Map((input.priorStats ?? []).map(stat => [stat.doctorId, stat]));

    // I requisiti del mese non cambiano fra un tentativo e l'altro: calcolarli
    // una volta sola evita di rifare lo stesso lavoro centinaia di volte.
    this.requirements = buildRequirements(
      input.rooms,
      input.config.year,
      input.config.month,
      input.config.holidays,
    );
    this.requirementsByKey = new Map(
      this.requirements.map(requirement => [requirementKey(requirement), requirement]),
    );
    this.inheritedBlockOwners = collectBlockOwners(input.priorAssignments ?? [], input.shiftTypes);

    this.rules = new DoctorRules(input.doctors);
    this.priorAssignments = input.priorAssignments ?? [];

    // Le settimane a cavallo del mese si possono giudicare solo se abbiamo il
    // mese precedente; il mese successivo non è ancora stato generato.
    const firstDay = buildISODate(input.config.year, input.config.month, 1);
    const earliestPrior = this.priorAssignments
      .reduce<string | null>(
        (earliest, assignment) =>
          earliest === null || assignment.date < earliest ? assignment.date : earliest,
        null,
      );
    this.knownRange = {
      from: earliestPrior !== null && earliestPrior < firstDay ? earliestPrior : firstDay,
      to: buildISODate(
        input.config.year,
        input.config.month,
        getDaysInMonth(input.config.year, input.config.month),
      ),
    };

    this.lengthScale = buildShiftLengthScale(input.shiftTypes.all);
    this.hoursTarget = input.hoursTarget ?? { ...DEFAULT_HOURS_TARGET, enabled: false };

    this.rotationRule = input.rotationRule ?? NO_ROTATION_RULE;
    const rotationScheme = input.schemes.find(
      scheme => scheme.id === this.rotationRule.schemeId,
    );
    const usableScheme = rotationScheme
      && rotationScheme.steps.length > 0
      && isSchemeUsable(rotationScheme, input.shiftTypes)
      ? rotationScheme
      : null;

    // La posizione nella rotazione riprende dal mese precedente, così il
    // cambio di mese non azzera il giro.
    this.rotationSeed = new RotationTracker(usableScheme, this.rotationRule, input.shiftTypes);
    this.rotationSeed.seed(input.priorAssignments ?? []);
  }

  /**
   * Genera più calendari con punti di partenza casuali e restituisce il
   * migliore. Il punteggio somma turni scoperti, violazioni e squilibrio fra
   * medici: anche quando nessun tentativo è perfetto viene restituito quello
   * meno problematico, non uno qualsiasi.
   */
  async generate(
    attempts: number,
    onProgress?: (progress: GenerationProgress) => void,
  ): Promise<GenerationResult> {
    let best: ScheduleCandidate | null = null;
    let validFound = 0;

    // Un batch abbastanza piccolo per restituire il controllo all'interfaccia
    // con regolarità, abbastanza grande da non pagare troppo il context switch.
    const batchSize = 25;

    for (let completed = 0; completed < attempts; ) {
      const batchEnd = Math.min(completed + batchSize, attempts);

      for (; completed < batchEnd; completed++) {
        const candidate = this.buildCandidate(Math.random());
        if (candidate.coverageGaps === 0 && candidate.errors === 0) validFound++;
        if (!best || candidate.score < best.score) best = candidate;
      }

      onProgress?.({
        current: completed,
        total: attempts,
        percentage: Math.round((completed / attempts) * 100),
        validSchedules: validFound,
        bestScore: best ? best.score : null,
      });

      await yieldToBrowser();
    }

    const result = best ?? this.buildCandidate(Math.random());
    return { ...result, attempts, validFound };
  }

  private buildCandidate(seed: number): ScheduleCandidate {
    const assignments = this.assign(seed);
    const schedule: MonthlySchedule = {
      year: this.config.year,
      month: this.config.month,
      holidays: this.config.holidays.map(holiday => holiday.date),
      assignments,
    };

    const stats = computeStats([schedule], {
      doctors: this.doctors,
      rooms: this.rooms,
      shiftTypes: this.shiftTypes,
      slotIndex: this.slotIndex,
    });

    const report = findViolations(assignments, {
      rooms: this.rooms,
      doctors: this.doctors,
      shiftTypes: this.shiftTypes,
      availability: this.availability,
      slotIndex: this.slotIndex,
    });
    const gaps = findCoverageGaps(this.requirements, assignments).length;
    const drift = this.rotationDrift(assignments);
    const preferences = this.preferenceCost(assignments);
    const hours = this.hoursCost(assignments);

    const score =
      gaps * PENALTY.coverageGap +
      report.errors.length * PENALTY.error +
      report.warnings.length * PENALTY.warning +
      drift.offPattern * PENALTY.offPattern +
      drift.shouldRest * PENALTY.restedOnDuty +
      preferences +
      hours +
      this.fairnessCost(stats);

    return {
      schedule,
      score,
      stats,
      coverageGaps: gaps,
      errors: report.errors.length,
      warnings: report.warnings.length,
    };
  }

  /**
   * Quanto un calendario si discosta dalla rotazione del servizio: turni che
   * non corrispondono al passo atteso, e turni assegnati in giornate che lo
   * schema vorrebbe di riposo.
   */
  private rotationDrift(assignments: Assignment[]): { offPattern: number; shouldRest: number } {
    if (!this.rotationSeed.isActive) return { offPattern: 0, shouldRest: 0 };

    const tracker = this.rotationSeed.clone();
    const ordered = [...assignments].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return this.shiftTypes.compare(a.shiftTypeId, b.shiftTypeId);
    });

    let offPattern = 0;
    let shouldRest = 0;

    for (const assignment of ordered) {
      const fit = tracker.fit(assignment.doctorId, assignment.date, assignment.shiftTypeId);
      if (fit === 'offPattern') offPattern++;
      else if (fit === 'shouldRest') shouldRest++;
      tracker.record(assignment.doctorId, assignment.date, assignment.shiftTypeId);
    }

    return { offPattern, shouldRest };
  }

  /** Quanto un calendario contraddice le preferenze dichiarate dai medici. */
  private preferenceCost(assignments: Assignment[]): number {
    let cost = 0;

    for (const assignment of assignments) {
      const doctor = this.doctorById.get(assignment.doctorId);
      if (!doctor) continue;

      const weekday = weekdayOfISODate(assignment.date);
      if (this.rules.discourages(doctor.id, weekday, assignment.shiftTypeId)) {
        cost += PENALTY.avoidedWeekday;
      }
      if (this.fitFor(doctor, assignment.shiftTypeId) === 'againstPreference') {
        cost += PENALTY.againstLengthPreference;
      }
    }

    return cost;
  }

  /**
   * Scarto dalle ore richieste. I periodi che escono dal mese non vengono
   * giudicati sul minimo: le ore dei giorni non visibili possono solo
   * aggiungersi.
   */
  private hoursCost(assignments: Assignment[]): number {
    if (!this.hoursTarget.enabled) return 0;

    const report = buildHoursReport({
      year: this.config.year,
      month: this.config.month,
      target: this.hoursTarget,
      doctors: this.doctors,
      shiftTypes: this.shiftTypes,
      assignments: [...this.priorAssignments, ...assignments],
      known: this.knownRange,
    });

    let cost = 0;

    // Gli sforamenti di singolo periodo pesano poco col recupero attivo: a
    // contare è il bilancio complessivo, che non deve uscire dall'intervallo.
    const perPeriodWeight = this.hoursTarget.enforcement === 'cap'
      ? PENALTY.hoursAboveMax
      : PENALTY.hoursAboveMaxRecoverable;

    for (const entry of report.entries) {
      if (entry.status === 'below') cost += entry.gap * PENALTY.hoursBelowMin;
      else if (entry.status === 'above') cost += entry.gap * perPeriodWeight;
    }

    for (const balance of report.balanceIssues) {
      cost += balance.gap * PENALTY.hoursBalance;
    }

    return cost;
  }

  /** Squilibrio del carico fra medici, mesi precedenti inclusi se richiesto. */
  private fairnessCost(stats: DoctorStats[]): number {
    if (stats.length === 0) return Number.POSITIVE_INFINITY;

    const combined = stats.map(stat => {
      const prior = this.priorStats.get(stat.doctorId);
      if (!prior) return stat;
      return {
        ...stat,
        totalShifts: stat.totalShifts + prior.totalShifts,
        totalHours: stat.totalHours + prior.totalHours,
        distinctDays: stat.distinctDays + prior.distinctDays,
        weekendShifts: stat.weekendShifts + prior.weekendShifts,
        criticalShifts: stat.criticalShifts + prior.criticalShifts,
        shiftsByRoom: mergeCounts(stat.shiftsByRoom, prior.shiftsByRoom),
        shiftsByShiftType: mergeCounts(stat.shiftsByShiftType, prior.shiftsByShiftType),
        blocksByShiftType: mergeCounts(stat.blocksByShiftType, prior.blocksByShiftType),
      };
    });

    let cost =
      variance(combined, stat => stat.totalShifts) * PENALTY.varianceShifts +
      variance(combined, stat => stat.totalHours) * PENALTY.varianceHours +
      variance(combined, stat => stat.distinctDays) * PENALTY.varianceDays +
      variance(combined, stat => stat.weekendShifts) * PENALTY.varianceWeekend +
      variance(combined, stat => stat.criticalShifts) * PENALTY.varianceCritical;

    for (const room of this.rooms) {
      cost += variance(combined, stat => stat.shiftsByRoom[room.id] ?? 0) * PENALTY.variancePerRoom;
    }
    for (const shiftType of this.shiftTypes.all) {
      cost += variance(combined, stat => stat.shiftsByShiftType[shiftType.id] ?? 0)
        * PENALTY.variancePerShiftType;
    }
    for (const shiftType of this.shiftTypes.rotational) {
      cost += variance(combined, stat => stat.blocksByShiftType[shiftType.id] ?? 0)
        * PENALTY.variancePerBlock;
    }

    return cost;
  }

  // -------------------------------------------------------------------------
  // Assegnazione
  // -------------------------------------------------------------------------

  private assign(seed: number): Assignment[] {
    const random = createSeededRandom(seed);
    // Ogni tentativo parte dalla stessa posizione di rotazione: il clone
    // impedisce che un tentativo erediti gli spostamenti del precedente.
    const ledger = new DoctorLedger(
      this.doctors,
      this.priorStats,
      this.rotationSeed.clone(),
      new HoursLedger(this.hoursTarget, this.doctors, this.shiftTypes),
    );

    const locked: Assignment[] = this.config.prefilledAssignments.map(assignment => ({
      ...assignment,
      locked: true,
    }));
    const assignments: Assignment[] = [];
    const covered = new Set<string>();

    for (const assignment of locked) {
      assignments.push(assignment);
      covered.add(requirementKey(assignment));
      ledger.record(assignment, this.requirementFor(assignment));
    }

    // I blocchi a rotazione vengono prima di tutto: impegnano un medico per
    // più giorni consecutivi, e assegnarli a giochi fatti lascerebbe soltanto
    // gli scarti fra i turni già distribuiti.
    this.assignRotationalBlocks(assignments, covered, ledger, random);
    this.assignDayGroups(assignments, covered, ledger, random);
    this.assignConsecutiveBlocks(assignments, covered, ledger, random);
    this.assignRemaining(assignments, covered, ledger, random);

    return assignments.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return this.shiftTypes.compare(a.shiftTypeId, b.shiftTypeId);
    });
  }

  private requirementFor(assignment: Assignment): SlotRequirement | undefined {
    return this.requirementsByKey.get(requirementKey(assignment));
  }

  /**
   * Fasce a rotazione (diurnismo e simili): i turni della stessa fascia che
   * cadono nello stesso blocco e nella stessa sala vanno tutti allo stesso
   * medico, e il blocco conta come una unità sola nell'equità.
   */
  private assignRotationalBlocks(
    assignments: Assignment[],
    covered: Set<string>,
    ledger: DoctorLedger,
    random: () => number,
  ): void {
    for (const shiftType of this.shiftTypes.rotational) {
      const blocks = new Map<string, SlotRequirement[]>();

      for (const requirement of this.requirements) {
        if (requirement.shiftTypeId !== shiftType.id) continue;
        if (covered.has(requirementKey(requirement))) continue;

        const key = `${requirement.roomId}|${blockIndexOf(shiftType, requirement.date)}`;
        const bucket = blocks.get(key);
        if (bucket) bucket.push(requirement);
        else blocks.set(key, [requirement]);
      }

      const ordered = [...blocks.entries()].sort((a, b) =>
        a[1][0].date < b[1][0].date ? -1 : a[1][0].date > b[1][0].date ? 1 : 0);

      for (const [, block] of ordered) {
        block.sort(this.byChronology);
        const blockIndex = blockIndexOf(shiftType, block[0].date);

        const doctor = this.pickDoctorForRotationalBlock(
          block, shiftType.id, blockIndex, ledger, random,
        );
        if (!doctor) continue;

        let assigned = 0;
        for (const requirement of block) {
          if (!this.isEligible(doctor, requirement, ledger)) continue;
          this.commit(doctor, requirement, assignments, covered, ledger);
          assigned++;
        }

        if (assigned > 0) ledger.recordBlock(doctor.id, shiftType.id, blockIndex);
      }
    }
  }

  /**
   * Medico a cui affidare un blocco a rotazione. Vince chi ne ha fatti meno
   * finora (mesi precedenti compresi); chi ha già iniziato il blocco nel mese
   * scorso lo completa, per non spezzare una settimana a metà.
   */
  private pickDoctorForRotationalBlock(
    block: SlotRequirement[],
    shiftTypeId: string,
    blockIndex: number,
    ledger: DoctorLedger,
    random: () => number,
  ): Doctor | null {
    const inherited = this.inheritedBlockOwners.get(`${shiftTypeId}|${blockIndex}`);
    if (inherited) {
      const owner = this.doctorById.get(inherited);
      const canContinue = owner
        && block.some(requirement => this.isEligible(owner, requirement, ledger));
      if (owner && canContinue) return owner;
    }

    const candidates = this.doctors
      .map(doctor => ({
        doctor,
        eligible: block.filter(requirement => this.isEligible(doctor, requirement, ledger)).length,
        tiebreak: random(),
      }))
      .filter(candidate => candidate.eligible > 0);

    if (candidates.length === 0) return null;

    // Chi copre solo un paio di giorni su cinque non è un buon titolare del
    // blocco: si preferiscono i medici che riescono a coprirlo quasi tutto.
    const best = Math.max(...candidates.map(candidate => candidate.eligible));
    const threshold = Math.max(1, Math.ceil(best * 0.6));
    const shortlist = candidates.filter(candidate => candidate.eligible >= threshold);

    shortlist.sort((a, b) => {
      const blocks = ledger.blocks(a.doctor.id, shiftTypeId) - ledger.blocks(b.doctor.id, shiftTypeId);
      if (blocks !== 0) return blocks;

      const aFit = rotationRank(ledger.rotation.fit(a.doctor.id, block[0].date, shiftTypeId));
      const bFit = rotationRank(ledger.rotation.fit(b.doctor.id, block[0].date, shiftTypeId));
      if (aFit !== bFit) return aFit - bFit;

      if (a.eligible !== b.eligible) return b.eligible - a.eligible;

      const shifts = ledger.shifts(a.doctor.id) - ledger.shifts(b.doctor.id);
      if (shifts !== 0) return shifts;

      return a.tiebreak - b.tiebreak;
    });

    return shortlist[0].doctor;
  }

  /** Gruppi di giorni: lo stesso medico copre tutti i giorni del gruppo. */
  private assignDayGroups(
    assignments: Assignment[],
    covered: Set<string>,
    ledger: DoctorLedger,
    random: () => number,
  ): void {
    for (const room of this.rooms) {
      if (getRotationMode(room) !== 'dayGroups') continue;

      for (const group of room.dayGroups) {
        if (group.days.length === 0) continue;

        for (const week of this.groupInstances(room, group)) {
          const pending = week.filter(requirement => !covered.has(requirementKey(requirement)));
          if (pending.length === 0) continue;

          const doctor = this.pickDoctorForBlock(pending, ledger, random);
          if (!doctor) continue;

          for (const requirement of pending) {
            if (!this.isEligible(doctor, requirement, ledger)) continue;
            this.commit(doctor, requirement, assignments, covered, ledger);
          }
        }
      }
    }
  }

  /**
   * Istanze di un gruppo di giorni, una per settimana di calendario: così un
   * gruppo non contiguo (es. lunedì + mercoledì) resta un unico blocco
   * affidato allo stesso medico.
   */
  private groupInstances(room: OperativeRoom, group: DayGroup): SlotRequirement[][] {
    const weeks = new Map<number, SlotRequirement[]>();
    const days = new Set<Weekday>(group.days);

    for (const requirement of this.requirements) {
      if (requirement.roomId !== room.id) continue;
      if (!days.has(requirement.weekday)) continue;

      const weekIndex = this.weekIndexOf(requirement.date);
      const bucket = weeks.get(weekIndex);
      if (bucket) bucket.push(requirement);
      else weeks.set(weekIndex, [requirement]);
    }

    return [...weeks.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, bucket]) => bucket.sort(this.byChronology));
  }

  /** Settimana del mese a cui appartiene la data, con inizio al lunedì. */
  private weekIndexOf(date: string): number {
    const offsetOfFirstDay = mondayFirstIndex(
      buildISODate(this.config.year, this.config.month, 1),
    );
    const dayOfMonth = Number(date.slice(8, 10));
    return Math.floor((dayOfMonth - 1 + offsetOfFirstDay) / 7);
  }

  /** Turni consecutivi: blocchi di N turni, o settimanali se ancorati a un giorno. */
  private assignConsecutiveBlocks(
    assignments: Assignment[],
    covered: Set<string>,
    ledger: DoctorLedger,
    random: () => number,
  ): void {
    for (const room of this.rooms) {
      if (getRotationMode(room) !== 'consecutive') continue;

      const pending = this.requirements
        .filter(requirement => requirement.roomId === room.id)
        .filter(requirement => !covered.has(requirementKey(requirement)))
        .sort(this.byChronology);
      if (pending.length === 0) continue;

      const blocks = room.consecutiveStartDay
        ? splitByWeekday(pending, room.consecutiveStartDay)
        : chunk(pending, room.consecutiveShifts!);

      for (const block of blocks) {
        const doctor = this.pickDoctorForBlock(block, ledger, random);
        if (!doctor) continue;

        for (const requirement of block) {
          if (!this.isEligible(doctor, requirement, ledger)) continue;
          this.commit(doctor, requirement, assignments, covered, ledger);
        }
      }
    }
  }

  /** Turni restanti, assegnati privilegiando l'equità del carico. */
  private assignRemaining(
    assignments: Assignment[],
    covered: Set<string>,
    ledger: DoctorLedger,
    random: () => number,
  ): void {
    const pending = this.requirements
      .filter(requirement => !covered.has(requirementKey(requirement)))
      // I turni critici e festivi sono i più difficili da coprire: vengono
      // assegnati per primi, quando ci sono ancora medici disponibili.
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1;
        if (a.isWeekendOrHoliday !== b.isWeekendOrHoliday) return a.isWeekendOrHoliday ? -1 : 1;
        return this.shiftTypes.compare(a.shiftTypeId, b.shiftTypeId);
      });

    for (const requirement of pending) {
      if (covered.has(requirementKey(requirement))) continue;

      const doctor = this.pickDoctor(requirement, ledger, random);
      if (!doctor) continue;

      this.commit(doctor, requirement, assignments, covered, ledger);
    }
  }

  private commit(
    doctor: Doctor,
    requirement: SlotRequirement,
    assignments: Assignment[],
    covered: Set<string>,
    ledger: DoctorLedger,
  ): void {
    const assignment: Assignment = {
      id: generateId(),
      date: requirement.date,
      roomId: requirement.roomId,
      roomName: requirement.roomName,
      shiftTypeId: requirement.shiftTypeId,
      doctorId: doctor.id,
      doctorName: doctor.name,
    };

    assignments.push(assignment);
    covered.add(requirementKey(requirement));
    ledger.record(assignment, requirement);
  }

  private byChronology = (a: SlotRequirement, b: SlotRequirement): number => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return this.shiftTypes.compare(a.shiftTypeId, b.shiftTypeId);
  };

  // -------------------------------------------------------------------------
  // Scelta del medico
  // -------------------------------------------------------------------------

  private isEligible(
    doctor: Doctor,
    requirement: SlotRequirement,
    ledger: DoctorLedger,
    options: { ignoreOffDay?: boolean } = {},
  ): boolean {
    if (doctor.excludedRooms.includes(requirement.roomId)) return false;
    if (this.rules.forbids(doctor.id, requirement.weekday, requirement.shiftTypeId)) return false;
    if (this.availability.isBlocked(doctor.id, requirement.date, requirement.shiftTypeId)) return false;

    // Il massimo impedisce l'assegnazione solo quando è impostato come tetto
    // invalicabile: col recupero attivo resta un criterio di preferenza.
    if (ledger.hours.blocksForMax(doctor.id, requirement.date, requirement.shiftTypeId)) {
      return false;
    }
    if (ledger.isResting(doctor.id, requirement.date)) return false;
    if (!options.ignoreOffDay && ledger.isOff(doctor.id, requirement.date)) return false;
    if (ledger.hasExclusiveShift(doctor.id, requirement.date)) return false;
    if (ledger.isBusy(doctor.id, requirement.date, requirement.shiftTypeId)) return false;

    for (const overlapping of this.shiftTypes.overlapping(requirement.shiftTypeId)) {
      if (ledger.isBusy(doctor.id, requirement.date, overlapping.id)) return false;
    }

    if (requirement.isFullDayExclusive && ledger.dayLoad(doctor.id, requirement.date) > 0) {
      return false;
    }

    // Con la regola di rotazione vincolante, i giorni di smonto e riposo
    // previsti dallo schema non sono assegnabili.
    if (this.rotationRule.strength === 'binding') {
      const fit = ledger.rotation.fit(doctor.id, requirement.date, requirement.shiftTypeId);
      if (fit === 'shouldRest') return false;
    }

    return true;
  }

  private pickDoctor(
    requirement: SlotRequirement,
    ledger: DoctorLedger,
    random: () => number,
  ): Doctor | null {
    const eligible = this.doctors.filter(doctor => this.isEligible(doctor, requirement, ledger));
    if (eligible.length === 0) return null;

    const tiebreak = new Map(eligible.map(doctor => [doctor.id, random()]));

    return [...eligible].sort((a, b) => {
      // La rotazione del servizio viene prima delle altre preferenze: è il
      // criterio che il reparto vuole vedere rispettato, e seguirlo rende
      // già uniforme il carico, perché tutti percorrono la stessa sequenza.
      const aFit = rotationRank(ledger.rotation.fit(a.id, requirement.date, requirement.shiftTypeId));
      const bFit = rotationRank(ledger.rotation.fit(b.id, requirement.date, requirement.shiftTypeId));
      if (aFit !== bFit) return aFit - bFit;

      // Le giornate che il medico preferisce evitare vengono dopo la
      // rotazione ma prima dell'equità: è una richiesta personale, non un
      // vincolo di servizio.
      const aAvoid = this.rules.discourages(a.id, requirement.weekday, requirement.shiftTypeId) ? 1 : 0;
      const bAvoid = this.rules.discourages(b.id, requirement.weekday, requirement.shiftTypeId) ? 1 : 0;
      if (aAvoid !== bAvoid) return aAvoid - bAvoid;

      // Chi è sotto il minimo di ore del periodo ha la precedenza: è il modo
      // di far convergere tutti verso l'intervallo richiesto. Fra chi lo ha
      // già raggiunto si preferisce il meno carico, così le ore in eccesso si
      // distribuiscono invece di accumularsi sulla stessa persona.
      if (ledger.hours.enabled) {
        const aBelow = ledger.hours.isBelowMin(a.id, requirement.date) ? 0 : 1;
        const bBelow = ledger.hours.isBelowMin(b.id, requirement.date) ? 0 : 1;
        if (aBelow !== bBelow) return aBelow - bBelow;

        const loadDifference = ledger.hours.loadRatio(a.id, requirement.date)
          - ledger.hours.loadRatio(b.id, requirement.date);
        if (Math.abs(loadDifference) > 0.001) return loadDifference;
      }

      // Il secondo giorno di riposo è una preferenza, non un divieto: si evita
      // quando c'è alternativa, ma non lascia il turno scoperto.
      const aRest = ledger.isOnSecondRest(a.id, requirement.date) ? 1 : 0;
      const bRest = ledger.isOnSecondRest(b.id, requirement.date) ? 1 : 0;
      if (aRest !== bRest) return aRest - bRest;

      const aLength = lengthRank(this.fitFor(a, requirement.shiftTypeId));
      const bLength = lengthRank(this.fitFor(b, requirement.shiftTypeId));
      if (aLength !== bLength) return aLength - bLength;

      if (requirement.isCritical) {
        const difference = ledger.critical(a.id) - ledger.critical(b.id);
        if (difference !== 0) return difference;
      }

      if (requirement.isWeekendOrHoliday) {
        const difference = ledger.weekend(a.id) - ledger.weekend(b.id);
        if (difference !== 0) return difference;
      }

      // A parità di carico si preferisce chi è già in questa sala nello stesso
      // giorno, per non spezzare la giornata fra reparti diversi.
      const aContinuity = ledger.worksRoomOn(a.id, requirement.date, requirement.roomId) ? 0 : 1;
      const bContinuity = ledger.worksRoomOn(b.id, requirement.date, requirement.roomId) ? 0 : 1;
      if (aContinuity !== bContinuity) return aContinuity - bContinuity;

      const shifts = ledger.shifts(a.id) - ledger.shifts(b.id);
      if (shifts !== 0) return shifts;

      const room = ledger.room(a.id, requirement.roomId) - ledger.room(b.id, requirement.roomId);
      if (room !== 0) return room;

      const shiftType =
        ledger.shiftType(a.id, requirement.shiftTypeId) - ledger.shiftType(b.id, requirement.shiftTypeId);
      if (shiftType !== 0) return shiftType;

      return (tiebreak.get(a.id) ?? 0) - (tiebreak.get(b.id) ?? 0);
    })[0];
  }

  /** Come un turno si rapporta alla preferenza di durata del medico. */
  private fitFor(doctor: Doctor, shiftTypeId: string): LengthFit {
    return lengthFit(
      doctor.shiftLengthPreference, shiftTypeId, this.shiftTypes, this.lengthScale,
    );
  }

  /** Medico per un blocco di turni: deve poter coprire la maggior parte del blocco. */
  private pickDoctorForBlock(
    block: SlotRequirement[],
    ledger: DoctorLedger,
    random: () => number,
  ): Doctor | null {
    const roomId = block[0]?.roomId;
    if (!roomId) return null;

    const scored = this.doctors
      .map(doctor => ({
        doctor,
        eligible: block.filter(requirement => this.isEligible(doctor, requirement, ledger)).length,
        tiebreak: random(),
      }))
      .filter(candidate => candidate.eligible > 0);

    if (scored.length === 0) return null;

    scored.sort((a, b) => {
      if (a.eligible !== b.eligible) return b.eligible - a.eligible;

      const shifts = ledger.shifts(a.doctor.id) - ledger.shifts(b.doctor.id);
      if (shifts !== 0) return shifts;

      const room = ledger.room(a.doctor.id, roomId) - ledger.room(b.doctor.id, roomId);
      if (room !== 0) return room;

      return a.tiebreak - b.tiebreak;
    });

    return scored[0].doctor;
  }

  // -------------------------------------------------------------------------
  // Statistiche dei mesi precedenti
  // -------------------------------------------------------------------------

  /**
   * Somma le statistiche dei mesi già chiusi dell'anno, per continuare a
   * bilanciare il carico anche fra mesi diversi.
   */
  static collectPriorYearStats(options: {
    year: number;
    upToMonth: number;
    doctors: Doctor[];
    rooms: OperativeRoom[];
    shiftTypes: ShiftTypeIndex;
    loadSchedule: (year: number, month: number) => MonthlySchedule | null;
  }): { stats: DoctorStats[]; monthsCovered: number[] } {
    const schedules: MonthlySchedule[] = [];
    const monthsCovered: number[] = [];

    for (let month = 1; month < options.upToMonth; month++) {
      const schedule = options.loadSchedule(options.year, month);
      if (!schedule) continue;
      schedules.push(schedule);
      monthsCovered.push(month);
    }

    const stats = computeStats(schedules, {
      doctors: options.doctors,
      rooms: options.rooms,
      shiftTypes: options.shiftTypes,
    });

    return { stats, monthsCovered };
  }
}

// ---------------------------------------------------------------------------
// Registro del carico per medico
// ---------------------------------------------------------------------------

/**
 * Contatori e vincoli accumulati durante l'assegnazione.
 *
 * Tutte le verifiche sono su `Set`/`Map`: la versione precedente rileggeva
 * l'intero elenco di assegnazioni per ogni candidato, e il costo cresceva col
 * quadrato dei turni del mese.
 */
class DoctorLedger {
  private readonly shiftCount = new Map<string, number>();
  private readonly weekendCount = new Map<string, number>();
  private readonly criticalCount = new Map<string, number>();
  private readonly roomCount = new Map<string, number>();
  private readonly shiftTypeCount = new Map<string, number>();
  private readonly blockCount = new Map<string, number>();
  private readonly dayCount = new Map<string, number>();
  private readonly busySlots = new Set<string>();
  private readonly roomsPerDay = new Set<string>();
  private readonly restDays = new Set<string>();
  private readonly secondRestDays = new Set<string>();
  private readonly exclusiveDays = new Set<string>();
  private readonly offDays = new Set<string>();
  private readonly countedBlocks = new Set<string>();

  constructor(
    doctors: Doctor[],
    priorStats: Map<string, DoctorStats>,
    readonly rotation: RotationTracker,
    readonly hours: HoursLedger,
  ) {
    for (const doctor of doctors) {
      const prior = priorStats.get(doctor.id);
      this.shiftCount.set(doctor.id, prior?.totalShifts ?? 0);
      this.weekendCount.set(doctor.id, prior?.weekendShifts ?? 0);
      this.criticalCount.set(doctor.id, prior?.criticalShifts ?? 0);

      for (const [roomId, count] of Object.entries(prior?.shiftsByRoom ?? {})) {
        this.roomCount.set(`${doctor.id}|${roomId}`, count);
      }
      for (const [shiftTypeId, count] of Object.entries(prior?.shiftsByShiftType ?? {})) {
        this.shiftTypeCount.set(`${doctor.id}|${shiftTypeId}`, count);
      }
      // I blocchi già fatti nei mesi precedenti fanno parte del conteggio:
      // è quello che rende equa la rotazione del diurnismo sull'anno.
      for (const [shiftTypeId, count] of Object.entries(prior?.blocksByShiftType ?? {})) {
        this.blockCount.set(`${doctor.id}|${shiftTypeId}`, count);
      }
    }
  }

  record(assignment: Assignment, requirement: SlotRequirement | undefined): void {
    const { doctorId, date } = assignment;

    bump(this.shiftCount, doctorId);
    bump(this.dayCount, `${doctorId}|${date}`);
    bump(this.roomCount, `${doctorId}|${assignment.roomId}`);
    bump(this.shiftTypeCount, `${doctorId}|${assignment.shiftTypeId}`);
    this.busySlots.add(`${doctorId}|${date}|${assignment.shiftTypeId}`);
    this.roomsPerDay.add(`${doctorId}|${date}|${assignment.roomId}`);
    this.rotation.record(doctorId, date, assignment.shiftTypeId);
    this.hours.add(doctorId, date, assignment.shiftTypeId);

    if (!requirement) return;

    if (requirement.isWeekendOrHoliday) bump(this.weekendCount, doctorId);
    if (requirement.isCritical) bump(this.criticalCount, doctorId);
    if (requirement.requiresNextDayRest) this.restDays.add(`${doctorId}|${addDays(date, 1)}`);
    if (requirement.requiresSecondDayRest) this.secondRestDays.add(`${doctorId}|${addDays(date, 2)}`);
    if (requirement.isFullDayExclusive) this.exclusiveDays.add(`${doctorId}|${date}`);
  }

  markOff(doctorId: string, date: string): void {
    this.offDays.add(`${doctorId}|${date}`);
  }

  /** Registra un blocco a rotazione completato, indipendentemente dai giorni. */
  recordBlock(doctorId: string, shiftTypeId: string, blockIndex: number): void {
    const key = `${doctorId}|${shiftTypeId}|${blockIndex}`;
    if (this.countedBlocks.has(key)) return;
    this.countedBlocks.add(key);
    bump(this.blockCount, `${doctorId}|${shiftTypeId}`);
  }

  shifts = (doctorId: string) => this.shiftCount.get(doctorId) ?? 0;
  weekend = (doctorId: string) => this.weekendCount.get(doctorId) ?? 0;
  critical = (doctorId: string) => this.criticalCount.get(doctorId) ?? 0;
  room = (doctorId: string, roomId: string) => this.roomCount.get(`${doctorId}|${roomId}`) ?? 0;
  shiftType = (doctorId: string, shiftTypeId: string) =>
    this.shiftTypeCount.get(`${doctorId}|${shiftTypeId}`) ?? 0;
  blocks = (doctorId: string, shiftTypeId: string) =>
    this.blockCount.get(`${doctorId}|${shiftTypeId}`) ?? 0;
  dayLoad = (doctorId: string, date: string) => this.dayCount.get(`${doctorId}|${date}`) ?? 0;

  isBusy = (doctorId: string, date: string, shiftTypeId: string) =>
    this.busySlots.has(`${doctorId}|${date}|${shiftTypeId}`);
  worksRoomOn = (doctorId: string, date: string, roomId: string) =>
    this.roomsPerDay.has(`${doctorId}|${date}|${roomId}`);
  isResting = (doctorId: string, date: string) => this.restDays.has(`${doctorId}|${date}`);
  isOnSecondRest = (doctorId: string, date: string) => this.secondRestDays.has(`${doctorId}|${date}`);
  hasExclusiveShift = (doctorId: string, date: string) => this.exclusiveDays.has(`${doctorId}|${date}`);
  isOff = (doctorId: string, date: string) => this.offDays.has(`${doctorId}|${date}`);
}

// ---------------------------------------------------------------------------
// Utilità
// ---------------------------------------------------------------------------

/**
 * Ordine di preferenza rispetto alla rotazione. I medici senza riferimento
 * nello schema restano in mezzo: la regola non ha ancora nulla da dire su di
 * loro, e metterli in coda impedirebbe alla rotazione di avviarsi.
 */
/** Ordine di preferenza rispetto alla durata desiderata dei turni. */
function lengthRank(fit: LengthFit): number {
  if (fit === 'preferred') return 0;
  if (fit === 'neutral') return 1;
  return 2;
}

function rotationRank(fit: RotationFit): number {
  switch (fit) {
    case 'inPattern': return 0;
    case 'unknown': return 1;
    case 'offPattern': return 2;
    case 'shouldRest': return 3;
  }
}

function bump(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

/**
 * Ricostruisce a chi appartiene ogni blocco a rotazione a partire da un
 * calendario già prodotto. Serve a far proseguire allo stesso medico un
 * blocco iniziato nel mese precedente.
 */
function collectBlockOwners(
  assignments: Assignment[],
  shiftTypes: ShiftTypeIndex,
): Map<string, string> {
  const owners = new Map<string, string>();

  for (const assignment of assignments) {
    const blockIndex = shiftTypes.blockIndex(assignment.shiftTypeId, assignment.date);
    if (blockIndex === null) continue;
    owners.set(`${assignment.shiftTypeId}|${blockIndex}`, assignment.doctorId);
  }

  return owners;
}

function mergeCounts(
  left: Record<string, number>,
  right: Record<string, number>,
): Record<string, number> {
  const merged = { ...left };
  for (const [key, value] of Object.entries(right)) {
    merged[key] = (merged[key] ?? 0) + value;
  }
  return merged;
}

function variance(stats: DoctorStats[], valueOf: (stat: DoctorStats) => number): number {
  if (stats.length === 0) return 0;
  const values = stats.map(valueOf);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const blocks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    blocks.push(items.slice(index, index + size));
  }
  return blocks;
}

/** Spezza l'elenco a ogni ricorrenza del giorno indicato, mantenendo i giorni interi. */
function splitByWeekday(requirements: SlotRequirement[], weekday: Weekday): SlotRequirement[][] {
  const blocks: SlotRequirement[][] = [];
  let current: SlotRequirement[] = [];
  let currentDate: string | null = null;

  for (const requirement of requirements) {
    const startsNewBlock =
      current.length > 0 && requirement.weekday === weekday && requirement.date !== currentDate;

    if (startsNewBlock) {
      blocks.push(current);
      current = [];
    }
    if (current.length === 0) currentDate = requirement.date;
    current.push(requirement);
  }

  if (current.length > 0) blocks.push(current);
  return blocks;
}

/**
 * Generatore Lehmer: a parità di seme produce sempre la stessa sequenza, così
 * un tentativo è riproducibile a scopo di diagnosi.
 */
function createSeededRandom(seed: number): () => number {
  const modulus = 2147483647;
  let state = Math.floor(seed * (modulus - 1)) + 1;
  if (state <= 0 || state >= modulus) state = 1;

  return () => {
    state = (state * 16807) % modulus;
    return (state - 1) / (modulus - 1);
  };
}

function yieldToBrowser(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}
