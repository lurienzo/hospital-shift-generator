// Equita cumulata.
//
// Per ogni medico e ogni categoria (turni, ore, notti, weekend, festivi,
// critici, per tipo di turno, per area) si calcola quanto "gli spetterebbe"
// sommando, mese per mese, il carico totale ripartito in proporzione alla sua
// disponibilita: chi e stato in ferie due settimane, chi e part-time, chi non
// fa notti o e entrato in servizio da poco ha una quota piu bassa. Lo scarto
// fra fatto e atteso guida il generatore e compare nelle statistiche.

import type { MonthContext, ShiftInfo } from './context';
import { dayKeyOf, isWeekendOrHoliday, shiftInfos } from './context';
import { monthDates, monthKey, parseMonthKey, shiftMonth } from './dates';
import { monthHolidays } from './holidays';
import type { Doctor, MonthData, Rules, ServiceConfig } from './types';

export interface Tally {
  total: number;
  hours: number;
  nights: number;
  weekends: number;
  holidays: number;
  critical: number;
  byShift: Record<string, number>;
  byArea: Record<string, number>;
}

export const SCALAR_KEYS = ['total', 'hours', 'nights', 'weekends', 'holidays', 'critical'] as const;
export type ScalarKey = typeof SCALAR_KEYS[number];

export function emptyTally(): Tally {
  return { total: 0, hours: 0, nights: 0, weekends: 0, holidays: 0, critical: 0, byShift: {}, byArea: {} };
}

export function addToTally(
  t: Tally,
  date: string,
  areaId: string,
  shift: ShiftInfo | undefined,
  holidays: Map<string, string> | Set<string>,
  critical: boolean,
  sign = 1,
): void {
  if (!shift) return;
  t.total += sign;
  t.hours += sign * shift.hours;
  if (shift.night) t.nights += sign;
  if (isWeekendOrHoliday(date, holidays)) t.weekends += sign;
  if (holidays.has(date)) t.holidays += sign;
  if (critical) t.critical += sign;
  t.byShift[shift.id] = (t.byShift[shift.id] ?? 0) + sign;
  t.byArea[areaId] = (t.byArea[areaId] ?? 0) + sign;
}

export function sumTally(into: Tally, t: Tally, factor = 1): void {
  for (const k of SCALAR_KEYS) into[k] += t[k] * factor;
  for (const [k, v] of Object.entries(t.byShift)) into.byShift[k] = (into.byShift[k] ?? 0) + v * factor;
  for (const [k, v] of Object.entries(t.byArea)) into.byArea[k] = (into.byArea[k] ?? 0) + v * factor;
}

export interface FairBase {
  /** Fatto nei mesi precedenti della finestra. */
  histActual: Tally;
  /** Atteso nei soli mesi precedenti. */
  histExpected: Tally;
  /** Atteso: mesi precedenti + quota del mese corrente. */
  expected: Tally;
  /** Mesi considerati. */
  months: number;
}

/** Mesi precedenti al corrente che entrano nell'equita. */
export function fairnessWindowKeys(rules: Rules, year: number, month: number, allKeys: string[]): string[] {
  const current = monthKey(year, month);
  if (rules.fairnessWindow === 'all') return allKeys.filter(k => k < current).sort();
  const keys: string[] = [];
  const count = rules.fairnessWindow === 'year' ? month - 1 : 12;
  for (let i = 1; i <= count; i++) {
    const m = shiftMonth(year, month, -i);
    keys.push(monthKey(m.year, m.month));
  }
  return keys.sort();
}

function availability(doc: Doctor, key: string, data: MonthData | undefined, dates: string[]): number {
  if (doc.since && doc.since > key) return 0;
  const req = data?.requests[doc.id] ?? {};
  const away = dates.filter(d => req[d] === 'F' || req[d] === 'A').length;
  return (dates.length - away) / dates.length;
}

function partTimeFactor(doc: Doctor, rules: Rules): number {
  if (!rules.hours.enabled || !doc.hours || rules.hours.min <= 0) return 1;
  return Math.max(0, doc.hours.min / rules.hours.min);
}

function canDoNights(doc: Doctor, config: ServiceConfig): boolean {
  if (doc.maxNights === 0) return false;
  return config.shiftTypes.some(s => s.kind === 'night' && !doc.excludedShiftIds.includes(s.id));
}

/** Somma `total * peso / somma pesi` per ogni categoria. */
function distribute(
  doctors: Doctor[],
  config: ServiceConfig,
  total: Tally,
  baseWeight: (d: Doctor) => number,
  into: Map<string, Tally>,
): void {
  const w = new Map(doctors.map(d => [d.id, baseWeight(d)]));
  const share = (value: number, eligible: (d: Doctor) => boolean) => {
    const sum = doctors.reduce((s, d) => s + (eligible(d) ? w.get(d.id)! : 0), 0);
    return (d: Doctor) => (sum > 0 && eligible(d) ? value * w.get(d.id)! / sum : 0);
  };
  const all = () => true;
  const shares = {
    total: share(total.total, all),
    hours: share(total.hours, all),
    nights: share(total.nights, d => canDoNights(d, config)),
    weekends: share(total.weekends, all),
    holidays: share(total.holidays, all),
    critical: share(total.critical, all),
  };
  const byShift = Object.entries(total.byShift).map(([id, v]) => [id, share(v, d => !d.excludedShiftIds.includes(id))] as const);
  const byArea = Object.entries(total.byArea).map(([id, v]) => [id, share(v, d => !d.excludedAreaIds.includes(id))] as const);
  for (const d of doctors) {
    const t = into.get(d.id)!;
    for (const k of SCALAR_KEYS) t[k] += shares[k](d);
    for (const [id, f] of byShift) t.byShift[id] = (t.byShift[id] ?? 0) + f(d);
    for (const [id, f] of byArea) t.byArea[id] = (t.byArea[id] ?? 0) + f(d);
  }
}

export function buildFairness(ctx: MonthContext, months: Record<string, MonthData>): Map<string, FairBase> {
  const { config, doctors } = ctx;
  const rules = config.rules;
  const shifts = ctx.shifts.size ? ctx.shifts : shiftInfos(config);
  const result = new Map<string, FairBase>(doctors.map(d => [d.id, { histActual: emptyTally(), histExpected: emptyTally(), expected: emptyTally(), months: 0 }]));
  const expected = new Map(doctors.map(d => [d.id, result.get(d.id)!.expected]));

  for (const key of fairnessWindowKeys(rules, ctx.year, ctx.month, Object.keys(months))) {
    const data = months[key];
    const version = data?.versions.find(v => v.id === data.activeVersionId);
    if (!version) continue;
    const { year, month } = parseMonthKey(key);
    const dates = monthDates(year, month);
    const holidays = monthHolidays(year, month, rules.patronDay, data);
    const monthTotal = emptyTally();
    for (const a of version.assignments) {
      const fb = result.get(a.doctorId);
      if (!fb) continue;
      const area = ctx.areas.get(a.areaId);
      const critical = !!area?.coverage[dayKeyOf(a.date, holidays)]?.[a.shiftId]?.critical;
      addToTally(fb.histActual, a.date, a.areaId, shifts.get(a.shiftId), holidays, critical);
      addToTally(monthTotal, a.date, a.areaId, shifts.get(a.shiftId), holidays, critical);
    }
    for (const d of doctors) if (!d.since || d.since <= key) result.get(d.id)!.months++;
    distribute(doctors, config, monthTotal, d => availability(d, key, data, dates) * partTimeFactor(d, rules), expected);
  }

  for (const fb of result.values()) sumTally(fb.histExpected, fb.expected);

  // Quota del mese corrente: il fabbisogno dei posti da coprire.
  const demandTotal = emptyTally();
  for (const s of ctx.slots) if (!s.optional) addToTally(demandTotal, s.date, s.areaId, shifts.get(s.shiftId), ctx.holidays, s.critical);
  const currentData = { requests: ctx.requests } as MonthData;
  distribute(doctors, config, demandTotal, d => availability(d, ctx.key, currentData, ctx.dates) * partTimeFactor(d, rules), expected);
  return result;
}
