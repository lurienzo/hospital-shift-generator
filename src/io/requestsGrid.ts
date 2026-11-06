// Lettura di una griglia medici x giorni (da Excel, CSV o appunti).
// Funzioni pure, senza dipendenze dal browser: testabili.

import { daysInMonth, toIso } from '../domain/dates';
import type { Doctor, RequestCode } from '../domain/types';

export type Cell = string | number | boolean | Date | null | undefined;

const CODE_ALIASES: Record<string, RequestCode> = {
  F: 'F', FE: 'F', FER: 'F', FERIE: 'F',
  A: 'A', AS: 'A', ASS: 'A', ASSENZA: 'A', M: 'A', MAL: 'A', MALATTIA: 'A', C: 'A', CONG: 'A', CONGRESSO: 'A', AGG: 'A', CORSO: 'A', R: 'A', RECUPERO: 'A',
  D: 'D', DES: 'D', DESIDERATA: 'D', X: 'D', L: 'D', LIB: 'D', LIBERO: 'D',
  N: 'N', NN: 'N', NONOTTE: 'N', 'NO NOTTE': 'N', NO_NOTTE: 'N',
};

export function parseCode(value: Cell): RequestCode | null | 'invalid' {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toUpperCase().replace(/[.-]/g, '');
  if (!text) return null;
  return CODE_ALIASES[text] ?? CODE_ALIASES[text.replace(/\s+/g, '')] ?? 'invalid';
}

export function normalizeName(name: string): string {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(dott\.?ssa|dott\.?|dr\.?|dssa)\s*/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchDoctor(name: string, doctors: Doctor[]): Doctor | null {
  const n = normalizeName(name);
  if (!n) return null;
  const exact = doctors.find(d => normalizeName(d.name) === n);
  if (exact) return exact;
  // "Rossi Mario" contro "Rossi", o viceversa: accetta solo se univoco.
  const partial = doctors.filter(d => {
    const dn = normalizeName(d.name);
    return dn.split(' ').every(p => n.split(' ').includes(p)) || n.split(' ').every(p => dn.split(' ').includes(p));
  });
  return partial.length === 1 ? partial[0] : null;
}

export interface GridImport {
  requests: Record<string, Record<string, RequestCode>>;
  matched: { doctorId: string; name: string; count: number }[];
  unknownNames: string[];
  invalid: { name: string; day: number; value: string }[];
  /** Numero di giorni riconosciuti nell'intestazione. */
  days: number;
}

function asDay(value: Cell): number | null {
  if (value instanceof Date) return value.getDate();
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{1,2})(?:\s|$|\/|-|\n)/) ?? value.trim().match(/^(\d{1,2})$/);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Trova la riga d'intestazione con i numeri dei giorni: 1, 2, 3, ... */
function findHeader(rows: Cell[][]): { row: number; columns: Map<number, number> } | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const columns = new Map<number, number>();
    let expected = 1;
    rows[r].forEach((cell, c) => {
      const day = asDay(cell);
      if (day === expected) { columns.set(c, day); expected++; }
    });
    if (columns.size >= 7) return { row: r, columns };
  }
  return null;
}

export function parseRequestGrid(rows: Cell[][], doctors: Doctor[], year: number, month: number): GridImport {
  const header = findHeader(rows);
  const result: GridImport = { requests: {}, matched: [], unknownNames: [], invalid: [], days: 0 };
  if (!header) return result;
  const n = daysInMonth(year, month);
  const firstDayCol = Math.min(...header.columns.keys());
  result.days = [...header.columns.values()].filter(d => d <= n).length;

  for (let r = header.row + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const name = row.slice(0, firstDayCol).map(c => (c === null || c === undefined ? '' : String(c).trim())).filter(Boolean).join(' ');
    if (!name) continue;
    // Le righe sotto l'intestazione con soli giorni della settimana si saltano.
    if (/^(lun|mar|mer|gio|ven|sab|dom|l|m|g|v|s|d)$/i.test(String(row[firstDayCol] ?? '').trim()) && !matchDoctor(name, doctors)) continue;
    const doc = matchDoctor(name, doctors);
    const codes: Record<string, RequestCode> = {};
    for (const [col, day] of header.columns) {
      if (day > n) continue;
      const code = parseCode(row[col]);
      if (code === 'invalid') result.invalid.push({ name, day, value: String(row[col]) });
      else if (code) codes[toIso(year, month, day)] = code;
    }
    if (!doc) {
      if (Object.keys(codes).length > 0 || /[a-z]/i.test(name)) result.unknownNames.push(name);
      continue;
    }
    result.requests[doc.id] = { ...result.requests[doc.id], ...codes };
    result.matched.push({ doctorId: doc.id, name: doc.name, count: Object.keys(codes).length });
  }
  return result;
}

/** CSV o testo incollato da Excel (tabulazioni). */
export function parseDelimited(text: string): Cell[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const sample = lines.slice(0, 5).join('\n');
  const delimiter = sample.includes('\t') ? '\t' : (sample.split(';').length >= sample.split(',').length ? ';' : ',');
  return lines.map(line => splitLine(line, delimiter));
}

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
