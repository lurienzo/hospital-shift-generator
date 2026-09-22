import { describe, expect, it } from 'vitest';
import { DEFAULT_SHIFT_TYPES, ShiftType } from '../models/types';
import {
  ShiftTypeIndex,
  blockIndexOf,
  blockStartDate,
  crossesMidnight,
  shiftDurationHours,
  shiftsOverlap,
  validateShiftType,
} from './shiftTypes';

const morning = DEFAULT_SHIFT_TYPES[0];
const afternoon = DEFAULT_SHIFT_TYPES[1];
const night = DEFAULT_SHIFT_TYPES[2];

const long: ShiftType = {
  id: 'long', name: 'Lunga', code: 'L', start: '08:00', end: '20:00',
  color: '#10b981', order: 3,
};

const diurnismo: ShiftType = {
  id: 'diurnismo', name: 'Diurnismo', code: 'D', start: '08:00', end: '16:00',
  color: '#06b6d4', order: 4,
  rotational: true, blockLengthDays: 7, blockStartWeekday: 'monday',
};

describe('durata dei turni', () => {
  it('calcola le ore delle fasce diurne', () => {
    expect(shiftDurationHours(morning)).toBe(6);
    expect(shiftDurationHours(long)).toBe(12);
  });

  it('gestisce le fasce che scavalcano la mezzanotte', () => {
    expect(shiftDurationHours(night)).toBe(12);
    expect(crossesMidnight(night)).toBe(true);
    expect(crossesMidnight(morning)).toBe(false);
  });
});

describe('sovrapposizione fra fasce', () => {
  it('considera sovrapposte le fasce che condividono del tempo', () => {
    expect(shiftsOverlap(morning, long)).toBe(true);
    expect(shiftsOverlap(afternoon, long)).toBe(true);
    expect(shiftsOverlap(morning, diurnismo)).toBe(true);
  });

  it('non considera sovrapposte le fasce consecutive', () => {
    expect(shiftsOverlap(morning, afternoon)).toBe(false);
    expect(shiftsOverlap(afternoon, night)).toBe(false);
  });

  it('non considera la notte sovrapposta alla mattina, che è il caso dello smontante', () => {
    expect(shiftsOverlap(night, morning)).toBe(false);
  });
});

describe('blocchi delle fasce a rotazione', () => {
  it('assegna lo stesso blocco a tutti i giorni della settimana', () => {
    // 2026-04-06 è un lunedì, 2026-04-12 la domenica successiva.
    const monday = blockIndexOf(diurnismo, '2026-04-06');
    for (const date of [
      '2026-04-06', '2026-04-07', '2026-04-08',
      '2026-04-09', '2026-04-10', '2026-04-11', '2026-04-12',
    ]) {
      expect(blockIndexOf(diurnismo, date)).toBe(monday);
    }
  });

  it('cambia blocco al lunedì successivo', () => {
    expect(blockIndexOf(diurnismo, '2026-04-13'))
      .toBe(blockIndexOf(diurnismo, '2026-04-06') + 1);
  });

  it('tiene unito un blocco a cavallo di due mesi', () => {
    // 2026-03-30 è lunedì: la settimana finisce il 5 aprile.
    expect(blockIndexOf(diurnismo, '2026-04-01'))
      .toBe(blockIndexOf(diurnismo, '2026-03-30'));
    expect(blockIndexOf(diurnismo, '2026-04-05'))
      .toBe(blockIndexOf(diurnismo, '2026-03-30'));
  });

  it('ricava la data di inizio di un blocco', () => {
    const index = blockIndexOf(diurnismo, '2026-04-08');
    expect(blockStartDate(diurnismo, index)).toBe('2026-04-06');
  });

  it('rispetta un giorno di inizio diverso dal lunedì', () => {
    const fromThursday: ShiftType = { ...diurnismo, blockStartWeekday: 'thursday' };
    // 2026-04-09 è giovedì: il blocco arriva fino al 15.
    expect(blockIndexOf(fromThursday, '2026-04-09'))
      .toBe(blockIndexOf(fromThursday, '2026-04-15'));
    expect(blockIndexOf(fromThursday, '2026-04-08'))
      .toBe(blockIndexOf(fromThursday, '2026-04-09') - 1);
  });
});

describe('ShiftTypeIndex', () => {
  const index = new ShiftTypeIndex([night, morning, long, diurnismo, afternoon]);

  it('ordina le fasce e permette il confronto cronologico', () => {
    expect(index.all.map(shiftType => shiftType.id))
      .toEqual([morning.id, afternoon.id, night.id, long.id, diurnismo.id]);
    expect(index.compare(morning.id, night.id)).toBeLessThan(0);
  });

  it('elenca solo le fasce a rotazione', () => {
    expect(index.rotational.map(shiftType => shiftType.id)).toEqual([diurnismo.id]);
    expect(index.isRotational(morning.id)).toBe(false);
    expect(index.isRotational(diurnismo.id)).toBe(true);
  });

  it('restituisce null come indice di blocco per le fasce non a rotazione', () => {
    expect(index.blockIndex(morning.id, '2026-04-06')).toBeNull();
    expect(index.blockIndex(diurnismo.id, '2026-04-06')).not.toBeNull();
  });

  it('non va in errore su una fascia eliminata', () => {
    const missing = index.get('fascia-inesistente');
    expect(missing.name).toBe('Fascia rimossa');
    expect(index.hours('fascia-inesistente')).toBe(0);
  });

  it('elenca le fasce sovrapposte', () => {
    expect(index.overlapping(long.id).map(shiftType => shiftType.id))
      .toEqual([morning.id, afternoon.id, diurnismo.id]);
  });
});

describe('validazione delle fasce', () => {
  const existing = [morning, afternoon, night];

  it('accetta una fascia valida', () => {
    expect(validateShiftType(
      { id: 'new', name: 'Lunga', code: 'L', start: '08:00', end: '20:00' },
      existing,
    )).toBeNull();
  });

  it('rifiuta nomi e sigle duplicate', () => {
    expect(validateShiftType(
      { id: 'new', name: 'Mattina', code: 'X', start: '09:00', end: '15:00' },
      existing,
    )).toMatch(/nome/);

    expect(validateShiftType(
      { id: 'new', name: 'Altro', code: 'M', start: '09:00', end: '15:00' },
      existing,
    )).toMatch(/sigla/);
  });

  it('rifiuta orari non validi o coincidenti', () => {
    expect(validateShiftType(
      { id: 'new', name: 'Altro', code: 'X', start: '25:00', end: '15:00' },
      existing,
    )).toMatch(/inizio/);

    expect(validateShiftType(
      { id: 'new', name: 'Altro', code: 'X', start: '09:00', end: '09:00' },
      existing,
    )).toMatch(/coincidere/);
  });

  it('non segnala conflitti con se stessa in modifica', () => {
    expect(validateShiftType(
      { id: morning.id, name: 'Mattina', code: 'M', start: '07:00', end: '14:00' },
      existing,
    )).toBeNull();
  });
});
