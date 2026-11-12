import { describe, expect, it } from 'vitest';
import { defaultRules, emptyCoverage, fillCoverage, makeArea, makeDoctor, makeShift, SHIFT_PRESETS, WEEKDAYS } from './defaults';
import { addExistingFascia, addNewFascia, areasUsing, deleteArea, fasceOf, migrateFasce, moveFascia, removeFascia, setCells, splitFascia } from './fasce';
import { DAY_KEYS, type ServiceConfig } from './types';

function base(): ServiceConfig {
  const L = makeShift({ name: 'Lunga', code: 'L', start: '08:00', end: '20:00', color: '#10b981', kind: 'day', block: null });
  const N = makeShift({ name: 'Notte', code: 'N', start: '20:00', end: '08:00', color: '#6366f1', kind: 'night', block: null });
  const a1 = { ...makeArea('Linea 1', '#000'), coverage: fillCoverage(fillCoverage(emptyCoverage(), L.id, DAY_KEYS, 1, true), N.id, DAY_KEYS, 1, false) };
  const a2 = makeArea('Linea 2', '#111');
  const rules = defaultRules();
  rules.schemes = [{ id: 's', name: 'S', steps: [{ kind: 'shift', shiftId: L.id }, { kind: 'shift', shiftId: N.id }, { kind: 'smonto' }] }];
  return { shiftTypes: [L, N], areas: [a1, a2], doctors: [makeDoctor('Rossi', '#000', '2026-01')], rules, fasceV: 2 };
}

describe('fasce delle aree', () => {
  it('un’area mostra solo le fasce che ha', () => {
    const c = base();
    expect(fasceOf(c, c.areas[0]).map(s => s.name)).toEqual(['Lunga', 'Notte']);
    expect(fasceOf(c, c.areas[1])).toEqual([]);
  });

  it('aggiungere una fascia esistente copia i giorni dell’area che già la usa', () => {
    const c = base();
    const next = addExistingFascia(c, c.areas[1].id, c.shiftTypes[0].id);
    expect(fasceOf(next, next.areas[1]).map(s => s.name)).toEqual(['Lunga']);
    expect(next.areas[1].coverage.sun[c.shiftTypes[0].id]).toEqual({ count: 1, critical: true });
    expect(next.shiftTypes).toHaveLength(2);
  });

  it('una fascia nuova parte dai feriali (le notti da tutti i giorni) con una sigla libera', () => {
    const c = base();
    const day = addNewFascia(c, c.areas[1].id, { ...SHIFT_PRESETS[0], code: 'L' });
    const m = day.shiftTypes[2];
    expect(m.code).toBe('L2');
    expect(DAY_KEYS.filter(k => day.areas[1].coverage[k][m.id].count > 0)).toEqual(WEEKDAYS);
    const night = addNewFascia(c, c.areas[1].id, SHIFT_PRESETS[5]);
    expect(DAY_KEYS.every(k => night.areas[1].coverage[k][night.shiftTypes[2].id].count === 1)).toBe(true);
  });

  it('una riga azzerata resta; tolta dall’ultima area, il turno sparisce anche dalla rotazione', () => {
    const c = base();
    const [L] = c.shiftTypes;
    const zero = setCells(c, c.areas[0].id, L.id, DAY_KEYS, () => ({ count: 0, critical: false }));
    expect(fasceOf(zero, zero.areas[0]).map(s => s.name)).toEqual(['Lunga', 'Notte']);
    expect(migrateFasce(zero)).toBe(zero);
    const two = addExistingFascia(c, c.areas[1].id, L.id);
    const one = removeFascia(two, two.areas[0].id, L.id);
    expect(one.shiftTypes).toHaveLength(2);
    const none = removeFascia(one, one.areas[1].id, L.id);
    expect(none.shiftTypes.map(s => s.name)).toEqual(['Notte']);
    expect(none.rules.schemes[0].steps).toHaveLength(2);
  });

  it('separare dà all’area una copia propria senza toccare le altre', () => {
    const c0 = base();
    const L = c0.shiftTypes[0];
    const c = addExistingFascia(c0, c0.areas[1].id, L.id);
    const s = splitFascia(c, c.areas[1].id, L.id);
    expect(s.shiftTypes.map(x => x.name)).toEqual(['Lunga', 'Lunga (Linea 2)', 'Notte']);
    expect(areasUsing(s, L.id).map(a => a.name)).toEqual(['Linea 1']);
    expect(fasceOf(s, s.areas[1])[0].code).toBe('L2');
    expect(s.areas[1].coverage.mon[s.shiftTypes[1].id]).toEqual({ count: 1, critical: true });
    // Da sola non c'e nulla da separare.
    expect(splitFascia(c0, c0.areas[0].id, L.id)).toBe(c0);
  });

  it('sposta le fasce e, eliminando un’area, toglie i turni usati solo lì', () => {
    const c = base();
    const moved = moveFascia(c, c.areas[0].id, c.shiftTypes[1].id, -1);
    expect(moved.shiftTypes.map(s => s.name)).toEqual(['Notte', 'Lunga']);
    expect(deleteArea(c, c.areas[0].id).shiftTypes).toEqual([]);
  });

  it('la migrazione toglie una volta sola le righe tutte a zero del vecchio modello', () => {
    const c = base();
    const L = c.shiftTypes[0];
    const old: ServiceConfig = { ...c, fasceV: undefined, areas: [c.areas[0], { ...c.areas[1], coverage: fillCoverage(emptyCoverage(), L.id, DAY_KEYS, 0, false) }] };
    const m = migrateFasce(old);
    expect(m.fasceV).toBe(2);
    expect(fasceOf(m, m.areas[1])).toEqual([]);
    expect(fasceOf(m, m.areas[0])).toHaveLength(2);
  });
});
