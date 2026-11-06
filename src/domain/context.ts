import { addDays, monthDates, monthKey, shiftHours, shiftInterval, shiftMonth, weekdayOf } from './dates';
import { monthHolidays } from './holidays';
import { buildFairness, type FairBase } from './fairness';
import {
  WEEK_KEYS, emptyMonth,
  type Area, type Assignment, type DayKey, type Doctor, type MonthData, type SchemeStep, type ServiceConfig, type ShiftType, type SlotOverride,
} from './types';

export interface ShiftInfo extends ShiftType {
  hours: number;
  interval: [number, number];
  night: boolean;
  isBlock: boolean;
}

/** Un posto da coprire: data + area + turno + indice (se servono piu medici). */
export interface Slot {
  key: string;
  date: string;
  areaId: string;
  shiftId: string;
  index: number;
  critical: boolean;
  /** Opzionale: se resta vuoto non e segnalato. */
  optional: boolean;
}

export interface MonthContext {
  year: number;
  month: number;
  key: string;
  dates: string[];
  dateSet: Set<string>;
  holidays: Map<string, string>;
  config: ServiceConfig;
  shifts: Map<string, ShiftInfo>;
  areas: Map<string, Area>;
  /** Medici attivi. */
  doctors: Doctor[];
  doctorById: Map<string, Doctor>;
  requests: MonthData['requests'];
  slots: Slot[];
  /** date|area|shift -> fabbisogno */
  demand: Map<string, Demand>;
  /** Turni rimossi per un giorno: chiave -> medici che servivano di base. */
  removed: Map<string, number>;
  /** Ultimi giorni del mese precedente (versione definitiva): continuita di smonto, riposo, rotazione. */
  tailByDoctor: Map<string, Assignment[]>;
  tailDates: string[];
  fair: Map<string, FairBase>;
  scheme: SchemeStep[] | null;
}

export const TAIL_DAYS = 7;

export const demandKey = (date: string, areaId: string, shiftId: string) => `${date}|${areaId}|${shiftId}`;

export function dayKeyOf(date: string, holidays: Map<string, string> | Set<string>): DayKey {
  return holidays.has(date) ? 'hol' : WEEK_KEYS[weekdayOf(date)];
}

export function isWeekendOrHoliday(date: string, holidays: Map<string, string> | Set<string>): boolean {
  return holidays.has(date) || weekdayOf(date) >= 5;
}

export function shiftInfos(config: ServiceConfig): Map<string, ShiftInfo> {
  return new Map(config.shiftTypes.map(s => [s.id, {
    ...s,
    hours: shiftHours(s.start, s.end),
    interval: shiftInterval(s.start, s.end),
    night: s.kind === 'night',
    isBlock: s.block !== null,
  }]));
}

/** Posti da coprire nel mese, secondo la griglia di copertura delle aree. */
export interface Demand {
  count: number;
  critical: boolean;
  optional: boolean;
}

export function buildSlots(
  config: ServiceConfig,
  dates: string[],
  holidays: Map<string, string>,
  overrides: Record<string, SlotOverride> = {},
): { slots: Slot[]; demand: Map<string, Demand>; removed: Map<string, number> } {
  const slots: Slot[] = [];
  const demand = new Map<string, Demand>();
  /** Turni tolti per un giorno: chiave -> quanti medici servivano di base. */
  const removed = new Map<string, number>();
  const shifts = new Map(config.shiftTypes.map(s => [s.id, s]));
  const order = new Map(config.shiftTypes.map((s, i) => [s.id, i]));
  // Turni aggiunti a mano: data|area -> turni.
  const added = new Map<string, Set<string>>();
  for (const k of Object.keys(overrides)) {
    const [date, areaId, shiftId] = k.split('|');
    const dk = `${date}|${areaId}`;
    (added.get(dk) ?? added.set(dk, new Set()).get(dk)!).add(shiftId);
  }
  for (const date of dates) {
    const dk = dayKeyOf(date, holidays);
    for (const area of config.areas) {
      const cov = area.coverage[dk] ?? {};
      const ids = new Set([...Object.keys(cov), ...(added.get(`${date}|${area.id}`) ?? [])]);
      const sorted = [...ids].filter(sid => shifts.has(sid)).sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0));
      for (const shiftId of sorted) {
        const key = demandKey(date, area.id, shiftId);
        const cell = cov[shiftId];
        const base = cell?.count ?? 0;
        const ov = overrides[key];
        const count = ov?.count ?? base;
        const optional = ov?.optional ?? shifts.get(shiftId)!.optional ?? false;
        const critical = !!cell?.critical && !optional;
        if (count <= 0) {
          if (base > 0) removed.set(key, base);
          continue;
        }
        demand.set(key, { count, critical, optional });
        for (let index = 0; index < count; index++) {
          slots.push({ key: `${key}|${index}`, date, areaId: area.id, shiftId, index, critical, optional });
        }
      }
    }
  }
  return { slots, demand, removed };
}

export interface BuildContextInput {
  config: ServiceConfig;
  year: number;
  month: number;
  months: Record<string, MonthData>;
}

export function activeAssignments(data: MonthData | undefined): Assignment[] | null {
  if (!data?.activeVersionId) return null;
  return data.versions.find(v => v.id === data.activeVersionId)?.assignments ?? null;
}

export function buildContext({ config, year, month, months }: BuildContextInput): MonthContext {
  const key = monthKey(year, month);
  const data = months[key] ?? emptyMonth();
  const dates = monthDates(year, month);
  const holidays = monthHolidays(year, month, config.rules.patronDay, data);
  const shifts = shiftInfos(config);
  const doctors = config.doctors.filter(d => d.active);
  const { slots, demand, removed } = buildSlots(config, dates, holidays, data.overrides ?? {});

  // Coda del mese precedente: solo la versione definitiva fa testo.
  const prev = shiftMonth(year, month, -1);
  const prevAssignments = activeAssignments(months[monthKey(prev.year, prev.month)]) ?? [];
  const tailDates = Array.from({ length: TAIL_DAYS }, (_, i) => addDays(dates[0], i - TAIL_DAYS));
  const tailSet = new Set(tailDates);
  const tailByDoctor = new Map<string, Assignment[]>();
  for (const a of prevAssignments) {
    if (!tailSet.has(a.date)) continue;
    const list = tailByDoctor.get(a.doctorId) ?? [];
    list.push(a);
    tailByDoctor.set(a.doctorId, list);
  }

  const schemeId = config.rules.rotation.schemeId;
  const scheme = config.rules.schemes.find(s => s.id === schemeId);
  const steps = scheme?.steps.filter(s => s.kind !== 'shift' || shifts.has(s.shiftId)) ?? [];

  const ctx: MonthContext = {
    year, month, key, dates,
    dateSet: new Set(dates),
    holidays,
    config,
    shifts,
    areas: new Map(config.areas.map(a => [a.id, a])),
    doctors,
    doctorById: new Map(config.doctors.map(d => [d.id, d])),
    requests: data.requests,
    slots,
    demand,
    removed,
    tailByDoctor,
    tailDates,
    fair: new Map(),
    scheme: steps.length > 0 ? steps : null,
  };
  ctx.fair = buildFairness(ctx, months);
  return ctx;
}
