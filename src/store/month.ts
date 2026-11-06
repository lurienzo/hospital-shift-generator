// Accesso al mese selezionato: contesto, versione aperta e modifiche.

import { useMemo } from 'react';
import { analyzeSchedule, withoutIgnored, type Issue, type ScheduleAnalysis } from '../domain/analysis';
import { buildContext, type MonthContext } from '../domain/context';
import { monthKey } from '../domain/dates';
import { uid } from '../domain/defaults';
import { emptyMonth, type Assignment, type MonthData, type Version } from '../domain/types';
import { getState, setOpenVersion, updateMonth, useStore } from './store';

export interface MonthView {
  key: string;
  year: number;
  month: number;
  data: MonthData;
  ctx: MonthContext | null;
  version: Version | null;
  /** Analisi senza le segnalazioni ignorate: quella mostrata nel calendario. */
  analysis: ScheduleAnalysis | null;
  /** Analisi completa (statistiche). */
  rawAnalysis: ScheduleAnalysis | null;
  /** Segnalazioni ignorate in questa versione. */
  ignored: Issue[];
}

export function pickVersion(data: MonthData, openId: string | undefined): Version | null {
  return data.versions.find(v => v.id === openId)
    ?? data.versions.find(v => v.id === data.activeVersionId)
    ?? data.versions[data.versions.length - 1]
    ?? null;
}

export function useMonthView(): MonthView {
  const config = useStore(s => s.config);
  const months = useStore(s => s.months);
  const year = useStore(s => s.ui.year);
  const month = useStore(s => s.ui.month);
  const openId = useStore(s => s.ui.openVersion[monthKey(s.ui.year, s.ui.month)]);
  const key = monthKey(year, month);
  const data = months[key] ?? EMPTY;

  // Il contesto dipende da configurazione, richieste e festivi del mese e dai
  // mesi precedenti: non dalle versioni del mese stesso.
  const ctx = useMemo(
    () => (config ? buildContext({ config, year, month, months }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config, year, month, data.requests, data.extraHolidays, data.removedHolidays, data.overrides, historySignature(months, key)],
  );
  const version = pickVersion(data, openId);
  const rawAnalysis = useMemo(
    () => (ctx && version ? analyzeSchedule(ctx, version.assignments) : null),
    [ctx, version],
  );
  const filtered = useMemo(
    () => (rawAnalysis ? withoutIgnored(rawAnalysis, new Set(version?.ignoredIssues ?? [])) : null),
    [rawAnalysis, version?.ignoredIssues],
  );
  return { key, year, month, data, ctx, version, analysis: filtered?.analysis ?? null, rawAnalysis, ignored: filtered?.ignored ?? [] };
}

const EMPTY = emptyMonth();

/** Cambia solo se cambiano le versioni definitive degli altri mesi. */
function historySignature(months: Record<string, MonthData>, current: string): string {
  return Object.entries(months)
    .filter(([k]) => k !== current)
    .map(([k, m]) => {
      const v = m.versions.find(x => x.id === m.activeVersionId);
      return `${k}:${v?.id ?? ''}:${v?.updatedAt ?? ''}:${m.requests ? Object.keys(m.requests).length : 0}`;
    })
    .join(',');
}

// --- Versioni ---------------------------------------------------------------

export function addVersion(key: string, assignments: Assignment[], name?: string): string {
  const id = uid('v');
  const now = new Date().toISOString();
  updateMonth(key, m => {
    const n = m.versions.length + 1;
    const version: Version = { id, name: name ?? `Versione ${n}`, createdAt: now, updatedAt: now, assignments };
    return { ...m, versions: [...m.versions, version], activeVersionId: m.activeVersionId ?? id };
  });
  setOpenVersion(key, id);
  return id;
}

export function updateVersion(key: string, versionId: string, fn: (list: Assignment[]) => Assignment[]) {
  updateMonth(key, m => ({
    ...m,
    versions: m.versions.map(v => (v.id === versionId ? { ...v, assignments: fn(v.assignments), updatedAt: new Date().toISOString() } : v)),
  }));
}

/** Ignora (o ripristina) una segnalazione nella versione aperta. */
export function setIssueIgnored(view: MonthView, key: string, ignored: boolean) {
  if (!view.version) return;
  const id = view.version.id;
  updateMonth(view.key, m => ({
    ...m,
    versions: m.versions.map(v => {
      if (v.id !== id) return v;
      const set = new Set(v.ignoredIssues ?? []);
      if (ignored) set.add(key); else set.delete(key);
      return { ...v, ignoredIssues: [...set] };
    }),
  }));
}

export function restoreAllIssues(view: MonthView) {
  if (!view.version) return;
  const id = view.version.id;
  updateMonth(view.key, m => ({ ...m, versions: m.versions.map(v => (v.id === id ? { ...v, ignoredIssues: [] } : v)) }));
}

export function renameVersion(key: string, versionId: string, name: string) {
  updateMonth(key, m => ({ ...m, versions: m.versions.map(v => (v.id === versionId ? { ...v, name } : v)) }));
}

export function setActiveVersion(key: string, versionId: string) {
  updateMonth(key, m => ({ ...m, activeVersionId: versionId }));
}

export function deleteVersion(key: string, versionId: string) {
  updateMonth(key, m => {
    const versions = m.versions.filter(v => v.id !== versionId);
    return { ...m, versions, activeVersionId: m.activeVersionId === versionId ? versions[0]?.id ?? null : m.activeVersionId };
  });
}

export function duplicateVersion(key: string, versionId: string) {
  const m = getState().months[key];
  const v = m?.versions.find(x => x.id === versionId);
  if (!v) return;
  addVersion(key, v.assignments.map(a => ({ ...a, id: uid('x') })), `${v.name} (copia)`);
}

/** Garantisce una versione su cui lavorare a mano; la crea vuota se manca. */
export function ensureVersion(view: MonthView): string {
  if (view.version) return view.version.id;
  return addVersion(view.key, [], 'Versione 1');
}
