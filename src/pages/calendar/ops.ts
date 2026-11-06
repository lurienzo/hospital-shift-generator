import { dayKeyOf, demandKey, type MonthContext } from '../../domain/context';
import { formatDay } from '../../domain/dates';
import { uid } from '../../domain/defaults';
import type { Assignment, SlotOverride } from '../../domain/types';
import { ensureVersion, updateVersion, type MonthView } from '../../store/month';
import { notify, updateMonth } from '../../store/store';

type SlotRef = Pick<Assignment, 'date' | 'areaId' | 'shiftId'>;

/**
 * Assegna un posto. Le modifiche a mano NON vengono fissate: il lucchetto e
 * una scelta esplicita ("questo turno non cambia se rigenero").
 */
export function assign(view: MonthView, slot: SlotRef, doctorId: string, replacing?: Assignment) {
  const versionId = ensureVersion(view);
  updateVersion(view.key, versionId, list => {
    if (replacing) return list.map(a => (a.id === replacing.id ? { ...a, doctorId } : a));
    return [...list, { id: uid('x'), ...slot, doctorId }];
  });
}

export function removeAssignment(view: MonthView, id: string) {
  if (!view.version) return;
  updateVersion(view.key, view.version.id, list => list.filter(a => a.id !== id));
}

export function toggleLock(view: MonthView, id: string) {
  if (!view.version) return;
  updateVersion(view.key, view.version.id, list => list.map(a => (a.id === id ? { ...a, locked: !a.locked } : a)));
}

export function unlockAll(view: MonthView) {
  if (!view.version) return;
  updateVersion(view.key, view.version.id, list => list.map(a => ({ ...a, locked: false })));
}

export function clearUnlocked(view: MonthView) {
  if (!view.version) return;
  updateVersion(view.key, view.version.id, list => list.filter(a => a.locked));
}

/** Esito di un trascinamento, calcolato senza applicarlo. */
export interface DropPlan {
  /** Calendario risultante; null se lo spostamento non e possibile. */
  list: Assignment[] | null;
  message: string;
  /** Medici i cui turni cambiano. */
  doctors: string[];
}

const NONE: DropPlan = { list: null, message: '', doctors: [] };

/**
 * Turni di un medico (una giornata) lasciati sulla casella di un altro medico:
 * - stesso giorno: i due si scambiano la giornata (o il turno passa all'altro);
 * - giorno diverso con turni: scambio di turni fra i due medici;
 * - giorno diverso vuoto: il turno si sposta a quel giorno, se quel giorno lo prevede.
 */
export function planDoctorDay(ctx: MonthContext, list: Assignment[], ids: string[], doctorId: string, date: string): DropPlan {
  const source = list.filter(a => ids.includes(a.id));
  if (source.length === 0) return NONE;
  const fromDoctor = source[0].doctorId;
  const fromDate = source[0].date;
  if (fromDoctor === doctorId && fromDate === date) return NONE;
  const target = list.filter(a => a.doctorId === doctorId && a.date === date);
  const docName = (id: string) => ctx.doctorById.get(id)?.name ?? '';

  if (target.length > 0 || date === fromDate) {
    if (fromDoctor === doctorId) return NONE;
    const targetIds = new Set(target.map(a => a.id));
    return {
      list: list.map(a => (ids.includes(a.id) ? { ...a, doctorId } : targetIds.has(a.id) ? { ...a, doctorId: fromDoctor } : a)),
      message: target.length ? `Scambio fra ${docName(fromDoctor)} e ${docName(doctorId)}` : `Turno passato a ${docName(doctorId)}`,
      doctors: [fromDoctor, doctorId],
    };
  }

  const missing = source.find(a => !ctx.demand.has(demandKey(date, a.areaId, a.shiftId)));
  if (missing) {
    return {
      list: null,
      message: `${formatDay(date)} non prevede ${ctx.shifts.get(missing.shiftId)?.name.toLowerCase() ?? 'quel turno'} in ${ctx.areas.get(missing.areaId)?.name ?? 'quell’area'}`,
      doctors: [],
    };
  }
  return {
    list: list.map(a => (ids.includes(a.id) ? { ...a, doctorId, date } : a)),
    message: `Turno spostato a ${formatDay(date)}`,
    doctors: [fromDoctor, doctorId],
  };
}

/** Vista per area: su un altro turno scambia i medici, su un buco sposta il turno. */
export function planSlot(list: Assignment[], id: string, slot: SlotRef, targetId: string | null): DropPlan {
  const a = list.find(x => x.id === id);
  if (!a || a.id === targetId) return NONE;
  if (targetId) {
    const b = list.find(x => x.id === targetId);
    if (!b || b.doctorId === a.doctorId) return NONE;
    return {
      list: list.map(x => (x.id === a.id ? { ...x, doctorId: b.doctorId } : x.id === b.id ? { ...x, doctorId: a.doctorId } : x)),
      message: 'Medici scambiati',
      doctors: [a.doctorId, b.doctorId],
    };
  }
  return { list: list.map(x => (x.id === a.id ? { ...x, ...slot } : x)), message: 'Turno spostato', doctors: [a.doctorId] };
}

function apply(view: MonthView, plan: DropPlan) {
  if (!view.version) return;
  if (!plan.list) { if (plan.message) notify(plan.message, 'error'); return; }
  const next = plan.list;
  updateVersion(view.key, view.version.id, () => next);
  notify(plan.message);
}

export function dropOnDoctorDay(view: MonthView, ids: string[], doctorId: string, date: string) {
  if (!view.version || !view.ctx) return;
  apply(view, planDoctorDay(view.ctx, view.version.assignments, ids, doctorId, date));
}

export function dropOnSlot(view: MonthView, id: string, slot: SlotRef, targetId: string | null) {
  if (!view.version || !view.ctx) return;
  apply(view, planSlot(view.version.assignments, id, slot, targetId));
}

// --- Variazioni del singolo giorno: rimuovi, aggiungi, opzionale -------------

function baseCount(ctx: MonthContext, slot: SlotRef): number {
  return ctx.areas.get(slot.areaId)?.coverage[dayKeyOf(slot.date, ctx.holidays)]?.[slot.shiftId]?.count ?? 0;
}

function setOverride(view: MonthView, slot: SlotRef, fn: (o: SlotOverride) => SlotOverride) {
  const k = demandKey(slot.date, slot.areaId, slot.shiftId);
  updateMonth(view.key, m => {
    const overrides = { ...(m.overrides ?? {}) };
    const next = fn({ ...(overrides[k] ?? {}) });
    if (next.count === undefined && next.optional === undefined) delete overrides[k];
    else overrides[k] = next;
    return { ...m, overrides };
  });
}

/** Toglie un posto (un medico) da quel turno per quel giorno; con l'ultimo il turno risulta rimosso. */
export function removeSlot(view: MonthView, slot: SlotRef, current: Assignment | null) {
  if (!view.ctx) return;
  const count = view.ctx.demand.get(demandKey(slot.date, slot.areaId, slot.shiftId))?.count ?? 0;
  const next = Math.max(0, count - 1);
  if (current) removeAssignment(view, current.id);
  setOverride(view, slot, o => ({ ...o, count: next === baseCount(view.ctx!, slot) ? undefined : next }));
  notify(next === 0 ? `Turno rimosso per ${formatDay(slot.date)}` : 'Posto tolto dal turno');
}

export function restoreSlot(view: MonthView, slot: SlotRef) {
  setOverride(view, slot, o => ({ ...o, count: undefined }));
  notify('Turno ripristinato');
}

/** Aggiunge un posto a quel turno per quel giorno (anche se l'area normalmente non lo prevede). */
export function addSlot(view: MonthView, slot: SlotRef) {
  if (!view.ctx) return;
  const count = view.ctx.demand.get(demandKey(slot.date, slot.areaId, slot.shiftId))?.count ?? 0;
  const next = count + 1;
  setOverride(view, slot, o => ({ ...o, count: next === baseCount(view.ctx!, slot) ? undefined : next }));
  notify(`Turno aggiunto per ${formatDay(slot.date)}`);
}

export function setSlotOptional(view: MonthView, slot: SlotRef, optional: boolean) {
  if (!view.ctx) return;
  const byDefault = view.ctx.shifts.get(slot.shiftId)?.optional ?? false;
  setOverride(view, slot, o => ({ ...o, optional: optional === byDefault ? undefined : optional }));
  notify(optional ? 'Turno opzionale per questo giorno' : 'Turno di nuovo da coprire');
}
