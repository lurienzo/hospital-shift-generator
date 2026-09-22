import { describe, expect, it } from 'vitest';
import { ShiftScheme } from '../models/types';
import { ShiftTypeIndex } from './shiftTypes';
import {
  buildBuiltInSchemes,
  buildCyclePreview,
  buildSchemeSlots,
  cycleStepFor,
  describeScheme,
  isSchemeUsable,
  mergeSchemeSlots,
  suggestOffsetStep,
} from './schemes';
import { AFTERNOON, LONG, MORNING, NIGHT, makeSlot } from './testFixtures';

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

  it('descrive lo schema in forma leggibile', () => {
    expect(describeScheme(cycle5, shiftTypes))
      .toBe('Pomeriggio → Lunga → Notte → Smonto → Riposo');
  });
});

describe('applicazione dello schema alla settimana', () => {
  it('distribuisce i passi sui sette giorni partendo dal giorno scelto', () => {
    const drafts = buildSchemeSlots(cycle5, 'monday', shiftTypes);

    // Lun pomeriggio, mar lunga, mer notte, gio e ven non lavorativi,
    // poi la sequenza riparte: sab pomeriggio, dom lunga.
    expect(drafts.map(draft => [draft.weekday, draft.shiftTypeId])).toEqual([
      ['monday', AFTERNOON.id],
      ['tuesday', LONG.id],
      ['wednesday', NIGHT.id],
      ['saturday', AFTERNOON.id],
      ['sunday', LONG.id],
    ]);
  });

  it('sposta la sequenza quando cambia il giorno di partenza', () => {
    const drafts = buildSchemeSlots(cycle5, 'wednesday', shiftTypes);
    expect(drafts[0].weekday).toBe('wednesday');
    expect(drafts[0].shiftTypeId).toBe(AFTERNOON.id);
  });

  it('deduce i flag di riposo dai passi di smonto e riposo', () => {
    const drafts = buildSchemeSlots(cycle5, 'monday', shiftTypes);
    const night = drafts.find(draft => draft.shiftTypeId === NIGHT.id)!;

    // Alla notte segue uno smonto e poi un riposo.
    expect(night.requiresNextDayRest).toBe(true);
    expect(night.requiresSecondDayRest).toBe(true);
    expect(night.isFullDayExclusive).toBe(true);

    // Al pomeriggio segue la lunga: nessun riposo imposto.
    const afternoon = drafts.find(draft => draft.weekday === 'monday')!;
    expect(afternoon.requiresNextDayRest).toBe(false);
    expect(afternoon.requiresSecondDayRest).toBe(false);
  });

  it('rende smontante un turno notturno anche senza smonto esplicito', () => {
    const scheme: ShiftScheme = {
      id: 'x', name: 'Notte secca', steps: [{ kind: 'shift', shiftTypeId: NIGHT.id }],
    };
    const drafts = buildSchemeSlots(scheme, 'monday', shiftTypes);

    expect(drafts).toHaveLength(7);
    expect(drafts.every(draft => draft.requiresNextDayRest)).toBe(true);
    expect(drafts.every(draft => draft.isFullDayExclusive)).toBe(true);
  });

  it('restituisce un elenco vuoto per uno schema senza passi', () => {
    expect(buildSchemeSlots({ id: 'v', name: 'Vuoto', steps: [] }, 'monday', shiftTypes))
      .toEqual([]);
  });
});

describe('unione con i turni già presenti', () => {
  const existing = [makeSlot('monday', MORNING.id)];
  const drafts = buildSchemeSlots(cycle5, 'monday', shiftTypes);

  it('in modalità aggiunta conserva i turni esistenti', () => {
    const merged = mergeSchemeSlots(existing, drafts, 'merge');
    expect(merged.some(slot => slot.weekday === 'monday' && slot.shiftTypeId === MORNING.id))
      .toBe(true);
    expect(merged).toHaveLength(existing.length + drafts.length);
  });

  it('in modalità sostituzione tiene solo i turni dello schema', () => {
    const merged = mergeSchemeSlots(existing, drafts, 'replace');
    expect(merged.some(slot => slot.shiftTypeId === MORNING.id)).toBe(false);
    expect(merged).toHaveLength(drafts.length);
  });

  it('non duplica un turno già presente con la stessa fascia e giorno', () => {
    const withAfternoon = [makeSlot('monday', AFTERNOON.id)];
    const merged = mergeSchemeSlots(withAfternoon, drafts, 'merge');

    const mondayAfternoon = merged.filter(
      slot => slot.weekday === 'monday' && slot.shiftTypeId === AFTERNOON.id);
    expect(mondayAfternoon).toHaveLength(1);
  });
});

describe('ciclo di rotazione', () => {
  it('avanza di un passo al giorno', () => {
    const anchor = '2026-04-01';
    expect(cycleStepFor(cycle5, 0, 1, anchor, '2026-04-01')?.stepIndex).toBe(0);
    expect(cycleStepFor(cycle5, 0, 1, anchor, '2026-04-02')?.stepIndex).toBe(1);
    expect(cycleStepFor(cycle5, 0, 1, anchor, '2026-04-06')?.stepIndex).toBe(0);
  });

  it('sfasa i dottori fra loro', () => {
    const anchor = '2026-04-01';
    expect(cycleStepFor(cycle5, 1, 1, anchor, '2026-04-01')?.stepIndex).toBe(1);
    expect(cycleStepFor(cycle5, 2, 1, anchor, '2026-04-01')?.stepIndex).toBe(2);
  });

  it('gestisce le date precedenti alla data di inizio', () => {
    const anchor = '2026-04-10';
    expect(cycleStepFor(cycle5, 0, 1, anchor, '2026-04-09')?.stepIndex).toBe(4);
  });

  it('con tanti dottori quanti i passi copre tutte le posizioni ogni giorno', () => {
    const anchor = '2026-04-01';
    const positions = [0, 1, 2, 3, 4].map(
      index => cycleStepFor(cycle5, index, 1, anchor, '2026-04-15')?.stepIndex);

    expect(new Set(positions).size).toBe(5);
  });

  it('produce un’anteprima con una riga per dottore', () => {
    const preview = buildCyclePreview(cycle5, ['a', 'b', 'c'], 1, '2026-04-01', 7, shiftTypes);

    expect(preview.dates).toHaveLength(7);
    expect(preview.rows).toHaveLength(3);
    expect(preview.rows[0].codes[0]).toBe(AFTERNOON.code);
    expect(preview.rows[0].codes[3]).toBe('S');
    expect(preview.rows[0].codes[4]).toBe('R');
  });

  it('suggerisce uno sfasamento coerente col numero di dottori', () => {
    expect(suggestOffsetStep(5, 5)).toBe(1);
    expect(suggestOffsetStep(1, 4)).toBe(1);
    expect(suggestOffsetStep(5, 1)).toBe(1);
  });
});
