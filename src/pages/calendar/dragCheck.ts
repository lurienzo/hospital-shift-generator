// Durante il trascinamento: per ogni casella, cosa succederebbe lasciando li
// il turno. Le caselle che creano errori vengono oscurate con il motivo, ma il
// rilascio resta possibile.

import { useSyncExternalStore } from 'react';
import { evaluateDoctor, groupByDoctor, ISSUE_LABELS, type Issue, type IssueKind } from '../../domain/analysis';
import type { MonthContext } from '../../domain/context';
import type { Assignment } from '../../domain/types';
import type { DropPlan } from './ops';

export interface Verdict {
  level: 'bad' | 'warn';
  /** Motivo breve, scritto sulla casella. */
  short: string;
  /** Motivo completo, nel suggerimento. */
  reason: string;
}

const SHORT: Partial<Record<IssueKind, string>> = {
  absence: 'Ferie / assenza',
  smonto: 'Smonto',
  overlap: 'Sovrapposto',
  multiple: 'Doppio turno',
  'long-split': 'Lunga in altra sala',
  'excluded-area': 'Area esclusa',
  'excluded-shift': 'Turno escluso',
  'weekday-never': 'Giorno escluso',
  'hours-cap': 'Oltre le ore',
  'rotation-binding': 'Rotazione',
  inactive: 'Non attivo',
  desiderata: 'Desiderata',
  'no-night': 'No notte',
  riposo: 'Riposo saltato',
  'weekday-avoid': 'Da evitare',
  'max-nights': 'Troppe notti',
  consecutive: 'Troppi giorni',
  'night-gap': 'Notti vicine',
  'long-split-pref': 'Altra sala',
};

function counts(issues: Issue[]) {
  const m = new Map<IssueKind, number>();
  for (const i of issues) if (i.severity !== 'info') m.set(i.kind, (m.get(i.kind) ?? 0) + 1);
  return m;
}

export function judge(ctx: MonthContext, before: Assignment[], plan: DropPlan): Verdict | null {
  if (!plan.list) return plan.message ? { level: 'bad', short: 'Non previsto', reason: plan.message } : null;
  const b = groupByDoctor(before);
  const a = groupByDoctor(plan.list);
  let err: Issue | null = null;
  let warn: Issue | null = null;
  for (const id of new Set(plan.doctors)) {
    const doc = ctx.doctors.find(d => d.id === id);
    if (!doc) continue;
    const ib: Issue[] = [];
    const ia: Issue[] = [];
    evaluateDoctor(ctx, doc, b.get(id) ?? [], ib);
    evaluateDoctor(ctx, doc, a.get(id) ?? [], ia);
    const cb = counts(ib);
    for (const [kind, n] of counts(ia)) {
      if (n <= (cb.get(kind) ?? 0)) continue;
      const issue = ia.filter(i => i.kind === kind).pop()!;
      if (issue.severity === 'error') err ??= issue; else warn ??= issue;
    }
  }
  const pick = err ?? warn;
  if (!pick) return null;
  const who = pick.doctorId ? ctx.doctorById.get(pick.doctorId)?.name : null;
  return {
    level: err ? 'bad' : 'warn',
    short: SHORT[pick.kind] ?? ISSUE_LABELS[pick.kind],
    reason: `${ISSUE_LABELS[pick.kind]}${who ? ` · ${who}` : ''}: ${pick.message}`,
  };
}

// --- Cosa si sta trascinando (condiviso fra le griglie) ---------------------

let dragging: string[] | null = null;
const listeners = new Set<() => void>();

export function setDragging(ids: string[] | null) {
  dragging = ids;
  listeners.forEach(l => l());
}

export function useDragging(): string[] | null {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => listeners.delete(l); },
    () => dragging,
    () => dragging,
  );
}
