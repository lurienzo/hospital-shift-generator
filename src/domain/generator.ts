// Generatore dei turni.
//
// 1. I turni fissati a mano restano dove sono.
// 2. I blocchi di diurnismo vengono assegnati per settimana intera.
// 3. Giorno per giorno, prima i critici, poi le notti, poi il resto: ogni
//    posto va al medico per cui il costo complessivo (vincoli morbidi +
//    equita) cresce di meno. Le violazioni rigide escludono il medico; un
//    turno critico puo forzare solo quelle "forzabili" (doppio turno non
//    sovrapposto, tetto ore, rotazione vincolante), mai ferie o smonto.
//    Con uno schema di rotazione, i turni che lo schema mette in giorni
//    consecutivi (es. lunga e poi notte) si assegnano insieme come una
//    catena allo stesso medico.
// 4. Si ripete con ordini e rumori diversi e si tiene il migliore.
// 5. Una ricerca locale (spostamenti e scambi, a catene intere) rifinisce il
//    risultato.

import { blockStart, COST, evaluateDoctor, groupByDoctor, schemePositions, schemeShiftAt, type DoctorEval } from './analysis';
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

  /** Valuta il medico con delle assegnazioni in piu (senza applicarle). */
  tryAdd(doc: Doctor, adds: Assignment[]): DoctorEval {
    return evaluateDoctor(this.ctx, doc, [...this.byDoc.get(doc.id)!, ...adds]);
  }

  add(doc: Doctor, adds: Assignment[], ev?: DoctorEval) {
    const list = this.byDoc.get(doc.id)!;
    for (const a of adds) { list.push(a); this.bump(a, 1); }
    this.evals.set(doc.id, ev ?? evaluateDoctor(this.ctx, doc, list));
  }

  /** Sostituisce i turni di un medico, aggiornando i conteggi dei posti. */
  replace(docId: string, list: Assignment[], ev: DoctorEval) {
    for (const a of this.byDoc.get(docId)!) this.bump(a, -1);
    for (const a of list) this.bump(a, 1);
    this.byDoc.set(docId, list);
    this.evals.set(docId, ev);
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

/**
 * Catena di posti a partire da un posto: se lo schema mette dopo quel turno
 * altri turni nei giorni successivi (es. lunga -> notte), aggiunge per ogni
 * giorno un posto libero di quel turno, preferendo la stessa area o l'area
 * che la segue nell'ordine (es. "Lunga" -> "Notte", "SEI Lunga" -> "SEI notte").
 * Se un anello manca, la catena si ferma: l'analisi decidera se e ammesso.
 */
function chainFrom(ctx: MonthContext, state: State, slot: Slot, slotsByDate: Map<string, Slot[]>): Slot[] {
  const steps = ctx.scheme;
  if (!steps) return [slot];
  const start = schemePositions(steps, slot.shiftId).find(p => !schemeShiftAt(steps, p - 1));
  if (start === undefined) return [slot];
  const areaIndex = new Map(ctx.config.areas.map((a, i) => [a.id, i]));
  const n = ctx.config.areas.length;
  const chain = [slot];
  const taken = new Set<Slot>();
  let date = slot.date;
  let fromArea = slot.areaId;
  for (let k = 1; ; k++) {
    const shiftId = schemeShiftAt(steps, start + k);
    if (!shiftId) break;
    date = addDays(date, 1);
    const open = (slotsByDate.get(date) ?? []).filter(s => s.shiftId === shiftId && !taken.has(s) && !state.isFilled(s) && !s.optional);
    if (open.length === 0) break;
    const dist = (s: Slot) => s.areaId === fromArea ? -1 : ((areaIndex.get(s.areaId) ?? 0) - (areaIndex.get(fromArea) ?? 0) + n) % n;
    // Il primo posto libero per area: gli indici piu bassi si riempiono prima.
    const next = open.sort((a, b) => dist(a) - dist(b) || a.index - b.index)[0];
    taken.add(next);
    chain.push(next);
    fromArea = next.areaId;
  }
  return chain;
}

/** Turni dello stesso medico che formano una catena dello schema con a. */
function chainOf(ctx: MonthContext, list: readonly Assignment[], a: Assignment): Assignment[] {
  const steps = ctx.scheme;
  if (!steps) return [a];
  const at = (date: string, shiftId: string) => list.find(x => x.date === date && x.shiftId === shiftId);
  let best: Assignment[] = [a];
  for (const p of schemePositions(steps, a.shiftId)) {
    const group = [a];
    for (let k = 1, date = a.date; ; k++) {
      const id = schemeShiftAt(steps, p - k);
      date = addDays(date, -1);
      const x = id && ctx.dateSet.has(date) ? at(date, id) : undefined;
      if (!x) break;
      group.unshift(x);
    }
    for (let k = 1, date = a.date; ; k++) {
      const id = schemeShiftAt(steps, p + k);
      date = addDays(date, 1);
      const x = id && ctx.dateSet.has(date) ? at(date, id) : undefined;
      if (!x) break;
      group.push(x);
    }
    if (group.length > best.length) best = group;
  }
  return best;
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
      state.add(best.doc, best.take.map(s => makeAssignment(s, best.doc.id)));
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
      const chain = chainFrom(ctx, state, slot, byDate);
      const critical = chain.some(s => s.critical);
      let best: { doc: Doctor; cost: number; ev: DoctorEval; adds: Assignment[] } | null = null;
      for (const doc of ctx.doctors) {
        const before = state.evals.get(doc.id)!;
        const adds = (doc.inRotation ? chain : [slot]).map(s => makeAssignment(s, doc.id));
        const after = state.tryAdd(doc, adds);
        if (!feasible(before, after, critical)) continue;
        // Un turno opzionale va solo a chi ci guadagna (es. chi e sotto carico).
        if (slot.optional && after.total - before.total >= 0) continue;
        const cost = after.total - before.total + (random() - 0.5) * noise;
        if (!best || cost < best.cost) best = { doc, cost, ev: after, adds };
      }
      if (best) state.add(best.doc, best.adds, best.ev);
    }
  }
  return state;
}

/** Ricerca locale: spostamenti, scambi e riempimento dei buchi, a catene intere. */
function improve(ctx: MonthContext, state: State, random: () => number, deadline: number, onProgress?: (p: number) => void, progressStart = 0.45) {
  const docs = ctx.doctors;
  if (docs.length < 2) return;
  // I blocchi di diurnismo si muovono solo interi: qui restano fermi.
  const isMovable = (a: Assignment) => !a.locked && !ctx.shifts.get(a.shiftId)?.isBlock;
  const movable = () => state.all().filter(isMovable);
  let pool = movable();
  let iter = 0;
  const startTime = performance.now();
  const span = Math.max(1, deadline - startTime);
  const docById = new Map(docs.map(d => [d.id, d]));
  const slotsByDate = new Map<string, Slot[]>();
  for (const s of ctx.slots) (slotsByDate.get(s.date) ?? slotsByDate.set(s.date, []).get(s.date)!).push(s);
  const isCritical = (a: Assignment) => ctx.demand.get(demandKey(a.date, a.areaId, a.shiftId))?.critical ?? false;
  /** La catena di a (se e in rotazione), solo se tutta spostabile. */
  const groupOf = (doc: Doctor, a: Assignment): Assignment[] | null => {
    const g = doc.inRotation ? chainOf(ctx, state.byDoc.get(doc.id)!, a) : [a];
    return g.every(isMovable) ? g : null;
  };

  while (performance.now() < deadline) {
    iter++;
    if (iter % 200 === 0) {
      onProgress?.(progressStart + (1 - progressStart) * Math.min(1, (performance.now() - startTime) / span));
    }
    const temp = 40 * Math.max(0, 1 - (performance.now() - startTime) / span);
    const accept = (delta: number) => delta < 0 || (temp > 0.5 && random() < Math.exp(-delta / temp));
    const move = random();

    if (move < 0.15) {
      // Riempi un buco (con la sua catena).
      const holes = ctx.slots.filter(s => !state.isFilled(s));
      if (holes.length === 0) continue;
      const slot = holes[Math.floor(random() * holes.length)];
      const doc = docs[Math.floor(random() * docs.length)];
      const chain = doc.inRotation ? chainFrom(ctx, state, slot, slotsByDate) : [slot];
      const before = state.evals.get(doc.id)!;
      const adds = chain.map(s => makeAssignment(s, doc.id));
      const after = state.tryAdd(doc, adds);
      if (!feasible(before, after, chain.some(s => s.critical))) continue;
      const gain = chain.reduce((g, s) => g + (s.optional ? 0 : s.critical ? COST.uncoveredCritical : COST.uncovered), 0);
      if (after.total - before.total - gain < 0) { state.add(doc, adds, after); pool = movable(); }
      continue;
    }

    if (pool.length === 0) continue;
    const a = pool[Math.floor(random() * pool.length)];
    const from = docById.get(a.doctorId);
    if (!from) continue;
    const groupA = groupOf(from, a);
    if (!groupA) continue;
    const critA = groupA.some(isCritical);

    if (move < 0.55) {
      // Sposta il turno (o la catena) su un altro medico.
      const to = docs[Math.floor(random() * docs.length)];
      if (to.id === from.id) continue;
      const moved = groupA.map(x => ({ ...x, doctorId: to.id }));
      const fromList = state.byDoc.get(from.id)!.filter(x => !groupA.includes(x));
      const toList = [...state.byDoc.get(to.id)!, ...moved];
      const evFrom = evaluateDoctor(ctx, from, fromList);
      const evTo = evaluateDoctor(ctx, to, toList);
      const bFrom = state.evals.get(from.id)!, bTo = state.evals.get(to.id)!;
      if (!feasible(bTo, evTo, critA) || evFrom.strict > bFrom.strict) continue;
      const delta = evFrom.total + evTo.total - bFrom.total - bTo.total;
      if (accept(delta)) {
        state.replace(from.id, fromList, evFrom);
        state.replace(to.id, toList, evTo);
        pool = movable();
      }
    } else {
      // Scambia due turni (o due catene) fra due medici.
      const b = pool[Math.floor(random() * pool.length)];
      if (b.doctorId === a.doctorId || b.date === a.date && b.shiftId === a.shiftId) continue;
      const other = docById.get(b.doctorId);
      if (!other) continue;
      const groupB = groupOf(other, b);
      if (!groupB) continue;
      const a2 = groupA.map(x => ({ ...x, doctorId: other.id }));
      const b2 = groupB.map(x => ({ ...x, doctorId: from.id }));
      const fromList = [...state.byDoc.get(from.id)!.filter(x => !groupA.includes(x)), ...b2];
      const otherList = [...state.byDoc.get(other.id)!.filter(x => !groupB.includes(x)), ...a2];
      const evFrom = evaluateDoctor(ctx, from, fromList);
      const evOther = evaluateDoctor(ctx, other, otherList);
      const bFrom = state.evals.get(from.id)!, bOther = state.evals.get(other.id)!;
      if (!feasible(bFrom, evFrom, groupB.some(isCritical)) || !feasible(bOther, evOther, critA)) continue;
      const delta = evFrom.total + evOther.total - bFrom.total - bOther.total;
      if (accept(delta)) {
        state.replace(from.id, fromList, evFrom);
        state.replace(other.id, otherList, evOther);
        pool = movable();
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
