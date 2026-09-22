import { describe, expect, it } from 'vitest';
import { RotationRule, ShiftScheme } from '../models/types';
import { ShiftTypeIndex } from './shiftTypes';
import { RotationTracker, measureAdherence } from './rotation';
import { AFTERNOON, DIURNISMO, LONG, MORNING, NIGHT, makeAssignment } from './testFixtures';

const shiftTypes = new ShiftTypeIndex([MORNING, AFTERNOON, NIGHT, LONG, DIURNISMO]);

/** Pomeriggio → Lunga → Notte → Smonto → Riposo */
const cycle5: ShiftScheme = {
  id: 'c5',
  name: 'Ciclo 5 giorni',
  steps: [
    { kind: 'shift', shiftTypeId: AFTERNOON.id },
    { kind: 'shift', shiftTypeId: LONG.id },
    { kind: 'shift', shiftTypeId: NIGHT.id },
    { kind: 'smonto' },
    { kind: 'riposo' },
  ],
};

const everyone: RotationRule = { schemeId: 'c5', doctorIds: [], strength: 'preference' };

function tracker(rule: RotationRule = everyone, scheme: ShiftScheme | null = cycle5) {
  return new RotationTracker(scheme, rule, shiftTypes);
}

describe('posizione nel giro', () => {
  it('non dice nulla su un medico senza turni precedenti', () => {
    const rotation = tracker();
    expect(rotation.expectedStep('rossi', '2026-04-10')).toBeNull();
    expect(rotation.fit('rossi', '2026-04-10', NIGHT.id)).toBe('unknown');
  });

  it('deriva la posizione dal turno svolto più recentemente', () => {
    const rotation = tracker();
    rotation.record('rossi', '2026-04-10', AFTERNOON.id);

    // Il giorno dopo il pomeriggio tocca la lunga, poi la notte.
    expect(rotation.expectedStep('rossi', '2026-04-11')).toEqual(
      { kind: 'shift', shiftTypeId: LONG.id });
    expect(rotation.expectedStep('rossi', '2026-04-12')).toEqual(
      { kind: 'shift', shiftTypeId: NIGHT.id });
  });

  it('prevede smonto e riposo dopo la notte', () => {
    const rotation = tracker();
    rotation.record('rossi', '2026-04-12', NIGHT.id);

    expect(rotation.expectedStep('rossi', '2026-04-13')).toEqual({ kind: 'smonto' });
    expect(rotation.expectedStep('rossi', '2026-04-14')).toEqual({ kind: 'riposo' });
    // Il giro riparte.
    expect(rotation.expectedStep('rossi', '2026-04-15')).toEqual(
      { kind: 'shift', shiftTypeId: AFTERNOON.id });
  });

  it('non dipende dal giorno della settimana', () => {
    // Stessa posizione nel giro partendo da un lunedì o da un giovedì.
    const fromMonday = tracker();
    fromMonday.record('rossi', '2026-04-06', AFTERNOON.id);

    const fromThursday = tracker();
    fromThursday.record('rossi', '2026-04-09', AFTERNOON.id);

    expect(fromMonday.expectedStep('rossi', '2026-04-08'))
      .toEqual(fromThursday.expectedStep('rossi', '2026-04-11'));
  });

  it('si riallinea quando un medico esce dal giro', () => {
    const rotation = tracker();
    rotation.record('rossi', '2026-04-10', AFTERNOON.id);

    // Invece della lunga fa una notte: da lì in poi il giro riparte dalla notte.
    rotation.record('rossi', '2026-04-11', NIGHT.id);
    expect(rotation.expectedStep('rossi', '2026-04-12')).toEqual({ kind: 'smonto' });
  });

  it('ignora i turni di fasce che lo schema non contiene', () => {
    const rotation = tracker();
    rotation.record('rossi', '2026-04-10', AFTERNOON.id);
    rotation.record('rossi', '2026-04-11', MORNING.id);

    // La mattina non compare nello schema: il riferimento resta al pomeriggio
    // e le giornate continuano a scorrere.
    expect(rotation.expectedStep('rossi', '2026-04-12')).toEqual(
      { kind: 'shift', shiftTypeId: NIGHT.id });
  });

  it('tiene medici diversi su posizioni indipendenti', () => {
    const rotation = tracker();
    rotation.record('rossi', '2026-04-10', AFTERNOON.id);
    rotation.record('bianchi', '2026-04-10', NIGHT.id);

    expect(rotation.expectedStep('rossi', '2026-04-11')).toEqual(
      { kind: 'shift', shiftTypeId: LONG.id });
    expect(rotation.expectedStep('bianchi', '2026-04-11')).toEqual({ kind: 'smonto' });
  });
});

describe('classificazione dei turni', () => {
  it('distingue in rotazione, fuori rotazione e giorno di riposo', () => {
    const rotation = tracker();
    rotation.record('rossi', '2026-04-10', AFTERNOON.id);

    expect(rotation.fit('rossi', '2026-04-11', LONG.id)).toBe('inPattern');
    expect(rotation.fit('rossi', '2026-04-11', MORNING.id)).toBe('offPattern');

    rotation.record('rossi', '2026-04-12', NIGHT.id);
    expect(rotation.fit('rossi', '2026-04-13', MORNING.id)).toBe('shouldRest');
  });
});

describe('ambito della regola', () => {
  it('si applica a tutti quando l’elenco dei medici è vuoto', () => {
    const rotation = tracker();
    expect(rotation.appliesTo('chiunque')).toBe(true);
  });

  it('si applica solo ai medici indicati', () => {
    const rotation = tracker({ schemeId: 'c5', doctorIds: ['rossi'], strength: 'preference' });

    expect(rotation.appliesTo('rossi')).toBe(true);
    expect(rotation.appliesTo('bianchi')).toBe(false);

    rotation.record('bianchi', '2026-04-10', AFTERNOON.id);
    expect(rotation.expectedStep('bianchi', '2026-04-11')).toBeNull();
  });

  it('è inattiva senza schema', () => {
    const rotation = tracker(everyone, null);
    expect(rotation.isActive).toBe(false);
    expect(rotation.appliesTo('rossi')).toBe(false);
  });
});

describe('ripresa dai mesi precedenti', () => {
  it('riparte dal turno più recente del mese scorso', () => {
    const rotation = tracker();
    rotation.seed([
      makeAssignment('p1', '2026-03-29', 'sala1', AFTERNOON.id, 'rossi'),
      makeAssignment('p2', '2026-03-31', 'sala1', NIGHT.id, 'rossi'),
    ]);

    // L'ultimo turno è la notte del 31 marzo: il 1 aprile è smonto.
    expect(rotation.expectedStep('rossi', '2026-04-01')).toEqual({ kind: 'smonto' });
    expect(rotation.expectedStep('rossi', '2026-04-02')).toEqual({ kind: 'riposo' });
  });
});

describe('copia indipendente', () => {
  it('non propaga i movimenti alla copia', () => {
    const original = tracker();
    original.record('rossi', '2026-04-10', AFTERNOON.id);

    const copy = original.clone();
    copy.record('rossi', '2026-04-11', NIGHT.id);

    expect(original.expectedStep('rossi', '2026-04-12')).toEqual(
      { kind: 'shift', shiftTypeId: NIGHT.id });
    expect(copy.expectedStep('rossi', '2026-04-12')).toEqual({ kind: 'smonto' });
  });
});

describe('convivenza con le fasce a blocchi', () => {
  it('sospende il giro durante un blocco, senza segnalarlo come scostamento', () => {
    const rotation = tracker();
    rotation.record('rossi', '2026-04-06', AFTERNOON.id);

    // Il diurnismo è una fascia a blocchi: i suoi giorni non vengono giudicati
    // rispetto al giro, altrimenti ogni giornata del blocco sarebbe un avviso.
    for (const date of ['2026-04-07', '2026-04-08', '2026-04-09']) {
      expect(rotation.fit('rossi', date, DIURNISMO.id)).toBe('unknown');
      rotation.record('rossi', date, DIURNISMO.id);
    }

    // Finito il blocco il riferimento è ancora quello del pomeriggio del 6:
    // il 7 toccava la lunga, quindi il 10 tocca il pomeriggio.
    expect(rotation.expectedStep('rossi', '2026-04-07')).toEqual(
      { kind: 'shift', shiftTypeId: LONG.id });
  });

  it('scarta dal giro i passi che citano una fascia a blocchi', () => {
    const mixed: ShiftScheme = {
      id: 'mix',
      name: 'Pomeriggio · Diurnismo · Notte',
      steps: [
        { kind: 'shift', shiftTypeId: AFTERNOON.id },
        { kind: 'shift', shiftTypeId: DIURNISMO.id },
        { kind: 'shift', shiftTypeId: NIGHT.id },
      ],
    };

    const rotation = tracker(everyone, mixed);
    // Il passo con la fascia a blocchi viene scartato: restano due giornate.
    expect(rotation.length).toBe(2);

    rotation.record('rossi', '2026-04-10', AFTERNOON.id);
    expect(rotation.expectedStep('rossi', '2026-04-11')).toEqual(
      { kind: 'shift', shiftTypeId: NIGHT.id });
  });
});

describe('aderenza alla rotazione', () => {
  it('misura la quota di turni in rotazione', () => {
    const assignments = [
      makeAssignment('a1', '2026-04-01', 'sala1', AFTERNOON.id, 'rossi'),
      makeAssignment('a2', '2026-04-02', 'sala1', LONG.id, 'rossi'),
      makeAssignment('a3', '2026-04-03', 'sala1', NIGHT.id, 'rossi'),
      makeAssignment('a4', '2026-04-06', 'sala1', AFTERNOON.id, 'rossi'),
    ];

    const result = measureAdherence(assignments, cycle5, everyone, shiftTypes);
    const rossi = result.get('rossi')!;

    // Il primo turno non è classificabile (nessun riferimento), i tre
    // successivi seguono il giro.
    expect(rossi.inPattern).toBe(3);
    expect(rossi.offPattern).toBe(0);
    expect(rossi.shouldRest).toBe(0);
    expect(rossi.ratio).toBe(1);
  });

  it('conta i turni assegnati in giornate che lo schema vuole libere', () => {
    const assignments = [
      makeAssignment('a1', '2026-04-01', 'sala1', NIGHT.id, 'rossi'),
      makeAssignment('a2', '2026-04-02', 'sala1', MORNING.id, 'rossi'),
    ];

    const result = measureAdherence(assignments, cycle5, everyone, shiftTypes);
    expect(result.get('rossi')!.shouldRest).toBe(1);
    expect(result.get('rossi')!.ratio).toBe(0);
  });

  it('non restituisce nulla senza schema', () => {
    const assignments = [makeAssignment('a1', '2026-04-01', 'sala1', NIGHT.id, 'rossi')];
    expect(measureAdherence(assignments, null, everyone, shiftTypes).size).toBe(0);
  });
});
