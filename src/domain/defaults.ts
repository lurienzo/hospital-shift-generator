import { DAY_KEYS, type Area, type Coverage, type DayKey, type Doctor, type Rules, type ServiceConfig, type ServiceKind, type ShiftType } from './types';

export function uid(prefix = ''): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36).slice(-4)}${rnd}`;
}

export const PALETTE = [
  '#2563eb', '#0d9488', '#d97706', '#7c3aed', '#db2777', '#059669',
  '#dc2626', '#0891b2', '#65a30d', '#9333ea', '#ea580c', '#4f46e5',
  '#0f766e', '#be185d', '#a16207', '#475569',
];

export function nextColor(used: string[]): string {
  return PALETTE.find(c => !used.includes(c)) ?? PALETTE[used.length % PALETTE.length];
}

export const SHIFT_PRESETS: Omit<ShiftType, 'id'>[] = [
  { name: 'Mattina', code: 'M', start: '08:00', end: '14:00', color: '#f59e0b', kind: 'day', block: null },
  { name: 'Pomeriggio', code: 'P', start: '14:00', end: '20:00', color: '#0ea5e9', kind: 'day', block: null },
  { name: 'Notte', code: 'N', start: '20:00', end: '08:00', color: '#6366f1', kind: 'night', block: null },
  { name: 'Lunga', code: 'L', start: '08:00', end: '20:00', color: '#10b981', kind: 'day', block: null },
  { name: 'Diurnismo', code: 'G', start: '08:00', end: '16:00', color: '#14b8a6', kind: 'day', block: { startWeekday: 0 } },
  { name: 'Guardia 24h', code: 'H', start: '08:00', end: '08:00', color: '#e11d48', kind: 'night', block: null },
];

export function makeShift(preset: Omit<ShiftType, 'id'>): ShiftType {
  return { ...preset, id: uid('t') };
}

export function emptyCoverage(): Coverage {
  return Object.fromEntries(DAY_KEYS.map(k => [k, {}])) as Coverage;
}

/** Imposta la copertura di un turno su un gruppo di colonne. */
export function fillCoverage(
  coverage: Coverage,
  shiftId: string,
  keys: DayKey[],
  count: number,
  critical: boolean,
): Coverage {
  const next = { ...coverage };
  for (const k of keys) {
    next[k] = { ...next[k], [shiftId]: { count, critical } };
  }
  return next;
}

export const WEEKDAYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
export const WEEKEND_HOL: DayKey[] = ['sat', 'sun', 'hol'];

export function defaultRules(): Rules {
  return {
    hours: { enabled: false, min: 36, max: 42, enforcement: 'balance' },
    schemes: [],
    rotation: { schemeId: null, strength: 'preference' },
    maxConsecutiveDays: 6,
    minNightGap: 5,
    allowMultiplePerDay: false,
    longSameArea: 'binding',
    maxDayHours: 12,
    protectDesiderata: true,
    fairnessWindow: 'year',
    weights: { total: 2, nights: 3, weekends: 3, holidays: 2, critical: 1 },
    patronDay: null,
  };
}

export function makeDoctor(name: string, color: string, since: string): Doctor {
  return {
    id: uid('d'),
    name,
    color,
    active: true,
    since,
    excludedAreaIds: [],
    excludedShiftIds: [],
    weekdayRules: [],
    hours: null,
    maxNights: null,
    inRotation: true,
    note: '',
  };
}

export function makeArea(name: string, color: string): Area {
  return { id: uid('a'), name, color, coverage: emptyCoverage() };
}

/** Configurazione iniziale per tipo di servizio. */
export function templateConfig(kind: ServiceKind): ServiceConfig {
  const rules = defaultRules();
  if (kind === 'custom') return { shiftTypes: [], areas: [], doctors: [], rules, fasceV: 2 };

  const [m, p, n] = SHIFT_PRESETS.slice(0, 3).map(makeShift);
  const shiftTypes = [m, p, n];

  if (kind === 'ti') {
    const area = makeArea('Terapia Intensiva', '#0d9488');
    let cov = area.coverage;
    cov = fillCoverage(cov, m.id, WEEKDAYS, 2, true);
    cov = fillCoverage(cov, m.id, WEEKEND_HOL, 1, true);
    cov = fillCoverage(cov, p.id, [...WEEKDAYS, ...WEEKEND_HOL], 1, true);
    cov = fillCoverage(cov, n.id, [...WEEKDAYS, ...WEEKEND_HOL], 1, true);
    return { shiftTypes, areas: [{ ...area, coverage: cov }], doctors: [], rules, fasceV: 2 };
  }

  const s1 = makeArea('Sala 1', '#2563eb');
  const s2 = makeArea('Sala 2', '#7c3aed');
  const guard = makeArea('Guardia', '#dc2626');
  const room = (a: Area) => ({
    ...a,
    coverage: fillCoverage(fillCoverage(a.coverage, m.id, WEEKDAYS, 1, false), p.id, WEEKDAYS, 1, false),
  });
  let gc = guard.coverage;
  gc = fillCoverage(gc, n.id, [...WEEKDAYS, ...WEEKEND_HOL], 1, true);
  gc = fillCoverage(gc, m.id, WEEKEND_HOL, 1, true);
  gc = fillCoverage(gc, p.id, WEEKEND_HOL, 1, true);
  // Nelle sale chi fa mattina puo proseguire col pomeriggio (lunga), nella stessa sala.
  return { shiftTypes, areas: [room(s1), room(s2), { ...guard, coverage: gc }], doctors: [], rules: { ...rules, allowMultiplePerDay: true }, fasceV: 2 };
}

export const SERVICE_KIND_LABELS: Record<ServiceKind, string> = {
  sale: 'Sale operatorie',
  ti: 'Terapia intensiva',
  custom: 'Personalizzato',
};

export const EXAMPLE_DOCTORS = [
  'Rossi', 'Bianchi', 'Verdi', 'Russo', 'Ferrari', 'Esposito', 'Romano', 'Colombo', 'Ricci', 'Marino',
];
