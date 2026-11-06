// Come raggruppare i posti da coprire in colonne: per area o per turno.
// Usato dalla griglia del calendario e dal foglio di stampa.

import { demandKey, type MonthContext } from '../../domain/context';
import { addDays } from '../../domain/dates';
import type { Area, Assignment, Doctor, ShiftType } from '../../domain/types';

/** Un posto ricorrente: area + turno + indice (se servono piu medici). */
export interface AreaColumn { area: Area; shift: ShiftType; index: number; count: number }

export function areaColumns(ctx: MonthContext, byKey: Map<string, Assignment[]>): AreaColumn[] {
  const cols: AreaColumn[] = [];
  for (const area of ctx.config.areas) {
    for (const shift of ctx.config.shiftTypes) {
      const n = Math.max(0, ...ctx.dates.map(d => Math.max(ctx.demand.get(demandKey(d, area.id, shift.id))?.count ?? 0, byKey.get(demandKey(d, area.id, shift.id))?.length ?? 0)));
      for (let index = 0; index < n; index++) cols.push({ area, shift, index, count: n });
    }
  }
  return cols;
}

/**
 * Turni che si fanno in piu aree: solo per questi serve dire in quale area.
 * Se un turno esiste in una sola area (es. l'area "Notte"), ripeterla e inutile.
 */
export function shiftsInManyAreas(ctx: MonthContext): Set<string> {
  const areasByShift = new Map<string, Set<string>>();
  for (const k of ctx.demand.keys()) {
    const [, areaId, shiftId] = k.split('|');
    (areasByShift.get(shiftId) ?? areasByShift.set(shiftId, new Set()).get(shiftId)!).add(areaId);
  }
  return new Set([...areasByShift].filter(([, a]) => a.size > 1).map(([s]) => s));
}

export type GroupMode = 'area' | 'shift';

/**
 * Etichetta di una riga dentro il gruppo:
 * - per area: la sigla del turno, solo se l'area ha piu turni;
 * - per turno: il nome breve dell'area, solo se il turno e in piu aree;
 * - il numero, solo se lo stesso posto ha piu medici.
 */
export interface LineLabel { shift: ShiftType | null; area: Area | null; index: number | null }

export interface ColumnGroup {
  id: string;
  name: string;
  color: string;
  cols: AreaColumn[];
  /** Gruppo di sole notti: dopo di lui vengono il suo smonto e il suo riposo. */
  night?: boolean;
  label: (c: AreaColumn) => LineLabel | null;
}

export function buildGroups(ctx: MonthContext, columns: AreaColumn[], mode: GroupMode): ColumnGroup[] {
  if (mode === 'area') {
    // Nell'ordine delle aree. Le notti stanno sempre in una colonna a parte:
    // una per area e tipo di notte, mai mescolate fra loro ne con i diurni.
    const groups: ColumnGroup[] = [];
    for (const area of ctx.config.areas) {
      const mine = columns.filter(c => c.area.id === area.id);
      const day = mine.filter(c => c.shift.kind !== 'night');
      const manyShifts = new Set(day.map(c => c.shift.id)).size > 1;
      if (day.length > 0) {
        groups.push({
          id: area.id, name: area.name, color: area.color, cols: day,
          label: c => (manyShifts || c.count > 1 ? { shift: manyShifts ? c.shift : null, area: null, index: c.count > 1 ? c.index + 1 : null } : null),
        });
      }
      const nightShifts = ctx.config.shiftTypes.filter(s => s.kind === 'night' && mine.some(c => c.shift.id === s.id));
      for (const shift of nightShifts) {
        const cols = mine.filter(c => c.shift.id === shift.id);
        groups.push({
          id: `${area.id}|${shift.id}`,
          name: day.length > 0 || nightShifts.length > 1 ? `${area.name} · ${shift.name}` : area.name,
          color: area.color, cols, night: true,
          label: c => (c.count > 1 ? { shift: null, area: null, index: c.index + 1 } : null),
        });
      }
    }
    return groups;
  }
  return ctx.config.shiftTypes
    .map(shift => {
      const cols = columns.filter(c => c.shift.id === shift.id);
      const manyAreas = new Set(cols.map(c => c.area.id)).size > 1;
      return {
        id: shift.id, name: shift.name, color: shift.color, cols, night: shift.kind === 'night',
        label: (c: AreaColumn) => (manyAreas || c.count > 1
          ? { shift: null, area: manyAreas ? c.area : null, index: c.count > 1 ? c.index + 1 : null }
          : null),
      };
    })
    .filter(g => g.cols.length > 0);
}

/** Una colonna della vista: un gruppo di posti, oppure smonto o riposo delle notti di un gruppo. */
export type ViewColumn =
  | { kind: 'slots'; id: string; group: ColumnGroup }
  | { kind: 'off'; id: string; which: 'smonto' | 'riposo'; name: string; night: ColumnGroup };

/**
 * Colonne nell'ordine di lettura della rotazione: ogni notte e seguita dal
 * proprio smonto e dal proprio riposo (es. Lunga | Notte | Smonto | Riposo |
 * SEI Lunga | SEI notte | Smonto | Riposo).
 */
export function viewColumns(groups: ColumnGroup[], showOff: boolean): ViewColumn[] {
  const nights = groups.filter(g => g.night).length;
  const out: ViewColumn[] = [];
  for (const g of groups) {
    out.push({ kind: 'slots', id: g.id, group: g });
    if (!showOff || !g.night) continue;
    for (const which of ['smonto', 'riposo'] as const) {
      const label = which === 'smonto' ? 'Smonto' : 'Riposo';
      out.push({ kind: 'off', id: `${g.id}|${which}`, which, name: nights > 1 ? `${label} ${g.name}` : label, night: g });
    }
  }
  return out;
}

/**
 * Chi e in smonto (notte ieri) o in riposo (notte l'altro ieri, e non ieri)
 * per le notti di un gruppo. dayOf restituisce i turni di un medico in un
 * giorno, compresi quelli degli ultimi giorni del mese precedente.
 */
export function offDoctors(ctx: MonthContext, night: ColumnGroup, date: string, which: 'smonto' | 'riposo', dayOf: (docId: string, date: string) => readonly Assignment[]): Doctor[] {
  const inGroup = (docId: string, d: string) => dayOf(docId, d).some(a => night.cols.some(c => c.area.id === a.areaId && c.shift.id === a.shiftId));
  const anyNight = (docId: string, d: string) => dayOf(docId, d).some(a => ctx.shifts.get(a.shiftId)?.night);
  return ctx.doctors.filter(doc => (which === 'smonto'
    ? inGroup(doc.id, addDays(date, -1))
    : !anyNight(doc.id, addDays(date, -1)) && inGroup(doc.id, addDays(date, -2))));
}
