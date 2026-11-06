import { addDays, monthDates, toIso } from './dates';
import type { MonthData } from './types';

/** Domenica di Pasqua (calendario gregoriano, algoritmo anonimo). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toIso(year, month, day);
}

const FIXED: { md: string; name: string; from?: number }[] = [
  { md: '01-01', name: 'Capodanno' },
  { md: '01-06', name: 'Epifania' },
  { md: '04-25', name: 'Festa della Liberazione' },
  { md: '05-01', name: 'Festa dei Lavoratori' },
  { md: '06-02', name: 'Festa della Repubblica' },
  { md: '08-15', name: 'Ferragosto' },
  // Ripristinata come festivita nazionale a partire dal 2026.
  { md: '10-04', name: 'San Francesco d’Assisi', from: 2026 },
  { md: '11-01', name: 'Ognissanti' },
  { md: '12-08', name: 'Immacolata' },
  { md: '12-25', name: 'Natale' },
  { md: '12-26', name: 'Santo Stefano' },
];

/** Festivi nazionali italiani dell'anno, piu l'eventuale patrono (MM-DD). */
export function italianHolidays(year: number, patronDay: string | null = null): Map<string, string> {
  const out = new Map<string, string>();
  for (const h of FIXED) {
    if (h.from && year < h.from) continue;
    out.set(`${year}-${h.md}`, h.name);
  }
  const easter = easterSunday(year);
  out.set(easter, 'Pasqua');
  out.set(addDays(easter, 1), 'Lunedì dell’Angelo');
  if (patronDay && /^\d{2}-\d{2}$/.test(patronDay)) {
    const key = `${year}-${patronDay}`;
    if (!out.has(key)) out.set(key, 'Santo patrono');
  }
  return out;
}

/** Festivi effettivi del mese: automatici + aggiunti - tolti. */
export function monthHolidays(
  year: number,
  month: number,
  patronDay: string | null,
  data: Pick<MonthData, 'extraHolidays' | 'removedHolidays'> | undefined,
): Map<string, string> {
  const auto = italianHolidays(year, patronDay);
  const out = new Map<string, string>();
  const removed = new Set(data?.removedHolidays ?? []);
  for (const date of monthDates(year, month)) {
    const name = auto.get(date);
    if (name && !removed.has(date)) out.set(date, name);
  }
  for (const date of data?.extraHolidays ?? []) {
    if (!out.has(date)) out.set(date, 'Festivo');
  }
  return out;
}
