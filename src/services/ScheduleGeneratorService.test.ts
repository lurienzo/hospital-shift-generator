import { describe, expect, it } from 'vitest';
import {
  Assignment,
  DoctorStats,
  GenerationConfig,
  OperativeRoom,
  ShiftScheme,
  ShiftType,
} from '../models/types';
import { ShiftTypeIndex, blockIndexOf } from '../domain/shiftTypes';
import { computeStats } from '../domain/stats';
import { AvailabilityRules, RoomSlotIndex, findViolations } from '../domain/validation';
import {
  AFTERNOON,
  DIURNISMO,
  EVERY_DAY,
  MORNING,
  NIGHT,
  WORKDAYS,
  makeAssignment,
  makeDoctor,
  makeRoom,
  makeSlot,
  slotsOn,
} from '../domain/testFixtures';
import { ScheduleGeneratorService } from './ScheduleGeneratorService';

const YEAR = 2026;
const MONTH = 4; // Aprile 2026: inizia di mercoledì, 30 giorni.

function emptyConfig(overrides: Partial<GenerationConfig> = {}): GenerationConfig {
  return {
    year: YEAR,
    month: MONTH,
    holidays: [],
    doctorDateExclusions: {},
    doctorDateAvailability: {},
    doctorAvailabilityMode: {},
    prefilledAssignments: [],
    ...overrides,
  };
}

function run(options: {
  rooms: OperativeRoom[];
  doctorIds: string[];
  shiftTypes?: ShiftType[];
  schemes?: ShiftScheme[];
  config?: Partial<GenerationConfig>;
  priorStats?: DoctorStats[];
  priorAssignments?: Assignment[];
  attempts?: number;
}) {
  const shiftTypes = new ShiftTypeIndex(
    options.shiftTypes ?? [MORNING, AFTERNOON, NIGHT, DIURNISMO],
  );
  const doctors = options.doctorIds.map(id => makeDoctor(id));

  const generator = new ScheduleGeneratorService({
    rooms: options.rooms,
    doctors,
    shiftTypes,
    schemes: options.schemes ?? [],
    config: emptyConfig(options.config),
    priorStats: options.priorStats,
    priorAssignments: options.priorAssignments,
  });

  return { generator, doctors, shiftTypes };
}

describe('copertura dei turni', () => {
  it('assegna un dottore a ogni turno previsto quando ce ne sono a sufficienza', async () => {
    const room = makeRoom('sala1', slotsOn(EVERY_DAY, MORNING.id));
    const { generator } = run({ rooms: [room], doctorIds: ['a', 'b', 'c'] });

    const result = await generator.generate(20);

    expect(result.coverageGaps).toBe(0);
    expect(result.schedule.assignments).toHaveLength(30);
  });

  it('non lascia scoperti i turni di più sale e più fasce', async () => {
    const rooms = [
      makeRoom('sala1', [...slotsOn(EVERY_DAY, MORNING.id), ...slotsOn(EVERY_DAY, AFTERNOON.id)]),
      makeRoom('sala2', slotsOn(EVERY_DAY, MORNING.id)),
    ];
    const { generator } = run({ rooms, doctorIds: ['a', 'b', 'c', 'd', 'e'] });

    const result = await generator.generate(20);

    expect(result.coverageGaps).toBe(0);
    expect(result.schedule.assignments).toHaveLength(90);
  });

  it('riporta i turni scoperti quando i dottori non bastano', async () => {
    // Un solo dottore e due turni sovrapponibili nello stesso giorno: uno dei
    // due resta necessariamente scoperto.
    const room = makeRoom('sala1', [
      ...slotsOn(EVERY_DAY, MORNING.id),
      ...slotsOn(EVERY_DAY, AFTERNOON.id),
      ...slotsOn(EVERY_DAY, NIGHT.id, { isFullDayExclusive: true }),
    ]);
    const { generator } = run({ rooms: [room], doctorIds: ['a'] });

    const result = await generator.generate(10);
    expect(result.coverageGaps).toBeGreaterThan(0);
  });
});

describe('vincoli rispettati dal generatore', () => {
  it('non assegna turni il giorno dopo uno smontante', async () => {
    const room = makeRoom('sala1', [
      ...slotsOn(EVERY_DAY, NIGHT.id, { requiresNextDayRest: true, isFullDayExclusive: true }),
      ...slotsOn(EVERY_DAY, MORNING.id),
    ]);
    const { generator, doctors, shiftTypes } = run({
      rooms: [room],
      doctorIds: ['a', 'b', 'c', 'd'],
    });

    const result = await generator.generate(30);
    const report = findViolations(result.schedule.assignments, {
      rooms: [room],
      doctors,
      shiftTypes,
      availability: new AvailabilityRules({}),
      slotIndex: new RoomSlotIndex([room]),
    });

    expect(report.errors).toHaveLength(0);
    expect(result.coverageGaps).toBe(0);
  });

  it('rispetta le indisponibilità dichiarate per il mese', async () => {
    const room = makeRoom('sala1', slotsOn(EVERY_DAY, MORNING.id));
    const { generator } = run({
      rooms: [room],
      doctorIds: ['a', 'b'],
      config: { doctorDateExclusions: { a: ['2026-04-06', '2026-04-07'] } },
    });

    const result = await generator.generate(20);
    const ofA = result.schedule.assignments.filter(item => item.doctorId === 'a');

    expect(ofA.some(item => item.date === '2026-04-06')).toBe(false);
    expect(ofA.some(item => item.date === '2026-04-07')).toBe(false);
    expect(result.coverageGaps).toBe(0);
  });

  it('non assegna un dottore a una sala da cui è escluso', async () => {
    const rooms = [
      makeRoom('sala1', slotsOn(EVERY_DAY, MORNING.id)),
      makeRoom('sala2', slotsOn(EVERY_DAY, MORNING.id)),
    ];
    const shiftTypes = new ShiftTypeIndex([MORNING]);
    const doctors = [
      makeDoctor('a', { excludedRooms: ['sala1'] }),
      makeDoctor('b'),
      makeDoctor('c'),
    ];

    const generator = new ScheduleGeneratorService({
      rooms, doctors, shiftTypes, schemes: [], config: emptyConfig(),
    });

    const result = await generator.generate(20);
    expect(result.schedule.assignments
      .some(item => item.doctorId === 'a' && item.roomId === 'sala1')).toBe(false);
    expect(result.coverageGaps).toBe(0);
  });

  it('mantiene invariati i turni fissati', async () => {
    const room = makeRoom('sala1', slotsOn(EVERY_DAY, MORNING.id));
    const prefilled = [
      makeAssignment('pf1', '2026-04-10', 'sala1', MORNING.id, 'b', { locked: true }),
    ];

    const { generator } = run({
      rooms: [room],
      doctorIds: ['a', 'b', 'c'],
      config: { prefilledAssignments: prefilled },
    });

    const result = await generator.generate(20);
    const onDate = result.schedule.assignments.filter(item => item.date === '2026-04-10');

    expect(onDate).toHaveLength(1);
    expect(onDate[0].doctorId).toBe('b');
    expect(onDate[0].locked).toBe(true);
  });
});

describe('fasce a rotazione', () => {
  const diurnismoRoom = () => makeRoom('sala1', slotsOn(WORKDAYS, DIURNISMO.id));

  it('affida ogni blocco settimanale a un solo dottore', async () => {
    const { generator } = run({
      rooms: [diurnismoRoom()],
      doctorIds: ['a', 'b', 'c', 'd'],
    });

    const result = await generator.generate(20);

    const byBlock = new Map<number, Set<string>>();
    for (const assignment of result.schedule.assignments) {
      const index = blockIndexOf(DIURNISMO, assignment.date);
      const bucket = byBlock.get(index) ?? new Set<string>();
      bucket.add(assignment.doctorId);
      byBlock.set(index, bucket);
    }

    expect(byBlock.size).toBeGreaterThan(1);
    for (const doctorsInBlock of byBlock.values()) {
      expect(doctorsInBlock.size).toBe(1);
    }
  });

  it('conta un blocco come una unità, non come i suoi singoli turni', async () => {
    const room = diurnismoRoom();
    const { generator, doctors, shiftTypes } = run({
      rooms: [room],
      doctorIds: ['a', 'b', 'c', 'd', 'e'],
    });

    const result = await generator.generate(20);
    const stats = computeStats([result.schedule], {
      doctors, rooms: [room], shiftTypes, slotIndex: new RoomSlotIndex([room]),
    });

    for (const stat of stats) {
      const blocks = stat.blocksByShiftType[DIURNISMO.id];
      const shifts = stat.shiftsByShiftType[DIURNISMO.id];
      // Chi copre un blocco lavora i cinque giorni lavorativi che contiene,
      // ma il blocco conta una volta sola.
      if (blocks > 0) expect(shifts).toBeGreaterThan(blocks);
    }

    const totalBlocks = stats.reduce(
      (sum, stat) => sum + stat.blocksByShiftType[DIURNISMO.id], 0);
    // Aprile 2026 tocca cinque settimane distinte.
    expect(totalBlocks).toBe(5);
  });

  it('distribuisce i blocchi fra dottori diversi', async () => {
    const { generator, doctors, shiftTypes } = run({
      rooms: [diurnismoRoom()],
      doctorIds: ['a', 'b', 'c', 'd', 'e'],
    });

    const result = await generator.generate(30);
    const stats = computeStats([result.schedule], {
      doctors,
      rooms: [diurnismoRoom()],
      shiftTypes,
      slotIndex: new RoomSlotIndex([diurnismoRoom()]),
    });

    const blocks = stats.map(stat => stat.blocksByShiftType[DIURNISMO.id]);
    // Cinque blocchi fra cinque dottori: nessuno deve accumularne più di due.
    expect(Math.max(...blocks)).toBeLessThanOrEqual(2);
    expect(blocks.filter(value => value > 0).length).toBeGreaterThanOrEqual(3);
  });

  it('tiene conto dei blocchi già fatti nei mesi precedenti', async () => {
    const room = diurnismoRoom();
    // "a" ha già coperto tre blocchi: il mese nuovo deve privilegiare gli altri.
    const priorStats: DoctorStats[] = ['a', 'b', 'c'].map(id => ({
      doctorId: id,
      doctorName: id.toUpperCase(),
      doctorColor: '#000',
      totalShifts: id === 'a' ? 15 : 0,
      totalHours: 0,
      distinctDays: 0,
      weekendShifts: 0,
      criticalShifts: 0,
      shiftsByRoom: {},
      shiftsByShiftType: {},
      blocksByShiftType: { [DIURNISMO.id]: id === 'a' ? 3 : 0 },
      shiftsByMonth: {},
    }));

    const { generator, doctors, shiftTypes } = run({
      rooms: [room],
      doctorIds: ['a', 'b', 'c'],
      priorStats,
    });

    const result = await generator.generate(20);
    const stats = computeStats([result.schedule], {
      doctors, rooms: [room], shiftTypes, slotIndex: new RoomSlotIndex([room]),
    });

    const blocksOfA = stats.find(stat => stat.doctorId === 'a')!.blocksByShiftType[DIURNISMO.id];
    const blocksOfOthers = stats
      .filter(stat => stat.doctorId !== 'a')
      .reduce((sum, stat) => sum + stat.blocksByShiftType[DIURNISMO.id], 0);

    expect(blocksOfOthers).toBeGreaterThan(blocksOfA);
  });

  it('fa completare allo stesso dottore un blocco iniziato nel mese precedente', async () => {
    const room = makeRoom('sala1', slotsOn(EVERY_DAY, DIURNISMO.id));
    // 2026-03-30 è lunedì: la settimana arriva al 5 aprile.
    const priorAssignments = [
      makeAssignment('p1', '2026-03-30', 'sala1', DIURNISMO.id, 'c'),
      makeAssignment('p2', '2026-03-31', 'sala1', DIURNISMO.id, 'c'),
    ];

    const { generator } = run({
      rooms: [room],
      doctorIds: ['a', 'b', 'c'],
      priorAssignments,
    });

    const result = await generator.generate(20);
    const firstWeek = result.schedule.assignments
      .filter(item => item.date >= '2026-04-01' && item.date <= '2026-04-05');

    expect(firstWeek.length).toBeGreaterThan(0);
    expect([...new Set(firstWeek.map(item => item.doctorId))]).toEqual(['c']);
  });
});

describe('rotazioni della sala', () => {
  it('con i turni consecutivi tiene lo stesso dottore per N turni di fila', async () => {
    const room = makeRoom('sala1', slotsOn(EVERY_DAY, MORNING.id), { consecutiveShifts: 3 });
    const { generator } = run({ rooms: [room], doctorIds: ['a', 'b', 'c'] });

    const result = await generator.generate(10);
    const ordered = [...result.schedule.assignments].sort((x, y) => x.date.localeCompare(y.date));

    // I primi tre giorni del mese devono essere dello stesso dottore.
    expect(new Set(ordered.slice(0, 3).map(item => item.doctorId)).size).toBe(1);
    expect(result.coverageGaps).toBe(0);
  });

  it('con i gruppi di giorni affida al medesimo dottore tutti i giorni del gruppo', async () => {
    const room = makeRoom(
      'sala1',
      slotsOn(['tuesday', 'wednesday', 'thursday'], MORNING.id),
      { dayGroups: [{ id: 'g1', days: ['tuesday', 'wednesday', 'thursday'] }] },
    );
    const { generator } = run({ rooms: [room], doctorIds: ['a', 'b', 'c', 'd'] });

    const result = await generator.generate(10);

    // 7, 8, 9 aprile 2026 sono martedì, mercoledì e giovedì della stessa settimana.
    const week = result.schedule.assignments.filter(
      item => ['2026-04-07', '2026-04-08', '2026-04-09'].includes(item.date));

    expect(week).toHaveLength(3);
    expect(new Set(week.map(item => item.doctorId)).size).toBe(1);
  });

  it('con il ciclo turni segue lo schema e salta i giorni di riposo', async () => {
    const scheme: ShiftScheme = {
      id: 's1',
      name: 'Mattina · Pomeriggio · Smonto · Riposo',
      steps: [
        { kind: 'shift', shiftTypeId: MORNING.id },
        { kind: 'shift', shiftTypeId: AFTERNOON.id },
        { kind: 'smonto' },
        { kind: 'riposo' },
      ],
    };

    const room = makeRoom(
      'sala1',
      [...slotsOn(EVERY_DAY, MORNING.id), ...slotsOn(EVERY_DAY, AFTERNOON.id)],
      {
        cycle: {
          schemeId: 's1',
          startDate: '2026-04-01',
          doctorIds: ['a', 'b', 'c', 'd'],
          offsetStep: 1,
        },
      },
    );

    const { generator } = run({
      rooms: [room],
      doctorIds: ['a', 'b', 'c', 'd'],
      schemes: [scheme],
    });

    const result = await generator.generate(10);

    // Il 1 aprile "a" è al passo 0 (mattina) e "b" al passo 1 (pomeriggio).
    const firstDay = result.schedule.assignments.filter(item => item.date === '2026-04-01');
    expect(firstDay.find(item => item.shiftTypeId === MORNING.id)?.doctorId).toBe('a');
    expect(firstDay.find(item => item.shiftTypeId === AFTERNOON.id)?.doctorId).toBe('b');

    // "c" è di smonto e "d" di riposo: non devono comparire.
    expect(firstDay.some(item => ['c', 'd'].includes(item.doctorId))).toBe(false);
    expect(result.coverageGaps).toBe(0);
  });
});

describe('equità della distribuzione', () => {
  it('distribuisce i turni in modo uniforme fra i dottori', async () => {
    const room = makeRoom('sala1', slotsOn(EVERY_DAY, MORNING.id));
    const { generator, doctors, shiftTypes } = run({
      rooms: [room],
      doctorIds: ['a', 'b', 'c', 'd', 'e'],
    });

    const result = await generator.generate(60);
    const stats = computeStats([result.schedule], {
      doctors, rooms: [room], shiftTypes, slotIndex: new RoomSlotIndex([room]),
    });

    const counts = stats.map(stat => stat.totalShifts);
    // 30 turni fra 5 dottori: la differenza fra il più e il meno carico
    // non deve superare un turno.
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it('distribuisce equamente i turni festivi', async () => {
    const room = makeRoom('sala1', slotsOn(EVERY_DAY, NIGHT.id, { isCritical: true }));
    const { generator, doctors, shiftTypes } = run({
      rooms: [room],
      doctorIds: ['a', 'b', 'c', 'd'],
    });

    const result = await generator.generate(60);
    const stats = computeStats([result.schedule], {
      doctors, rooms: [room], shiftTypes, slotIndex: new RoomSlotIndex([room]),
    });

    const weekend = stats.map(stat => stat.weekendShifts);
    expect(Math.max(...weekend) - Math.min(...weekend)).toBeLessThanOrEqual(1);
  });

  it('riparte dal carico dei mesi precedenti quando fornito', async () => {
    const room = makeRoom('sala1', slotsOn(EVERY_DAY, MORNING.id));
    const priorStats: DoctorStats[] = ['a', 'b'].map(id => ({
      doctorId: id,
      doctorName: id.toUpperCase(),
      doctorColor: '#000',
      totalShifts: id === 'a' ? 20 : 0,
      totalHours: id === 'a' ? 120 : 0,
      distinctDays: id === 'a' ? 20 : 0,
      weekendShifts: 0,
      criticalShifts: 0,
      shiftsByRoom: { sala1: id === 'a' ? 20 : 0 },
      shiftsByShiftType: { [MORNING.id]: id === 'a' ? 20 : 0 },
      blocksByShiftType: {},
      shiftsByMonth: {},
    }));

    const { generator } = run({ rooms: [room], doctorIds: ['a', 'b'], priorStats });
    const result = await generator.generate(40);

    const ofA = result.schedule.assignments.filter(item => item.doctorId === 'a').length;
    const ofB = result.schedule.assignments.filter(item => item.doctorId === 'b').length;

    // "a" parte con venti turni di vantaggio: nel mese nuovo deve lavorare meno.
    expect(ofB).toBeGreaterThan(ofA);
  });
});

describe('progresso della generazione', () => {
  it('riporta l’avanzamento fino al 100%', async () => {
    const room = makeRoom('sala1', slotsOn(['monday'], MORNING.id));
    const { generator } = run({ rooms: [room], doctorIds: ['a', 'b'] });

    const updates: number[] = [];
    await generator.generate(50, progress => updates.push(progress.percentage));

    expect(updates.length).toBeGreaterThan(1);
    expect(updates.at(-1)).toBe(100);
  });

  it('conta le soluzioni valide trovate', async () => {
    const room = makeRoom('sala1', slotsOn(EVERY_DAY, MORNING.id));
    const { generator } = run({ rooms: [room], doctorIds: ['a', 'b', 'c'] });

    const result = await generator.generate(15);
    expect(result.validFound).toBeGreaterThan(0);
    expect(result.attempts).toBe(15);
  });
});

describe('statistiche dei mesi precedenti', () => {
  it('somma solo i mesi che precedono quello indicato', () => {
    const room = makeRoom('sala1', slotsOn(EVERY_DAY, MORNING.id));
    const shiftTypes = new ShiftTypeIndex([MORNING]);
    const doctors = [makeDoctor('a')];

    const schedules = new Map([
      [1, [makeAssignment('x1', '2026-01-05', 'sala1', MORNING.id, 'a')]],
      [2, [makeAssignment('x2', '2026-02-05', 'sala1', MORNING.id, 'a')]],
      [5, [makeAssignment('x3', '2026-05-05', 'sala1', MORNING.id, 'a')]],
    ]);

    const result = ScheduleGeneratorService.collectPriorYearStats({
      year: 2026,
      upToMonth: 4,
      doctors,
      rooms: [room],
      shiftTypes,
      loadSchedule: (_year, month) => {
        const assignments = schedules.get(month);
        if (!assignments) return null;
        return { year: 2026, month, holidays: [], assignments };
      },
    });

    expect(result.monthsCovered).toEqual([1, 2]);
    expect(result.stats[0].totalShifts).toBe(2);
  });
});

describe('turni critici', () => {
  it('distribuisce i turni critici in modo equilibrato', async () => {
    const room = makeRoom('sala1', [
      ...slotsOn(EVERY_DAY, NIGHT.id, { isCritical: true }),
      ...slotsOn(EVERY_DAY, MORNING.id),
    ]);
    const { generator, doctors, shiftTypes } = run({
      rooms: [room],
      doctorIds: ['a', 'b', 'c', 'd'],
    });

    const result = await generator.generate(40);
    const stats = computeStats([result.schedule], {
      doctors, rooms: [room], shiftTypes, slotIndex: new RoomSlotIndex([room]),
    });

    const critical = stats.map(stat => stat.criticalShifts);
    expect(Math.max(...critical) - Math.min(...critical)).toBeLessThanOrEqual(2);
  });

  it('considera critico solo il giorno configurato come tale', async () => {
    const room = makeRoom('sala1', [
      makeSlot('monday', NIGHT.id, { isCritical: true }),
      makeSlot('tuesday', NIGHT.id, { isCritical: false }),
    ]);
    const shiftTypes = new ShiftTypeIndex([NIGHT]);
    const doctors = [makeDoctor('a')];

    const stats = computeStats([{
      year: YEAR,
      month: MONTH,
      holidays: [],
      assignments: [
        makeAssignment('a1', '2026-04-06', 'sala1', NIGHT.id, 'a'), // lunedì
        makeAssignment('a2', '2026-04-07', 'sala1', NIGHT.id, 'a'), // martedì
      ],
    }], { doctors, rooms: [room], shiftTypes, slotIndex: new RoomSlotIndex([room]) });

    expect(stats[0].totalShifts).toBe(2);
    expect(stats[0].criticalShifts).toBe(1);
  });
});
