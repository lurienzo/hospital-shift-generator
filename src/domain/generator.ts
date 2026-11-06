// Generatore dei turni.
//
// 1. I turni fissati a mano restano dove sono.
// 2. I blocchi di diurnismo vengono assegnati per settimana intera.
// 3. Giorno per giorno, prima i critici, poi le notti, poi il resto: ogni
//    posto va al medico per cui il costo complessivo (vincoli morbidi +
//    equita) cresce di meno. Le violazioni rigide escludono il medico; un
//    turno critico puo forzare solo quelle "forzabili" (doppio turno non
//    sovrapposto, tetto ore, rotazione vincolante), mai ferie o smonto.
// 4. Si ripete con ordini e rumori diversi e si tiene il migliore.
// 5. Una ricerca locale (spostamenti e scambi) rifinisce il risultato.

import { blockStart, COST, evaluateDoctor, groupByDoctor, type DoctorEval } from './analysis';
import { demandKey, type MonthContext, type Slot } from './context';
import { addDays } from './dates';
import { uid } from './defaults';
import type { Assignment, Doctor } from './types';

export interface GenerateOptions {
  /** Tempo massimo in millisecondi. */
  timeMs?: number;
  seed?: number;
  /** Turni da mantenere (fissati a mano). */
  locked?: Assignment[];
  onProgress?: (fraction: number) => void;
}

export interface GenerateResult {
  assignments: Assignment[];
  score: number;
  iterations: number;
}

/** Generatore pseudo-casuale riproducibile (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class State {
  readonly byDoc = new Map<string, Assignment[]>();
  readonly evals = new Map<string, DoctorEval>();
  /** date|area|shift -> numero di assegnati */
  readonly filled = new Map<string, number>();

  constructor(private ctx: MonthContext, initial: Assignment[]) {
    for (const d of ctx.doctors) this.byDoc.set(d.id, []);
    for (const a of initial) {
      if (!this.byDoc.has(a.doctorId)) continue;
      this.byDoc.get(a.doctorId)!.push(a);
      this.bump(a, 1);
    }
    for (const d of ctx.doctors) this.evals.set(d.id, evaluateDoctor(ctx, d, this.byDoc.get(d.id)!));
  }

  bump(a: Pick<Assignment, 'date' | 'areaId' | 'shiftId'>, delta: number) {
    const k = demandKey(a.date, a.areaId, a.shiftId);
    this.filled.set(k, (this.filled.get(k) ?? 0) + delta);
  }

  isFilled(slot: Slot): boolean {
    return (this.filled.get(demandKey(slot.date, slot.areaId, slot.shiftId)) ?? 0) > slot.index;
  }

  /** Valuta il medico con un'assegnazione in piu (senza applicarla). */
  tryAdd(doc: Doctor, a: Assignment): DoctorEval {
    return evaluateDoctor(this.ctx, doc, [...this.byDoc.get(doc.id)!, a]);
  }

  add(doc: Doctor, a: Assignment, ev?: DoctorEval) {
    const list = this.byDoc.get(doc.id)!;
    list.push(a);
    this.bump(a, 1);
    this.evals.set(doc.id, ev ?? evaluateDoctor(this.ctx, doc, list));
  }

  all(): Assignment[] {
    return [...this.byDoc.values()].flat();
  }

  uncoveredCost(): number {
    let cost = 0;
    for (const [k, d] of this.ctx.demand) {
      const missing = d.count - (this.filled.get(k) ?? 0);
      if (missing > 0 && !d.optional) cost += missing * (d.critical ? COST.uncoveredCritical : COST.uncovered);
    }
    return cost;
  }

  score(): number {
    let s = this.uncoveredCost();
    for (const ev of this.evals.values()) s += ev.total;
    return s;
  }
}

/** Il medico puo prendere il posto? Restituisce la valutazione o null. */
function feasible(before: DoctorEval, after: DoctorEval, critical: boolean): boolean {
  if (after.strict > before.strict) return false;
  if (after.relaxable > before.relaxable && !critical) return false;
  if (after.protectedViolations > before.protectedViolations) return false;
  return true;
}

function makeAssignment(slot: Pick<Slot, 'date' | 'areaId' | 'shiftId'>, doctorId: string): Assignment {
  return { id: uid('x'), date: slot.date, areaId: slot.areaId, shiftId: slot.shiftId, doctorId };
}

function assignBlocks(ctx: MonthContext, state: State, random: () => number) {
  for (const shift of ctx.shifts.values()) {
    if (!shift.isBlock) continue;
    const start = shift.block!.startWeekday;
    // Raggruppa i posti per area, settimana e indice.
    const groups = new Map<string, Slot[]>();
    for (const s of ctx.slots) {
      if (s.shiftId !== shift.id) continue;
      const k = `${s.areaId}|${blockStart(s.date, start)}|${s.index}`;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
    }
    for (const [k, slots] of groups) {
      const open = slots.filter(s => !state.isFilled(s));
      if (open.length === 0) continue;
      const [areaId, weekStartDate] = k.split('|');
      // Continuita: chi aveva iniziato il blocco nel mese precedente lo finisce.
      let continuing: string | null = null;
      for (let d = weekStartDate; d < ctx.dates[0]; d = addDays(d, 1)) {
        for (const [docId, list] of ctx.tailByDoctor) {
          if (list.some(a => a.date === d && a.shiftId === shift.id && a.areaId === areaId)) continuing = docId;
        }
      }
      let best: { doc: Doctor; cost: number; take: Slot[] } | null = null;
      for (const doc of ctx.doctors) {
        const before = state.evals.get(doc.id)!;
        const take: Slot[] = [];
        let list = [...state.byDoc.get(doc.id)!];
        let ev = before;
        for (const s of open) {
          const a = makeAssignment(s, doc.id);
          const next = evaluateDoctor(ctx, doc, [...list, a]);
          if (!feasible(ev, next, s.critical)) continue;
          list = [...list, a];
          ev = next;
          take.push(s);
        }
        if (take.length === 0) continue;
        // Si preferisce chi copre tutto il blocco.
        const missingPenalty = (open.length - take.length) * 5_000;
        const continuity = continuing === doc.id ? -10_000 : 0;
        const cost = (ev.total - before.total) / take.length + missingPenalty + continuity + random() * 20;
        if (!best || cost < best.cost) best = { doc, cost, take };
      }
      if (!best) continue;
      for (const s of best.take) state.add(best.doc, makeAssignment(s, best.doc.id));
    }
  }
}

function greedy(ctx: MonthContext, locked: Assignment[], random: () => number, noise: number): State {
  const state = new State(ctx, locked);
  assignBlocks(ctx, state, random);

  const byDate = new Map<string, Slot[]>();
  for (const s of ctx.slots) (byDate.get(s.date) ?? byDate.set(s.date, []).get(s.date)!).push(s);

  for (const date of ctx.dates) {
    const slots = (byDate.get(date) ?? []).filter(s => !state.isFilled(s));
    const rank = (s: Slot) => (s.critical ? 0 : 2) + (ctx.shifts.get(s.shiftId)?.night ? 0 : 1) + random() * 0.9;
    const order = slots.map(s => ({ s, r: rank(s) })).sort((a, b) => a.r - b.r).map(x => x.s);

    for (const slot of order) {
      if (state.isFilled(slot)) continue;
      let best: { doc: Doctor; cost: number; ev: DoctorEval; a: Assignment } | null = null;
      for (const doc of ctx.doctors) {
        const before = state.evals.get(doc.id)!;
        const a = makeAssignment(slot, doc.id);
        const after = state.tryAdd(doc, a);
        if (!feasible(before, after, slot.critical)) continue;
        // Un turno opzionale va solo a chi ci guadagna (es. chi e sotto carico).
        if (slot.optional && after.total - before.total >= 0) continue;
        const cost = after.total - before.total + (random() - 0.5) * noise;
        if (!best || cost < best.cost) best = { doc, cost, ev: after, a };
      }
      if (best) state.add(best.doc, best.a, best.ev);
    }
  }
  return state;
}

/** Ricerca locale: spostamenti, scambi e riempimento dei buchi. */
function improve(ctx: MonthContext, state: State, random: () => number, deadline: number, onProgress?: (p: number) => void, progressStart = 0.45) {
  const docs = ctx.doctors;
  if (docs.length < 2) return;
  const lockedIds = new Set<string>();
  // I blocchi di diurnismo si muovono solo interi: qui restano fermi.
  const movable = () => state.all().filter(a => !a.locked && !lockedIds.has(a.id) && !ctx.shifts.get(a.shiftId)?.isBlock);
  let pool = movable();
  let iter = 0;
  const startTime = performance.now();
  const span = Math.max(1, deadline - startTime);
  const docById = new Map(docs.map(d => [d.id, d]));

  const replace = (docId: string, list: Assignment[], ev: DoctorEval) => {
    state.byDoc.set(docId, list);
    state.evals.set(docId, ev);
  };

  while (performance.now() < deadline) {
    iter++;
    if (iter % 200 === 0) {
      pool = movable();
      onProgress?.(progressStart + (1 - progressStart) * Math.min(1, (performance.now() - startTime) / span));
    }
    const temp = 40 * Math.max(0, 1 - (performance.now() - startTime) / span);
    const accept = (delta: number) => delta < 0 || (temp > 0.5 && random() < Math.exp(-delta / temp));
    const move = random();

    if (move < 0.15) {
      // Riempi un buco.
      const holes = ctx.slots.filter(s => !state.isFilled(s));
      if (holes.length === 0) continue;
      const slot = holes[Math.floor(random() * holes.length)];
      const doc = docs[Math.floor(random() * docs.length)];
      const before = state.evals.get(doc.id)!;
      const a = makeAssignment(slot, doc.id);
      const after = state.tryAdd(doc, a);
      if (!feasible(before, after, slot.critical)) continue;
      const gain = slot.optional ? 0 : slot.critical ? COST.uncoveredCritical : COST.uncovered;
      if (after.total - before.total - gain < 0) state.add(doc, a, after);
      continue;
    }

    if (pool.length === 0) continue;
    const a = pool[Math.floor(random() * pool.length)];
    const from = docById.get(a.doctorId);
    if (!from) continue;
    const critical = ctx.demand.get(demandKey(a.date, a.areaId, a.shiftId))?.critical ?? false;

    if (move < 0.55) {
      // Sposta il turno su un altro medico.
      const to = docs[Math.floor(random() * docs.length)];
      if (to.id === from.id) continue;
      const fromList = state.byDoc.get(from.id)!.filter(x => x !== a);
      const moved = { ...a, doctorId: to.id };
      const toList = [...state.byDoc.get(to.id)!, moved];
      const evFrom = evaluateDoctor(ctx, from, fromList);
      const evTo = evaluateDoctor(ctx, to, toList);
      const bFrom = state.evals.get(from.id)!, bTo = state.evals.get(to.id)!;
      if (!feasible(bTo, evTo, critical) || evFrom.strict > bFrom.strict) continue;
      const delta = evFrom.total + evTo.total - bFrom.total - bTo.total;
      if (accept(delta)) {
        replace(from.id, fromList, evFrom);
        replace(to.id, toList, evTo);
        const i = pool.indexOf(a);
        if (i >= 0) pool[i] = moved;
      }
    } else {
      // Scambia due turni fra due medici.
      const b = pool[Math.floor(random() * pool.length)];
      if (b.doctorId === a.doctorId || b.date === a.date && b.shiftId === a.shiftId) continue;
      const other = docById.get(b.doctorId);
      if (!other) continue;
      const critB = ctx.demand.get(demandKey(b.date, b.areaId, b.shiftId))?.critical ?? false;
      const a2 = { ...a, doctorId: other.id };
      const b2 = { ...b, doctorId: from.id };
      const fromList = [...state.byDoc.get(from.id)!.filter(x => x !== a), b2];
      const otherList = [...state.byDoc.get(other.id)!.filter(x => x !== b), a2];
      const evFrom = evaluateDoctor(ctx, from, fromList);
      const evOther = evaluateDoctor(ctx, other, otherList);
      const bFrom = state.evals.get(from.id)!, bOther = state.evals.get(other.id)!;
      if (!feasible(bFrom, evFrom, critB) || !feasible(bOther, evOther, critical)) continue;
      const delta = evFrom.total + evOther.total - bFrom.total - bOther.total;
      if (accept(delta)) {
        replace(from.id, fromList, evFrom);
        replace(other.id, otherList, evOther);
        const ia = pool.indexOf(a), ib = pool.indexOf(b);
        if (ia >= 0) pool[ia] = a2;
        if (ib >= 0) pool[ib] = b2;
      }
    }
  }
}

export function generate(ctx: MonthContext, options: GenerateOptions = {}): GenerateResult {
  const timeMs = options.timeMs ?? 2500;
  const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
  const random = rng(seed);
  const locked = (options.locked ?? []).map(a => ({ ...a, locked: true }));
  const start = performance.now();
  const greedyDeadline = start + timeMs * 0.45;

  let best: State | null = null;
  let bestScore = Infinity;
  let iterations = 0;
  do {
    const noise = iterations === 0 ? 0 : 20 + random() * 60;
    const state = greedy(ctx, locked, random, noise);
    const score = state.score();
    iterations++;
    if (score < bestScore) { best = state; bestScore = score; }
    options.onProgress?.(Math.min(0.45, (performance.now() - start) / timeMs));
  } while (performance.now() < greedyDeadline && ctx.doctors.length > 0);

  if (!best) best = new State(ctx, locked);
  improve(ctx, best, random, start + timeMs, options.onProgress);
  options.onProgress?.(1);

  // I turni fissati di medici non piu attivi restano: li segnala l'analisi.
  const active = new Set(ctx.doctors.map(d => d.id));
  const assignments = [...best.all(), ...locked.filter(a => !active.has(a.doctorId))];
  return { assignments, score: best.score(), iterations };
}

export { groupByDoctor };
