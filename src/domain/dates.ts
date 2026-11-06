// Date come stringhe YYYY-MM-DD, calcolate in UTC per non inciampare
// nell'ora legale. Mese 1-12 ovunque.

export const MONTH_NAMES = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

export const WEEKDAY_SHORT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
export const WEEKDAY_LETTER = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
export const WEEKDAY_LONG = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

const pad = (n: number) => String(n).padStart(2, '0');

export function toIso(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function parseIso(iso: string): { year: number; month: number; day: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { year: y, month: m, day: d };
}

function toUtc(iso: string): number {
  const { year, month, day } = parseIso(iso);
  return Date.UTC(year, month - 1, day);
}

function fromUtc(ms: number): string {
  const d = new Date(ms);
  return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * 86_400_000);
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(a) - toUtc(b)) / 86_400_000);
}

/** 0 = lunedi ... 6 = domenica */
export function weekdayOf(iso: string): number {
  return (new Date(toUtc(iso)).getUTCDay() + 6) % 7;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthDates(year: number, month: number): string[] {
  const n = daysInMonth(year, month);
  return Array.from({ length: n }, (_, i) => toIso(year, month, i + 1));
}

export function monthKey(year: number, month: number): string {
  return `${year}-${pad(month)}`;
}

export function parseMonthKey(key: string): { year: number; month: number } {
  const [y, m] = key.split('-').map(Number);
  return { year: y, month: m };
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function formatDay(iso: string): string {
  const { day, month } = parseIso(iso);
  return `${WEEKDAY_SHORT[weekdayOf(iso)]} ${day} ${MONTH_NAMES[month - 1].slice(0, 3).toLowerCase()}`;
}

/** Lunedi della settimana che contiene la data. */
export function weekStart(iso: string): string {
  return addDays(iso, -weekdayOf(iso));
}

/** Minuti da mezzanotte di una stringa HH:MM. */
export function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Durata in ore; fine <= inizio significa che scavalca la mezzanotte (24h se uguali). */
export function shiftHours(start: string, end: string): number {
  let d = minutes(end) - minutes(start);
  if (d <= 0) d += 24 * 60;
  return d / 60;
}

/** Intervallo assoluto in minuti rispetto alla mezzanotte del giorno del turno. */
export function shiftInterval(start: string, end: string): [number, number] {
  const s = minutes(start);
  let e = minutes(end);
  if (e <= s) e += 24 * 60;
  return [s, e];
}
