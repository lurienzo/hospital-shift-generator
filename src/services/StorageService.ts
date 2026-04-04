import { OperativeRoom, Doctor, MonthlySchedule, HolidayConfig, ScheduleVersion, getMonthKey, DoctorDateMode } from '../models/types';
import { generateId } from '../utils/idGenerator';
import { parseDateLocal } from '../utils/constants';

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
  doctorDateAvailability: Record<string, string[]>;
  doctorAvailabilityMode: Record<string, DoctorDateMode>;
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
    const config = allConfigs[key];
    if (!config) return null;
    // Backfill fields for backward compatibility with older saved configs
    config.doctorDateAvailability = config.doctorDateAvailability || {};
    config.doctorAvailabilityMode = config.doctorAvailabilityMode || {};
    return config;
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

  static exportToCSV(schedule: MonthlySchedule, rooms: OperativeRoom[], doctors?: Doctor[]): string {
    const weekdayNames = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
    const daysInMonth = new Date(schedule.year, schedule.month, 0).getDate();
    
    // Escape any values with commas or quotes for proper CSV format
    const escapeCSV = (value: string): string => {
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };

    // ========== SECTION 1: BY ROOM ==========
    
    // Build column definitions: each column is a room + time slot combination
    interface ColumnDef {
      roomId: string;
      roomName: string;
      timeSlot: string;
      label: string;
    }
    
    const columns: ColumnDef[] = [];
    
    // First add night shifts
    for (const room of rooms) {
      const hasNight = room.slots.some(s => s.timeSlot === '20:00-08:00');
      if (hasNight) {
        columns.push({
          roomId: room.id,
          roomName: room.name,
          timeSlot: '20:00-08:00',
          label: `${room.name} N`,
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
    
    // Build headers for room view
    const roomHeaders = ['Giorno', 'Giorno Sett.', ...columns.map(c => c.label)];
    const roomRows: string[][] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(schedule.year, schedule.month - 1, day);
      const dateStr = `${schedule.year}-${String(schedule.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const weekdayName = weekdayNames[date.getDay()];

      const columnValues = columns.map(col => {
        const assignments = schedule.assignments.filter(
          a => a.date === dateStr && a.roomId === col.roomId && a.timeSlot === col.timeSlot
        );
        return assignments.map(a => a.doctorName.replace(/,/g, ';')).join(' / ');
      });

      roomRows.push([String(day), weekdayName, ...columnValues]);
    }

    const roomSection = [
      '=== TURNI PER SALA ===',
      roomHeaders.map(escapeCSV).join(','), 
      ...roomRows.map(row => row.map(escapeCSV).join(','))
    ];

    // ========== SECTION 2: BY DOCTOR ==========
    
    // Get unique doctors from assignments if not provided
    const doctorList = doctors || (() => {
      const uniqueDoctors = new Map<string, { id: string; name: string }>();
      schedule.assignments.forEach(a => {
        if (!uniqueDoctors.has(a.doctorId)) {
          uniqueDoctors.set(a.doctorId, { id: a.doctorId, name: a.doctorName });
        }
      });
      return Array.from(uniqueDoctors.values()).sort((a, b) => a.name.localeCompare(b.name));
    })();

    // Build headers for doctor view
    const doctorHeaders = ['Giorno', 'Giorno Sett.', ...doctorList.map(d => d.name)];
    const doctorRows: string[][] = [];

    // Helper to format assignment for doctor view
    const formatAssignment = (roomId: string, timeSlot: string): string => {
      const room = rooms.find(r => r.id === roomId);
      const roomAbbr = room ? room.name.substring(0, 4) : roomId.substring(0, 4);
      const slotAbbr = timeSlot === '08:00-14:00' ? 'M' : timeSlot === '14:00-20:00' ? 'P' : 'N';
      return `${roomAbbr} ${slotAbbr}`;
    };

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(schedule.year, schedule.month - 1, day);
      const dateStr = `${schedule.year}-${String(schedule.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const weekdayName = weekdayNames[date.getDay()];

      const doctorValues = doctorList.map(doctor => {
        const doctorAssignments = schedule.assignments.filter(
          a => a.date === dateStr && a.doctorId === doctor.id
        );
        // Sort by time slot order
        doctorAssignments.sort((a, b) => {
          const order: Record<string, number> = { '08:00-14:00': 0, '14:00-20:00': 1, '20:00-08:00': 2 };
          return (order[a.timeSlot] || 0) - (order[b.timeSlot] || 0);
        });
        return doctorAssignments.map(a => formatAssignment(a.roomId, a.timeSlot)).join(' / ');
      });

      doctorRows.push([String(day), weekdayName, ...doctorValues]);
    }

    const doctorSection = [
      '',
      '',
      '=== TURNI PER DOTTORE ===',
      doctorHeaders.map(escapeCSV).join(','), 
      ...doctorRows.map(row => row.map(escapeCSV).join(','))
    ];

    // ========== SECTION 3: STATISTICS ==========
    
    const TIME_SLOT_HOURS: Record<string, number> = {
      '08:00-14:00': 6,
      '14:00-20:00': 6,
      '20:00-08:00': 12,
    };

    // Build set of critical slots
    const criticalSlots = new Set<string>();
    for (const room of rooms) {
      for (const slot of room.slots) {
        if (slot.isCritical) {
          criticalSlots.add(`${room.id}-${slot.timeSlot}`);
        }
      }
    }

    // Calculate stats for each doctor
    interface DoctorStat {
      name: string;
      totalShifts: number;
      totalHours: number;
      distinctDays: number;
      weekendShifts: number;
      criticalShifts: number;
      morningShifts: number;
      afternoonShifts: number;
      nightShifts: number;
      shiftsByRoom: Record<string, number>;
    }

    const doctorStats: DoctorStat[] = doctorList.map(doctor => {
      const doctorAssignments = schedule.assignments.filter(a => a.doctorId === doctor.id);
      const daysWorked = new Set<string>();
      let weekendShifts = 0;
      let criticalShifts = 0;
      let morningShifts = 0;
      let afternoonShifts = 0;
      let nightShifts = 0;
      let totalHours = 0;
      const shiftsByRoom: Record<string, number> = {};

      // Initialize room counts
      for (const room of rooms) {
        shiftsByRoom[room.id] = 0;
      }

      for (const assignment of doctorAssignments) {
        daysWorked.add(assignment.date);
        totalHours += TIME_SLOT_HOURS[assignment.timeSlot] || 0;

        // Weekend check
        const date = parseDateLocal(assignment.date);
        if (date.getDay() === 0 || date.getDay() === 6) {
          weekendShifts++;
        }

        // Critical check
        if (criticalSlots.has(`${assignment.roomId}-${assignment.timeSlot}`)) {
          criticalShifts++;
        }

        // Time slot counts
        if (assignment.timeSlot === '08:00-14:00') morningShifts++;
        else if (assignment.timeSlot === '14:00-20:00') afternoonShifts++;
        else if (assignment.timeSlot === '20:00-08:00') nightShifts++;

        // Room counts
        if (shiftsByRoom[assignment.roomId] !== undefined) {
          shiftsByRoom[assignment.roomId]++;
        }
      }

      return {
        name: doctor.name,
        totalShifts: doctorAssignments.length,
        totalHours,
        distinctDays: daysWorked.size,
        weekendShifts,
        criticalShifts,
        morningShifts,
        afternoonShifts,
        nightShifts,
        shiftsByRoom,
      };
    });

    // Build stats headers
    const statsHeaders = [
      'Dottore',
      'Turni',
      'Ore',
      'Giorni',
      'Weekend',
      'Critici',
      'M',
      'P',
      'N',
      ...rooms.map(r => r.name),
    ];

    const statsRows = doctorStats.map(stat => [
      stat.name,
      String(stat.totalShifts),
      String(stat.totalHours),
      String(stat.distinctDays),
      String(stat.weekendShifts),
      String(stat.criticalShifts),
      String(stat.morningShifts),
      String(stat.afternoonShifts),
      String(stat.nightShifts),
      ...rooms.map(r => String(stat.shiftsByRoom[r.id] || 0)),
    ]);

    // Calculate totals row
    const totals = {
      shifts: doctorStats.reduce((sum, s) => sum + s.totalShifts, 0),
      hours: doctorStats.reduce((sum, s) => sum + s.totalHours, 0),
      days: doctorStats.reduce((sum, s) => sum + s.distinctDays, 0),
      weekend: doctorStats.reduce((sum, s) => sum + s.weekendShifts, 0),
      critical: doctorStats.reduce((sum, s) => sum + s.criticalShifts, 0),
      morning: doctorStats.reduce((sum, s) => sum + s.morningShifts, 0),
      afternoon: doctorStats.reduce((sum, s) => sum + s.afternoonShifts, 0),
      night: doctorStats.reduce((sum, s) => sum + s.nightShifts, 0),
      byRoom: rooms.map(r => doctorStats.reduce((sum, s) => sum + (s.shiftsByRoom[r.id] || 0), 0)),
    };

    const totalsRow = [
      'TOTALE',
      String(totals.shifts),
      String(totals.hours),
      String(totals.days),
      String(totals.weekend),
      String(totals.critical),
      String(totals.morning),
      String(totals.afternoon),
      String(totals.night),
      ...totals.byRoom.map(String),
    ];

    // Calculate averages row
    const numDoctors = doctorStats.length || 1;
    const averages = {
      shifts: totals.shifts / numDoctors,
      hours: totals.hours / numDoctors,
      days: totals.days / numDoctors,
      weekend: totals.weekend / numDoctors,
      critical: totals.critical / numDoctors,
      morning: totals.morning / numDoctors,
      afternoon: totals.afternoon / numDoctors,
      night: totals.night / numDoctors,
      byRoom: totals.byRoom.map(v => v / numDoctors),
    };

    const averagesRow = [
      'MEDIA',
      averages.shifts.toFixed(1),
      averages.hours.toFixed(1),
      averages.days.toFixed(1),
      averages.weekend.toFixed(1),
      averages.critical.toFixed(1),
      averages.morning.toFixed(1),
      averages.afternoon.toFixed(1),
      averages.night.toFixed(1),
      ...averages.byRoom.map(v => v.toFixed(1)),
    ];

    // Calculate standard deviation (varianza) row
    const calcStdDev = (values: number[], mean: number): number => {
      if (values.length === 0) return 0;
      const squareDiffs = values.map(v => Math.pow(v - mean, 2));
      return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
    };

    const stdDevRow = [
      'DEV.STD',
      calcStdDev(doctorStats.map(s => s.totalShifts), averages.shifts).toFixed(2),
      calcStdDev(doctorStats.map(s => s.totalHours), averages.hours).toFixed(2),
      calcStdDev(doctorStats.map(s => s.distinctDays), averages.days).toFixed(2),
      calcStdDev(doctorStats.map(s => s.weekendShifts), averages.weekend).toFixed(2),
      calcStdDev(doctorStats.map(s => s.criticalShifts), averages.critical).toFixed(2),
      calcStdDev(doctorStats.map(s => s.morningShifts), averages.morning).toFixed(2),
      calcStdDev(doctorStats.map(s => s.afternoonShifts), averages.afternoon).toFixed(2),
      calcStdDev(doctorStats.map(s => s.nightShifts), averages.night).toFixed(2),
      ...rooms.map((r, i) => 
        calcStdDev(doctorStats.map(s => s.shiftsByRoom[r.id] || 0), averages.byRoom[i]).toFixed(2)
      ),
    ];

    const statsSection = [
      '',
      '',
      '=== STATISTICHE MESE ===',
      statsHeaders.map(escapeCSV).join(','),
      ...statsRows.map(row => row.map(escapeCSV).join(',')),
      '',
      totalsRow.map(escapeCSV).join(','),
      averagesRow.map(escapeCSV).join(','),
      stdDevRow.map(escapeCSV).join(','),
    ];

    return [...roomSection, ...doctorSection, ...statsSection].join('\n');
  }

  static downloadCSV(schedule: MonthlySchedule, rooms: OperativeRoom[], doctors?: Doctor[]): void {
    const csv = this.exportToCSV(schedule, rooms, doctors);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `turni_${schedule.year}_${schedule.month}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  static clearAll(): void {
    localStorage.removeItem(STORAGE_KEYS.ROOMS);
    localStorage.removeItem(STORAGE_KEYS.DOCTORS);
    localStorage.removeItem(STORAGE_KEYS.SCHEDULE);
    localStorage.removeItem(STORAGE_KEYS.SCHEDULE_VERSIONS);
    localStorage.removeItem(STORAGE_KEYS.GENERATION_CONFIG);
  }
}
