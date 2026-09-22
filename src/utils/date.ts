import { Weekday, WEEKDAYS } from '../models/types';

export const MONTH_NAMES = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

export const MONTH_NAMES_SHORT = [
  'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu',
  'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic',
];

/** Sigle dei giorni indicizzate come `Date.getDay()` (0 = domenica). */
export const WEEKDAY_SHORT_BY_INDEX = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

/** `Date.getDay()` → `Weekday`. */
const WEEKDAY_BY_INDEX: Weekday[] = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

/** Converte una data in stringa YYYY-MM-DD usando il fuso locale. */
export function formatISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Interpreta YYYY-MM-DD come mezzanotte locale.
 * `new Date('2026-04-15')` userebbe invece mezzanotte UTC, spostando il giorno
 * nei fusi a ovest di Greenwich.
 */
export function parseISODate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function buildISODate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addDays(isoDate: string, days: number): string {
  const date = parseISODate(isoDate);
  date.setDate(date.getDate() + days);
  return formatISODate(date);
}

/** Numero di giorni fra due date ISO (b - a). */
export function daysBetween(fromISO: string, toISO: string): number {
  const from = parseISODate(fromISO);
  const to = parseISODate(toISO);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function weekdayOfISODate(isoDate: string): Weekday {
  return WEEKDAY_BY_INDEX[parseISODate(isoDate).getDay()];
}

export function weekdayOfDate(date: Date): Weekday {
  return WEEKDAY_BY_INDEX[date.getDay()];
}

export function isWeekendISODate(isoDate: string): boolean {
  const day = parseISODate(isoDate).getDay();
  return day === 0 || day === 6;
}

/** Posizione della colonna in una griglia che inizia dal lunedì (0-6). */
export function mondayFirstIndex(isoDate: string): number {
  return (parseISODate(isoDate).getDay() + 6) % 7;
}

export interface MonthDay {
  day: number;
  date: string;
  weekday: Weekday;
  /** Indice compatibile con `WEEKDAY_SHORT_BY_INDEX`. */
  weekdayIndex: number;
  isWeekend: boolean;
}

/** Elenco dei giorni di un mese, pronto per essere iterato nelle viste. */
export function buildMonthDays(year: number, month: number): MonthDay[] {
  const total = getDaysInMonth(year, month);
  const days: MonthDay[] = [];
  for (let day = 1; day <= total; day++) {
    const date = new Date(year, month - 1, day);
    const weekdayIndex = date.getDay();
    days.push({
      day,
      date: buildISODate(year, month, day),
      weekday: WEEKDAY_BY_INDEX[weekdayIndex],
      weekdayIndex,
      isWeekend: weekdayIndex === 0 || weekdayIndex === 6,
    });
  }
  return days;
}

export function monthKey(year: number, month: number): string {
  return `${year}-${month}`;
}

export function parseMonthKey(key: string): { year: number; month: number } {
  const [year, month] = key.split('-').map(Number);
  return { year, month };
}

export function formatMonthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** Giorno e mese in forma breve, es. "15 Aprile". */
export function formatDayMonth(isoDate: string): string {
  const date = parseISODate(isoDate);
  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
}

export function getYearRange(): number[] {
  const currentYear = new Date().getFullYear();
  return [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];
}

export function formatDateTime(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export { WEEKDAYS };
