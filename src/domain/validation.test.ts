import { describe, expect, it } from 'vitest';
import { ShiftTypeIndex } from './shiftTypes';
import {
  AvailabilityRules,
  RoomSlotIndex,
  buildRequirements,
  findCoverageGaps,
  findViolations,
  primaryViolation,
} from './validation';
import { DoctorRules } from './preferences';
import {
  AFTERNOON,
  DIURNISMO,
  EVERY_DAY,
  LONG,
  MORNING,
  NIGHT,
  makeAssignment,
  makeDoctor,
  makeRoom,
  makeSlot,
  rule,
  slotsOn,
} from './testFixtures';

const shiftTypes = new ShiftTypeIndex([MORNING, AFTERNOON, NIGHT, LONG, DIURNISMO]);
const doctors = [makeDoctor('rossi'), makeDoctor('bianchi')];

function contextFor(rooms: ReturnType<typeof makeRoom>[], availability = new AvailabilityRules({})) {
  return { rooms, doctors, shiftTypes, availability, slotIndex: new RoomSlotIndex(rooms) };
}

describe('AvailabilityRules', () => {
  it('in modalità esclusione blocca la giornata intera e le singole fasce', () => {
    const rules = new AvailabilityRules({
      doctorDateExclusions: {
        rossi: ['2026-04-10', `2026-04-11:${NIGHT.id}`],
      },
    });

    expect(rules.isBlocked('rossi', '2026-04-10', MORNING.id)).toBe(true);
    expect(rules.isBlocked('rossi', '2026-04-11', NIGHT.id)).toBe(true);
    expect(rules.isBlocked('rossi', '2026-04-11', MORNING.id)).toBe(false);
    expect(rules.isBlocked('bianchi', '2026-04-10', MORNING.id)).toBe(false);
  });

  it('in modalità disponibilità ammette solo le voci elencate', () => {
    const rules = new AvailabilityRules({
      doctorDateAvailability: { rossi: ['2026-04-10', `2026-04-12:${MORNING.id}`] },
      doctorAvailabilityMode: { rossi: 'availability' },
    });

    expect(rules.isBlocked('rossi', '2026-04-10', NIGHT.id)).toBe(false);
    expect(rules.isBlocked('rossi', '2026-04-12', MORNING.id)).toBe(false);
    expect(rules.isBlocked('rossi', '2026-04-12', NIGHT.id)).toBe(true);
    expect(rules.isBlocked('rossi', '2026-04-13', MORNING.id)).toBe(true);
  });

  it('con elenco di disponibilità vuoto non applica vincoli', () => {
    const rules = new AvailabilityRules({
      doctorDateAvailability: { rossi: [] },
      doctorAvailabilityMode: { rossi: 'availability' },
    });
    expect(rules.isBlocked('rossi', '2026-04-10', MORNING.id)).toBe(false);
  });
});

describe('RoomSlotIndex', () => {
  it('distingue i flag dello stesso turno in giorni diversi', () => {
    // La notte del lunedì è smontante, quella del sabato no.
    const room = makeRoom('sala1', [
      makeSlot('monday', NIGHT.id, { requiresNextDayRest: true, isCritical: true }),
      makeSlot('saturday', NIGHT.id, { requiresNextDayRest: false, isCritical: false }),
    ]);
    const index = new RoomSlotIndex([room]);

    expect(index.slot('sala1', 'monday', NIGHT.id)?.requiresNextDayRest).toBe(true);
    expect(index.slot('sala1', 'saturday', NIGHT.id)?.requiresNextDayRest).toBe(false);

    // 2026-04-06 è lunedì, 2026-04-11 sabato.
    expect(index.isCritical('sala1', '2026-04-06', NIGHT.id)).toBe(true);
    expect(index.isCritical('sala1', '2026-04-11', NIGHT.id)).toBe(false);
  });
});

describe('buildRequirements', () => {
  it('genera un requisito per ogni giorno che prevede il turno', () => {
    const room = makeRoom('sala1', slotsOn(['monday'], MORNING.id));
    // Aprile 2026 ha 4 lunedì: 6, 13, 20, 27.
    const requirements = buildRequirements([room], 2026, 4, []);

    expect(requirements.map(r => r.date)).toEqual([
      '2026-04-06', '2026-04-13', '2026-04-20', '2026-04-27',
    ]);
  });

  it('salta le sale disabilitate nei festivi e marca la giornata come festiva', () => {
    const room = makeRoom('sala1', slotsOn(EVERY_DAY, MORNING.id));
    const other = makeRoom('sala2', slotsOn(EVERY_DAY, MORNING.id));

    const requirements = buildRequirements(
      [room, other], 2026, 4,
      [{ date: '2026-04-06', disabledRooms: ['sala1'] }],
    );

    const onHoliday = requirements.filter(r => r.date === '2026-04-06');
    expect(onHoliday.map(r => r.roomId)).toEqual(['sala2']);
    expect(onHoliday[0].isWeekendOrHoliday).toBe(true);
  });

  it('marca sabato e domenica come festivi', () => {
    const room = makeRoom('sala1', slotsOn(EVERY_DAY, MORNING.id));
    const requirements = buildRequirements([room], 2026, 4, []);
    // 2026-04-11 è sabato.
    expect(requirements.find(r => r.date === '2026-04-11')?.isWeekendOrHoliday).toBe(true);
    expect(requirements.find(r => r.date === '2026-04-10')?.isWeekendOrHoliday).toBe(false);
  });
});

describe('findViolations', () => {
  it('segnala il giorno successivo a un turno smontante', () => {
    const room = makeRoom('sala1', [
      makeSlot('monday', NIGHT.id, { requiresNextDayRest: true }),
      makeSlot('tuesday', MORNING.id),
    ]);

    const report = findViolations([
      makeAssignment('a1', '2026-04-06', 'sala1', NIGHT.id, 'rossi'),
      makeAssignment('a2', '2026-04-07', 'sala1', MORNING.id, 'rossi'),
    ], contextFor([room]));

    expect(primaryViolation(report, 'a2')?.code).toBe('restDay');
    expect(report.byAssignment.has('a1')).toBe(false);
    expect(report.errors).toHaveLength(1);
  });

  it('considera il secondo giorno di riposo un avviso e non un errore', () => {
    const room = makeRoom('sala1', [
      makeSlot('monday', NIGHT.id, { requiresSecondDayRest: true }),
      makeSlot('wednesday', MORNING.id),
    ]);

    const report = findViolations([
      makeAssignment('a1', '2026-04-06', 'sala1', NIGHT.id, 'rossi'),
      makeAssignment('a2', '2026-04-08', 'sala1', MORNING.id, 'rossi'),
    ], contextFor([room]));

    expect(primaryViolation(report, 'a2')?.code).toBe('secondRestDay');
    expect(report.errors).toHaveLength(0);
    expect(report.warnings).toHaveLength(1);
  });

  it('segnala due turni con orari sovrapposti nello stesso giorno', () => {
    const room = makeRoom('sala1', [
      makeSlot('monday', MORNING.id),
      makeSlot('monday', LONG.id),
    ]);

    const report = findViolations([
      makeAssignment('a1', '2026-04-06', 'sala1', MORNING.id, 'rossi'),
      makeAssignment('a2', '2026-04-06', 'sala1', LONG.id, 'rossi'),
    ], contextFor([room]));

    expect(report.errors.map(v => v.code)).toContain('overlappingShift');
  });

  it('non segnala turni consecutivi non sovrapposti', () => {
    const room = makeRoom('sala1', [
      makeSlot('monday', MORNING.id),
      makeSlot('monday', AFTERNOON.id),
    ]);

    const report = findViolations([
      makeAssignment('a1', '2026-04-06', 'sala1', MORNING.id, 'rossi'),
      makeAssignment('a2', '2026-04-06', 'sala1', AFTERNOON.id, 'rossi'),
    ], contextFor([room]));

    expect(report.errors).toHaveLength(0);
  });

  it('segnala un turno esclusivo affiancato ad altri nella stessa giornata', () => {
    const room = makeRoom('sala1', [
      makeSlot('monday', NIGHT.id, { isFullDayExclusive: true }),
      makeSlot('monday', MORNING.id),
    ]);

    const report = findViolations([
      makeAssignment('a1', '2026-04-06', 'sala1', NIGHT.id, 'rossi'),
      makeAssignment('a2', '2026-04-06', 'sala1', MORNING.id, 'rossi'),
    ], contextFor([room]));

    expect(report.errors.map(v => v.code)).toContain('exclusiveDay');
  });

  it('segnala sala e giorno esclusi per il dottore', () => {
    const room = makeRoom('sala1', slotsOn(['monday'], MORNING.id));
    const restricted = [
      makeDoctor('rossi', { excludedRooms: ['sala1'] }),
      makeDoctor('bianchi', { weekdayRules: [rule('monday', 'never')] }),
    ];

    const report = findViolations([
      makeAssignment('a1', '2026-04-06', 'sala1', MORNING.id, 'rossi'),
      makeAssignment('a2', '2026-04-06', 'sala1', MORNING.id, 'bianchi'),
    ], {
      rooms: [room],
      doctors: restricted,
      shiftTypes,
      availability: new AvailabilityRules({}),
      slotIndex: new RoomSlotIndex([room]),
      rules: new DoctorRules(restricted),
    });

    expect(primaryViolation(report, 'a1')?.code).toBe('excludedRoom');
    expect(primaryViolation(report, 'a2')?.code).toBe('excludedWeekday');
  });

  it('distingue la preferenza dal divieto sullo stesso giorno', () => {
    const room = makeRoom('sala1', slotsOn(['monday'], MORNING.id));
    // Rossi preferisce evitare il lunedì mattina, Bianchi non lo fa mai.
    const people = [
      makeDoctor('rossi', { weekdayRules: [rule('monday', 'avoid', MORNING.id)] }),
      makeDoctor('bianchi', { weekdayRules: [rule('monday', 'never', MORNING.id)] }),
    ];

    const report = findViolations([
      makeAssignment('a1', '2026-04-06', 'sala1', MORNING.id, 'rossi'),
      makeAssignment('a2', '2026-04-06', 'sala1', MORNING.id, 'bianchi'),
    ], {
      rooms: [room],
      doctors: people,
      shiftTypes,
      availability: new AvailabilityRules({}),
      slotIndex: new RoomSlotIndex([room]),
      rules: new DoctorRules(people),
    });

    const forRossi = primaryViolation(report, 'a1')!;
    expect(forRossi.code).toBe('avoidedWeekday');
    expect(forRossi.severity).toBe('warning');

    const forBianchi = primaryViolation(report, 'a2')!;
    expect(forBianchi.code).toBe('excludedWeekday');
    expect(forBianchi.severity).toBe('error');
  });

  it('non segnala una fascia diversa da quella evitata', () => {
    const room = makeRoom('sala1', [
      ...slotsOn(['monday'], MORNING.id),
      ...slotsOn(['monday'], AFTERNOON.id),
    ]);
    // Solo il lunedì pomeriggio è da evitare.
    const people = [makeDoctor('rossi', { weekdayRules: [rule('monday', 'avoid', AFTERNOON.id)] })];

    const report = findViolations([
      makeAssignment('a1', '2026-04-06', 'sala1', MORNING.id, 'rossi'),
      makeAssignment('a2', '2026-04-06', 'sala1', AFTERNOON.id, 'rossi'),
    ], {
      rooms: [room],
      doctors: people,
      shiftTypes,
      availability: new AvailabilityRules({}),
      slotIndex: new RoomSlotIndex([room]),
      rules: new DoctorRules(people),
    });

    expect(report.byAssignment.has('a1')).toBe(false);
    expect(primaryViolation(report, 'a2')?.code).toBe('avoidedWeekday');
  });

  it('non segnala i turni fissati, ma ne tiene conto per gli altri', () => {
    const room = makeRoom('sala1', [
      makeSlot('monday', NIGHT.id, { requiresNextDayRest: true }),
      makeSlot('tuesday', MORNING.id),
    ]);

    const report = findViolations([
      makeAssignment('a1', '2026-04-06', 'sala1', NIGHT.id, 'rossi', { locked: true }),
      makeAssignment('a2', '2026-04-07', 'sala1', MORNING.id, 'rossi'),
    ], contextFor([room]));

    expect(report.byAssignment.has('a1')).toBe(false);
    expect(primaryViolation(report, 'a2')?.code).toBe('restDay');
  });

  it('segnala un blocco a rotazione diviso fra dottori diversi', () => {
    const room = makeRoom('sala1', slotsOn(['monday', 'tuesday'], DIURNISMO.id));

    const report = findViolations([
      makeAssignment('a1', '2026-04-06', 'sala1', DIURNISMO.id, 'rossi'),
      makeAssignment('a2', '2026-04-07', 'sala1', DIURNISMO.id, 'bianchi'),
    ], contextFor([room]));

    expect(report.warnings.map(v => v.code)).toEqual(['splitBlock', 'splitBlock']);
  });

  it('non segnala un blocco a rotazione coperto da un solo dottore', () => {
    const room = makeRoom('sala1', slotsOn(['monday', 'tuesday'], DIURNISMO.id));

    const report = findViolations([
      makeAssignment('a1', '2026-04-06', 'sala1', DIURNISMO.id, 'rossi'),
      makeAssignment('a2', '2026-04-07', 'sala1', DIURNISMO.id, 'rossi'),
    ], contextFor([room]));

    expect(report.warnings).toHaveLength(0);
  });

  it('segnala il dottore non disponibile', () => {
    const room = makeRoom('sala1', slotsOn(['monday'], MORNING.id));
    const availability = new AvailabilityRules({
      doctorDateExclusions: { rossi: ['2026-04-06'] },
    });

    const report = findViolations(
      [makeAssignment('a1', '2026-04-06', 'sala1', MORNING.id, 'rossi')],
      contextFor([room], availability),
    );

    expect(primaryViolation(report, 'a1')?.code).toBe('unavailable');
  });
});

describe('findCoverageGaps', () => {
  it('elenca i turni previsti e non assegnati', () => {
    const room = makeRoom('sala1', slotsOn(['monday'], MORNING.id));
    const requirements = buildRequirements([room], 2026, 4, []);

    const gaps = findCoverageGaps(requirements, [
      makeAssignment('a1', '2026-04-06', 'sala1', MORNING.id, 'rossi'),
    ]);

    expect(gaps.map(gap => gap.date)).toEqual(['2026-04-13', '2026-04-20', '2026-04-27']);
  });
});
