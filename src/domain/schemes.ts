import {
  ScheduleSlot,
  SchemeStep,
  ShiftScheme,
  ShiftType,
  Weekday,
  WEEKDAYS,
  OFF_STEP_LABELS,
} from '../models/types';
import { ShiftTypeIndex, crossesMidnight } from './shiftTypes';
import { addDays, daysBetween } from '../utils/date';
import { generateId } from '../utils/id';

/**
 * Uno schema turni è una sequenza di passi giornalieri: ogni passo è un turno
 * da coprire oppure un giorno non lavorativo (smonto / riposo). Lo stesso
 * schema si usa in due modi:
 *
 *  - per riempire la griglia settimanale di una sala (quali turni servono);
 *  - come ciclo di rotazione dei medici, che avanzano di un passo al giorno
 *    sfasati fra loro.
 */

export function describeStep(step: SchemeStep, shiftTypes: ShiftTypeIndex): string {
  return step.kind === 'shift' ? shiftTypes.get(step.shiftTypeId).name : OFF_STEP_LABELS[step.kind];
}

export function stepCode(step: SchemeStep, shiftTypes: ShiftTypeIndex): string {
  if (step.kind === 'shift') return shiftTypes.get(step.shiftTypeId).code;
  return step.kind === 'smonto' ? 'S' : 'R';
}

export function describeScheme(scheme: ShiftScheme, shiftTypes: ShiftTypeIndex): string {
  return scheme.steps.map(step => describeStep(step, shiftTypes)).join(' → ');
}

/** Uno schema è utilizzabile solo se tutte le fasce che cita esistono ancora. */
export function isSchemeUsable(scheme: ShiftScheme, shiftTypes: ShiftTypeIndex): boolean {
  return scheme.steps.every(step => step.kind !== 'shift' || shiftTypes.has(step.shiftTypeId));
}

// ---------------------------------------------------------------------------
// Schemi predefiniti
// ---------------------------------------------------------------------------

/**
 * Gli schemi predefiniti si adattano alle fasce configurate: vengono proposti
 * solo quando le fasce che citano esistono davvero.
 */
export function buildBuiltInSchemes(shiftTypes: ShiftType[]): ShiftScheme[] {
  const byCode = new Map(shiftTypes.map(shiftType => [shiftType.code.toUpperCase(), shiftType]));
  const night = shiftTypes.find(shiftType => crossesMidnight(shiftType));
  const morning = byCode.get('M');
  const afternoon = byCode.get('P');
  const long = byCode.get('L');

  const schemes: ShiftScheme[] = [];
  const shift = (shiftType: ShiftType): SchemeStep => ({ kind: 'shift', shiftTypeId: shiftType.id });
  const smonto: SchemeStep = { kind: 'smonto' };
  const riposo: SchemeStep = { kind: 'riposo' };

  if (afternoon && long && night) {
    schemes.push({
      id: 'builtin-p-l-n-s-r',
      name: 'Pomeriggio · Lunga · Notte · Smonto · Riposo',
      steps: [shift(afternoon), shift(long), shift(night), smonto, riposo],
      builtIn: true,
    });
  }

  if (morning && afternoon && night) {
    schemes.push({
      id: 'builtin-m-p-n-s-r',
      name: 'Mattina · Pomeriggio · Notte · Smonto · Riposo',
      steps: [shift(morning), shift(afternoon), shift(night), smonto, riposo],
      builtIn: true,
    });
  }

  if (night) {
    schemes.push({
      id: 'builtin-n-s-r',
      name: 'Notte · Smonto · Riposo',
      steps: [shift(night), smonto, riposo],
      builtIn: true,
    });
  }

  if (morning && afternoon) {
    schemes.push({
      id: 'builtin-m-p',
      name: 'Mattina · Pomeriggio',
      steps: [shift(morning), shift(afternoon)],
      builtIn: true,
    });
  }

  return schemes;
}

export function createEmptyScheme(name = 'Nuovo schema'): ShiftScheme {
  return { id: generateId(), name, steps: [] };
}

// ---------------------------------------------------------------------------
// Applicazione alla griglia settimanale di una sala
// ---------------------------------------------------------------------------

export interface SchemeSlotDraft {
  weekday: Weekday;
  shiftTypeId: string;
  isCritical: boolean;
  requiresNextDayRest: boolean;
  requiresSecondDayRest: boolean;
  isFullDayExclusive: boolean;
}

/**
 * Distribuisce i passi dello schema sui sette giorni, partendo dal giorno
 * scelto e ripetendo la sequenza se più corta della settimana.
 *
 * I flag di riposo vengono dedotti dai passi successivi: un turno seguito da
 * "Smonto" rende smontante il giorno dopo, e se allo smonto segue un "Riposo"
 * viene marcato anche il secondo giorno. I turni che scavalcano la mezzanotte
 * sono sempre smontanti ed esclusivi, anche senza uno smonto esplicito.
 */
export function buildSchemeSlots(
  scheme: ShiftScheme,
  startWeekday: Weekday,
  shiftTypes: ShiftTypeIndex,
): SchemeSlotDraft[] {
  const steps = scheme.steps;
  if (steps.length === 0) return [];

  const startIndex = WEEKDAYS.indexOf(startWeekday);
  const drafts: SchemeSlotDraft[] = [];

  for (let dayOffset = 0; dayOffset < WEEKDAYS.length; dayOffset++) {
    const step = steps[dayOffset % steps.length];
    if (step.kind !== 'shift') continue;

    const shiftType = shiftTypes.get(step.shiftTypeId);
    const next = steps[(dayOffset + 1) % steps.length];
    const afterNext = steps[(dayOffset + 2) % steps.length];
    const overnight = crossesMidnight(shiftType);
    const followedBySmonto = next.kind === 'smonto';

    drafts.push({
      weekday: WEEKDAYS[(startIndex + dayOffset) % WEEKDAYS.length],
      shiftTypeId: step.shiftTypeId,
      isCritical: overnight || followedBySmonto,
      requiresNextDayRest: overnight || followedBySmonto,
      requiresSecondDayRest: followedBySmonto && afterNext.kind === 'riposo',
      isFullDayExclusive: overnight || followedBySmonto,
    });
  }

  return drafts;
}

/** Trasforma le bozze in slot veri, unendole a quelle già presenti nella sala. */
export function mergeSchemeSlots(
  existing: ScheduleSlot[],
  drafts: SchemeSlotDraft[],
  mode: 'replace' | 'merge',
): ScheduleSlot[] {
  const slots = mode === 'replace' ? [] : [...existing];

  for (const draft of drafts) {
    const duplicate = slots.some(
      slot => slot.weekday === draft.weekday && slot.shiftTypeId === draft.shiftTypeId,
    );
    if (duplicate) continue;
    slots.push({ id: generateId(), ...draft });
  }

  return slots;
}

// ---------------------------------------------------------------------------
// Ciclo di rotazione dei medici
// ---------------------------------------------------------------------------

/** Passo dello schema toccato da un medico in una data. */
export interface CycleStepAtDate {
  step: SchemeStep;
  stepIndex: number;
}

/**
 * Passo del ciclo per un medico in una data: i medici partono sfasati di
 * `offsetStep` passi ciascuno, così insieme coprono tutta la sequenza.
 */
export function cycleStepFor(
  scheme: ShiftScheme,
  doctorIndex: number,
  offsetStep: number,
  anchorDate: string,
  date: string,
): CycleStepAtDate | null {
  const length = scheme.steps.length;
  if (length === 0) return null;

  const dayOffset = daysBetween(anchorDate, date);
  const raw = dayOffset + doctorIndex * offsetStep;
  const stepIndex = ((raw % length) + length) % length;

  return { step: scheme.steps[stepIndex], stepIndex };
}

export interface CyclePreviewRow {
  doctorId: string;
  codes: string[];
}

/** Anteprima della rotazione, usata nelle impostazioni della sala. */
export function buildCyclePreview(
  scheme: ShiftScheme,
  doctorIds: string[],
  offsetStep: number,
  anchorDate: string,
  days: number,
  shiftTypes: ShiftTypeIndex,
): { dates: string[]; rows: CyclePreviewRow[] } {
  const dates = Array.from({ length: days }, (_, index) => addDays(anchorDate, index));

  const rows = doctorIds.map((doctorId, doctorIndex) => ({
    doctorId,
    codes: dates.map(date => {
      const current = cycleStepFor(scheme, doctorIndex, offsetStep, anchorDate, date);
      return current ? stepCode(current.step, shiftTypes) : '';
    }),
  }));

  return { dates, rows };
}

/**
 * Sfasamento che distribuisce i medici sul ciclo nel modo più uniforme
 * possibile: con tanti medici quanti i passi ogni posizione è occupata una
 * volta sola, ed è il caso in cui la copertura è completa.
 */
export function suggestOffsetStep(stepCount: number, doctorCount: number): number {
  if (stepCount <= 1 || doctorCount <= 1) return 1;
  return Math.max(1, Math.round(stepCount / doctorCount)) || 1;
}
