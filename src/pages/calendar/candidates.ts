import { evaluateDoctor, ISSUE_LABELS, type Issue, type IssueKind } from '../../domain/analysis';
import type { MonthContext } from '../../domain/context';
import type { Assignment, Doctor } from '../../domain/types';

export interface Candidate {
  doctor: Doctor;
  /** Variazione del costo complessivo (piu basso = meglio). */
  delta: number;
  level: 'good' | 'warn' | 'bad';
  reason: string;
}

function issueCounts(issues: Issue[]): Map<IssueKind, { n: number; first: Issue }> {
  const m = new Map<IssueKind, { n: number; first: Issue }>();
  for (const i of issues) {
    const e = m.get(i.kind);
    if (e) e.n++; else m.set(i.kind, { n: 1, first: i });
  }
  return m;
}

/**
 * Cosa succede se `doctor` prende il posto (date/area/shift)? Se `replacing`
 * e indicato, quell'assegnazione viene tolta al medico che la aveva.
 */
export function evaluateCandidate(
  ctx: MonthContext,
  assignments: readonly Assignment[],
  doctor: Doctor,
  slot: Pick<Assignment, 'date' | 'areaId' | 'shiftId'>,
  replacing?: Assignment,
): Candidate {
  const mine = assignments.filter(a => a.doctorId === doctor.id && a.id !== replacing?.id);
  const beforeIssues: Issue[] = [];
  const afterIssues: Issue[] = [];
  const before = evaluateDoctor(ctx, doctor, mine, beforeIssues);
  const after = evaluateDoctor(ctx, doctor, [...mine, { id: '__new', ...slot, doctorId: doctor.id }], afterIssues);
  const b = issueCounts(beforeIssues);
  const added: Issue[] = [];
  for (const [kind, v] of issueCounts(afterIssues)) {
    if (v.n > (b.get(kind)?.n ?? 0)) added.push(afterIssues.filter(i => i.kind === kind).pop()!);
  }
  const errors = added.filter(i => i.severity === 'error');
  const warnings = added.filter(i => i.severity === 'warning');
  const level = errors.length ? 'bad' : warnings.length ? 'warn' : 'good';
  const reason = errors[0] ? ISSUE_LABELS[errors[0].kind] : warnings[0] ? ISSUE_LABELS[warnings[0].kind] : '';
  return { doctor, delta: after.total - before.total, level, reason };
}

export function rankCandidates(
  ctx: MonthContext,
  assignments: readonly Assignment[],
  slot: Pick<Assignment, 'date' | 'areaId' | 'shiftId'>,
  replacing?: Assignment,
): Candidate[] {
  const order = { good: 0, warn: 1, bad: 2 };
  return ctx.doctors
    .filter(d => d.id !== replacing?.doctorId)
    .map(d => evaluateCandidate(ctx, assignments, d, slot, replacing))
    .sort((a, b) => order[a.level] - order[b.level] || a.delta - b.delta);
}
