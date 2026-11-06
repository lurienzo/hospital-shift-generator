// Come raggruppare i posti da coprire in colonne: per area o per turno.
// Usato dalla griglia del calendario e dal foglio di stampa.

import { demandKey, type MonthContext } from '../../domain/context';
import type { Area, Assignment, ShiftType } from '../../domain/types';

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
  label: (c: AreaColumn) => LineLabel | null;
}

export function buildGroups(ctx: MonthContext, columns: AreaColumn[], mode: GroupMode): ColumnGroup[] {
  if (mode === 'area') {
    // Le notti stanno sempre in una colonna a parte, dopo le aree: una per
    // ogni tipo di notte, con l'area indicata se la notte e in piu aree.
    const nightShifts = ctx.config.shiftTypes.filter(s => s.kind === 'night');
    const nightGroups = buildGroups(ctx, columns.filter(c => c.shift.kind === 'night'), 'shift')
      .filter(g => nightShifts.some(s => s.id === g.id));
    const dayGroups = ctx.config.areas
      .map(area => {
        const cols = columns.filter(c => c.area.id === area.id && c.shift.kind !== 'night');
        const manyShifts = new Set(cols.map(c => c.shift.id)).size > 1;
        return {
          id: area.id, name: area.name, color: area.color, cols,
          label: (c: AreaColumn) => (manyShifts || c.count > 1
            ? { shift: manyShifts ? c.shift : null, area: null, index: c.count > 1 ? c.index + 1 : null }
            : null),
        };
      })
      .filter(g => g.cols.length > 0);
    return [...dayGroups, ...nightGroups];
  }
  return ctx.config.shiftTypes
    .map(shift => {
      const cols = columns.filter(c => c.shift.id === shift.id);
      const manyAreas = new Set(cols.map(c => c.area.id)).size > 1;
      return {
        id: shift.id, name: shift.name, color: shift.color, cols,
        label: (c: AreaColumn) => (manyAreas || c.count > 1
          ? { shift: null, area: manyAreas ? c.area : null, index: c.count > 1 ? c.index + 1 : null }
          : null),
      };
    })
    .filter(g => g.cols.length > 0);
}
