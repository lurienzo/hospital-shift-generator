import {
  DEFAULT_BLOCK_LENGTH_DAYS,
  DEFAULT_BLOCK_START_WEEKDAY,
  ShiftType,
  Weekday,
  WEEKDAYS,
} from '../models/types';
import { daysBetween } from '../utils/date';

const MINUTES_PER_DAY = 24 * 60;

/**
 * Lunedì, usato come origine per numerare i blocchi delle fasce a rotazione.
 * Un riferimento assoluto invece dell'inizio del mese serve perché un blocco
 * settimanale può stare a cavallo di due mesi e deve restare un blocco solo.
 */
const EPOCH_MONDAY = '1970-01-05';

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
  const normalized = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(normalized / 60);
  return `${String(hours).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

/**
 * Intervallo della fascia in minuti dalla mezzanotte del giorno di inizio.
 * Le fasce che scavalcano la mezzanotte hanno `end` oltre i 1440 minuti,
 * così i confronti fra intervalli restano semplici sottrazioni.
 */
export function shiftInterval(shiftType: ShiftType): { start: number; end: number } {
  const start = timeToMinutes(shiftType.start);
  let end = timeToMinutes(shiftType.end);
  if (end <= start) end += MINUTES_PER_DAY;
  return { start, end };
}

export function shiftDurationHours(shiftType: ShiftType): number {
  const { start, end } = shiftInterval(shiftType);
  return (end - start) / 60;
}

export function crossesMidnight(shiftType: ShiftType): boolean {
  return timeToMinutes(shiftType.end) <= timeToMinutes(shiftType.start);
}

/**
 * Due fasce si sovrappongono se, iniziando lo stesso giorno, i loro intervalli
 * si intersecano. La notte 20:00-08:00 termina esattamente quando inizia la
 * mattina del giorno dopo, quindi non è una sovrapposizione: quel vincolo si
 * esprime col flag "smontante".
 */
export function shiftsOverlap(a: ShiftType, b: ShiftType): boolean {
  const first = shiftInterval(a);
  const second = shiftInterval(b);
  return first.start < second.end && second.start < first.end;
}

/** Etichetta compatta della fascia, es. "08-14". */
export function shiftRangeLabel(shiftType: ShiftType): string {
  const strip = (time: string) => (time.endsWith(':00') ? time.slice(0, 2) : time);
  return `${strip(shiftType.start)}-${strip(shiftType.end)}`;
}

/** Etichetta completa, es. "Mattina (08:00-14:00)". */
export function shiftFullLabel(shiftType: ShiftType): string {
  return `${shiftType.name} (${shiftType.start}-${shiftType.end})`;
}

// ---------------------------------------------------------------------------
// Fasce a rotazione
// ---------------------------------------------------------------------------

export function isRotational(shiftType: ShiftType): boolean {
  return shiftType.rotational === true;
}

export function blockLengthOf(shiftType: ShiftType): number {
  const length = shiftType.blockLengthDays ?? DEFAULT_BLOCK_LENGTH_DAYS;
  return length > 0 ? length : DEFAULT_BLOCK_LENGTH_DAYS;
}

export function blockStartOf(shiftType: ShiftType): Weekday {
  return shiftType.blockStartWeekday ?? DEFAULT_BLOCK_START_WEEKDAY;
}

/**
 * Numero progressivo del blocco a cui appartiene una data.
 *
 * Due date dello stesso blocco condividono l'indice, anche se cadono in mesi
 * diversi: è così che una settimana di diurnismo resta un'unica assegnazione
 * anche a fine mese.
 */
export function blockIndexOf(shiftType: ShiftType, isoDate: string): number {
  const offset = WEEKDAYS.indexOf(blockStartOf(shiftType));
  const days = daysBetween(EPOCH_MONDAY, isoDate) - offset;
  return Math.floor(days / blockLengthOf(shiftType));
}

/** Prima data del blocco indicato. */
export function blockStartDate(shiftType: ShiftType, blockIndex: number): string {
  const offset = WEEKDAYS.indexOf(blockStartOf(shiftType));
  const days = blockIndex * blockLengthOf(shiftType) + offset;
  const start = new Date(1970, 0, 5);
  start.setDate(start.getDate() + days);
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
}

/** Etichetta leggibile della durata del blocco. */
export function blockLabel(shiftType: ShiftType): string {
  const length = blockLengthOf(shiftType);
  if (length === 7) return 'settimana';
  if (length === 14) return 'due settimane';
  return `${length} giorni`;
}

export function sortShiftTypes(shiftTypes: ShiftType[]): ShiftType[] {
  return [...shiftTypes].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return shiftInterval(a).start - shiftInterval(b).start;
  });
}

/**
 * Indice per risolvere un id fascia in tempo costante, con fallback per gli id
 * che non esistono più (fascia cancellata ma ancora citata in un calendario
 * salvato). Il fallback evita schermate rotte e resta riconoscibile.
 */
export class ShiftTypeIndex {
  readonly all: ShiftType[];
  /** Solo le fasce a rotazione, nell'ordine di visualizzazione. */
  readonly rotational: ShiftType[];
  private readonly byId: Map<string, ShiftType>;
  private readonly orderById: Map<string, number>;

  constructor(shiftTypes: ShiftType[]) {
    this.all = sortShiftTypes(shiftTypes);
    this.rotational = this.all.filter(isRotational);
    this.byId = new Map(this.all.map(shiftType => [shiftType.id, shiftType]));
    this.orderById = new Map(this.all.map((shiftType, index) => [shiftType.id, index]));
  }

  isRotational(id: string): boolean {
    const shiftType = this.byId.get(id);
    return shiftType ? isRotational(shiftType) : false;
  }

  /** Indice del blocco, oppure `null` se la fascia non è a rotazione. */
  blockIndex(id: string, isoDate: string): number | null {
    const shiftType = this.byId.get(id);
    if (!shiftType || !isRotational(shiftType)) return null;
    return blockIndexOf(shiftType, isoDate);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  get(id: string): ShiftType {
    return this.byId.get(id) ?? placeholderShiftType(id);
  }

  order(id: string): number {
    return this.orderById.get(id) ?? Number.MAX_SAFE_INTEGER;
  }

  hours(id: string): number {
    const shiftType = this.byId.get(id);
    return shiftType ? shiftDurationHours(shiftType) : 0;
  }

  /** Confronto cronologico utilizzabile direttamente in `Array.sort`. */
  compare = (a: string, b: string): number => this.order(a) - this.order(b);

  /** Fasce che si sovrappongono a quella indicata (esclusa se stessa). */
  overlapping(id: string): ShiftType[] {
    const shiftType = this.byId.get(id);
    if (!shiftType) return [];
    return this.all.filter(other => other.id !== id && shiftsOverlap(shiftType, other));
  }
}

function placeholderShiftType(id: string): ShiftType {
  return {
    id,
    name: 'Fascia rimossa',
    code: '?',
    start: '00:00',
    end: '00:00',
    color: '#64748b',
    order: Number.MAX_SAFE_INTEGER,
  };
}

/** Validazione usata dall'editor delle fasce orarie. */
export function validateShiftType(
  candidate: Pick<ShiftType, 'id' | 'name' | 'code' | 'start' | 'end'>,
  existing: ShiftType[],
): string | null {
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

  if (!candidate.name.trim()) return 'Il nome è obbligatorio';
  if (!candidate.code.trim()) return 'La sigla è obbligatoria';
  if (candidate.code.trim().length > 2) return 'La sigla può avere al massimo 2 caratteri';
  if (!timePattern.test(candidate.start)) return 'Orario di inizio non valido (usa HH:MM)';
  if (!timePattern.test(candidate.end)) return 'Orario di fine non valido (usa HH:MM)';
  if (candidate.start === candidate.end) return 'Inizio e fine non possono coincidere';

  const others = existing.filter(shiftType => shiftType.id !== candidate.id);
  const name = candidate.name.trim().toLowerCase();
  const code = candidate.code.trim().toUpperCase();

  if (others.some(shiftType => shiftType.name.trim().toLowerCase() === name)) {
    return 'Esiste già una fascia con questo nome';
  }
  if (others.some(shiftType => shiftType.code.trim().toUpperCase() === code)) {
    return 'Esiste già una fascia con questa sigla';
  }
  if (others.some(shiftType => shiftType.start === candidate.start && shiftType.end === candidate.end)) {
    return 'Esiste già una fascia con questi orari';
  }

  return null;
}
