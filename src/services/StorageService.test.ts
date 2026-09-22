import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SHIFT_TYPES, MonthlySchedule } from '../models/types';
import { ServiceRegistry } from './ServiceRegistry';
import { StorageService } from './StorageService';
import { EVERY_DAY, MORNING, makeAssignment, makeDoctor, makeRoom, slotsOn } from '../domain/testFixtures';

function schedule(month: number, doctorId = 'a'): MonthlySchedule {
  return {
    year: 2026,
    month,
    holidays: [],
    assignments: [makeAssignment('x1', `2026-0${month}-06`, 'sala1', MORNING.id, doctorId)],
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('inizializzazione dei servizi', () => {
  it('crea un servizio iniziale al primo avvio', () => {
    const services = ServiceRegistry.list();
    expect(services).toHaveLength(1);
    expect(ServiceRegistry.getActiveId()).toBe(services[0].id);
  });

  it('recupera i dati salvati dalla versione senza servizi', () => {
    // Dati scritti dalla versione precedente, con le vecchie chiavi globali.
    localStorage.setItem('hospital_shift_doctors', JSON.stringify([
      { id: 'd1', name: 'ROSSI', color: '#fff', excludedRooms: [], excludedWeekdays: [] },
    ]));
    localStorage.setItem('hospital_shift_rooms', JSON.stringify([
      { id: 'r1', name: 'Sala 1', color: '#000', slots: [], dayGroups: [] },
    ]));

    const services = ServiceRegistry.list();
    expect(services).toHaveLength(1);
    expect(services[0].name).toBe('Servizio principale');

    expect(StorageService.loadDoctors()).toHaveLength(1);
    expect(StorageService.loadRooms()).toHaveLength(1);

    // Le vecchie chiavi vengono rimosse dopo il recupero.
    expect(localStorage.getItem('hospital_shift_doctors')).toBeNull();
  });
});

describe('conversione dei dati salvati', () => {
  it('rinomina il vecchio campo timeSlot in shiftTypeId', () => {
    const id = ServiceRegistry.getActiveId();
    localStorage.setItem(
      ServiceRegistry.scopedKey('schedule', id),
      JSON.stringify({
        year: 2026,
        month: 4,
        holidays: [],
        assignments: [{
          id: 'a1',
          date: '2026-04-06',
          roomId: 'r1',
          roomName: 'Sala 1',
          timeSlot: '08:00-14:00',
          doctorId: 'd1',
          doctorName: 'ROSSI',
        }],
      }),
    );

    const loaded = StorageService.loadSchedule();
    expect(loaded?.assignments[0].shiftTypeId).toBe('08:00-14:00');
    expect('timeSlot' in loaded!.assignments[0]).toBe(false);
  });

  it('converte anche i turni settimanali delle sale', () => {
    const id = ServiceRegistry.getActiveId();
    localStorage.setItem(
      ServiceRegistry.scopedKey('rooms', id),
      JSON.stringify([{
        id: 'r1',
        name: 'Sala 1',
        color: '#000',
        dayGroups: [],
        slots: [{
          id: 's1',
          weekday: 'monday',
          timeSlot: '20:00-08:00',
          isCritical: true,
          requiresNextDayRest: true,
          isFullDayExclusive: true,
        }],
      }]),
    );

    const [room] = StorageService.loadRooms();
    expect(room.slots[0].shiftTypeId).toBe('20:00-08:00');
    // Il campo mancante nella versione precedente riceve un valore sensato.
    expect(room.slots[0].requiresSecondDayRest).toBe(false);
  });

  it('tiene una sola modalità di rotazione per sala', () => {
    const id = ServiceRegistry.getActiveId();
    localStorage.setItem(
      ServiceRegistry.scopedKey('rooms', id),
      JSON.stringify([{
        id: 'r1',
        name: 'Sala 1',
        color: '#000',
        slots: [],
        consecutiveShifts: 3,
        dayGroups: [{ id: 'g1', days: ['monday'] }],
      }]),
    );

    const [room] = StorageService.loadRooms();
    expect(room.dayGroups).toHaveLength(1);
    expect(room.consecutiveShifts).toBeUndefined();
  });

  it('restituisce le fasce predefinite quando non ce ne sono salvate', () => {
    expect(StorageService.loadShiftTypes().map(item => item.id))
      .toEqual(DEFAULT_SHIFT_TYPES.map(item => item.id));
  });

  it('non va in errore su dati corrotti', () => {
    const id = ServiceRegistry.getActiveId();
    localStorage.setItem(ServiceRegistry.scopedKey('doctors', id), '{non json');
    expect(StorageService.loadDoctors()).toEqual([]);
  });
});

describe('versioni del calendario', () => {
  it('mantiene una sola versione attiva per mese', () => {
    StorageService.createVersion(schedule(4), 'Prima', true);
    const second = StorageService.createVersion(schedule(4), 'Seconda', true);

    const versions = StorageService.loadVersionsForMonth(2026, 4);
    expect(versions).toHaveLength(2);
    expect(versions.filter(version => version.isActive).map(version => version.id))
      .toEqual([second.id]);
  });

  it('promuove un’altra versione quando si elimina quella attiva', () => {
    const first = StorageService.createVersion(schedule(4), 'Prima', true);
    const second = StorageService.createVersion(schedule(4), 'Seconda', true);

    StorageService.deleteVersion(2026, 4, second.id);

    const remaining = StorageService.loadVersionsForMonth(2026, 4);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(first.id);
    expect(remaining[0].isActive).toBe(true);
  });

  it('conta le versioni per mese', () => {
    StorageService.createVersion(schedule(4), 'A', true);
    StorageService.createVersion(schedule(4), 'B', false);
    StorageService.createVersion(schedule(5), 'C', true);

    const counts = StorageService.countVersionsByMonth(2026);
    expect(counts[3]).toBe(2);
    expect(counts[4]).toBe(1);
    expect(counts[0]).toBe(0);
  });

  it('rinomina e aggiorna una versione', () => {
    const version = StorageService.createVersion(schedule(4), 'Bozza', true);
    StorageService.updateVersion(2026, 4, version.id, { name: 'Definitivo' });

    expect(StorageService.loadVersionsForMonth(2026, 4)[0].name).toBe('Definitivo');
  });
});

describe('isolamento fra servizi', () => {
  it('tiene separati sale, medici e calendari', () => {
    const first = ServiceRegistry.getActiveId();

    StorageService.saveDoctors([makeDoctor('a')]);
    StorageService.saveRooms([makeRoom('sala1', slotsOn(EVERY_DAY, MORNING.id))]);
    StorageService.createVersion(schedule(4), 'Aprile primo servizio', true);

    const second = ServiceRegistry.create('Terapia Intensiva 2');
    ServiceRegistry.setActive(second.id);

    // Il nuovo servizio parte vuoto.
    expect(StorageService.loadDoctors()).toEqual([]);
    expect(StorageService.loadRooms()).toEqual([]);
    expect(StorageService.loadVersionsForMonth(2026, 4)).toEqual([]);
    expect(StorageService.getAllActiveVersions()).toEqual([]);

    StorageService.saveDoctors([makeDoctor('b'), makeDoctor('c')]);
    expect(StorageService.loadDoctors()).toHaveLength(2);

    // Tornando al primo servizio i suoi dati sono intatti.
    ServiceRegistry.setActive(first);
    expect(StorageService.loadDoctors().map(item => item.id)).toEqual(['a']);
    expect(StorageService.loadVersionsForMonth(2026, 4)).toHaveLength(1);
  });

  it('azzerare un servizio non toglie nulla agli altri', () => {
    const first = ServiceRegistry.getActiveId();
    StorageService.saveDoctors([makeDoctor('a')]);

    const second = ServiceRegistry.create('Piastra Operatoria');
    ServiceRegistry.setActive(second.id);
    StorageService.saveDoctors([makeDoctor('b')]);
    StorageService.clearAll();

    expect(StorageService.loadDoctors()).toEqual([]);

    ServiceRegistry.setActive(first);
    expect(StorageService.loadDoctors().map(item => item.id)).toEqual(['a']);
  });

  it('elimina tutti i dati di un servizio rimosso', () => {
    const first = ServiceRegistry.getActiveId();
    const second = ServiceRegistry.create('Da eliminare');

    ServiceRegistry.setActive(second.id);
    StorageService.saveDoctors([makeDoctor('b')]);
    StorageService.createVersion(schedule(4), 'Versione', true);
    expect(ServiceRegistry.countVersions(second.id)).toBe(1);

    ServiceRegistry.setActive(first);
    expect(ServiceRegistry.remove(second.id)).toBe(true);

    expect(ServiceRegistry.list().map(service => service.id)).toEqual([first]);
    expect(localStorage.getItem(ServiceRegistry.scopedKey('doctors', second.id))).toBeNull();
    expect(localStorage.getItem(ServiceRegistry.scopedKey('versions', second.id))).toBeNull();
  });

  it('non permette di eliminare l’ultimo servizio', () => {
    const only = ServiceRegistry.getActiveId();
    expect(ServiceRegistry.remove(only)).toBe(false);
    expect(ServiceRegistry.list()).toHaveLength(1);
  });

  it('duplica la configurazione senza portarsi dietro i calendari', () => {
    StorageService.saveDoctors([makeDoctor('a')]);
    StorageService.saveRooms([makeRoom('sala1', slotsOn(EVERY_DAY, MORNING.id))]);
    StorageService.createVersion(schedule(4), 'Aprile', true);

    const source = ServiceRegistry.getActiveId();
    const copy = ServiceRegistry.duplicateConfiguration(source, 'Terapia Intensiva 2');
    ServiceRegistry.setActive(copy.id);

    expect(StorageService.loadDoctors().map(item => item.id)).toEqual(['a']);
    expect(StorageService.loadRooms()).toHaveLength(1);
    expect(StorageService.loadVersionsForMonth(2026, 4)).toEqual([]);
  });

  it('torna a un servizio valido se quello attivo non esiste più', () => {
    const first = ServiceRegistry.getActiveId();
    const second = ServiceRegistry.create('Secondo');
    ServiceRegistry.setActive(second.id);

    ServiceRegistry.remove(second.id);
    expect(ServiceRegistry.getActiveId()).toBe(first);
  });
});

describe('export CSV', () => {
  it('include le tre sezioni e i nomi dei dottori', () => {
    const room = makeRoom('sala1', slotsOn(EVERY_DAY, MORNING.id));
    const doctors = [makeDoctor('rossi'), makeDoctor('bianchi')];

    const csv = StorageService.exportToCSV(
      {
        year: 2026,
        month: 4,
        holidays: [],
        assignments: [makeAssignment('a1', '2026-04-06', 'sala1', MORNING.id, 'rossi')],
      },
      [room],
      doctors,
      DEFAULT_SHIFT_TYPES,
    );

    expect(csv).toContain('Turni per sala');
    expect(csv).toContain('Turni per dottore');
    expect(csv).toContain('Statistiche del mese');
    expect(csv).toContain('ROSSI');
    expect(csv).toContain('SALA1 M');
  });

  it('protegge i valori che contengono virgole', () => {
    const room = makeRoom('sala1', slotsOn(EVERY_DAY, MORNING.id));
    const doctors = [makeDoctor('x', { name: 'Rossi, Mario' })];

    const csv = StorageService.exportToCSV(
      {
        year: 2026,
        month: 4,
        holidays: [],
        assignments: [makeAssignment('a1', '2026-04-06', 'sala1', MORNING.id, 'x', {
          doctorName: 'Rossi, Mario',
        })],
      },
      [room],
      doctors,
      DEFAULT_SHIFT_TYPES,
    );

    expect(csv).toContain('"Rossi, Mario"');
  });
});
