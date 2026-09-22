import { Assignment, Doctor, HoursRange, HoursTarget } from '../models/types';
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
 * Il punto delicato sono i periodi a cavallo del mese. Una settimana che
 * comincia il 30 marzo e finisce il 5 aprile, guardata dal solo mese di
 * aprile, sembra sempre sotto il minimo. Per questo ogni periodo sa se i suoi
 * giorni ricadono tutti nell'intervallo di dati disponibili: quando non è
 * così, il minimo non viene giudicato, mentre il massimo sì, perché ore che
 * non vediamo possono solo aumentare il totale.
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
  /** Solo le voci che richiedono attenzione. */
  issues: DoctorPeriodHours[];
  /** Ore totali del mese per medico. */
  monthlyHours: Map<string, number>;
}

export const EMPTY_HOURS_REPORT: HoursReport = {
  target: { enabled: false, period: 'week', min: 0, max: 0 },
  periods: [],
  entries: [],
  issues: [],
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

  return {
    target,
    periods,
    entries,
    issues: entries.filter(entry => entry.status === 'below' || entry.status === 'above'),
    monthlyHours,
  };
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

  /** Vero se aggiungere quel turno farebbe superare il massimo del periodo. */
  wouldExceedMax(doctorId: string, date: string, shiftTypeId: string): boolean {
    if (!this.target.enabled) return false;
    const range = this.rangeOf(doctorId);
    if (range.max <= 0) return false;
    return this.hoursIn(doctorId, date) + this.shiftTypes.hours(shiftTypeId) > range.max;
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
