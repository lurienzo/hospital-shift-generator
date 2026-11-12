// Fasce di un'area: le righe della pagina "Turni e copertura".
//
// Una fascia e un turno (nome, orario, colore) presente nella copertura di
// un'area. La stessa fascia puo stare in piu aree (es. "Lunga" in due linee):
// e cosi che la rotazione e l'equita la riconoscono come lo stesso turno.
// Non esiste piu un elenco separato di tipi di turno da tenere allineato:
// una fascia nasce aggiungendola a un'area e sparisce togliendola dall'ultima.
// Funzioni pure, senza dipendenze dal browser.

import { makeShift, uid, WEEKDAYS } from './defaults';
import { DAY_KEYS, type Area, type Coverage, type CoverageCell, type DayKey, type ServiceConfig, type ShiftType } from './types';

/** La fascia e fra le righe dell'area (anche con tutti i giorni a zero). */
export function hasFascia(area: Area, shiftId: string): boolean {
  return DAY_KEYS.some(k => area.coverage[k]?.[shiftId] !== undefined);
}

/** Le fasce dell'area, nell'ordine comune dei turni. */
export function fasceOf(config: ServiceConfig, area: Area): ShiftType[] {
  return config.shiftTypes.filter(s => hasFascia(area, s.id));
}

/** Le aree che usano una fascia. */
export function areasUsing(config: ServiceConfig, shiftId: string): Area[] {
  return config.areas.filter(a => hasFascia(a, shiftId));
}

function dropFromCoverage(coverage: Coverage, shiftId: string): Coverage {
  return Object.fromEntries(DAY_KEYS.map(k => {
    const rest = { ...(coverage[k] ?? {}) };
    delete rest[shiftId];
    return [k, rest];
  })) as Coverage;
}

const mapArea = (c: ServiceConfig, areaId: string, fn: (a: Area) => Area): ServiceConfig =>
  ({ ...c, areas: c.areas.map(a => (a.id === areaId ? fn(a) : a)) });

/** Sigla libera a partire da una base ("M", poi "M2", "M3"...). */
export function freeCode(config: ServiceConfig, base: string): string {
  const used = new Set(config.shiftTypes.map(s => s.code));
  const root = (base.trim().toUpperCase() || 'T').slice(0, 3);
  let code = root;
  for (let i = 2; used.has(code); i++) code = `${root.slice(0, 2)}${i}`;
  return code;
}

/** Elimina un turno ovunque: copertura, esclusioni dei medici, schemi di rotazione. */
export function deleteShift(c: ServiceConfig, shiftId: string): ServiceConfig {
  return {
    ...c,
    shiftTypes: c.shiftTypes.filter(s => s.id !== shiftId),
    areas: c.areas.map(a => ({ ...a, coverage: dropFromCoverage(a.coverage, shiftId) })),
    doctors: c.doctors.map(d => ({ ...d, excludedShiftIds: d.excludedShiftIds.filter(x => x !== shiftId), weekdayRules: d.weekdayRules.filter(r => r.shiftId !== shiftId) })),
    rules: { ...c.rules, schemes: c.rules.schemes.map(sc => ({ ...sc, steps: sc.steps.filter(st => st.kind !== 'shift' || st.shiftId !== shiftId) })) },
  };
}

/** Il turno e citato da uno schema di rotazione o dalle regole di un medico. */
export function isReferenced(c: ServiceConfig, shiftId: string): boolean {
  return c.rules.schemes.some(sc => sc.steps.some(st => st.kind === 'shift' && st.shiftId === shiftId))
    || c.doctors.some(d => d.excludedShiftIds.includes(shiftId) || d.weekdayRules.some(r => r.shiftId === shiftId));
}

/** Toglie la fascia dall'area; se non resta in nessun'altra, il turno sparisce del tutto. */
export function removeFascia(c: ServiceConfig, areaId: string, shiftId: string): ServiceConfig {
  const next = mapArea(c, areaId, a => ({ ...a, coverage: dropFromCoverage(a.coverage, shiftId) }));
  return areasUsing(next, shiftId).length > 0 ? next : deleteShift(next, shiftId);
}

/** Giorni di partenza di una fascia nuova: le notti tutti i giorni, i diurni dal lunedi al venerdi. */
function defaultDays(shift: Pick<ShiftType, 'kind'>): DayKey[] {
  return shift.kind === 'night' ? DAY_KEYS : WEEKDAYS;
}

/**
 * Aggiunge all'area una fascia che esiste gia. Parte dagli stessi giorni
 * dell'area che gia la usa, cosi una seconda linea nasce uguale alla prima.
 */
export function addExistingFascia(c: ServiceConfig, areaId: string, shiftId: string): ServiceConfig {
  const shift = c.shiftTypes.find(s => s.id === shiftId);
  if (!shift) return c;
  const model = c.areas.find(a => a.id !== areaId && DAY_KEYS.some(k => (a.coverage[k]?.[shiftId]?.count ?? 0) > 0));
  const days = defaultDays(shift);
  return mapArea({ ...c, shiftTypes: c.shiftTypes.map(s => (s.id === shiftId && s.areaId ? { ...s, areaId: null } : s)) }, areaId, a => {
    const coverage = { ...a.coverage };
    for (const k of DAY_KEYS) {
      const cell: CoverageCell = model ? model.coverage[k]?.[shiftId] ?? { count: 0, critical: false } : { count: days.includes(k) ? 1 : 0, critical: false };
      coverage[k] = { ...coverage[k], [shiftId]: { ...cell } };
    }
    return { ...a, coverage };
  });
}

/** Crea una fascia nuova e la mette nell'area. */
export function addNewFascia(c: ServiceConfig, areaId: string, preset: Omit<ShiftType, 'id'>): ServiceConfig {
  const shift = makeShift({ ...preset, code: freeCode(c, preset.code), areaId: null });
  return addExistingFascia({ ...c, shiftTypes: [...c.shiftTypes, shift] }, areaId, shift.id);
}

/**
 * Separa la fascia dalle altre aree: quest'area riceve una copia propria, da
 * modificare (nome, orario) senza toccare le altre.
 */
export function splitFascia(c: ServiceConfig, areaId: string, shiftId: string): ServiceConfig {
  const shift = c.shiftTypes.find(s => s.id === shiftId);
  const area = c.areas.find(a => a.id === areaId);
  if (!shift || !area || areasUsing(c, shiftId).length < 2) return c;
  const copy: ShiftType = { ...shift, id: uid('t'), name: `${shift.name} (${area.name})`, code: freeCode(c, shift.code), areaId: null };
  const i = c.shiftTypes.findIndex(s => s.id === shiftId);
  const shiftTypes = [...c.shiftTypes.slice(0, i + 1), copy, ...c.shiftTypes.slice(i + 1)];
  return mapArea({ ...c, shiftTypes }, areaId, a => ({
    ...a,
    coverage: Object.fromEntries(DAY_KEYS.map(k => {
      const day = { ...(a.coverage[k] ?? {}) };
      const cell = day[shiftId];
      delete day[shiftId];
      return [k, cell ? { ...day, [copy.id]: cell } : day];
    })) as Coverage,
  }));
}

/** Sposta la fascia sopra o sotto la fascia vicina della stessa area. */
export function moveFascia(c: ServiceConfig, areaId: string, shiftId: string, delta: -1 | 1): ServiceConfig {
  const area = c.areas.find(a => a.id === areaId);
  if (!area) return c;
  const rows = fasceOf(c, area);
  const other = rows[rows.findIndex(s => s.id === shiftId) + delta];
  if (!other) return c;
  const list = [...c.shiftTypes];
  const i = list.findIndex(s => s.id === shiftId), j = list.findIndex(s => s.id === other.id);
  [list[i], list[j]] = [list[j], list[i]];
  return { ...c, shiftTypes: list };
}

/** Imposta le caselle di una fascia nei giorni indicati. */
export function setCells(c: ServiceConfig, areaId: string, shiftId: string, keys: readonly DayKey[], next: (cell: CoverageCell, key: DayKey) => CoverageCell): ServiceConfig {
  return mapArea(c, areaId, a => {
    const coverage = { ...a.coverage };
    for (const k of keys) coverage[k] = { ...coverage[k], [shiftId]: next(a.coverage[k]?.[shiftId] ?? { count: 0, critical: false }, k) };
    return { ...a, coverage };
  });
}

/** Elimina un'area e i turni che usava solo lei. */
export function deleteArea(c: ServiceConfig, areaId: string): ServiceConfig {
  const area = c.areas.find(a => a.id === areaId);
  if (!area) return c;
  let next: ServiceConfig = {
    ...c,
    areas: c.areas.filter(a => a.id !== areaId),
    doctors: c.doctors.map(d => ({ ...d, excludedAreaIds: d.excludedAreaIds.filter(x => x !== areaId) })),
  };
  for (const s of fasceOf(c, area)) if (areasUsing(next, s.id).length === 0) next = deleteShift(next, s.id);
  return next;
}

/**
 * Passaggio dal vecchio modello (ogni area mostrava tutti i tipi di turno,
 * anche a zero) al nuovo: restano solo le righe con almeno un medico. Si fa
 * una volta sola, poi una riga azzerata a mano resta dov'e.
 */
export function migrateFasce(c: ServiceConfig): ServiceConfig {
  if (c.fasceV) return c;
  return {
    ...c,
    fasceV: 2,
    areas: (c.areas ?? []).map(a => {
      let coverage = a.coverage;
      const ids = new Set(DAY_KEYS.flatMap(k => Object.keys(a.coverage?.[k] ?? {})));
      for (const id of ids) {
        if (DAY_KEYS.every(k => (a.coverage[k]?.[id]?.count ?? 0) === 0)) coverage = dropFromCoverage(coverage, id);
      }
      return { ...a, coverage };
    }),
  };
}
