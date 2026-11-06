import { describe, expect, it } from 'vitest';
import { analyzeSchedule, countDays } from './analysis';
import { nightCapacity } from './capacity';
import type { Assignment } from './types';
import { buildContext } from './context';
import { addDays, monthDates, monthKey, weekdayOf } from './dates';
import { DAY_KEYS } from './types';
import { defaultRules, emptyCoverage, EXAMPLE_DOCTORS, fillCoverage, makeArea, makeDoctor, makeShift, templateConfig } from './defaults';
import { generate } from './generator';
import { easterSunday, italianHolidays, monthHolidays } from './holidays';
import { emptyMonth, type MonthData, type ServiceConfig } from './types';

function tiConfig(doctors = 8): ServiceConfig {
  const config = templateConfig('ti');
  config.doctors = EXAMPLE_DOCTORS.slice(0, doctors).map(n => makeDoctor(n, '#000', '2026-01'));
  return config;
}

describe('festivi', () => {
  it('calcola la Pasqua', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(easterSunday(2024)).toBe('2024-03-31');
  });

  it('include Pasquetta, il 4 ottobre dal 2026 e il patrono', () => {
    const h = italianHolidays(2026, '06-24');
    expect(h.get('2026-04-06')).toMatch(/Angelo/);
    expect(h.has('2026-10-04')).toBe(true);
    expect(italianHolidays(2025).has('2025-10-04')).toBe(false);
    expect(h.get('2026-06-24')).toBe('Santo patrono');
  });

  it('applica aggiunte e rimozioni del mese', () => {
    const h = monthHolidays(2026, 12, null, { extraHolidays: ['2026-12-24'], removedHolidays: ['2026-12-26'] });
    expect([...h.keys()].sort()).toEqual(['2026-12-08', '2026-12-24', '2026-12-25']);
  });
});

describe('generatore', () => {
  const year = 2026, month = 11;
  const key = monthKey(year, month);

  function run(config: ServiceConfig, data: MonthData = emptyMonth(), months: Record<string, MonthData> = {}) {
    const all = { ...months, [key]: data };
    const ctx = buildContext({ config, year, month, months: all });
    const result = generate(ctx, { timeMs: 600, seed: 42 });
    return { ctx, result, analysis: analyzeSchedule(ctx, result.assignments) };
  }

  it('copre tutti i turni critici di una terapia intensiva senza errori', () => {
    const { analysis } = run(tiConfig(9));
    expect(analysis.counts.uncoveredCritical).toBe(0);
    expect(analysis.counts.errors).toBe(0);
  });

  it('rispetta lo smonto e distribuisce le notti in modo equo', () => {
    const { ctx, result } = run(tiConfig(9));
    const nightId = ctx.config.shiftTypes.find(s => s.kind === 'night')!.id;
    const nights = new Map<string, number>();
    for (const a of result.assignments) {
      if (a.shiftId !== nightId) continue;
      nights.set(a.doctorId, (nights.get(a.doctorId) ?? 0) + 1);
      const next = result.assignments.filter(b => b.doctorId === a.doctorId && b.date === addDays(a.date, 1));
      expect(next).toHaveLength(0);
    }
    const counts = ctx.doctors.map(d => nights.get(d.id) ?? 0);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it('non assegna nulla in ferie e rispetta le desiderate quando possibile', () => {
    const config = tiConfig(9);
    const data = emptyMonth();
    const [a, b] = config.doctors;
    data.requests[a.id] = Object.fromEntries(monthDates(year, month).slice(0, 10).map(d => [d, 'F']));
    data.requests[b.id] = { '2026-11-14': 'D', '2026-11-15': 'D', '2026-11-20': 'N' };
    const { result, analysis } = run(config, data);
    expect(result.assignments.filter(x => x.doctorId === a.id && x.date <= '2026-11-10')).toHaveLength(0);
    expect(analysis.issues.filter(i => i.kind === 'desiderata' || i.kind === 'no-night')).toHaveLength(0);
  });

  it('lascia scoperti i turni non critici piuttosto che violare una desiderata', () => {
    const config = templateConfig('sale');
    config.doctors = [makeDoctor('Uno', '#000', '2026-01')];
    const data = emptyMonth();
    data.requests[config.doctors[0].id] = Object.fromEntries(monthDates(year, month).map(d => [d, 'D']));
    const { result } = run(config, data);
    const ctx = buildContext({ config, year, month, months: { [key]: data } });
    for (const x of result.assignments) {
      expect(ctx.demand.get(`${x.date}|${x.areaId}|${x.shiftId}`)?.critical).toBe(true);
    }
  });

  it('assegna il diurnismo a settimane intere', () => {
    const config = tiConfig(8);
    const diurn = { id: 'g', name: 'Diurnismo', code: 'G', start: '08:00', end: '16:00', color: '#000', kind: 'day' as const, block: { startWeekday: 0 } };
    config.shiftTypes.push(diurn);
    for (const k of ['mon', 'tue', 'wed', 'thu', 'fri'] as const) config.areas[0].coverage[k].g = { count: 1, critical: false };
    const { result } = run(config);
    const weeks = new Map<string, Set<string>>();
    for (const a of result.assignments.filter(x => x.shiftId === 'g')) {
      const ws = addDays(a.date, -weekdayOf(a.date));
      (weeks.get(ws) ?? weeks.set(ws, new Set()).get(ws)!).add(a.doctorId);
    }
    for (const docs of weeks.values()) expect(docs.size).toBe(1);
  });

  it('tiene conto delle notti fatte nei mesi precedenti', () => {
    const config = tiConfig(6);
    const nightId = config.shiftTypes.find(s => s.kind === 'night')!.id;
    const area = config.areas[0].id;
    const heavy = config.doctors[0];
    // Ottobre: il primo medico ha fatto tutte le notti.
    const oct: MonthData = emptyMonth();
    const octAssignments = monthDates(2026, 10).filter((_, i) => i % 2 === 0)
      .map((date, i) => ({ id: `o${i}`, date, areaId: area, shiftId: nightId, doctorId: heavy.id }));
    oct.versions = [{ id: 'v', name: 'v', createdAt: '', updatedAt: '', assignments: octAssignments }];
    oct.activeVersionId = 'v';
    const { result } = run(config, emptyMonth(), { '2026-10': oct });
    const heavyNights = result.assignments.filter(a => a.doctorId === heavy.id && a.shiftId === nightId).length;
    const others = config.doctors.slice(1).map(d => result.assignments.filter(a => a.doctorId === d.id && a.shiftId === nightId).length);
    expect(heavyNights).toBeLessThan(Math.min(...others));
  });
});

describe('lunga nella stessa area', () => {
  const year = 2026, month = 11;
  const salaConfig = () => {
    const config = templateConfig('sale');
    config.doctors = EXAMPLE_DOCTORS.slice(0, 6).map(n => makeDoctor(n, '#000', '2026-01'));
    return config;
  };
  const ids = (config: ServiceConfig) => ({
    m: config.shiftTypes.find(s => s.name === 'Mattina')!.id,
    p: config.shiftTypes.find(s => s.name === 'Pomeriggio')!.id,
    s1: config.areas.find(a => a.name === 'Sala 1')!.id,
    s2: config.areas.find(a => a.name === 'Sala 2')!.id,
  });
  const kinds = (config: ServiceConfig, list: Assignment[]) => {
    const ctx = buildContext({ config, year, month, months: {} });
    return analyzeSchedule(ctx, list).issues.map(i => i.kind);
  };

  it('segnala chi fa mattina in una sala e pomeriggio in un’altra', () => {
    const config = salaConfig();
    const { m, p, s1, s2 } = ids(config);
    const doc = config.doctors[0].id;
    // Lunedi 2 novembre: la Sala 1 prosegue il pomeriggio.
    const list = [
      { id: 'a', date: '2026-11-02', areaId: s1, shiftId: m, doctorId: doc },
      { id: 'b', date: '2026-11-02', areaId: s2, shiftId: p, doctorId: doc },
    ];
    expect(kinds(config, list)).toContain('long-split');
    config.rules.longSameArea = 'preference';
    expect(kinds(config, list)).toContain('long-split-pref');
    config.rules.longSameArea = 'off';
    expect(kinds(config, list)).not.toContain('long-split');
    // Stessa sala: nessun problema.
    config.rules.longSameArea = 'binding';
    expect(kinds(config, [list[0], { ...list[1], areaId: s1 }])).not.toContain('long-split');
  });

  it('permette di spostarsi se la sala non prosegue il pomeriggio', () => {
    const config = salaConfig();
    const { m, p, s1, s2 } = ids(config);
    for (const k of ['mon', 'tue', 'wed', 'thu', 'fri'] as const) delete config.areas.find(a => a.id === s1)!.coverage[k][p];
    const doc = config.doctors[0].id;
    const list = [
      { id: 'a', date: '2026-11-02', areaId: s1, shiftId: m, doctorId: doc },
      { id: 'b', date: '2026-11-02', areaId: s2, shiftId: p, doctorId: doc },
    ];
    expect(kinds(config, list)).not.toContain('long-split');
  });

  it('ammette più turni al giorno solo come lunga attaccata entro il massimo di ore', () => {
    const config = salaConfig();
    const { m, p, s1 } = ids(config);
    const n = config.shiftTypes.find(s => s.kind === 'night')!.id;
    const guard = config.areas.find(x => x.name === 'Guardia')!.id;
    const doc = config.doctors[0].id;
    const day = (list: [string, string][]) => list.map(([shiftId, areaId], i) => ({ id: `x${i}`, date: '2026-11-02', areaId, shiftId, doctorId: doc }));
    expect(kinds(config, day([[m, s1], [p, s1]]))).not.toContain('multiple');
    expect(kinds(config, day([[m, s1], [n, guard]]))).toContain('multiple');
    expect(kinds(config, day([[p, s1], [n, guard]]))).toContain('multiple');
    expect(kinds(config, day([[m, s1], [p, s1], [n, guard]]))).toContain('multiple');
  });

  it('il generatore fa le lunghe sempre nella stessa sala', () => {
    const config = salaConfig();
    const { m, p } = ids(config);
    const ctx = buildContext({ config, year, month, months: {} });
    const result = generate(ctx, { timeMs: 800, seed: 7 });
    const analysis = analyzeSchedule(ctx, result.assignments);
    expect(analysis.issues.filter(i => i.kind === 'long-split')).toHaveLength(0);
    expect(analysis.issues.filter(i => i.kind === 'multiple')).toHaveLength(0);
    // Con 6 medici per 2 sale + guardia servono lunghe: devono esserci.
    const lunghe = result.assignments.filter(a => a.shiftId === m && result.assignments.some(b => b.doctorId === a.doctorId && b.date === a.date && b.shiftId === p));
    expect(lunghe.length).toBeGreaterThan(0);
    for (const a of lunghe) {
      const pm = result.assignments.find(b => b.doctorId === a.doctorId && b.date === a.date && b.shiftId === p)!;
      if (ctx.demand.has(`${a.date}|${a.areaId}|${p}`)) expect(pm.areaId).toBe(a.areaId);
    }
  });
});

describe('conteggi per giorno', () => {
  it('una desiderata violata da una lunga conta una volta sola', () => {
    const config = templateConfig('sale');
    config.doctors = [makeDoctor('Uno', '#000', '2026-01')];
    const m = config.shiftTypes.find(s => s.name === 'Mattina')!.id;
    const p = config.shiftTypes.find(s => s.name === 'Pomeriggio')!.id;
    const s1 = config.areas[0].id;
    const doc = config.doctors[0].id;
    const data = emptyMonth();
    data.requests[doc] = { '2026-11-02': 'D' };
    const ctx = buildContext({ config, year: 2026, month: 11, months: { '2026-11': data } });
    const an = analyzeSchedule(ctx, [
      { id: 'a', date: '2026-11-02', areaId: s1, shiftId: m, doctorId: doc },
      { id: 'b', date: '2026-11-02', areaId: s1, shiftId: p, doctorId: doc },
    ]);
    expect(an.issues.filter(i => i.kind === 'desiderata')).toHaveLength(2);
    expect(countDays(an.issues, 'desiderata')).toBe(1);
  });
});

describe('distribuzione delle notti', () => {
  const year = 2027, month = 1;
  const nightsOf = (ctx: ReturnType<typeof buildContext>, list: { doctorId: string; date: string; shiftId: string }[], docId: string) =>
    ctx.dates.map((d): number => (list.some(a => a.doctorId === docId && a.date === d && ctx.shifts.get(a.shiftId)?.night) ? 1 : 0));
  const maxIn = (n: number[], w: number) => { let m = 0; for (let i = 0; i + w <= n.length; i++) m = Math.max(m, n.slice(i, i + w).reduce((a, b) => a + b, 0)); return m; };

  it('in una TI normale nessuno fa notti a raffica', () => {
    const config = tiConfig(9);
    const ctx = buildContext({ config, year, month, months: {} });
    const r = generate(ctx, { timeMs: 800, seed: 3 });
    for (const d of ctx.doctors) expect(maxIn(nightsOf(ctx, r.assignments, d.id), 14)).toBeLessThanOrEqual(3);
    expect(analyzeSchedule(ctx, r.assignments).issues.filter(i => i.kind === 'night-gap' || i.kind === 'riposo')).toHaveLength(0);
  });

  it('chi era indietro con le notti recupera gradualmente, non tutto in un mese', () => {
    const config = tiConfig(9);
    config.rules.fairnessWindow = 'all';
    const n = config.shiftTypes.find(s => s.kind === 'night')!.id;
    const area = config.areas[0].id;
    const dec = emptyMonth();
    dec.versions = [{ id: 'v', name: 'v', createdAt: '', updatedAt: '', assignments: monthDates(2026, 12).map((date, i) => ({ id: `x${i}`, date, areaId: area, shiftId: n, doctorId: config.doctors[1 + (i % 8)].id })) }];
    dec.activeVersionId = 'v';
    const ctx = buildContext({ config, year, month, months: { '2026-12': dec } });
    const r = generate(ctx, { timeMs: 800, seed: 3 });
    const rossi = nightsOf(ctx, r.assignments, config.doctors[0].id);
    expect(rossi.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(6);
    expect(maxIn(rossi, 14)).toBeLessThanOrEqual(3);
  });

  it('segnala quando le notti sono troppe per chi può farle', () => {
    const config = tiConfig(9);
    const n = config.shiftTypes.find(s => s.kind === 'night')!.id;
    for (const d of config.doctors.slice(3)) d.excludedShiftIds = [n];
    const cap = nightCapacity(buildContext({ config, year, month, months: {} }))!;
    expect(cap.short).toBe(true);
    expect(cap.eligible).toHaveLength(3);
    expect(cap.excluded).toHaveLength(6);
    expect(nightCapacity(buildContext({ config: tiConfig(9), year, month, months: {} }))!.short).toBe(false);
  });
});

describe('turni rimossi, aggiunti e opzionali', () => {
  const year = 2026, month = 11, key = '2026-11';
  const setup = () => {
    const config = tiConfig(9);
    const m = config.shiftTypes.find(s => s.name === 'Mattina')!.id;
    const p = config.shiftTypes.find(s => s.name === 'Pomeriggio')!.id;
    const area = config.areas[0].id;
    return { config, m, p, area };
  };

  it('un turno rimosso non va coperto e viene ricordato', () => {
    const { config, p, area } = setup();
    const data = emptyMonth();
    data.overrides = { [`2026-11-03|${area}|${p}`]: { count: 0 } };
    const ctx = buildContext({ config, year, month, months: { [key]: data } });
    expect(ctx.demand.has(`2026-11-03|${area}|${p}`)).toBe(false);
    expect(ctx.removed.get(`2026-11-03|${area}|${p}`)).toBe(1);
    const r = generate(ctx, { timeMs: 400, seed: 1 });
    expect(r.assignments.some(a => a.date === '2026-11-03' && a.shiftId === p)).toBe(false);
    expect(analyzeSchedule(ctx, r.assignments).uncovered.some(u => u.date === '2026-11-03' && u.shiftId === p)).toBe(false);
  });

  it('un turno aggiunto in un giorno va coperto', () => {
    const { config, m, area } = setup();
    const data = emptyMonth();
    data.overrides = { [`2026-11-07|${area}|${m}`]: { count: 3 } };
    const ctx = buildContext({ config, year, month, months: { [key]: data } });
    expect(ctx.demand.get(`2026-11-07|${area}|${m}`)?.count).toBe(3);
    const r = generate(ctx, { timeMs: 400, seed: 1 });
    expect(r.assignments.filter(a => a.date === '2026-11-07' && a.shiftId === m)).toHaveLength(3);
  });

  it('un turno opzionale vuoto non è segnalato e non conta nella copertura', () => {
    const { config, m } = setup();
    config.shiftTypes.find(s => s.id === m)!.optional = true;
    const ctx = buildContext({ config, year, month, months: {} });
    const an = analyzeSchedule(ctx, []);
    expect(an.uncovered.some(u => u.shiftId === m)).toBe(false);
    expect(an.counts.slots).toBe(ctx.slots.filter(s => s.shiftId !== m).length);
  });
});

describe('rotazione vincolante lunga → notte → smonto → riposo', () => {
  // Il caso reale: due linee parallele (Lunga + Notte, SEI Lunga + SEI notte),
  // 14 medici, schema L N S R vincolante.
  function rotationConfig(doctors = 14): ServiceConfig {
    const L = makeShift({ name: 'Lunga', code: 'L', start: '08:00', end: '20:00', color: '#10b981', kind: 'day', block: null });
    const N = makeShift({ name: 'Notte', code: 'N', start: '20:00', end: '08:00', color: '#6366f1', kind: 'night', block: null });
    const area = (name: string, shiftId: string) => ({ ...makeArea(name, '#2563eb'), coverage: fillCoverage(emptyCoverage(), shiftId, DAY_KEYS, 1, false) });
    const rules = { ...defaultRules(), minNightGap: 3, maxConsecutiveDays: 5, allowMultiplePerDay: true, longSameArea: 'binding' as const };
    rules.schemes = [{ id: 's1', name: 'Schema 1', steps: [{ kind: 'shift', shiftId: L.id }, { kind: 'shift', shiftId: N.id }, { kind: 'smonto' }, { kind: 'riposo' }] }];
    rules.rotation = { schemeId: 's1', strength: 'binding' };
    const names = Array.from({ length: doctors }, (_, i) => `Medico ${i + 1}`);
    return {
      shiftTypes: [N, L],
      areas: [area('Lunga', L.id), area('Notte', N.id), area('SEI Lunga', L.id), area('SEI notte', N.id)],
      doctors: names.map(n => makeDoctor(n, '#000', '2026-01')),
      rules,
    } as ServiceConfig;
  }

  it('chi fa la lunga fa la notte il giorno dopo, sempre', () => {
    const config = rotationConfig();
    const ctx = buildContext({ config, year: 2026, month: 12, months: {} });
    const { assignments } = generate(ctx, { timeMs: 1500, seed: 7 });
    const analysis = analyzeSchedule(ctx, assignments);
    const L = config.shiftTypes.find(s => s.code === 'L')!.id;
    const N = config.shiftTypes.find(s => s.code === 'N')!.id;
    expect(analysis.counts.uncovered).toBe(0);
    expect(analysis.issues.filter(i => i.severity === 'error')).toEqual([]);
    for (const a of assignments) {
      if (a.shiftId === L && a.date < '2026-12-31') {
        expect(assignments.some(x => x.doctorId === a.doctorId && x.shiftId === N && x.date === addDays(a.date, 1))).toBe(true);
      }
      if (a.shiftId === N && a.date > '2026-12-01') {
        expect(assignments.some(x => x.doctorId === a.doctorId && x.shiftId === L && x.date === addDays(a.date, -1))).toBe(true);
      }
    }
    // Le linee restano appaiate: dalla Lunga alla Notte, dalla SEI Lunga alla SEI notte.
    const areaName = (id: string) => config.areas.find(x => x.id === id)!.name;
    const pairs = new Set(assignments.filter(a => a.shiftId === L && a.date < '2026-12-31').map(a => {
      const n = assignments.find(x => x.doctorId === a.doctorId && x.shiftId === N && x.date === addDays(a.date, 1))!;
      return `${areaName(a.areaId)}>${areaName(n.areaId)}`;
    }));
    expect([...pairs].sort()).toEqual(['Lunga>Notte', 'SEI Lunga>SEI notte']);
  });

  it('una lunga senza la notte del giorno dopo è un errore, il riposo saltato solo un avviso', () => {
    const config = rotationConfig(4);
    const ctx = buildContext({ config, year: 2026, month: 12, months: {} });
    const [lunga, notte] = [config.areas[0], config.areas[1]];
    const L = config.shiftTypes.find(s => s.code === 'L')!.id;
    const N = config.shiftTypes.find(s => s.code === 'N')!.id;
    const d = config.doctors[0].id;
    const mk = (date: string, areaId: string, shiftId: string): Assignment => ({ id: `${date}${shiftId}`, date, areaId, shiftId, doctorId: d });
    const broken = analyzeSchedule(ctx, [mk('2026-12-03', lunga.id, L)]);
    expect(broken.issues.some(i => i.kind === 'rotation-binding' && i.doctorId === d)).toBe(true);
    const ok = analyzeSchedule(ctx, [mk('2026-12-03', lunga.id, L), mk('2026-12-04', notte.id, N), mk('2026-12-06', lunga.id, L), mk('2026-12-07', notte.id, N)]);
    const mine = ok.issues.filter(i => i.doctorId === d);
    expect(mine.filter(i => i.severity === 'error')).toEqual([]);
    expect(mine.some(i => i.kind === 'riposo')).toBe(true);
  });
});
