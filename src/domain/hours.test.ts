import { describe, expect, it } from 'vitest';
import { HoursTarget } from '../models/types';
import { ShiftTypeIndex } from './shiftTypes';
import { HoursLedger, buildHoursPeriods, buildHoursReport, rangeFor } from './hours';
import { LONG, MORNING, NIGHT, makeAssignment, makeDoctor } from './testFixtures';

const shiftTypes = new ShiftTypeIndex([MORNING, NIGHT, LONG]);
const doctors = [makeDoctor('rossi'), makeDoctor('bianchi')];

const weekly: HoursTarget = { enabled: true, period: 'week', min: 36, max: 42 };
const monthly: HoursTarget = { enabled: true, period: 'month', min: 140, max: 170 };

/** Aprile 2026: il 1 è mercoledì, il 30 giovedì. */
const APRIL = { year: 2026, month: 4 };
const APRIL_ONLY = { from: '2026-04-01', to: '2026-04-30' };

describe('periodi da controllare', () => {
  it('con la cadenza settimanale prende tutte le settimane che toccano il mese', () => {
    const periods = buildHoursPeriods(APRIL.year, APRIL.month, weekly, APRIL_ONLY);

    // La prima settimana comincia lunedì 30 marzo, l'ultima lunedì 27 aprile.
    expect(periods[0].start).toBe('2026-03-30');
    expect(periods.at(-1)!.start).toBe('2026-04-27');
    expect(periods).toHaveLength(5);
  });

  it('marca come incomplete le settimane che escono dai dati disponibili', () => {
    const periods = buildHoursPeriods(APRIL.year, APRIL.month, weekly, APRIL_ONLY);

    // La prima entra in marzo, l'ultima in maggio: nessuna delle due è
    // interamente coperta dai dati di aprile.
    expect(periods[0].complete).toBe(false);
    expect(periods.at(-1)!.complete).toBe(false);
    expect(periods[1].complete).toBe(true);
    expect(periods[2].complete).toBe(true);
  });

  it('considera completa la settimana a cavallo se c’è il mese precedente', () => {
    const withMarch = { from: '2026-03-01', to: '2026-04-30' };
    const periods = buildHoursPeriods(APRIL.year, APRIL.month, weekly, withMarch);

    expect(periods[0].complete).toBe(true);
    // L'ultima entra in maggio, che non esiste ancora.
    expect(periods.at(-1)!.complete).toBe(false);
  });

  it('con la cadenza mensile produce un solo periodo', () => {
    const periods = buildHoursPeriods(APRIL.year, APRIL.month, monthly, APRIL_ONLY);

    expect(periods).toHaveLength(1);
    expect(periods[0].start).toBe('2026-04-01');
    expect(periods[0].end).toBe('2026-04-30');
    expect(periods[0].complete).toBe(true);
  });
});

describe('verifica delle ore', () => {
  function report(assignments: ReturnType<typeof makeAssignment>[], target = weekly, known = APRIL_ONLY) {
    return buildHoursReport({
      ...APRIL, target, doctors, shiftTypes, assignments, known,
    });
  }

  it('segnala chi sta sotto il minimo in una settimana completa', () => {
    // Settimana 6-12 aprile: una sola notte da 12 ore.
    const result = report([makeAssignment('a1', '2026-04-06', 'sala1', NIGHT.id, 'rossi')]);

    const issue = result.issues.find(
      entry => entry.doctorId === 'rossi' && entry.period.start === '2026-04-06',
    )!;
    expect(issue.status).toBe('below');
    expect(issue.hours).toBe(12);
    expect(issue.gap).toBe(24);
  });

  it('non giudica il minimo su una settimana incompleta', () => {
    // La settimana del 30 marzo esce dai dati: sotto il minimo non si sa.
    const result = report([makeAssignment('a1', '2026-04-01', 'sala1', NIGHT.id, 'rossi')]);

    const first = result.entries.find(
      entry => entry.doctorId === 'rossi' && entry.period.start === '2026-03-30',
    )!;
    expect(first.status).toBe('partial');
    expect(result.issues).not.toContain(first);
  });

  it('segnala il superamento del massimo anche su una settimana incompleta', () => {
    // Le ore che non vediamo possono solo aggiungersi, quindi il massimo
    // superato resta superato.
    const assignments = ['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04'].map(
      (date, index) => makeAssignment(`a${index}`, date, 'sala1', LONG.id, 'rossi'),
    );
    const result = report(assignments);

    const first = result.entries.find(
      entry => entry.doctorId === 'rossi' && entry.period.start === '2026-03-30',
    )!;
    expect(first.hours).toBe(48);
    expect(first.status).toBe('above');
    expect(first.gap).toBe(6);
  });

  it('accetta un totale dentro l’intervallo', () => {
    // Tre turni da 12 ore nella settimana 6-12 aprile: 36 ore, al minimo.
    const assignments = ['2026-04-06', '2026-04-07', '2026-04-08'].map(
      (date, index) => makeAssignment(`a${index}`, date, 'sala1', NIGHT.id, 'rossi'),
    );
    const result = report(assignments);

    const entry = result.entries.find(
      entry => entry.doctorId === 'rossi' && entry.period.start === '2026-04-06',
    )!;
    expect(entry.hours).toBe(36);
    expect(entry.status).toBe('ok');
  });

  it('include i turni del mese precedente nella settimana a cavallo', () => {
    const assignments = [
      // 30 e 31 marzo, più 1 e 2 aprile: la settimana ne raccoglie quattro.
      makeAssignment('p1', '2026-03-30', 'sala1', NIGHT.id, 'rossi'),
      makeAssignment('p2', '2026-03-31', 'sala1', NIGHT.id, 'rossi'),
      makeAssignment('a1', '2026-04-01', 'sala1', NIGHT.id, 'rossi'),
      makeAssignment('a2', '2026-04-02', 'sala1', MORNING.id, 'rossi'),
    ];
    const result = report(assignments, weekly, { from: '2026-03-01', to: '2026-04-30' });

    const first = result.entries.find(
      entry => entry.doctorId === 'rossi' && entry.period.start === '2026-03-30',
    )!;
    expect(first.hours).toBe(42);
    expect(first.status).toBe('ok');
  });

  it('conta solo il mese corrente nelle ore mensili', () => {
    const assignments = [
      makeAssignment('p1', '2026-03-31', 'sala1', NIGHT.id, 'rossi'),
      makeAssignment('a1', '2026-04-01', 'sala1', NIGHT.id, 'rossi'),
    ];
    const result = report(assignments, weekly, { from: '2026-03-01', to: '2026-04-30' });

    expect(result.monthlyHours.get('rossi')).toBe(12);
  });

  it('non produce segnalazioni quando il controllo è disattivato', () => {
    const disabled: HoursTarget = { ...weekly, enabled: false };
    const result = report([makeAssignment('a1', '2026-04-06', 'sala1', NIGHT.id, 'rossi')], disabled);

    expect(result.entries).toHaveLength(0);
    expect(result.issues).toHaveLength(0);
    // Le ore del mese restano comunque disponibili.
    expect(result.monthlyHours.get('rossi')).toBe(12);
  });

  it('usa le ore proprie del medico quando impostate', () => {
    const custom = [
      makeDoctor('rossi', { hoursOverride: { min: 12, max: 24 } }),
      makeDoctor('bianchi'),
    ];

    expect(rangeFor(custom[0], weekly)).toEqual({ min: 12, max: 24 });
    expect(rangeFor(custom[1], weekly)).toEqual({ min: 36, max: 42 });

    const result = buildHoursReport({
      ...APRIL,
      target: weekly,
      doctors: custom,
      shiftTypes,
      assignments: [makeAssignment('a1', '2026-04-06', 'sala1', NIGHT.id, 'rossi')],
      known: APRIL_ONLY,
    });

    // 12 ore rientrano nel suo intervallo, ma non in quello del servizio.
    const forRossi = result.entries.find(
      entry => entry.doctorId === 'rossi' && entry.period.start === '2026-04-06',
    )!;
    const forBianchi = result.entries.find(
      entry => entry.doctorId === 'bianchi' && entry.period.start === '2026-04-06',
    )!;

    expect(forRossi.status).toBe('ok');
    expect(forBianchi.status).toBe('below');
  });
});

describe('registro delle ore del generatore', () => {
  it('accumula le ore nel periodo della data', () => {
    const ledger = new HoursLedger(weekly, doctors, shiftTypes);

    ledger.add('rossi', '2026-04-06', NIGHT.id);
    ledger.add('rossi', '2026-04-08', NIGHT.id);

    // Stessa settimana: le ore si sommano.
    expect(ledger.hoursIn('rossi', '2026-04-06')).toBe(24);
    expect(ledger.hoursIn('rossi', '2026-04-10')).toBe(24);
    // Settimana successiva: si riparte da zero.
    expect(ledger.hoursIn('rossi', '2026-04-13')).toBe(0);
  });

  it('riconosce quando un turno farebbe superare il massimo', () => {
    const ledger = new HoursLedger(weekly, doctors, shiftTypes);
    for (const date of ['2026-04-06', '2026-04-07', '2026-04-08']) {
      ledger.add('rossi', date, NIGHT.id);
    }

    // 36 ore più una notte da 12 farebbero 48, oltre il massimo di 42.
    expect(ledger.wouldExceedMax('rossi', '2026-04-09', NIGHT.id)).toBe(true);
    // Una mattina da 6 ore arriverebbe a 42, che è ammesso.
    expect(ledger.wouldExceedMax('rossi', '2026-04-09', MORNING.id)).toBe(false);
  });

  it('riconosce chi è ancora sotto il minimo', () => {
    const ledger = new HoursLedger(weekly, doctors, shiftTypes);
    expect(ledger.isBelowMin('rossi', '2026-04-06')).toBe(true);

    for (const date of ['2026-04-06', '2026-04-07', '2026-04-08']) {
      ledger.add('rossi', date, NIGHT.id);
    }
    expect(ledger.isBelowMin('rossi', '2026-04-06')).toBe(false);
  });

  it('non vincola nulla se disattivato', () => {
    const ledger = new HoursLedger({ ...weekly, enabled: false }, doctors, shiftTypes);
    ledger.add('rossi', '2026-04-06', NIGHT.id);

    expect(ledger.enabled).toBe(false);
    expect(ledger.hoursIn('rossi', '2026-04-06')).toBe(0);
    expect(ledger.wouldExceedMax('rossi', '2026-04-06', NIGHT.id)).toBe(false);
    expect(ledger.isBelowMin('rossi', '2026-04-06')).toBe(false);
  });
});
