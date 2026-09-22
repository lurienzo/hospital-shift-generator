import { describe, expect, it } from 'vitest';
import { ShiftTypeIndex } from './shiftTypes';
import {
  DoctorRules,
  buildShiftLengthScale,
  lengthFit,
  measureLengthPreference,
  nextRuleLevel,
  setWeekdayRule,
} from './preferences';
import { AFTERNOON, LONG, MORNING, NIGHT, makeDoctor, rule } from './testFixtures';

const shiftTypes = new ShiftTypeIndex([MORNING, AFTERNOON, NIGHT, LONG]);

describe('regole per giorno', () => {
  it('applica la regola di giornata a tutte le fasce', () => {
    const rules = new DoctorRules([
      makeDoctor('rossi', { weekdayRules: [rule('thursday', 'avoid')] }),
    ]);

    expect(rules.levelFor('rossi', 'thursday', MORNING.id)).toBe('avoid');
    expect(rules.levelFor('rossi', 'thursday', NIGHT.id)).toBe('avoid');
    expect(rules.levelFor('rossi', 'friday', MORNING.id)).toBeNull();
  });

  it('limita la regola a una sola fascia quando indicata', () => {
    // "No giovedì pomeriggio": il mattino resta libero.
    const rules = new DoctorRules([
      makeDoctor('rossi', { weekdayRules: [rule('thursday', 'avoid', AFTERNOON.id)] }),
    ]);

    expect(rules.levelFor('rossi', 'thursday', AFTERNOON.id)).toBe('avoid');
    expect(rules.levelFor('rossi', 'thursday', MORNING.id)).toBeNull();
  });

  it('fa prevalere il divieto sulla preferenza', () => {
    const rules = new DoctorRules([
      makeDoctor('rossi', {
        weekdayRules: [rule('thursday', 'avoid'), rule('thursday', 'never', NIGHT.id)],
      }),
    ]);

    expect(rules.levelFor('rossi', 'thursday', NIGHT.id)).toBe('never');
    expect(rules.levelFor('rossi', 'thursday', MORNING.id)).toBe('avoid');
    expect(rules.forbids('rossi', 'thursday', NIGHT.id)).toBe(true);
    expect(rules.discourages('rossi', 'thursday', MORNING.id)).toBe(true);
  });

  it('distingue la regola impostata da quella ereditata', () => {
    const rules = new DoctorRules([
      makeDoctor('rossi', { weekdayRules: [rule('thursday', 'never')] }),
    ]);

    // Sulla singola fascia non c'è nulla di impostato, ma il livello effettivo
    // arriva dalla giornata: l'interfaccia deve poter mostrare la differenza.
    expect(rules.exactLevel('rossi', 'thursday', NIGHT.id)).toBeNull();
    expect(rules.exactLevel('rossi', 'thursday', null)).toBe('never');
    expect(rules.levelFor('rossi', 'thursday', NIGHT.id)).toBe('never');
  });

  it('non applica le regole di un dottore a un altro', () => {
    const rules = new DoctorRules([
      makeDoctor('rossi', { weekdayRules: [rule('thursday', 'never')] }),
      makeDoctor('bianchi'),
    ]);

    expect(rules.forbids('bianchi', 'thursday', MORNING.id)).toBe(false);
  });
});

describe('modifica delle regole', () => {
  it('cicla fra libero, evita e mai', () => {
    expect(nextRuleLevel(null)).toBe('avoid');
    expect(nextRuleLevel('avoid')).toBe('never');
    expect(nextRuleLevel('never')).toBeNull();
  });

  it('mantiene un solo livello per casella', () => {
    let doctor = makeDoctor('rossi');

    doctor = setWeekdayRule(doctor, 'thursday', AFTERNOON.id, 'avoid');
    expect(doctor.weekdayRules).toHaveLength(1);

    doctor = setWeekdayRule(doctor, 'thursday', AFTERNOON.id, 'never');
    expect(doctor.weekdayRules).toHaveLength(1);
    expect(doctor.weekdayRules[0].level).toBe('never');

    doctor = setWeekdayRule(doctor, 'thursday', AFTERNOON.id, null);
    expect(doctor.weekdayRules).toHaveLength(0);
  });

  it('tiene separate la giornata intera e la singola fascia', () => {
    let doctor = makeDoctor('rossi');
    doctor = setWeekdayRule(doctor, 'thursday', null, 'avoid');
    doctor = setWeekdayRule(doctor, 'thursday', AFTERNOON.id, 'never');

    expect(doctor.weekdayRules).toHaveLength(2);
  });
});

describe('durata dei turni', () => {
  it('ricava la soglia dalle fasce configurate', () => {
    // Fasce da 6 e 12 ore: la soglia è 9.
    const scale = buildShiftLengthScale([MORNING, AFTERNOON, NIGHT, LONG]);
    expect(scale.shortest).toBe(6);
    expect(scale.longest).toBe(12);
    expect(scale.threshold).toBe(9);
    expect(scale.meaningful).toBe(true);
  });

  it('non distingue nulla se le fasce hanno tutte la stessa durata', () => {
    const scale = buildShiftLengthScale([MORNING, AFTERNOON]);
    expect(scale.meaningful).toBe(false);
    expect(lengthFit('long', MORNING.id, shiftTypes, scale)).toBe('neutral');
  });

  it('valuta il turno rispetto alla preferenza', () => {
    const scale = buildShiftLengthScale([MORNING, AFTERNOON, NIGHT, LONG]);

    expect(lengthFit('long', LONG.id, shiftTypes, scale)).toBe('preferred');
    expect(lengthFit('long', MORNING.id, shiftTypes, scale)).toBe('againstPreference');
    expect(lengthFit('short', MORNING.id, shiftTypes, scale)).toBe('preferred');
    expect(lengthFit('short', NIGHT.id, shiftTypes, scale)).toBe('againstPreference');
    expect(lengthFit('none', LONG.id, shiftTypes, scale)).toBe('neutral');
  });

  it('misura la quota di turni nella durata preferita', () => {
    const scale = buildShiftLengthScale([MORNING, AFTERNOON, NIGHT, LONG]);
    const doctors = [
      makeDoctor('rossi', { shiftLengthPreference: 'long' }),
      makeDoctor('bianchi', { shiftLengthPreference: 'none' }),
    ];

    const result = measureLengthPreference([
      { doctorId: 'rossi', shiftTypeId: LONG.id },
      { doctorId: 'rossi', shiftTypeId: NIGHT.id },
      { doctorId: 'rossi', shiftTypeId: MORNING.id },
      { doctorId: 'bianchi', shiftTypeId: MORNING.id },
    ], doctors, shiftTypes, scale);

    const rossi = result.get('rossi')!;
    expect(rossi.preferred).toBe(2);
    expect(rossi.against).toBe(1);
    expect(rossi.ratio).toBeCloseTo(2 / 3);

    // Chi non ha preferenze non viene misurato.
    expect(result.has('bianchi')).toBe(false);
  });
});
