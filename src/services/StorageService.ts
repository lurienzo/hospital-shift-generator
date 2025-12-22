import { OperativeRoom, Doctor, MonthlySchedule, HolidayConfig, ScheduleVersion, getMonthKey } from '../models/types';
import { generateId } from '../utils/idGenerator';

const STORAGE_KEYS = {
  ROOMS: 'hospital_shift_rooms',
  DOCTORS: 'hospital_shift_doctors',
  SCHEDULE: 'hospital_shift_schedule',
  SCHEDULE_VERSIONS: 'hospital_shift_schedule_versions',
  GENERATION_CONFIG: 'hospital_shift_generation_config',
};

export interface StoredGenerationConfig {
  year: number;
  month: number;
  holidays: HolidayConfig[];
  doctorDateExclusions: Record<string, string[]>;
}

export class StorageService {
  static saveRooms(rooms: OperativeRoom[]): void {
    localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(rooms));
  }

  static loadRooms(): OperativeRoom[] {
    const data = localStorage.getItem(STORAGE_KEYS.ROOMS);
    return data ? JSON.parse(data) : [];
  }

  static saveDoctors(doctors: Doctor[]): void {
    localStorage.setItem(STORAGE_KEYS.DOCTORS, JSON.stringify(doctors));
  }

  static loadDoctors(): Doctor[] {
    const data = localStorage.getItem(STORAGE_KEYS.DOCTORS);
    return data ? JSON.parse(data) : [];
  }

  static saveSchedule(schedule: MonthlySchedule): void {
    localStorage.setItem(STORAGE_KEYS.SCHEDULE, JSON.stringify(schedule));
  }

  static loadSchedule(): MonthlySchedule | null {
    const data = localStorage.getItem(STORAGE_KEYS.SCHEDULE);
    return data ? JSON.parse(data) : null;
  }

  static saveGenerationConfig(config: StoredGenerationConfig): void {
    const allConfigs = this.loadAllGenerationConfigs();
    const key = `${config.year}-${config.month}`;
    allConfigs[key] = config;
    localStorage.setItem(STORAGE_KEYS.GENERATION_CONFIG, JSON.stringify(allConfigs));
  }

  static loadGenerationConfig(year: number, month: number): StoredGenerationConfig | null {
    const allConfigs = this.loadAllGenerationConfigs();
    const key = `${year}-${month}`;
    return allConfigs[key] || null;
  }

  private static loadAllGenerationConfigs(): Record<string, StoredGenerationConfig> {
    const data = localStorage.getItem(STORAGE_KEYS.GENERATION_CONFIG);
    return data ? JSON.parse(data) : {};
  }

  // ========== Schedule Versions ==========

  static loadAllScheduleVersions(): Record<string, ScheduleVersion[]> {
    const data = localStorage.getItem(STORAGE_KEYS.SCHEDULE_VERSIONS);
    return data ? JSON.parse(data) : {};
  }

  private static saveAllScheduleVersions(versions: Record<string, ScheduleVersion[]>): void {
    localStorage.setItem(STORAGE_KEYS.SCHEDULE_VERSIONS, JSON.stringify(versions));
  }

  static loadScheduleVersionsForMonth(year: number, month: number): ScheduleVersion[] {
    const allVersions = this.loadAllScheduleVersions();
    const key = getMonthKey(year, month);
    return allVersions[key] || [];
  }

  static saveScheduleVersion(schedule: MonthlySchedule, name: string, setActive: boolean = true): ScheduleVersion {
    const allVersions = this.loadAllScheduleVersions();
    const key = getMonthKey(schedule.year, schedule.month);
    
    if (!allVersions[key]) {
      allVersions[key] = [];
    }

    // If setActive, deactivate all other versions for this month
    if (setActive) {
      allVersions[key] = allVersions[key].map(v => ({ ...v, isActive: false }));
    }

    const newVersion: ScheduleVersion = {
      id: generateId(),
      name,
      schedule,
      createdAt: new Date().toISOString(),
      isActive: setActive,
    };

    allVersions[key].push(newVersion);
    this.saveAllScheduleVersions(allVersions);

    // Also update the current schedule if this is active
    if (setActive) {
      this.saveSchedule(schedule);
    }

    return newVersion;
  }

  static setActiveVersion(year: number, month: number, versionId: string): ScheduleVersion | null {
    const allVersions = this.loadAllScheduleVersions();
    const key = getMonthKey(year, month);
    
    if (!allVersions[key]) return null;

    allVersions[key] = allVersions[key].map(v => ({ ...v, isActive: v.id === versionId }));

    this.saveAllScheduleVersions(allVersions);

    // Find and return the active version, update current schedule
    const activeVersion = allVersions[key].find(v => v.isActive);
    if (activeVersion) {
      this.saveSchedule(activeVersion.schedule);
    }

    return activeVersion || null;
  }

  static getActiveVersion(year: number, month: number): ScheduleVersion | null {
    const versions = this.loadScheduleVersionsForMonth(year, month);
    return versions.find(v => v.isActive) || null;
  }

  static deleteScheduleVersion(year: number, month: number, versionId: string): void {
    const allVersions = this.loadAllScheduleVersions();
    const key = getMonthKey(year, month);
    
    if (!allVersions[key]) return;

    const deletedVersion = allVersions[key].find(v => v.id === versionId);
    allVersions[key] = allVersions[key].filter(v => v.id !== versionId);

    // If we deleted the active version and there are others, activate the first one
    if (deletedVersion?.isActive && allVersions[key].length > 0) {
      allVersions[key][0].isActive = true;
      this.saveSchedule(allVersions[key][0].schedule);
    }

    this.saveAllScheduleVersions(allVersions);
  }

  static updateScheduleVersion(year: number, month: number, versionId: string, schedule: MonthlySchedule): void {
    const allVersions = this.loadAllScheduleVersions();
    const key = getMonthKey(year, month);
    
    if (!allVersions[key]) return;

    allVersions[key] = allVersions[key].map(v => {
      if (v.id !== versionId) return v;
      return { ...v, schedule };
    });

    this.saveAllScheduleVersions(allVersions);

    // Update current schedule if this is the active version
    const updatedVersion = allVersions[key].find(v => v.id === versionId);
    if (updatedVersion?.isActive) {
      this.saveSchedule(schedule);
    }
  }

  static renameScheduleVersion(year: number, month: number, versionId: string, newName: string): void {
    const allVersions = this.loadAllScheduleVersions();
    const key = getMonthKey(year, month);
    
    if (!allVersions[key]) return;

    allVersions[key] = allVersions[key].map(v => {
      if (v.id !== versionId) return v;
      return { ...v, name: newName };
    });

    this.saveAllScheduleVersions(allVersions);
  }

  static getAllActiveVersions(): ScheduleVersion[] {
    const allVersions = this.loadAllScheduleVersions();
    const activeVersions: ScheduleVersion[] = [];

    for (const monthKey of Object.keys(allVersions)) {
      const active = allVersions[monthKey].find(v => v.isActive);
      if (active) {
        activeVersions.push(active);
      }
    }

    // Sort by date
    return activeVersions.sort((a, b) => {
      const aKey = getMonthKey(a.schedule.year, a.schedule.month);
      const bKey = getMonthKey(b.schedule.year, b.schedule.month);
      return aKey.localeCompare(bKey);
    });
  }

  static getMonthsWithVersions(): { year: number; month: number; versionsCount: number; hasActive: boolean }[] {
    const allVersions = this.loadAllScheduleVersions();
    const months: { year: number; month: number; versionsCount: number; hasActive: boolean }[] = [];

    for (const [monthKey, versions] of Object.entries(allVersions)) {
      const [year, month] = monthKey.split('-').map(Number);
      months.push({
        year,
        month,
        versionsCount: versions.length,
        hasActive: versions.some(v => v.isActive),
      });
    }

    return months.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });
  }

  static exportToCSV(schedule: MonthlySchedule, rooms: OperativeRoom[]): string {
    const weekdayNames = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
    
    // Build column definitions: each column is a room + time slot combination
    interface ColumnDef {
      roomId: string;
      roomName: string;
      timeSlot: string;
      label: string;
    }
    
    const columns: ColumnDef[] = [];
    
    // First add night shifts (they're special, shown without room suffix usually)
    for (const room of rooms) {
      const hasNight = room.slots.some(s => s.timeSlot === '20:00-08:00');
      if (hasNight) {
        columns.push({
          roomId: room.id,
          roomName: room.name,
          timeSlot: '20:00-08:00',
          label: `${room.name} Notte`,
        });
      }
    }
    
    // Then add morning and afternoon for each room
    for (const room of rooms) {
      const hasMorning = room.slots.some(s => s.timeSlot === '08:00-14:00');
      const hasAfternoon = room.slots.some(s => s.timeSlot === '14:00-20:00');
      
      if (hasMorning) {
        columns.push({
          roomId: room.id,
          roomName: room.name,
          timeSlot: '08:00-14:00',
          label: `${room.name} M`,
        });
      }
      if (hasAfternoon) {
        columns.push({
          roomId: room.id,
          roomName: room.name,
          timeSlot: '14:00-20:00',
          label: `${room.name} P`,
        });
      }
    }
    
    // Build headers
    const headers = ['Giorno', 'Giorno Sett.', ...columns.map(c => c.label)];
    const rows: string[][] = [];

    const daysInMonth = new Date(schedule.year, schedule.month, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(schedule.year, schedule.month - 1, day);
      const dateStr = `${schedule.year}-${String(schedule.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const weekdayName = weekdayNames[date.getDay()];

      const columnValues = columns.map(col => {
        const assignment = schedule.assignments.find(
          a => a.date === dateStr && a.roomId === col.roomId && a.timeSlot === col.timeSlot
        );
        // Return just the doctor name, escape commas for CSV
        return assignment ? assignment.doctorName.replace(/,/g, ';') : '';
      });

      rows.push([String(day), weekdayName, ...columnValues]);
    }

    // Escape any values with commas or quotes for proper CSV format
    const escapeCSV = (value: string): string => {
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };

    return [
      headers.map(escapeCSV).join(','), 
      ...rows.map(row => row.map(escapeCSV).join(','))
    ].join('\n');
  }

  static downloadCSV(schedule: MonthlySchedule, rooms: OperativeRoom[]): void {
    const csv = this.exportToCSV(schedule, rooms);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `turni_${schedule.year}_${schedule.month}.csv`;
    link.click();
  }

  static clearAll(): void {
    localStorage.removeItem(STORAGE_KEYS.ROOMS);
    localStorage.removeItem(STORAGE_KEYS.DOCTORS);
    localStorage.removeItem(STORAGE_KEYS.SCHEDULE);
    localStorage.removeItem(STORAGE_KEYS.SCHEDULE_VERSIONS);
    localStorage.removeItem(STORAGE_KEYS.GENERATION_CONFIG);
  }
}
