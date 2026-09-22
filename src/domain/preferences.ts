import {
  Doctor,
  RuleLevel,
  ShiftLengthPreference,
  ShiftType,
  Weekday,
} from '../models/types';
import { ShiftTypeIndex, shiftDurationHours } from './shiftTypes';

/**
 * Divieti e preferenze dei medici sulle giornate e sulla durata dei turni.
 *
 * Divieto e preferenza sono lo stesso meccanismo con due livelli: `never`
 * impedisce l'assegnazione, `avoid` la sconsiglia. Tenerli insieme evita che
 * l'interfaccia mostri due elenchi che dicono cose simili e che il generatore
 * ne consulti solo uno.
 */
export class DoctorRules {
  /** `doctorId|weekday|shiftTypeId` → livello, con `*` per la giornata intera. */
  private readonly levels = new Map<string, RuleLevel>();
  private readonly doctorById: Map<string, Doctor>;

  constructor(doctors: Doctor[]) {
    this.doctorById = new Map(doctors.map(doctor => [doctor.id, doctor]));

    for (const doctor of doctors) {
      for (const rule of doctor.weekdayRules) {
        const key = ruleKey(doctor.id, rule.weekday, rule.shiftTypeId);
        // Il divieto vince sulla preferenza quando entrambi coprono la stessa
        // casella, per esempio una regola di giornata e una di fascia.
        if (this.levels.get(key) === 'never') continue;
        this.levels.set(key, rule.level);
      }
    }
  }

  /**
   * Livello applicabile a un medico per giorno e fascia. La regola della
   * giornata intera si applica anche alle singole fasce, e fra le due vince
   * la più stringente.
   */
  levelFor(doctorId: string, weekday: Weekday, shiftTypeId: string): RuleLevel | null {
    const wholeDay = this.levels.get(ruleKey(doctorId, weekday, null));
    const specific = this.levels.get(ruleKey(doctorId, weekday, shiftTypeId));

    if (wholeDay === 'never' || specific === 'never') return 'never';
    if (wholeDay === 'avoid' || specific === 'avoid') return 'avoid';
    return null;
  }

  /** Livello impostato esattamente su quella casella, per l'interfaccia. */
  exactLevel(doctorId: string, weekday: Weekday, shiftTypeId: string | null): RuleLevel | null {
    return this.levels.get(ruleKey(doctorId, weekday, shiftTypeId)) ?? null;
  }

  forbids(doctorId: string, weekday: Weekday, shiftTypeId: string): boolean {
    return this.levelFor(doctorId, weekday, shiftTypeId) === 'never';
  }

  discourages(doctorId: string, weekday: Weekday, shiftTypeId: string): boolean {
    return this.levelFor(doctorId, weekday, shiftTypeId) === 'avoid';
  }

  doctor(doctorId: string): Doctor | undefined {
    return this.doctorById.get(doctorId);
  }
}

function ruleKey(doctorId: string, weekday: Weekday, shiftTypeId: string | null): string {
  return `${doctorId}|${weekday}|${shiftTypeId ?? '*'}`;
}

/** Aggiunge o rimuove una regola, mantenendo un solo livello per casella. */
export function setWeekdayRule(
  doctor: Doctor,
  weekday: Weekday,
  shiftTypeId: string | null,
  level: RuleLevel | null,
): Doctor {
  const others = doctor.weekdayRules.filter(
    rule => !(rule.weekday === weekday && rule.shiftTypeId === shiftTypeId),
  );

  return {
    ...doctor,
    weekdayRules: level === null ? others : [...others, { weekday, shiftTypeId, level }],
  };
}

/** Ciclo dei livelli per il clic sulla griglia: libero → evita → mai → libero. */
export function nextRuleLevel(current: RuleLevel | null): RuleLevel | null {
  if (current === null) return 'avoid';
  if (current === 'avoid') return 'never';
  return null;
}

// ---------------------------------------------------------------------------
// Durata dei turni
// ---------------------------------------------------------------------------

/**
 * Soglia fra turni lunghi e brevi, ricavata dalle fasce configurate: è il
 * punto medio fra la fascia più breve e la più lunga.
 *
 * Usare le fasce del servizio invece di un numero fisso fa sì che la
 * preferenza abbia senso sia dove si alternano 6 e 12 ore, sia dove le durate
 * sono altre. Quando tutte le fasce hanno la stessa durata la distinzione non
 * esiste e la preferenza non ha effetto.
 */
export interface ShiftLengthScale {
  shortest: number;
  longest: number;
  threshold: number;
  /** Falso quando tutte le fasce hanno la stessa durata. */
  meaningful: boolean;
}

export function buildShiftLengthScale(shiftTypes: ShiftType[]): ShiftLengthScale {
  const hours = shiftTypes.map(shiftDurationHours);
  if (hours.length === 0) {
    return { shortest: 0, longest: 0, threshold: 0, meaningful: false };
  }

  const shortest = Math.min(...hours);
  const longest = Math.max(...hours);

  return {
    shortest,
    longest,
    threshold: (shortest + longest) / 2,
    meaningful: longest > shortest,
  };
}

export type LengthFit = 'preferred' | 'againstPreference' | 'neutral';

/** Se un turno rispetta la preferenza di durata del medico. */
export function lengthFit(
  preference: ShiftLengthPreference,
  shiftTypeId: string,
  shiftTypes: ShiftTypeIndex,
  scale: ShiftLengthScale,
): LengthFit {
  if (preference === 'none' || !scale.meaningful) return 'neutral';

  const hours = shiftTypes.hours(shiftTypeId);
  if (hours === 0) return 'neutral';

  const isLong = hours >= scale.threshold;
  if (preference === 'long') return isLong ? 'preferred' : 'againstPreference';
  return isLong ? 'againstPreference' : 'preferred';
}

export const SHIFT_LENGTH_LABELS: Record<ShiftLengthPreference, string> = {
  none: 'Nessuna preferenza',
  long: 'Turni lunghi',
  short: 'Turni brevi',
};

/** Quota di turni che rispettano la preferenza di durata, per medico. */
export function measureLengthPreference(
  assignments: { doctorId: string; shiftTypeId: string }[],
  doctors: Doctor[],
  shiftTypes: ShiftTypeIndex,
  scale: ShiftLengthScale,
): Map<string, { preferred: number; against: number; ratio: number }> {
  const result = new Map<string, { preferred: number; against: number; ratio: number }>();
  if (!scale.meaningful) return result;

  const preferenceById = new Map(
    doctors.map(doctor => [doctor.id, doctor.shiftLengthPreference]),
  );

  for (const assignment of assignments) {
    const preference = preferenceById.get(assignment.doctorId) ?? 'none';
    if (preference === 'none') continue;

    const fit = lengthFit(preference, assignment.shiftTypeId, shiftTypes, scale);
    if (fit === 'neutral') continue;

    const entry = result.get(assignment.doctorId) ?? { preferred: 0, against: 0, ratio: 0 };
    if (fit === 'preferred') entry.preferred++;
    else entry.against++;
    result.set(assignment.doctorId, entry);
  }

  for (const entry of result.values()) {
    const total = entry.preferred + entry.against;
    entry.ratio = total > 0 ? entry.preferred / total : 0;
  }

  return result;
}
