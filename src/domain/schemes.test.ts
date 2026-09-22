import { describe, expect, it } from 'vitest';
import { ShiftScheme } from '../models/types';
import { ShiftTypeIndex } from './shiftTypes';
import {
  buildBuiltInSchemes,
  describeScheme,
  isSchemeUsable,
  stepCode,
  workingStepCount,
} from './schemes';
import { AFTERNOON, LONG, MORNING, NIGHT } from './testFixtures';

const shiftTypes = new ShiftTypeIndex([MORNING, AFTERNOON, NIGHT, LONG]);

const cycle5: ShiftScheme = {
  id: 'c5',
  name: 'Pomeriggio · Lunga · Notte · Smonto · Riposo',
  steps: [
    { kind: 'shift', shiftTypeId: AFTERNOON.id },
    { kind: 'shift', shiftTypeId: LONG.id },
    { kind: 'shift', shiftTypeId: NIGHT.id },
    { kind: 'smonto' },
    { kind: 'riposo' },
  ],
};

describe('schemi predefiniti', () => {
  it('propone il ciclo con la lunga quando la fascia esiste', () => {
    const schemes = buildBuiltInSchemes([MORNING, AFTERNOON, NIGHT, LONG]);
    expect(schemes.map(scheme => scheme.id)).toContain('builtin-p-l-n-s-r');
  });

  it('non propone schemi che citano fasce inesistenti', () => {
    const schemes = buildBuiltInSchemes([MORNING, AFTERNOON]);
    expect(schemes.map(scheme => scheme.id)).not.toContain('builtin-p-l-n-s-r');
    expect(schemes.map(scheme => scheme.id)).toContain('builtin-m-p');
  });

  it('riconosce uno schema inutilizzabile dopo la rimozione di una fascia', () => {
    const reduced = new ShiftTypeIndex([MORNING, AFTERNOON]);
    expect(isSchemeUsable(cycle5, shiftTypes)).toBe(true);
    expect(isSchemeUsable(cycle5, reduced)).toBe(false);
  });
});

describe('descrizione di uno schema', () => {
  it('elenca i passi in ordine', () => {
    expect(describeScheme(cycle5, shiftTypes))
      .toBe('Pomeriggio → Lunga → Notte → Smonto → Riposo');
  });

  it('usa le sigle per le viste compatte', () => {
    expect(cycle5.steps.map(step => stepCode(step, shiftTypes)))
      .toEqual([AFTERNOON.code, LONG.code, NIGHT.code, 'S', 'R']);
  });

  it('conta le giornate lavorative del giro', () => {
    expect(workingStepCount(cycle5)).toBe(3);
    expect(cycle5.steps.length).toBe(5);
  });
});
