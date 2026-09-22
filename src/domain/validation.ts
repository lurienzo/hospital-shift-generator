import {
  Assignment,
  Doctor,
  DoctorDateMode,
  HolidayConfig,
  OperativeRoom,
  ScheduleSlot,
  Weekday,
  WEEKDAY_LABELS,
} from '../models/types';
import { ShiftTypeIndex } from './shiftTypes';
import { RotationFit, RotationTracker } from './rotation';
import { DoctorRules } from './preferences';
import { DoctorPeriodHours, HoursReport } from './hours';
import { addDays, buildMonthDays, weekdayOfISODate } from '../utils/date';

/**
 * Regole di disponibilità dei medici.
 *
 * Ogni voce è una data (`2026-04-15`) oppure una data con fascia
 * (`2026-04-15:08:00-14:00`). In modalità "esclusione" le voci elencano
 * quando il medico NON può lavorare; in modalità "disponibilità" fanno da
 * whitelist, e un elenco vuoto significa "nessun vincolo".
 */
export class AvailabilityRules {
  private readonly exclusions: Record<string, Set<string>>;
  private readonly availability: Record<string, Set<string>>;
  private readonly modes: Record<string, DoctorDateMode>;

  constructor(config: {
    doctorDateExclusions?: Record<string, string[]>;
    doctorDateAvailability?: Record<string, string[]>;
    doctorAvailabilityMode?: Record<string, DoctorDateMode>;
  }) {
    this.exclusions = toSetMap(config.doctorDateExclusions);
    this.availability = toSetMap(config.doctorDateAvailability);
    this.modes = config.doctorAvailabilityMode ?? {};
  }

  mode(doctorId: string): DoctorDateMode {
    return this.modes[doctorId] ?? 'exclusion';
  }

  /**
   * `shiftTypeId` omesso significa "la giornata intera": il medico risulta
   * bloccato solo se lo è per tutto il giorno, non per una singola fascia.
   */
  isBlocked(doctorId: string, date: string, shiftTypeId?: string): boolean {
    if (this.mode(doctorId) === 'availability') {
      const allowed = this.availability[doctorId];
      if (!allowed || allowed.size === 0) return false;
      if (allowed.has(date)) return false;
      return shiftTypeId ? !allowed.has(`${date}:${shiftTypeId}`) : true;
    }

    const blocked = this.exclusions[doctorId];
    if (!blocked || blocked.size === 0) return false;
    if (blocked.has(date)) return true;
    return shiftTypeId ? blocked.has(`${date}:${shiftTypeId}`) : false;
  }
}

function toSetMap(source?: Record<string, string[]>): Record<string, Set<string>> {
  const result: Record<string, Set<string>> = {};
  for (const [key, values] of Object.entries(source ?? {})) {
    result[key] = new Set(values);
  }
  return result;
}

/**
 * Risolve i turni settimanali di una sala per giorno e fascia.
 *
 * I flag (critico, smontante, esclusivo) appartengono alla coppia
 * giorno + fascia: cercarli guardando solo la fascia farebbe ereditare a una
 * notte del sabato le impostazioni di quella del lunedì.
 */
export class RoomSlotIndex {
  private readonly slots = new Map<string, ScheduleSlot>();
  private readonly rooms = new Map<string, OperativeRoom>();

  constructor(rooms: OperativeRoom[]) {
    for (const room of rooms) {
      this.rooms.set(room.id, room);
      for (const slot of room.slots) {
        this.slots.set(key(room.id, slot.weekday, slot.shiftTypeId), slot);
      }
    }
  }

  room(roomId: string): OperativeRoom | undefined {
    return this.rooms.get(roomId);
  }

  slot(roomId: string, weekday: Weekday, shiftTypeId: string): ScheduleSlot | undefined {
    return this.slots.get(key(roomId, weekday, shiftTypeId));
  }

  slotFor(assignment: Assignment): ScheduleSlot | undefined {
    return this.slot(assignment.roomId, weekdayOfISODate(assignment.date), assignment.shiftTypeId);
  }

  /** `true` se la sala è critica in quella specifica giornata. */
  isCritical(roomId: string, date: string, shiftTypeId: string): boolean {
    return this.slot(roomId, weekdayOfISODate(date), shiftTypeId)?.isCritical ?? false;
  }
}

function key(roomId: string, weekday: Weekday, shiftTypeId: string): string {
  return `${roomId}|${weekday}|${shiftTypeId}`;
}

// ---------------------------------------------------------------------------
// Turni da coprire
// ---------------------------------------------------------------------------

export interface SlotRequirement {
  date: string;
  weekday: Weekday;
  roomId: string;
  roomName: string;
  shiftTypeId: string;
  isWeekendOrHoliday: boolean;
  isCritical: boolean;
  requiresNextDayRest: boolean;
  requiresSecondDayRest: boolean;
  isFullDayExclusive: boolean;
}

export function requirementKey(requirement: {
  date: string;
  roomId: string;
  shiftTypeId: string;
}): string {
  return `${requirement.date}|${requirement.roomId}|${requirement.shiftTypeId}`;
}

/** Elenco di tutti i turni che il mese richiede, sale disabilitate escluse. */
export function buildRequirements(
  rooms: OperativeRoom[],
  year: number,
  month: number,
  holidays: HolidayConfig[],
): SlotRequirement[] {
  const holidayByDate = new Map(holidays.map(holiday => [holiday.date, holiday]));
  const requirements: SlotRequirement[] = [];

  for (const { date, weekday, isWeekend } of buildMonthDays(year, month)) {
    const holiday = holidayByDate.get(date);
    const isWeekendOrHoliday = isWeekend || holiday !== undefined;

    for (const room of rooms) {
      if (holiday?.disabledRooms.includes(room.id)) continue;

      for (const slot of room.slots) {
        if (slot.weekday !== weekday) continue;
        requirements.push({
          date,
          weekday,
          roomId: room.id,
          roomName: room.name,
          shiftTypeId: slot.shiftTypeId,
          isWeekendOrHoliday,
          isCritical: slot.isCritical,
          requiresNextDayRest: slot.requiresNextDayRest,
          requiresSecondDayRest: slot.requiresSecondDayRest,
          isFullDayExclusive: slot.isFullDayExclusive,
        });
      }
    }
  }

  return requirements;
}

// ---------------------------------------------------------------------------
// Violazioni
// ---------------------------------------------------------------------------

export type ViolationCode =
  | 'unavailable'
  | 'excludedRoom'
  | 'excludedWeekday'
  | 'duplicateShift'
  | 'overlappingShift'
  | 'restDay'
  | 'secondRestDay'
  | 'exclusiveDay'
  | 'splitBlock'
  | 'offPattern'
  | 'restedOnDuty'
  | 'avoidedWeekday'
  | 'aboveMaximumHours';

export type Severity = 'error' | 'warning';

export interface Violation {
  assignmentId: string;
  code: ViolationCode;
  severity: Severity;
  /** Etichetta breve mostrata sul turno. */
  label: string;
  /** Spiegazione completa per il tooltip. */
  detail: string;
}

const SEVERITY: Record<ViolationCode, Severity> = {
  unavailable: 'error',
  excludedRoom: 'error',
  excludedWeekday: 'error',
  duplicateShift: 'error',
  overlappingShift: 'error',
  restDay: 'error',
  secondRestDay: 'warning',
  exclusiveDay: 'error',
  splitBlock: 'warning',
  offPattern: 'warning',
  restedOnDuty: 'warning',
  avoidedWeekday: 'warning',
  aboveMaximumHours: 'warning',
};

export interface ViolationContext {
  rooms: OperativeRoom[];
  doctors: Doctor[];
  shiftTypes: ShiftTypeIndex;
  availability: AvailabilityRules;
  slotIndex?: RoomSlotIndex;
  /**
   * Rotazione del servizio, già avviata coi mesi precedenti. Se assente, gli
   * scostamenti dalla rotazione non vengono valutati.
   */
  rotation?: RotationTracker;
  /** Divieti e preferenze dei medici su giorni e fasce. */
  rules?: DoctorRules;
  /**
   * Ore per periodo. Le voci oltre il massimo vengono segnalate sui turni che
   * compongono il periodo eccedente.
   */
  hours?: HoursReport;
}

export interface ViolationReport {
  byAssignment: Map<string, Violation[]>;
  errors: Violation[];
  warnings: Violation[];
}

export const EMPTY_VIOLATION_REPORT: ViolationReport = {
  byAssignment: new Map(),
  errors: [],
  warnings: [],
};

/** Violazione più grave di un turno, quella da mostrare sul chip. */
export function primaryViolation(
  report: ViolationReport,
  assignmentId: string,
): Violation | undefined {
  const violations = report.byAssignment.get(assignmentId);
  if (!violations || violations.length === 0) return undefined;
  return violations.find(violation => violation.severity === 'error') ?? violations[0];
}

/**
 * Valuta tutti i vincoli su un insieme di assegnazioni.
 *
 * I turni pre-compilati sono voluti dall'utente e non vengono segnalati, ma
 * contribuiscono ai riposi e alle esclusività: un turno automatico che cade
 * il giorno dopo una notte bloccata resta quindi un errore.
 */
export function findViolations(
  assignments: Assignment[],
  context: ViolationContext,
): ViolationReport {
  const { doctors, shiftTypes, availability } = context;
  const slotIndex = context.slotIndex ?? new RoomSlotIndex(context.rooms);
  const doctorById = new Map(doctors.map(doctor => [doctor.id, doctor]));

  const restDays = new Set<string>();
  const secondRestDays = new Set<string>();
  const exclusiveDays = new Set<string>();

  // I riposi generati da un turno valgono per i giorni successivi, quindi
  // l'ordine cronologico va stabilito prima di valutare i vincoli.
  const ordered = [...assignments].sort(byDateThenShift(shiftTypes));

  for (const assignment of ordered) {
    const slot = slotIndex.slotFor(assignment);
    if (!slot) continue;
    const doctorDay = `${assignment.doctorId}|`;
    if (slot.requiresNextDayRest) {
      restDays.add(doctorDay + addDays(assignment.date, 1));
    }
    if (slot.requiresSecondDayRest) {
      secondRestDays.add(doctorDay + addDays(assignment.date, 2));
    }
    if (slot.isFullDayExclusive) {
      exclusiveDays.add(doctorDay + assignment.date);
    }
  }

  const byAssignment = new Map<string, Violation[]>();
  const errors: Violation[] = [];
  const warnings: Violation[] = [];

  const sameDay = groupBy(ordered, assignment => `${assignment.doctorId}|${assignment.date}`);
  const splitBlocks = findSplitBlocks(ordered, shiftTypes);

  // La rotazione va valutata scorrendo le date in ordine, perché la posizione
  // di ciascun medico dipende dal turno che ha svolto prima.
  const rules = context.rules;
  const overloaded = collectOverloadedPeriods(context.hours);
  const rotation = context.rotation?.clone();
  const rotationFits = new Map<string, RotationFit>();
  if (rotation) {
    for (const assignment of ordered) {
      rotationFits.set(
        assignment.id,
        rotation.fit(assignment.doctorId, assignment.date, assignment.shiftTypeId),
      );
      rotation.record(assignment.doctorId, assignment.date, assignment.shiftTypeId);
    }
  }

  for (const assignment of ordered) {
    if (assignment.locked) continue;

    const found: Violation[] = [];
    const doctor = doctorById.get(assignment.doctorId);
    const shiftType = shiftTypes.get(assignment.shiftTypeId);
    const weekday = weekdayOfISODate(assignment.date);
    const siblings = (sameDay.get(`${assignment.doctorId}|${assignment.date}`) ?? [])
      .filter(other => other.id !== assignment.id);

    if (availability.isBlocked(assignment.doctorId, assignment.date, assignment.shiftTypeId)) {
      found.push(violation(assignment, 'unavailable', 'Non disponibile',
        `${assignment.doctorName} non è disponibile in questa data`));
    }

    if (doctor?.excludedRooms.includes(assignment.roomId)) {
      found.push(violation(assignment, 'excludedRoom', 'Sala esclusa',
        `${assignment.doctorName} non lavora in ${assignment.roomName}`));
    }

    const ruleLevel = rules?.levelFor(assignment.doctorId, weekday, assignment.shiftTypeId);
    if (ruleLevel === 'never') {
      found.push(violation(assignment, 'excludedWeekday', 'Giorno escluso',
        `${assignment.doctorName} non lavora ${describeWhen(weekday, shiftType.name)}`));
    } else if (ruleLevel === 'avoid') {
      found.push(violation(assignment, 'avoidedWeekday', 'Preferenza',
        `${assignment.doctorName} preferisce non lavorare ${describeWhen(weekday, shiftType.name)}`));
    }

    if (siblings.some(other => other.shiftTypeId === assignment.shiftTypeId)) {
      found.push(violation(assignment, 'duplicateShift', 'Doppio turno',
        `${assignment.doctorName} è assegnato due volte alla fascia ${shiftType.name}`));
    }

    const overlapping = shiftTypes.overlapping(assignment.shiftTypeId).map(type => type.id);
    if (overlapping.length > 0 && siblings.some(other => overlapping.includes(other.shiftTypeId))) {
      found.push(violation(assignment, 'overlappingShift', 'Orari sovrapposti',
        `${assignment.doctorName} ha un altro turno che si sovrappone a ${shiftType.name}`));
    }

    const doctorDay = `${assignment.doctorId}|${assignment.date}`;
    if (restDays.has(doctorDay)) {
      found.push(violation(assignment, 'restDay', 'Smontante',
        `${assignment.doctorName} è smontante: il giorno prima ha un turno che impone riposo`));
    } else if (secondRestDays.has(doctorDay)) {
      found.push(violation(assignment, 'secondRestDay', 'Riposo',
        `${assignment.doctorName} dovrebbe essere a riposo (secondo giorno dopo il turno)`));
    }

    const slot = slotIndex.slotFor(assignment);
    const conflictsWithExclusive = slot?.isFullDayExclusive
      ? siblings.length > 0
      : siblings.some(other => slotIndex.slotFor(other)?.isFullDayExclusive ?? false);

    if (conflictsWithExclusive) {
      found.push(violation(assignment, 'exclusiveDay', 'Turno esclusivo',
        `${assignment.doctorName} ha un turno esclusivo in questa giornata`));
    }

    if (splitBlocks.has(assignment.id)) {
      found.push(violation(assignment, 'splitBlock', 'Blocco diviso',
        `${shiftType.name} è una fascia a rotazione: il blocco dovrebbe essere coperto da un solo medico`));
    }

    if (overloaded.has(overloadKey(assignment, context.hours))) {
      const entry = overloaded.get(overloadKey(assignment, context.hours))!;
      found.push(violation(assignment, 'aboveMaximumHours', 'Oltre le ore',
        `${assignment.doctorName} arriva a ${formatHours(entry.hours)} nel periodo `
        + `${entry.period.label}, ${formatHours(entry.gap)} oltre il massimo`));
    }

    const fit = rotationFits.get(assignment.id);
    if (fit === 'shouldRest') {
      found.push(violation(assignment, 'restedOnDuty', 'Fuori rotazione',
        `La rotazione del servizio prevede un giorno non lavorativo per ${assignment.doctorName}`));
    } else if (fit === 'offPattern') {
      const expected = rotationExpectation(context.rotation, assignment, shiftTypes);
      found.push(violation(assignment, 'offPattern', 'Fuori rotazione',
        `La rotazione del servizio prevedeva ${expected} per ${assignment.doctorName}`));
    }

    if (found.length === 0) continue;

    found.sort((a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'));
    byAssignment.set(assignment.id, found);
    for (const item of found) {
      (item.severity === 'error' ? errors : warnings).push(item);
    }
  }

  return { byAssignment, errors, warnings };
}

function violation(
  assignment: Assignment,
  code: ViolationCode,
  label: string,
  detail: string,
): Violation {
  return { assignmentId: assignment.id, code, severity: SEVERITY[code], label, detail };
}

/** "il giovedì" oppure "il giovedì pomeriggio", secondo la granularità della regola. */
function describeWhen(weekday: Weekday, shiftTypeName: string): string {
  return `${WEEKDAY_LABELS[weekday].toLowerCase()} in fascia ${shiftTypeName.toLowerCase()}`;
}

/** Periodi in cui un medico supera il massimo di ore. */
function collectOverloadedPeriods(report?: HoursReport): Map<string, DoctorPeriodHours> {
  const result = new Map<string, DoctorPeriodHours>();
  if (!report) return result;

  for (const entry of report.entries) {
    if (entry.status !== 'above') continue;
    result.set(`${entry.doctorId}|${entry.period.key}`, entry);
  }
  return result;
}

/** Chiave del periodo a cui appartiene un turno, secondo la cadenza impostata. */
function overloadKey(assignment: Assignment, report?: HoursReport): string {
  if (!report) return '';
  const period = report.periods.find(
    candidate => assignment.date >= candidate.start && assignment.date <= candidate.end,
  );
  return period ? `${assignment.doctorId}|${period.key}` : '';
}

function formatHours(hours: number): string {
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

/** Descrizione del passo che la rotazione si aspettava, per il messaggio. */
function rotationExpectation(
  rotation: RotationTracker | undefined,
  assignment: Assignment,
  shiftTypes: ShiftTypeIndex,
): string {
  const step = rotation?.expectedStep(assignment.doctorId, assignment.date);
  if (!step) return 'un altro turno';
  return step.kind === 'shift' ? shiftTypes.get(step.shiftTypeId).name : 'un giorno non lavorativo';
}

/**
 * Turni di una fascia a rotazione che, all'interno dello stesso blocco e
 * della stessa sala, risultano divisi fra medici diversi.
 */
function findSplitBlocks(assignments: Assignment[], shiftTypes: ShiftTypeIndex): Set<string> {
  const blocks = new Map<string, Assignment[]>();

  for (const assignment of assignments) {
    const blockIndex = shiftTypes.blockIndex(assignment.shiftTypeId, assignment.date);
    if (blockIndex === null) continue;

    const blockKey = `${assignment.roomId}|${assignment.shiftTypeId}|${blockIndex}`;
    const bucket = blocks.get(blockKey);
    if (bucket) bucket.push(assignment);
    else blocks.set(blockKey, [assignment]);
  }

  const split = new Set<string>();
  for (const bucket of blocks.values()) {
    const doctors = new Set(bucket.map(assignment => assignment.doctorId));
    if (doctors.size <= 1) continue;
    for (const assignment of bucket) split.add(assignment.id);
  }

  return split;
}

/** Turni richiesti dal mese che sono rimasti senza medico. */
export function findCoverageGaps(
  requirements: SlotRequirement[],
  assignments: Assignment[],
): SlotRequirement[] {
  const covered = new Set(assignments.map(requirementKey));
  return requirements.filter(requirement => !covered.has(requirementKey(requirement)));
}

export function byDateThenShift(shiftTypes: ShiftTypeIndex) {
  return (a: Assignment, b: Assignment): number => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return shiftTypes.compare(a.shiftTypeId, b.shiftTypeId);
  };
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const groupKey = keyOf(item);
    const group = groups.get(groupKey);
    if (group) group.push(item);
    else groups.set(groupKey, [item]);
  }
  return groups;
}
