import { OperativeRoom, Doctor, MonthlySchedule, HolidayConfig } from '../models/types';

const STORAGE_KEYS = {
  ROOMS: 'hospital_shift_rooms',
  DOCTORS: 'hospital_shift_doctors',
  SCHEDULE: 'hospital_shift_schedule',
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

  static exportToCSV(schedule: MonthlySchedule, rooms: OperativeRoom[]): string {
    const headers = ['Data', 'Giorno', ...rooms.map(room => room.name)];
    const rows: string[][] = [];

    const daysInMonth = new Date(schedule.year, schedule.month, 0).getDate();
    const weekdayNames = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(schedule.year, schedule.month - 1, day);
      const dateStr = `${day}/${schedule.month}/${schedule.year}`;
      const weekdayName = weekdayNames[date.getDay()];

      const roomAssignments = rooms.map(room => {
        const dayAssignments = schedule.assignments.filter(
          assignment => assignment.date === `${schedule.year}-${String(schedule.month).padStart(2, '0')}-${String(day).padStart(2, '0')}` &&
            assignment.roomId === room.id
        );
        return dayAssignments.map(assignment => `${assignment.doctorName} (${assignment.timeSlot})`).join(', ');
      });

      rows.push([dateStr, weekdayName, ...roomAssignments]);
    }

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
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
    localStorage.removeItem(STORAGE_KEYS.GENERATION_CONFIG);
  }
}
