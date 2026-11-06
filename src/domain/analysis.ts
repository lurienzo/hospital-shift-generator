// Valutazione di un calendario.
//
// Tutte le regole stanno qui, in un solo posto: il generatore sceglie i medici
// minimizzando questo costo, e il calendario mostra gli avvisi prodotti dalla
// stessa funzione. Quello che il generatore evita e esattamente quello che il
// calendario segnala.

import { addToTally, emptyTally, SCALAR_KEYS, type Tally } from './fairness';
import { demandKey, dayKeyOf, type MonthContext, type ShiftInfo, type Slot } from './context';
import { addDays, diffDays, formatDay, weekStart, weekdayOf } from './dates';
import type { Assignment, Doctor, SchemeStep } from './types';

export type IssueKind =
  // errori: vincoli che non si violano
  | 'absence' | 'excluded-area' | 'excluded-shift' | 'weekday-never' | 'overlap' | 'smonto'
  // errori che un turno critico puo forzare
  | 'multiple' | 'hours-cap' | 'rotation-binding' | 'long-split'
  // avvisi
  | 'desiderata' | 'no-night' | 'riposo' | 'weekday-avoid' | 'rotation' | 'consecutive'
  | 'hours-week' | 'hours-month' | 'max-nights' | 'block-split' | 'inactive' | 'long-split-pref' | 'night-gap'
  // copertura
  | 'uncovered' | 'uncovered-critical' | 'extra';

export type Severity = 'error' | 'warning' | 'info';

/**
 * Colore con cui mostrare una segnalazione. Le desiderate (e i "no notte")
 * hanno un colore proprio, distinto dagli altri avvisi come il riposo saltato.
 */
export type Tone = 'error' | 'desire' | 'warning' | 'info';

const DESIRE_KINDS: ReadonlySet<string> = new Set(['desiderata', 'no-night']);

/**
 * Giorni (medico + data) con almeno una segnalazione di quel tipo: una
 * desiderata violata da una lunga conta una volta, non una per turno.
 */
export function countDays(issues: readonly Issue[], kind: IssueKind, doctorId?: string): number {
  const days = new Set<string>();
  for (const i of issues) if (i.kind === kind && (!doctorId || i.doctorId === doctorId)) days.add(`${i.doctorId}|${i.date}`);
  return days.size;
}

/** Chiave stabile di una segnalazione, per poterla ignorare. */
export function issueKey(i: Issue): string {
  return [i.kind, i.doctorId ?? '', i.date ?? '', i.assignmentId ?? '', i.areaId ?? '', i.shiftId ?? ''].join('|');
}

/**
 * Toglie dall'analisi le segnalazioni ignorate: non compaiono nel calendario
 * ne nei conteggi. Un turno scoperto ignorato non e piu segnato come buco.
 */
export function withoutIgnored(a: ScheduleAnalysis, ignored: ReadonlySet<string>): { analysis: ScheduleAnalysis; ignored: Issue[] } {
  if (ignored.size === 0) return { analysis: a, ignored: [] };
  const kept: Issue[] = [];
  const dropped: Issue[] = [];
  for (const i of a.issues) (ignored.has(issueKey(i)) ? dropped : kept).push(i);
  const droppedHoles = new Set(dropped.filter(i => i.kind === 'uncovered' || i.kind === 'uncovered-critical').map(i => `${i.date}|${i.areaId}|${i.shiftId}`));
  const uncovered = a.uncovered.filter(u => !droppedHoles.has(`${u.date}|${u.areaId}|${u.shiftId}`));
  return {
    analysis: {
      ...a,
      issues: kept,
      uncovered,
      counts: {
        ...a.counts,
        errors: kept.filter(i => i.severity === 'error').length,
        warnings: kept.filter(i => i.severity === 'warning').length,
        uncovered: uncovered.filter(u => !u.critical).reduce((s, u) => s + u.missing, 0),
        uncoveredCritical: uncovered.filter(u => u.critical).reduce((s, u) => s + u.missing, 0),
      },
    },
    ignored: dropped,
  };
}

export function issueTone(i: { kind: string; severity: Severity }): Tone {
  if (i.severity === 'error') return 'error';
  if (DESIRE_KINDS.has(i.kind)) return 'desire';
  return i.severity;
}

export interface Issue {
  kind: IssueKind;
  severity: Severity;
  message: string;
  doctorId?: string;
  date?: string;
  assignmentId?: string;
  areaId?: string;
  shiftId?: string;
}

export const ISSUE_LABELS: Record<IssueKind, string> = {
  absence: 'Ferie o assenza',
  'excluded-area': 'Area esclusa',
  'excluded-shift': 'Turno escluso',
  'weekday-never': 'Giorno vietato',
  overlap: 'Orari sovrapposti',
  smonto: 'Smonto non rispettato',
  multiple: 'Più turni nello stesso giorno',
  'hours-cap': 'Oltre il massimo di ore',
  'rotation-binding': 'Fuori rotazione (vincolante)',
  'long-split': 'Lunga in un’altra area',
  'long-split-pref': 'Lunga in un’altra area',
  desiderata: 'Desiderata non rispettata',
  'no-night': 'Notte non desiderata',
  riposo: 'Riposo post-notte saltato',
  'weekday-avoid': 'Giorno da evitare',
  rotation: 'Fuori rotazione',
  consecutive: 'Troppi giorni di fila',
  'hours-week': 'Settimana oltre il massimo',
  'hours-month': 'Ore del mese fuori intervallo',
  'max-nights': 'Oltre il massimo di notti',
  'night-gap': 'Notti troppo ravvicinate',
  'block-split': 'Blocco diviso',
  inactive: 'Medico non attivo',
  uncovered: 'Turno scoperto',
  'uncovered-critical': 'Turno critico scoperto',
  extra: 'Turno oltre il fabbisogno',
};

/** Vincoli rigidi che un turno critico puo forzare pur di essere coperto. */
const RELAXABLE: ReadonlySet<IssueKind> = new Set(['multiple', 'hours-cap', 'rotation-binding', 'long-split']);

export const COST = {
  uncoveredCritical: 1_000_000,
  uncovered: 20_000,
  hard: 100_000,
  desiderata: 1_000,
  /** Desiderata violata per un turno non critico quando le desiderate sono protette. */
  protectedDesiderata: 50_000,
  noNight: 600,
  maxNights: 300,
  riposo: 250,
  consecutive: 100,
  weekdayAvoid: 120,
  rotationMismatch: 30,
  /** Catena della rotazione spezzata (es. lunga senza la notte del giorno dopo) in modalita preferenza. */
  rotationChain: 400,
  hoursWeekPerHour: 6,
  hoursMonthUnderPerHour: 4,
  hoursMonthOverPerHour: 8,
  /** Per ogni giorno mancante alla distanza minima fra due notti. */
  nightGapPerDay: 150,
  longSplit: 400,
};

const PRIORITY_WEIGHT = [0, 12, 30, 55];

export interface DoctorEval {
  /** Violazioni rigide non forzabili. */
  strict: number;
  /** Violazioni rigide forzabili da un turno critico. */
  relaxable: number;
  /** Desiderate / no-notte violate su turni non critici. */
  protectedViolations: number;
  /** Costo morbido (avvisi + ore). */
  soft: number;
  /** Costo di equita. */
  fairness: number;
  total: number;
  tally: Tally;
}

export function isCriticalAssignment(ctx: MonthContext, a: Pick<Assignment, 'date' | 'areaId' | 'shiftId'>): boolean {
  return ctx.demand.get(demandKey(a.date, a.areaId, a.shiftId))?.critical
    ?? !!ctx.areas.get(a.areaId)?.coverage[dayKeyOf(a.date, ctx.holidays)]?.[a.shiftId]?.critical;
}

function doctorHours(ctx: MonthContext, doc: Doctor) {
  const h = ctx.config.rules.hours;
  if (!h.enabled) return null;
  return { min: doc.hours?.min ?? h.min, max: doc.hours?.max ?? h.max, enforcement: h.enforcement };
}

/**
 * Valuta i turni di un medico nel mese. `list` sono le sue assegnazioni del
 * mese; la coda del mese precedente viene dal contesto. Se `issues` e passato
 * vi aggiunge le segnalazioni.
 */
export function evaluateDoctor(ctx: MonthContext, doc: Doctor, list: readonly Assignment[], issues?: Issue[]): DoctorEval {
  const rules = ctx.config.rules;
  const req = ctx.requests[doc.id] ?? {};
  const tail = ctx.tailByDoctor.get(doc.id) ?? [];
  let strict = 0, relaxable = 0, protectedViolations = 0, soft = 0;

  const push = (kind: IssueKind, severity: Severity, message: string, a?: Assignment, date?: string) => {
    if (severity === 'error') {
      if (RELAXABLE.has(kind)) relaxable++; else strict++;
    }
    issues?.push({ kind, severity, message, doctorId: doc.id, date: date ?? a?.date, assignmentId: a?.id, areaId: a?.areaId, shiftId: a?.shiftId });
  };

  // Indice per data (coda + mese).
  const byDate = new Map<string, Assignment[]>();
  for (const a of tail) (byDate.get(a.date) ?? byDate.set(a.date, []).get(a.date)!).push(a);
  for (const a of list) (byDate.get(a.date) ?? byDate.set(a.date, []).get(a.date)!).push(a);
  const nightOn = (date: string) => byDate.get(date)?.some(a => ctx.shifts.get(a.shiftId)?.night) ?? false;

  const tally = emptyTally();
  let nights = 0;

  for (const a of list) {
    const shift = ctx.shifts.get(a.shiftId);
    if (!shift) continue;
    const critical = isCriticalAssignment(ctx, a);
    addToTally(tally, a.date, a.areaId, shift, ctx.holidays, critical);
    const label = `${shift.name} ${formatDay(a.date)}`;
    const code = req[a.date];

    if (code === 'F' || code === 'A') push('absence', 'error', `${label}: è in ${code === 'F' ? 'ferie' : 'assenza'}`, a);
    if (doc.excludedAreaIds.includes(a.areaId)) push('excluded-area', 'error', `${label}: non lavora in ${ctx.areas.get(a.areaId)?.name ?? 'quest’area'}`, a);
    if (doc.excludedShiftIds.includes(a.shiftId)) push('excluded-shift', 'error', `${label}: non fa questo turno`, a);

    const wd = weekdayOf(a.date);
    const rule = doc.weekdayRules.find(r => r.weekday === wd && (r.shiftId === null || r.shiftId === a.shiftId) && r.level === 'never')
      ?? doc.weekdayRules.find(r => r.weekday === wd && (r.shiftId === null || r.shiftId === a.shiftId));
    if (rule?.level === 'never') push('weekday-never', 'error', `${label}: giorno escluso`, a);
    else if (rule?.level === 'avoid') { soft += COST.weekdayAvoid; push('weekday-avoid', 'warning', `${label}: preferisce evitarlo`, a); }

    if (code === 'D') {
      if (critical || !rules.protectDesiderata) soft += COST.desiderata; else { soft += COST.protectedDesiderata; protectedViolations++; }
      push('desiderata', 'warning', `${label}: aveva chiesto il giorno libero`, a);
    }
    if (code === 'N' && shift.night) {
      if (critical || !rules.protectDesiderata) soft += COST.noNight; else { soft += COST.protectedDesiderata; protectedViolations++; }
      push('no-night', 'warning', `${label}: aveva chiesto di non fare la notte`, a);
    }

    // Smonto: il giorno dopo una notte non si lavora.
    if (nightOn(addDays(a.date, -1))) push('smonto', 'error', `${label}: è smontante dalla notte precedente`, a);
    // Riposo post-notte: il secondo giorno dopo la notte.
    if (nightOn(addDays(a.date, -2))) { soft += COST.riposo; push('riposo', 'warning', `${label}: salta il riposo dopo la notte del ${formatDay(addDays(a.date, -2))}`, a); }

    if (shift.night) {
      nights++;
      // Notti troppo ravvicinate: oltre smonto (D+1) e riposo (D+2), la notte
      // successiva non dovrebbe arrivare prima della distanza minima.
      for (let k = 2; k < rules.minNightGap; k++) {
        if (!nightOn(addDays(a.date, -k))) continue;
        soft += COST.nightGapPerDay * (rules.minNightGap - k);
        push('night-gap', 'warning', `${label}: solo ${k} giorni dopo la notte del ${formatDay(addDays(a.date, -k))} (minimo ${rules.minNightGap})`, a);
        break;
      }
    }
  }

  // Piu turni nello stesso giorno: ammessi solo come "lunga", cioe turni
  // attaccati uno all'altro (fine dell'uno = inizio dell'altro) entro il
  // massimo di ore della giornata. M+P si, M+N o M+P+N no.
  for (const [date, items] of byDate) {
    if (items.length < 2 || !ctx.dateSet.has(date)) continue;
    const sorted = items
      .map(a => ({ a, s: ctx.shifts.get(a.shiftId) }))
      .filter((x): x is { a: Assignment; s: ShiftInfo } => !!x.s)
      .sort((x, y) => x.s.interval[0] - y.s.interval[0]);
    let overlap = false;
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i].s, b = sorted[j].s;
        if (a.interval[0] < b.interval[1] && b.interval[0] < a.interval[1]) {
          overlap = true;
          push('overlap', 'error', `${formatDay(date)}: ${a.name} e ${b.name} si sovrappongono`, sorted[j].a);
        }
      }
    }
    if (overlap) continue;
    const names = sorted.map(x => x.s.name.toLowerCase()).join(' + ');
    const hours = sorted.reduce((h, x) => h + x.s.hours, 0);
    const chained = sorted.every((x, i) => i === 0 || sorted[i - 1].s.interval[1] === x.s.interval[0]);
    const last = sorted[sorted.length - 1].a;
    if (!rules.allowMultiplePerDay) push('multiple', 'error', `${formatDay(date)}: ${names} nello stesso giorno`, last);
    else if (!chained) push('multiple', 'error', `${formatDay(date)}: ${names} non sono attaccati, quindi non formano una lunga`, last);
    else if (hours > rules.maxDayHours) push('multiple', 'error', `${formatDay(date)}: ${names} fanno ${round(hours)}h, oltre il massimo di ${rules.maxDayHours}h`, last);

    // Lunga nella stessa area: il turno successivo si fa nell'area del
    // precedente, se quell'area prosegue con quel turno.
    if (rules.longSameArea === 'off' || !chained) continue;
    for (let i = 1; i < sorted.length; i++) {
      const first = sorted[i - 1], second = sorted[i];
      if (first.a.areaId === second.a.areaId) continue;
      if (!ctx.demand.has(demandKey(date, first.a.areaId, second.a.shiftId))) continue;
      const from = ctx.areas.get(first.a.areaId)?.name ?? '', to = ctx.areas.get(second.a.areaId)?.name ?? '';
      const msg = `${formatDay(date)}: ${first.s.name.toLowerCase()} in ${from}, ${second.s.name.toLowerCase()} in ${to} (doveva restare in ${from})`;
      if (rules.longSameArea === 'binding') push('long-split', 'error', msg, second.a);
      else { soft += COST.longSplit; push('long-split-pref', 'warning', msg, second.a); }
    }
  }

  if (doc.maxNights !== null && nights > doc.maxNights) {
    soft += COST.maxNights * (nights - doc.maxNights);
    push('max-nights', 'warning', `${nights} notti, massimo indicato ${doc.maxNights}`);
  }

  // Giorni consecutivi.
  if (rules.maxConsecutiveDays > 0) {
    let run = 0;
    const all = [...ctx.tailDates, ...ctx.dates];
    for (const date of all) {
      if (byDate.has(date)) {
        run++;
        if (run === rules.maxConsecutiveDays + 1 && ctx.dateSet.has(date)) {
          push('consecutive', 'warning', `${run} giorni di fila fino a ${formatDay(date)}`, undefined, date);
        }
        if (run > rules.maxConsecutiveDays && ctx.dateSet.has(date)) soft += COST.consecutive;
      } else run = 0;
    }
  }

  // Ore settimanali e mensili.
  const target = doctorHours(ctx, doc);
  if (target) {
    const weeks = new Map<string, { hours: number; days: number }>();
    const known = [...ctx.tailDates, ...ctx.dates];
    const lastWeek = weekStart(ctx.dates[ctx.dates.length - 1]);
    for (const date of known) {
      const ws = weekStart(date);
      if (ws < weekStart(ctx.dates[0]) || ws > lastWeek) continue;
      const w = weeks.get(ws) ?? { hours: 0, days: 0 };
      w.days++;
      for (const a of byDate.get(date) ?? []) w.hours += ctx.shifts.get(a.shiftId)?.hours ?? 0;
      weeks.set(ws, w);
    }
    for (const [ws, w] of weeks) {
      const max = target.max * w.days / 7;
      if (w.hours > max + 0.01) {
        const over = w.hours - max;
        const msg = `settimana del ${formatDay(ws)}: ${round(w.hours)}h, oltre il massimo di ${round(max)}h`;
        if (target.enforcement === 'cap') push('hours-cap', 'error', msg, undefined, ws);
        else { soft += over * COST.hoursWeekPerHour; push('hours-week', 'info', msg, undefined, ws); }
      }
    }
    const away = ctx.dates.filter(d => req[d] === 'F' || req[d] === 'A').length;
    const workable = ctx.dates.length - away;
    const min = target.min * workable / 7, max = target.max * workable / 7;
    if (tally.hours < min - 0.01) {
      soft += (min - tally.hours) * COST.hoursMonthUnderPerHour;
      push('hours-month', 'warning', `${round(tally.hours)}h nel mese, sotto il minimo di ${round(min)}h`);
    } else if (tally.hours > max + 0.01) {
      soft += (tally.hours - max) * COST.hoursMonthOverPerHour;
      push('hours-month', 'warning', `${round(tally.hours)}h nel mese, oltre il massimo di ${round(max)}h`);
    }
  }

  // Rotazione del servizio.
  if (ctx.scheme && doc.inRotation) soft += evaluateRotation(ctx, byDate, nightOn, push);

  const fairness = fairnessCost(ctx, doc, tally);
  return { strict, relaxable, protectedViolations, soft, fairness, total: strict * COST.hard + relaxable * COST.hard + soft + fairness, tally };
}

/** Posizioni dello schema occupate da un turno. */
export function schemePositions(steps: readonly SchemeStep[], shiftId: string): number[] {
  const out: number[] = [];
  steps.forEach((s, i) => { if (s.kind === 'shift' && s.shiftId === shiftId) out.push(i); });
  return out;
}

/** Turno dello schema al passo i, se e un turno (non smonto o riposo). */
export function schemeShiftAt(steps: readonly SchemeStep[], i: number): string | null {
  const s = steps[i];
  return s && s.kind === 'shift' ? s.shiftId : null;
}

/**
 * Rotazione. Il cuore sono le catene: passi dello schema che sono turni in
 * giorni consecutivi (es. lunga -> notte) vanno fatti dallo stesso medico, uno
 * dopo l'altro. Con la rotazione vincolante una catena spezzata e un errore;
 * lo smonto e gia vincolante per conto suo, il riposo resta l'unica cosa
 * sacrificabile e se salta si conta come avviso.
 */
function evaluateRotation(
  ctx: MonthContext,
  byDate: Map<string, Assignment[]>,
  nightOn: (date: string) => boolean,
  push: (kind: IssueKind, severity: Severity, message: string, a?: Assignment, date?: string) => void,
): number {
  const steps = ctx.scheme!;
  const L = steps.length;
  const binding = ctx.config.rules.rotation.strength === 'binding';
  const lastDate = ctx.dates[ctx.dates.length - 1];
  const shiftName = (id: string) => ctx.shifts.get(id)?.name.toLowerCase() ?? '';
  const has = (date: string, shiftId: string) => byDate.get(date)?.some(a => a.shiftId === shiftId) ?? false;
  let cost = 0;

  // 1. Catene.
  for (const date of ctx.dates) {
    for (const a of byDate.get(date) ?? []) {
      if (ctx.shifts.get(a.shiftId)?.isBlock) continue;
      const positions = schemePositions(steps, a.shiftId);
      if (positions.length === 0) continue;
      let broken: string | null = null;
      for (const p of positions) {
        const prev = schemeShiftAt(steps, p - 1);
        const next = schemeShiftAt(steps, p + 1);
        const prevDate = addDays(date, -1), nextDate = addDays(date, 1);
        const prevKnown = ctx.dateSet.has(prevDate) || ctx.hasTail;
        const prevOk = !prev || !prevKnown || has(prevDate, prev);
        const nextOk = !next || nextDate > lastDate || has(nextDate, next);
        if (prevOk && nextOk) { broken = null; break; }
        broken ??= !prevOk ? `la rotazione prevede la ${shiftName(prev!)} il giorno prima` : `la rotazione prevede la ${shiftName(next!)} il giorno dopo`;
      }
      if (!broken) continue;
      const msg = `${ctx.shifts.get(a.shiftId)!.name} ${formatDay(date)}: ${broken}`;
      if (binding) push('rotation-binding', 'error', msg, a);
      else { cost += COST.rotationChain; push('rotation', 'warning', msg, a); }
    }
  }

  // 2. Giorni di smonto e riposo previsti dallo schema e turni fuori posto.
  let lastPos = -1;
  let lastDate2 = '';
  for (const date of [...ctx.tailDates, ...ctx.dates]) {
    const items = byDate.get(date) ?? [];
    const worked = items.find(a => !ctx.shifts.get(a.shiftId)?.isBlock);
    const onBlock = items.length > 0 && !worked;
    if (onBlock) {
      // Durante un blocco di diurnismo la rotazione resta sospesa.
      if (lastPos >= 0) lastDate2 = addDays(lastDate2, 1);
      continue;
    }
    const gap = lastPos >= 0 ? diffDays(date, lastDate2) : Infinity;
    const expectedPos = gap < L ? (lastPos + gap) % L : -1;
    const expected = expectedPos >= 0 ? steps[expectedPos] : null;
    if (worked && expected && ctx.dateSet.has(date)) {
      const shift = ctx.shifts.get(worked.shiftId)!;
      if (expected.kind === 'smonto') {
        // Dopo una notte lo smonto ha gia la sua regola; uno smonto dello
        // schema non legato a una notte vale solo con la rotazione vincolante.
        if (binding && !nightOn(addDays(date, -1))) push('rotation-binding', 'error', `${shift.name} ${formatDay(date)}: la rotazione prevede lo smonto`, worked);
      } else if (expected.kind === 'riposo') {
        // Il riposo e sacrificabile: avviso, mai errore. Dopo una notte lo
        // segnala gia la regola del riposo saltato.
        if (binding && !nightOn(addDays(date, -2))) {
          cost += COST.riposo;
          push('riposo', 'warning', `${shift.name} ${formatDay(date)}: salta il riposo previsto dalla rotazione`, worked);
        }
      } else if (expected.shiftId !== worked.shiftId) {
        cost += COST.rotationMismatch;
        const exp = ctx.shifts.get(expected.shiftId)?.name ?? '';
        push('rotation', 'info', `${shift.name} ${formatDay(date)}: la rotazione prevede ${exp}`, worked);
      }
    }
    if (worked) {
      const pos = expected?.kind === 'shift' && expected.shiftId === worked.shiftId
        ? expectedPos
        : steps.findIndex(s => s.kind === 'shift' && s.shiftId === worked.shiftId);
      if (pos >= 0) { lastPos = pos; lastDate2 = date; }
    }
  }
  return cost;
}

function fairnessCost(ctx: MonthContext, doc: Doctor, tally: Tally): number {
  const base = ctx.fair.get(doc.id);
  if (!base) return 0;
  const w = ctx.config.rules.weights;
  const weight: Record<(typeof SCALAR_KEYS)[number], number> = {
    total: PRIORITY_WEIGHT[w.total],
    hours: PRIORITY_WEIGHT[w.total] / 2,
    nights: PRIORITY_WEIGHT[w.nights],
    weekends: PRIORITY_WEIGHT[w.weekends],
    holidays: PRIORITY_WEIGHT[w.holidays],
    critical: PRIORITY_WEIGHT[w.critical],
  };
  // Lo scarto accumulato nei mesi precedenti si recupera gradualmente: in
  // un mese al massimo circa meta della quota mensile in piu o in meno.
  // Senza questo limite chi e rimasto indietro si vedrebbe scaricare tutto
  // il recupero in poche settimane (es. solo notti).
  const debtOf = (actualHist: number, expHist: number, actualNow: number, expTotal: number, minCarry: number) => {
    const expNow = expTotal - expHist;
    const cap = Math.max(minCarry, expNow * 0.5);
    const carried = Math.max(-cap, Math.min(cap, actualHist - expHist));
    return carried + actualNow - expNow;
  };
  let cost = 0;
  for (const k of SCALAR_KEYS) {
    let debt = debtOf(base.histActual[k], base.histExpected[k], tally[k], base.expected[k], k === 'hours' ? 6 : 1);
    if (k === 'hours') debt /= 6;
    cost += weight[k] * debt * debt;
  }
  for (const [id, exp] of Object.entries(base.expected.byShift)) {
    const debt = debtOf(base.histActual.byShift[id] ?? 0, base.histExpected.byShift[id] ?? 0, tally.byShift[id] ?? 0, exp, 1);
    cost += 8 * debt * debt;
  }
  if (ctx.areas.size > 1) {
    for (const [id, exp] of Object.entries(base.expected.byArea)) {
      const debt = debtOf(base.histActual.byArea[id] ?? 0, base.histExpected.byArea[id] ?? 0, tally.byArea[id] ?? 0, exp, 1);
      cost += 4 * debt * debt;
    }
  }
  return cost;
}

const round = (n: number) => Math.round(n * 10) / 10;

export interface UncoveredSlot {
  date: string;
  areaId: string;
  shiftId: string;
  missing: number;
  critical: boolean;
}

export interface ScheduleAnalysis {
  issues: Issue[];
  uncovered: UncoveredSlot[];
  perDoctor: Map<string, DoctorEval>;
  score: number;
  counts: { errors: number; warnings: number; uncovered: number; uncoveredCritical: number; slots: number };
}

export function groupByDoctor(assignments: readonly Assignment[]): Map<string, Assignment[]> {
  const map = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const list = map.get(a.doctorId);
    if (list) list.push(a); else map.set(a.doctorId, [a]);
  }
  return map;
}

export function coverageGaps(ctx: MonthContext, assignments: readonly Assignment[]): { uncovered: UncoveredSlot[]; extra: Assignment[] } {
  const assigned = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const k = demandKey(a.date, a.areaId, a.shiftId);
    (assigned.get(k) ?? assigned.set(k, []).get(k)!).push(a);
  }
  const uncovered: UncoveredSlot[] = [];
  const extra: Assignment[] = [];
  for (const [k, d] of ctx.demand) {
    const n = assigned.get(k)?.length ?? 0;
    if (n < d.count && !d.optional) {
      const [date, areaId, shiftId] = k.split('|');
      uncovered.push({ date, areaId, shiftId, missing: d.count - n, critical: d.critical });
    }
  }
  for (const [k, list] of assigned) {
    const need = ctx.demand.get(k)?.count ?? 0;
    if (list.length > need) extra.push(...list.slice(need));
  }
  uncovered.sort((a, b) => a.date.localeCompare(b.date));
  return { uncovered, extra };
}

export function analyzeSchedule(ctx: MonthContext, assignments: readonly Assignment[]): ScheduleAnalysis {
  const issues: Issue[] = [];
  const perDoctor = new Map<string, DoctorEval>();
  const byDoc = groupByDoctor(assignments);
  let score = 0;

  for (const doc of ctx.doctors) {
    const ev = evaluateDoctor(ctx, doc, byDoc.get(doc.id) ?? [], issues);
    perDoctor.set(doc.id, ev);
    score += ev.total;
  }
  for (const [docId, list] of byDoc) {
    if (ctx.doctors.some(d => d.id === docId)) continue;
    const name = ctx.doctorById.get(docId)?.name ?? 'Medico eliminato';
    for (const a of list) issues.push({ kind: 'inactive', severity: 'error', message: `${name}: non è attivo nel servizio`, doctorId: docId, date: a.date, assignmentId: a.id });
  }

  const { uncovered, extra } = coverageGaps(ctx, assignments);
  let uncoveredCritical = 0, uncoveredCount = 0;
  for (const u of uncovered) {
    const shift = ctx.shifts.get(u.shiftId)?.name ?? '';
    const area = ctx.areas.get(u.areaId)?.name ?? '';
    const many = u.missing > 1 ? ` (mancano ${u.missing})` : '';
    if (u.critical) uncoveredCritical += u.missing; else uncoveredCount += u.missing;
    issues.push({
      kind: u.critical ? 'uncovered-critical' : 'uncovered',
      severity: u.critical ? 'error' : 'warning',
      message: `${formatDay(u.date)} · ${area} · ${shift}${many}`,
      date: u.date, areaId: u.areaId, shiftId: u.shiftId,
    });
  }
  score += uncoveredCritical * COST.uncoveredCritical + uncoveredCount * COST.uncovered;
  for (const a of extra) {
    issues.push({ kind: 'extra', severity: 'info', message: `${formatDay(a.date)} · ${ctx.areas.get(a.areaId)?.name ?? ''} · ${ctx.shifts.get(a.shiftId)?.name ?? ''}: oltre il fabbisogno`, date: a.date, assignmentId: a.id, doctorId: a.doctorId });
  }

  // Blocchi di diurnismo coperti da medici diversi.
  for (const shift of ctx.shifts.values()) {
    if (!shift.isBlock) continue;
    const windows = new Map<string, Set<string>>();
    for (const a of assignments) {
      if (a.shiftId !== shift.id) continue;
      const k = `${a.areaId}|${blockStart(a.date, shift.block!.startWeekday)}`;
      (windows.get(k) ?? windows.set(k, new Set()).get(k)!).add(a.doctorId);
    }
    for (const [k, docs] of windows) {
      const demandPerDay = Math.max(1, ...ctx.slots.filter(s => s.shiftId === shift.id && s.areaId === k.split('|')[0]).map(s => s.index + 1));
      if (docs.size > demandPerDay) {
        const [areaId, start] = k.split('|');
        issues.push({ kind: 'block-split', severity: 'info', message: `${shift.name} · settimana del ${formatDay(start)}: ${docs.size} medici diversi`, date: start, areaId, shiftId: shift.id });
      }
    }
  }

  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  return {
    issues,
    uncovered,
    perDoctor,
    score,
    counts: { errors, warnings, uncovered: uncoveredCount, uncoveredCritical, slots: ctx.slots.filter(s => !s.optional).length },
  };
}

/** Primo giorno del blocco (settimana che inizia in `startWeekday`) che contiene la data. */
export function blockStart(date: string, startWeekday: number): string {
  const offset = (weekdayOf(date) - startWeekday + 7) % 7;
  return addDays(date, -offset);
}

export type { Slot };
