import { describe, expect, it } from 'vitest';
import { makeDoctor } from '../domain/defaults';
import { matchDoctor, parseCode, parseDelimited, parseRequestGrid } from './requestsGrid';

const doctors = [makeDoctor('Dott. Rossi', '#000', '2026-01'), makeDoctor('Dott.ssa Bianchi', '#000', '2026-01'), makeDoctor('Verdi Mario', '#000', '2026-01')];

describe('import richieste', () => {
  it('riconosce sigle e sinonimi', () => {
    expect(parseCode('f')).toBe('F');
    expect(parseCode('Ferie')).toBe('F');
    expect(parseCode('MAL')).toBe('A');
    expect(parseCode('x')).toBe('D');
    expect(parseCode('NN')).toBe('N');
    expect(parseCode('')).toBeNull();
    expect(parseCode('boh')).toBe('invalid');
  });

  it('abbina i nomi ignorando titoli, maiuscole e accenti', () => {
    expect(matchDoctor('ROSSI', doctors)?.name).toBe('Dott. Rossi');
    expect(matchDoctor('Dr. Bianchi', doctors)?.name).toBe('Dott.ssa Bianchi');
    expect(matchDoctor('Verdi', doctors)?.name).toBe('Verdi Mario');
    expect(matchDoctor('Neri', doctors)).toBeNull();
  });

  it('legge una griglia incollata da Excel', () => {
    const header = ['Medico', ...Array.from({ length: 30 }, (_, i) => String(i + 1))].join('\t');
    const weekdays = ['', 'Dom', 'Lun', 'Mar'].join('\t');
    const rossi = ['Rossi', 'F', 'F', '', 'D'].join('\t');
    const neri = ['Neri', 'F'].join('\t');
    const bianchi = ['Bianchi', '', 'boh', 'N'].join('\t');
    const r = parseRequestGrid(parseDelimited([header, weekdays, rossi, neri, bianchi].join('\n')), doctors, 2026, 11);
    expect(r.days).toBe(30);
    expect(r.requests[doctors[0].id]).toEqual({ '2026-11-01': 'F', '2026-11-02': 'F', '2026-11-04': 'D' });
    expect(r.requests[doctors[1].id]).toEqual({ '2026-11-03': 'N' });
    expect(r.unknownNames).toEqual(['Neri']);
    expect(r.invalid).toEqual([{ name: 'Bianchi', day: 2, value: 'boh' }]);
  });

  it('legge un CSV con punto e virgola', () => {
    const csv = `Medico;1;2;3;4;5;6;7;8\n"Rossi";;F;F;;;;;\n`;
    const r = parseRequestGrid(parseDelimited(csv), doctors, 2026, 2);
    expect(r.requests[doctors[0].id]).toEqual({ '2026-02-02': 'F', '2026-02-03': 'F' });
  });
});
