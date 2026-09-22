import {
  Assignment,
  DEFAULT_SHIFT_TYPES,
  Doctor,
  GenerationConfig,
  MonthlySchedule,
  OperativeRoom,
  ScheduleSlot,
  ScheduleVersion,
  ShiftScheme,
  ShiftType,
} from '../models/types';
import { ShiftTypeIndex, sortShiftTypes } from '../domain/shiftTypes';
import { computeStats, buildStatColumns, summarizeColumns } from '../domain/stats';
import { RoomSlotIndex } from '../domain/validation';
import { DATA_SCOPES, DataScope, ServiceRegistry } from './ServiceRegistry';
import { generateId } from '../utils/id';
import {
  WEEKDAY_SHORT_BY_INDEX,
  buildMonthDays,
  formatMonthLabel,
  monthKey,
} from '../utils/date';

/**
 * Ogni dato appartiene al servizio attivo: la chiave di storage viene
 * risolta al momento dell'accesso, così cambiare servizio isola
 * completamente sale, medici, calendari e statistiche.
 */
function keyOf(scope: DataScope): string {
  return ServiceRegistry.scopedKey(scope, ServiceRegistry.getActiveId());
}

/**
 * Lettura difensiva: una voce corrotta o scritta da una versione precedente
 * non deve impedire l'avvio dell'applicazione.
 */
function read<T>(scope: DataScope, fallback: T): T {
  const key = keyOf(scope);
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : (parsed as T);
  } catch (error) {
    console.warn(`Dati non leggibili per "${key}", uso i valori predefiniti.`, error);
    return fallback;
  }
}

function write(scope: DataScope, value: unknown): void {
  try {
    localStorage.setItem(keyOf(scope), JSON.stringify(value));
  } catch (error) {
    console.error(
      `Impossibile salvare "${scope}". Lo spazio del browser potrebbe essere esaurito.`,
      error,
    );
    throw error;
  }
}

/**
 * Marcatore di codifica UTF-8 richiesto da Excel per interpretare
 * correttamente le lettere accentate nei file CSV. Espresso come codice
 * numerico per non lasciare nel sorgente un carattere invisibile.
 */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

// ---------------------------------------------------------------------------
// Normalizzazione dei dati salvati
//
// Le versioni precedenti memorizzavano la fascia oraria nel campo `timeSlot`.
// Gli id delle fasce predefinite coincidono con quei valori, quindi basta
// rinominare il campo: la conversione è idempotente e avviene a ogni lettura,
// senza migrazioni distruttive.
// ---------------------------------------------------------------------------

type LegacyAssignment = Assignment & { timeSlot?: string };
type LegacySlot = ScheduleSlot & { timeSlot?: string };

function normalizeAssignment(assignment: LegacyAssignment): Assignment {
  const { timeSlot, ...rest } = assignment;
  return { ...rest, shiftTypeId: rest.shiftTypeId ?? timeSlot ?? '' };
}

function normalizeSlot(slot: LegacySlot): ScheduleSlot {
  const { timeSlot, ...rest } = slot;
  return {
    id: rest.id ?? generateId(),
    weekday: rest.weekday,
    shiftTypeId: rest.shiftTypeId ?? timeSlot ?? '',
    isCritical: rest.isCritical ?? false,
    requiresNextDayRest: rest.requiresNextDayRest ?? false,
    requiresSecondDayRest: rest.requiresSecondDayRest ?? false,
    isFullDayExclusive: rest.isFullDayExclusive ?? false,
  };
}

function normalizeRoom(room: OperativeRoom): OperativeRoom {
  const normalized: OperativeRoom = {
    ...room,
    slots: (room.slots ?? []).map(normalizeSlot).filter(slot => slot.shiftTypeId !== ''),
    dayGroups: room.dayGroups ?? [],
  };

  // Una sala non può avere due modalità di rotazione insieme: se i dati
  // salvati ne contengono più di una vince quella più specifica.
  if (normalized.cycle && normalized.cycle.doctorIds?.length) {
    return { ...normalized, dayGroups: [], consecutiveShifts: undefined, consecutiveStartDay: undefined };
  }
  if (normalized.dayGroups.length > 0) {
    return { ...normalized, cycle: undefined, consecutiveShifts: undefined, consecutiveStartDay: undefined };
  }
  return { ...normalized, cycle: undefined };
}

function normalizeSchedule(schedule: MonthlySchedule): MonthlySchedule {
  return {
    ...schedule,
    holidays: schedule.holidays ?? [],
    assignments: (schedule.assignments ?? []).map(normalizeAssignment),
  };
}

// ---------------------------------------------------------------------------

export class StorageService {
  // ----- Fasce orarie -----

  static loadShiftTypes(): ShiftType[] {
    const stored = read<ShiftType[]>('shiftTypes', []);
    if (!Array.isArray(stored) || stored.length === 0) return [...DEFAULT_SHIFT_TYPES];
    return sortShiftTypes(stored);
  }

  static saveShiftTypes(shiftTypes: ShiftType[]): void {
    write('shiftTypes', sortShiftTypes(shiftTypes));
  }

  // ----- Schemi turni -----

  /** Solo gli schemi creati dall'utente: i predefiniti si derivano dalle fasce. */
  static loadCustomSchemes(): ShiftScheme[] {
    return read<ShiftScheme[]>('schemes', []).filter(scheme => !scheme.builtIn);
  }

  static saveCustomSchemes(schemes: ShiftScheme[]): void {
    write('schemes', schemes.filter(scheme => !scheme.builtIn));
  }

  // ----- Sale e medici -----

  static loadRooms(): OperativeRoom[] {
    return read<OperativeRoom[]>('rooms', []).map(normalizeRoom);
  }

  static saveRooms(rooms: OperativeRoom[]): void {
    write('rooms', rooms);
  }

  static loadDoctors(): Doctor[] {
    return read<Doctor[]>('doctors', []).map(doctor => ({
      ...doctor,
      excludedRooms: doctor.excludedRooms ?? [],
      excludedWeekdays: doctor.excludedWeekdays ?? [],
    }));
  }

  static saveDoctors(doctors: Doctor[]): void {
    write('doctors', doctors);
  }

  // ----- Calendario corrente -----

  static loadSchedule(): MonthlySchedule | null {
    const stored = read<MonthlySchedule | null>('schedule', null);
    return stored ? normalizeSchedule(stored) : null;
  }

  static saveSchedule(schedule: MonthlySchedule): void {
    write('schedule', schedule);
  }

  static clearSchedule(): void {
    localStorage.removeItem(keyOf('schedule'));
  }

  // ----- Configurazione di generazione -----

  static loadGenerationConfig(year: number, month: number): GenerationConfig | null {
    const all = read<Record<string, GenerationConfig>>('generationConfig', {});
    const config = all[monthKey(year, month)];
    if (!config) return null;

    return {
      year,
      month,
      holidays: (config.holidays ?? []).map(holiday => ({
        date: holiday.date,
        disabledRooms: holiday.disabledRooms ?? [],
      })),
      doctorDateExclusions: config.doctorDateExclusions ?? {},
      doctorDateAvailability: config.doctorDateAvailability ?? {},
      doctorAvailabilityMode: config.doctorAvailabilityMode ?? {},
      prefilledAssignments: (config.prefilledAssignments ?? []).map(normalizeAssignment),
    };
  }

  static saveGenerationConfig(config: GenerationConfig): void {
    const all = read<Record<string, GenerationConfig>>('generationConfig', {});
    all[monthKey(config.year, config.month)] = config;
    write('generationConfig', all);
  }

  // ----- Versioni del calendario -----

  private static loadAllVersions(): Record<string, ScheduleVersion[]> {
    const all = read<Record<string, ScheduleVersion[]>>('versions', {});
    for (const [key, versions] of Object.entries(all)) {
      all[key] = versions.map(version => ({
        ...version,
        schedule: normalizeSchedule(version.schedule),
      }));
    }
    return all;
  }

  private static saveAllVersions(all: Record<string, ScheduleVersion[]>): void {
    write('versions', all);
  }

  static loadVersionsForMonth(year: number, month: number): ScheduleVersion[] {
    return this.loadAllVersions()[monthKey(year, month)] ?? [];
  }

  static createVersion(schedule: MonthlySchedule, name: string, setActive = true): ScheduleVersion {
    const all = this.loadAllVersions();
    const key = monthKey(schedule.year, schedule.month);
    const existing = all[key] ?? [];

    const version: ScheduleVersion = {
      id: generateId(),
      name,
      schedule,
      createdAt: new Date().toISOString(),
      isActive: setActive,
    };

    all[key] = setActive
      ? [...existing.map(other => ({ ...other, isActive: false })), version]
      : [...existing, version];

    this.saveAllVersions(all);
    if (setActive) this.saveSchedule(schedule);

    return version;
  }

  static updateVersion(year: number, month: number, versionId: string, changes: {
    schedule?: MonthlySchedule;
    name?: string;
  }): void {
    const all = this.loadAllVersions();
    const key = monthKey(year, month);
    if (!all[key]) return;

    all[key] = all[key].map(version =>
      version.id === versionId
        ? {
            ...version,
            schedule: changes.schedule ?? version.schedule,
            name: changes.name ?? version.name,
          }
        : version,
    );

    this.saveAllVersions(all);

    const updated = all[key].find(version => version.id === versionId);
    if (updated?.isActive) this.saveSchedule(updated.schedule);
  }

  static setActiveVersion(year: number, month: number, versionId: string): ScheduleVersion | null {
    const all = this.loadAllVersions();
    const key = monthKey(year, month);
    if (!all[key]) return null;

    all[key] = all[key].map(version => ({ ...version, isActive: version.id === versionId }));
    this.saveAllVersions(all);

    const active = all[key].find(version => version.isActive) ?? null;
    if (active) this.saveSchedule(active.schedule);
    return active;
  }

  static getActiveVersion(year: number, month: number): ScheduleVersion | null {
    return this.loadVersionsForMonth(year, month).find(version => version.isActive) ?? null;
  }

  static deleteVersion(year: number, month: number, versionId: string): void {
    const all = this.loadAllVersions();
    const key = monthKey(year, month);
    if (!all[key]) return;

    const deleted = all[key].find(version => version.id === versionId);
    all[key] = all[key].filter(version => version.id !== versionId);

    // Un mese non resta senza versione attiva: se ne restano altre, la prima
    // prende il posto di quella eliminata.
    if (deleted?.isActive && all[key].length > 0) {
      all[key][0] = { ...all[key][0], isActive: true };
      this.saveSchedule(all[key][0].schedule);
    } else if (all[key].length === 0) {
      this.clearSchedule();
    }

    this.saveAllVersions(all);
  }

  static getAllActiveVersions(): ScheduleVersion[] {
    return Object.values(this.loadAllVersions())
      .map(versions => versions.find(version => version.isActive))
      .filter((version): version is ScheduleVersion => version !== undefined)
      .sort((a, b) =>
        a.schedule.year - b.schedule.year || a.schedule.month - b.schedule.month);
  }

  /** Numero di versioni per ciascun mese dell'anno indicato (indice 0 = gennaio). */
  static countVersionsByMonth(year: number): number[] {
    const all = this.loadAllVersions();
    return Array.from({ length: 12 }, (_, index) => all[monthKey(year, index + 1)]?.length ?? 0);
  }

  static hasAnyVersion(): boolean {
    return Object.values(this.loadAllVersions()).some(versions => versions.length > 0);
  }

  // ----- Export -----

  static exportToCSV(
    schedule: MonthlySchedule,
    rooms: OperativeRoom[],
    doctors: Doctor[],
    shiftTypes: ShiftType[],
  ): string {
    const index = new ShiftTypeIndex(shiftTypes);
    const slotIndex = new RoomSlotIndex(rooms);
    const days = buildMonthDays(schedule.year, schedule.month);
    const lines: string[] = [];

    const byDate = new Map<string, Assignment[]>();
    for (const assignment of schedule.assignments) {
      const bucket = byDate.get(assignment.date);
      if (bucket) bucket.push(assignment);
      else byDate.set(assignment.date, [assignment]);
    }

    // --- Turni per sala ---
    // Una colonna per ogni combinazione sala + fascia effettivamente usata.
    const columns = rooms.flatMap(room => {
      const used = new Set(room.slots.map(slot => slot.shiftTypeId));
      return index.all
        .filter(shiftType => used.has(shiftType.id))
        .map(shiftType => ({ room, shiftType }));
    });

    lines.push(`Turni ${formatMonthLabel(schedule.year, schedule.month)}`);
    lines.push('');
    lines.push('Turni per sala');
    lines.push(csvRow([
      'Giorno',
      'Giorno sett.',
      ...columns.map(({ room, shiftType }) => `${room.name} ${shiftType.code}`),
    ]));

    for (const day of days) {
      const dayAssignments = byDate.get(day.date) ?? [];
      lines.push(csvRow([
        String(day.day),
        WEEKDAY_SHORT_BY_INDEX[day.weekdayIndex],
        ...columns.map(({ room, shiftType }) =>
          dayAssignments
            .filter(a => a.roomId === room.id && a.shiftTypeId === shiftType.id)
            .map(a => a.doctorName)
            .join(' / ')),
      ]));
    }

    // --- Turni per dottore ---
    lines.push('', 'Turni per dottore');
    lines.push(csvRow(['Giorno', 'Giorno sett.', ...doctors.map(doctor => doctor.name)]));

    for (const day of days) {
      const dayAssignments = byDate.get(day.date) ?? [];
      lines.push(csvRow([
        String(day.day),
        WEEKDAY_SHORT_BY_INDEX[day.weekdayIndex],
        ...doctors.map(doctor =>
          dayAssignments
            .filter(a => a.doctorId === doctor.id)
            .sort((a, b) => index.compare(a.shiftTypeId, b.shiftTypeId))
            .map(a => `${a.roomName} ${index.get(a.shiftTypeId).code}`)
            .join(' / ')),
      ]));
    }

    // --- Statistiche ---
    const stats = computeStats([schedule], { doctors, rooms, shiftTypes: index, slotIndex });
    const statColumns = buildStatColumns({ rooms, shiftTypes: index.all });
    const summary = summarizeColumns(stats, statColumns);

    lines.push('', 'Statistiche del mese');
    lines.push(csvRow(['Dottore', ...statColumns.map(column => column.label)]));

    for (const stat of stats) {
      lines.push(csvRow([
        stat.doctorName,
        ...statColumns.map(column => String(column.value(stat))),
      ]));
    }

    lines.push('');
    lines.push(csvRow(['TOTALE', ...statColumns.map(c => String(summary[c.key].total))]));
    lines.push(csvRow(['MEDIA', ...statColumns.map(c => summary[c.key].average.toFixed(1))]));
    lines.push(csvRow(['DEV.STD', ...statColumns.map(c => summary[c.key].stdDev.toFixed(2))]));

    return lines.join('\r\n');
  }

  static downloadCSV(
    schedule: MonthlySchedule,
    rooms: OperativeRoom[],
    doctors: Doctor[],
    shiftTypes: ShiftType[],
  ): void {
    const csv = this.exportToCSV(schedule, rooms, doctors, shiftTypes);
    // Il BOM serve a Excel per riconoscere UTF-8: senza, le lettere accentate
    // dei giorni della settimana arrivano illeggibili.
    const blob = new Blob([BYTE_ORDER_MARK + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `turni_${schedule.year}_${String(schedule.month).padStart(2, '0')}.csv`;
    // Firefox ignora i click su elementi non presenti nel documento.
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  /** Azzera i dati del solo servizio attivo. */
  static clearAll(): void {
    for (const scope of DATA_SCOPES) {
      localStorage.removeItem(keyOf(scope));
    }
  }
}

function csvRow(values: string[]): string {
  return values.map(escapeCSV).join(',');
}

function escapeCSV(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
