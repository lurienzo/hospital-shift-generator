import { Assignment, Doctor, HoursEnforcement, HoursRange, HoursTarget } from '../models/types';
import { ShiftTypeIndex } from './shiftTypes';
import {
  addDays,
  buildISODate,
  formatMonthLabel,
  formatWeekLabel,
  getDaysInMonth,
  startOfWeek,
} from '../utils/date';

/**
 * Verifica delle ore svolte da ciascun medico rispetto al minimo e al massimo
 * impostati per il servizio.
 *
 * Due accortezze governano questo calcolo.
 *
 * I periodi a cavallo del mese. Una settimana che comincia il 30 marzo e
 * finisce il 5 aprile, guardata dal solo mese di aprile, sembra sempre sotto
 * il minimo. Ogni periodo sa quindi se i suoi giorni ricadono tutti
 * nell'intervallo di dati disponibili: quando non e cosi il minimo non viene
 * giudicato, perche le ore dei giorni non visibili possono solo aggiungersi.
 *
 * Il recupero fra periodi. Con il massimo impostato su "si puo superare", una
 * settimana sopra soglia non e un problema se nelle vicine si sta sotto:
 * quello che conta e il bilancio complessivo sui periodi completi, non il
 * singolo periodo. Solo con il massimo impostato come tetto ogni sforamento
 * viene segnalato per se stesso.
 */

export interface HoursPeriodWindow {
  key: string;
  label: string;
  start: string;
  /** Ultimo giorno incluso. */
  end: string;
  /** Vero se tutti i giorni del periodo sono coperti dai dati disponibili. */
  complete: boolean;
}

export type HoursStatus = 'ok' | 'below' | 'above' | 'partial';

/**
 * Bilancio complessivo di un medico sui periodi completi del mese.
 *
 * `expected` e l'intervallo ammesso per il numero di periodi considerati:
 * con 36-42 ore su quattro settimane complete va da 144 a 168 ore. Finche il
 * totale resta dentro, gli sforamenti di una singola settimana si sono
 * compensati con le altre.
 */
export interface DoctorHoursBalance {
  doctorId: string;
  hours: number;
  /** Periodi completi considerati. */
  periods: number;
  expected: HoursRange;
  /** Ore che mancano al minimo complessivo, o che ne superano il massimo. */
  gap: number;
  status: 'ok' | 'below' | 'above' | 'unknown';
}

export interface DoctorPeriodHours {
  doctorId: string;
  period: HoursPeriodWindow;
  hours: number;
  status: HoursStatus;
  /** Ore che mancano al minimo, o che superano il massimo. */
  gap: number;
}

export interface HoursReport {
  target: HoursTarget;
  periods: HoursPeriodWindow[];
  entries: DoctorPeriodHours[];
  /**
   * Voci che richiedono attenzione. Con il recupero attivo i periodi sopra il
   * massimo non compaiono qui: al loro posto conta il bilancio complessivo.
   */
  issues: DoctorPeriodHours[];
  /** Periodi sopra il massimo che rientrano grazie al recupero. */
  compensated: DoctorPeriodHours[];
  /** Bilancio complessivo per medico, quando ci sono periodi completi. */
  balances: DoctorHoursBalance[];
  /** Solo i bilanci fuori dall'intervallo complessivo. */
  balanceIssues: DoctorHoursBalance[];
  /** Ore totali del mese per medico. */
  monthlyHours: Map<string, number>;
}

export const EMPTY_HOURS_REPORT: HoursReport = {
  target: { enabled: false, period: 'week', min: 0, max: 0, enforcement: 'balance' },
  periods: [],
  entries: [],
  issues: [],
  compensated: [],
  balances: [],
  balanceIssues: [],
  monthlyHours: new Map(),
};

/** Intervallo di date per cui conosciamo tutte le assegnazioni. */
export interface KnownRange {
  from: string;
  to: string;
}

/**
 * Periodi da controllare per un mese. Con la cadenza settimanale si prendono
 * tutte le settimane che toccano il mese, comprese quelle che lo scavalcano.
 */
export function buildHoursPeriods(
  year: number,
  month: number,
  target: HoursTarget,
  known: KnownRange,
): HoursPeriodWindow[] {
  const firstDay = buildISODate(year, month, 1);
  const lastDay = buildISODate(year, month, getDaysInMonth(year, month));

  if (target.period === 'month') {
    return [{
      key: `${year}-${month}`,
      label: formatMonthLabel(year, month),
      start: firstDay,
      end: lastDay,
      complete: known.from <= firstDay && known.to >= lastDay,
    }];
  }

  const periods: HoursPeriodWindow[] = [];
  let monday = startOfWeek(firstDay);

  while (monday <= lastDay) {
    const end = addDays(monday, 6);
    periods.push({
      key: monday,
      label: formatWeekLabel(monday),
      start: monday,
      end,
      complete: known.from <= monday && known.to >= end,
    });
    monday = addDays(monday, 7);
  }

  return periods;
}

/**
 * Ore svolte da ciascun medico in ciascun periodo.
 *
 * `assignments` deve contenere anche i turni dei mesi adiacenti già noti, per
 * poter giudicare le settimane a cavallo.
 */
export function buildHoursReport(options: {
  year: number;
  month: number;
  target: HoursTarget;
  doctors: Doctor[];
  shiftTypes: ShiftTypeIndex;
  assignments: Assignment[];
  known: KnownRange;
}): HoursReport {
  const { year, month, target, doctors, shiftTypes, assignments, known } = options;

  const firstDay = buildISODate(year, month, 1);
  const lastDay = buildISODate(year, month, getDaysInMonth(year, month));

  const monthlyHours = new Map<string, number>();
  for (const assignment of assignments) {
    if (assignment.date < firstDay || assignment.date > lastDay) continue;
    monthlyHours.set(
      assignment.doctorId,
      (monthlyHours.get(assignment.doctorId) ?? 0) + shiftTypes.hours(assignment.shiftTypeId),
    );
  }

  if (!target.enabled) {
    return { ...EMPTY_HOURS_REPORT, target, monthlyHours };
  }

  const periods = buildHoursPeriods(year, month, target, known);
  const entries: DoctorPeriodHours[] = [];

  for (const period of periods) {
    const hoursByDoctor = new Map<string, number>();

    for (const assignment of assignments) {
      if (assignment.date < period.start || assignment.date > period.end) continue;
      hoursByDoctor.set(
        assignment.doctorId,
        (hoursByDoctor.get(assignment.doctorId) ?? 0) + shiftTypes.hours(assignment.shiftTypeId),
      );
    }

    for (const doctor of doctors) {
      const hours = hoursByDoctor.get(doctor.id) ?? 0;
      const range = rangeFor(doctor, target);
      const { status, gap } = classify(hours, range, period.complete);
      entries.push({ doctorId: doctor.id, period, hours, status, gap });
    }
  }

  const balances = buildBalances(entries, doctors, target);

  // Con il recupero attivo lo sforamento di un periodo non e un problema in
  // se: conta il bilancio complessivo, e il periodo viene mostrato a parte.
  const recovering = target.enforcement === 'balance';
  const issues = entries.filter(entry => (
    entry.status === 'below' || (entry.status === 'above' && !recovering)
  ));
  const compensated = recovering
    ? entries.filter(entry => entry.status === 'above')
    : [];

  return {
    target,
    periods,
    entries,
    issues,
    compensated,
    balances,
    balanceIssues: balances.filter(
      balance => balance.status === 'below' || balance.status === 'above',
    ),
    monthlyHours,
  };
}

/**
 * Bilancio complessivo di ciascun medico sui soli periodi completi: i periodi
 * parziali non si possono sommare senza falsare il confronto.
 */
function buildBalances(
  entries: DoctorPeriodHours[],
  doctors: Doctor[],
  target: HoursTarget,
): DoctorHoursBalance[] {
  return doctors.map(doctor => {
    const own = entries.filter(
      entry => entry.doctorId === doctor.id && entry.period.complete,
    );
    const range = rangeFor(doctor, target);
    const hours = own.reduce((sum, entry) => sum + entry.hours, 0);
    const expected = { min: range.min * own.length, max: range.max * own.length };

    if (own.length === 0) {
      return {
        doctorId: doctor.id, hours, periods: 0, expected, gap: 0, status: 'unknown' as const,
      };
    }

    if (hours > expected.max) {
      return {
        doctorId: doctor.id,
        hours,
        periods: own.length,
        expected,
        gap: hours - expected.max,
        status: 'above' as const,
      };
    }
    if (hours < expected.min) {
      return {
        doctorId: doctor.id,
        hours,
        periods: own.length,
        expected,
        gap: expected.min - hours,
        status: 'below' as const,
      };
    }

    return {
      doctorId: doctor.id, hours, periods: own.length, expected, gap: 0, status: 'ok' as const,
    };
  });
}

/** Ore richieste a un medico: le sue, se impostate, altrimenti quelle del servizio. */
export function rangeFor(doctor: Doctor, target: HoursTarget): HoursRange {
  return doctor.hoursOverride ?? { min: target.min, max: target.max };
}

function classify(
  hours: number,
  range: HoursRange,
  complete: boolean,
): { status: HoursStatus; gap: number } {
  if (hours > range.max) return { status: 'above', gap: hours - range.max };

  // Sotto il minimo si giudica solo a periodo completo: le ore dei giorni che
  // non vediamo possono soltanto aggiungersi.
  if (hours < range.min) {
    return complete
      ? { status: 'below', gap: range.min - hours }
      : { status: 'partial', gap: range.min - hours };
  }

  return { status: 'ok', gap: 0 };
}

/**
 * Ore già impegnate da un medico nel periodo che contiene la data, usate dal
 * generatore per non superare il massimo.
 */
export class HoursLedger {
  private readonly hours = new Map<string, number>();
  private readonly periodOf = new Map<string, string>();

  constructor(
    private readonly target: HoursTarget,
    private readonly doctors: Doctor[],
    private readonly shiftTypes: ShiftTypeIndex,
  ) {}

  get enabled(): boolean {
    return this.target.enabled;
  }

  get enforcement(): HoursEnforcement {
    return this.target.enforcement;
  }

  /** Chiave del periodo a cui appartiene una data. */
  periodKey(date: string): string {
    const cached = this.periodOf.get(date);
    if (cached !== undefined) return cached;

    const key = this.target.period === 'week' ? startOfWeek(date) : date.slice(0, 7);
    this.periodOf.set(date, key);
    return key;
  }

  add(doctorId: string, date: string, shiftTypeId: string): void {
    if (!this.target.enabled) return;
    const key = `${doctorId}|${this.periodKey(date)}`;
    this.hours.set(key, (this.hours.get(key) ?? 0) + this.shiftTypes.hours(shiftTypeId));
  }

  hoursIn(doctorId: string, date: string): number {
    return this.hours.get(`${doctorId}|${this.periodKey(date)}`) ?? 0;
  }

  private rangeOf(doctorId: string): HoursRange {
    const doctor = this.doctors.find(candidate => candidate.id === doctorId);
    return doctor ? rangeFor(doctor, this.target) : { min: this.target.min, max: this.target.max };
  }

  /**
   * Vero se il turno non e assegnabile perche sfonderebbe il massimo.
   *
   * Vale solo col massimo impostato come tetto: con il recupero attivo lo
   * sforamento e ammesso, e resta un criterio di preferenza.
   */
  blocksForMax(doctorId: string, date: string, shiftTypeId: string): boolean {
    if (!this.target.enabled || this.target.enforcement !== 'cap') return false;
    return this.wouldExceedMax(doctorId, date, shiftTypeId);
  }

  /** Vero se aggiungere quel turno porterebbe il periodo oltre il massimo. */
  wouldExceedMax(doctorId: string, date: string, shiftTypeId: string): boolean {
    if (!this.target.enabled) return false;
    const range = this.rangeOf(doctorId);
    if (range.max <= 0) return false;
    return this.hoursIn(doctorId, date) + this.shiftTypes.hours(shiftTypeId) > range.max;
  }

  /**
   * Quanto un medico e carico nel periodo, in rapporto al suo massimo.
   *
   * Serve come preferenza col recupero attivo: a parita di altri criteri si
   * sceglie chi e piu lontano dalla propria soglia, cosi le ore in eccesso si
   * distribuiscono invece di accumularsi sulla stessa persona.
   */
  loadRatio(doctorId: string, date: string): number {
    if (!this.target.enabled) return 0;
    const range = this.rangeOf(doctorId);
    if (range.max <= 0) return 0;
    return this.hoursIn(doctorId, date) / range.max;
  }

  /** Vero se il medico è ancora sotto il minimo del periodo. */
  isBelowMin(doctorId: string, date: string): boolean {
    if (!this.target.enabled) return false;
    return this.hoursIn(doctorId, date) < this.rangeOf(doctorId).min;
  }

  /** Riporta nel registro le ore già presenti, per esempio dei turni fissati. */
  seed(assignments: Assignment[]): void {
    for (const assignment of assignments) {
      this.add(assignment.doctorId, assignment.date, assignment.shiftTypeId);
    }
  }
}
