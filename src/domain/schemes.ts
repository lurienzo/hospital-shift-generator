import {
  OFF_STEP_LABELS,
  SchemeStep,
  ShiftScheme,
  ShiftType,
} from '../models/types';
import { ShiftTypeIndex, crossesMidnight } from './shiftTypes';
import { generateId } from '../utils/id';

/**
 * Uno schema turni è una sequenza di giornate: ogni passo è un turno da
 * svolgere oppure un giorno non lavorativo (smonto o riposo).
 *
 * Lo schema descrive come si succedono le giornate di un medico, non cosa
 * serve a una sala: vale per l'intero servizio, e qualunque sala può fornire
 * il turno che il passo richiede. Si applica come regola di rotazione del
 * servizio, in `RotationTracker`.
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

/** Giornate lavorative di un giro completo, utile per stimare la copertura. */
export function workingStepCount(scheme: ShiftScheme): number {
  return scheme.steps.filter(step => step.kind === 'shift').length;
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

export function createEmptyScheme(name = ''): ShiftScheme {
  return { id: generateId(), name, steps: [] };
}
