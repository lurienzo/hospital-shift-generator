import {
  OperativeRoom,
  Doctor,
  MonthlySchedule,
  Assignment,
  DoctorStats,
  Weekday,
  TimeSlot,
  TIME_SLOTS,
  TIME_SLOT_ORDER,
  TIME_SLOT_HOURS,
  GenerationConfig,
  HolidayConfig,
  DayGroup,
  WEEKDAYS,
} from '../models/types';
import { generateId } from '../utils/idGenerator';
import { parseDateLocal } from '../utils/constants';

interface SlotRequirement {
  date: string;
  roomId: string;
  roomName: string;
  timeSlot: TimeSlot;
  isWeekendOrHoliday: boolean;
  isCritical: boolean;
  requiresNextDayRest: boolean;
  isFullDayExclusive: boolean;
}

export interface GenerationProgress {
  current: number;
  total: number;
  percentage: number;
  validSchedules: number;
  bestCost: number | null;
}

export interface GenerationResult {
  schedule: MonthlySchedule;
  cost: number;
  stats: DoctorStats[];
  attempts: number;
  validFound: number;
}

export interface PriorDoctorStats {
  doctorId: string;
  totalShifts: number;
  totalHours: number;
  weekendShifts: number;
  criticalShifts: number;
  shiftsByRoom: Record<string, number>;
  shiftsByTimeSlot: Record<TimeSlot, number>;
}

export interface YearPriorStatsResult {
  stats: PriorDoctorStats[];
  monthsCovered: number[];
}

export class ScheduleGeneratorService {
  private rooms: OperativeRoom[];
  private doctors: Doctor[];
  private config: GenerationConfig;
  private priorStats: Map<string, PriorDoctorStats>;

  constructor(
    rooms: OperativeRoom[], 
    doctors: Doctor[], 
    config: GenerationConfig,
    priorStats?: PriorDoctorStats[]
  ) {
    this.rooms = rooms;
    this.doctors = doctors;
    this.config = config;
    this.priorStats = new Map();
    
    if (priorStats) {
      for (const stat of priorStats) {
        this.priorStats.set(stat.doctorId, stat);
      }
    }
  }

  generate(): MonthlySchedule {
    const requirements = this.buildRequirements();
    const assignments = this.assignDoctors(requirements, Math.random());

    return {
      year: this.config.year,
      month: this.config.month,
      holidays: this.config.holidays.map(h => h.date),
      assignments,
    };
  }

  async generateOptimized(
    attempts: number = 300,
    onProgress?: (progress: GenerationProgress) => void
  ): Promise<GenerationResult> {
    const requirements = this.buildRequirements();
    
    let bestSchedule: MonthlySchedule | null = null;
    let bestCost = Infinity;
    let bestStats: DoctorStats[] = [];
    let validSchedulesCount = 0;

    const batchSize = 100;
    const totalBatches = Math.ceil(attempts / batchSize);

    for (let batch = 0; batch < totalBatches; batch++) {
      const batchStart = batch * batchSize;
      const batchEnd = Math.min(batchStart + batchSize, attempts);

      for (let i = batchStart; i < batchEnd; i++) {
        const seed = Math.random();
        const assignments = this.assignDoctors(requirements, seed);

        const schedule: MonthlySchedule = {
          year: this.config.year,
          month: this.config.month,
          holidays: this.config.holidays.map(h => h.date),
          assignments,
        };

        const stats = ScheduleGeneratorService.calculateStats(schedule, this.doctors, this.rooms);
        const warnings = this.countWarnings(schedule);
        
        if (warnings === 0) {
          validSchedulesCount++;
          const cost = this.calculateCost(stats);
          
          if (cost < bestCost) {
            bestCost = cost;
            bestSchedule = schedule;
            bestStats = stats;
          }
        }
      }

      if (onProgress) {
        onProgress({
          current: batchEnd,
          total: attempts,
          percentage: Math.round((batchEnd / attempts) * 100),
          validSchedules: validSchedulesCount,
          bestCost: bestCost === Infinity ? null : bestCost,
        });
      }

      await new Promise(resolve => setTimeout(resolve, 0));
    }

    if (!bestSchedule) {
      const seed = Math.random();
      const assignments = this.assignDoctors(requirements, seed);
      bestSchedule = {
        year: this.config.year,
        month: this.config.month,
        holidays: this.config.holidays.map(h => h.date),
        assignments,
      };
      bestStats = ScheduleGeneratorService.calculateStats(bestSchedule, this.doctors, this.rooms);
      bestCost = this.calculateCost(bestStats);
    }

    return {
      schedule: bestSchedule,
      cost: bestCost,
      stats: bestStats,
      attempts,
      validFound: validSchedulesCount,
    };
  }

  private countWarnings(schedule: MonthlySchedule): number {
    let warnings = 0;

    const restDays = new Map<string, Set<string>>();
    const exclusiveDays = new Map<string, Set<string>>();
    const doctorMap = new Map<string, Doctor>();

    for (const doctor of this.doctors) {
      restDays.set(doctor.id, new Set());
      exclusiveDays.set(doctor.id, new Set());
      doctorMap.set(doctor.id, doctor);
    }

    const sortedAssignments = [...schedule.assignments].sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return TIME_SLOT_ORDER[a.timeSlot] - TIME_SLOT_ORDER[b.timeSlot];
    });

    // Track assignments per doctor per date+timeSlot (same-slot double-booking)
    const doctorSlotKeys = new Set<string>();

    for (const assignment of sortedAssignments) {
      // Skip constraint checks for pre-filled (locked) assignments — they're intentional
      if (assignment.locked) {
        // Still track rest days / exclusive days from locked assignments
        const room = this.rooms.find(r => r.id === assignment.roomId);
        const slot = room?.slots.find(s => s.timeSlot === assignment.timeSlot);
        if (slot?.requiresNextDayRest) {
          const nextDay = parseDateLocal(assignment.date);
          nextDay.setDate(nextDay.getDate() + 1);
          const nextDayStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;
          restDays.get(assignment.doctorId)?.add(nextDayStr);
        }
        if (slot?.isFullDayExclusive) {
          exclusiveDays.get(assignment.doctorId)?.add(assignment.date);
        }
        continue;
      }

      const doctor = doctorMap.get(assignment.doctorId);

      // Excluded date
      if (this.isDoctorDateBlocked(assignment.doctorId, assignment.date)) {
        warnings++;
      }

      // Excluded room
      if (doctor?.excludedRooms.includes(assignment.roomId)) {
        warnings++;
      }

      // Excluded weekday
      if (doctor) {
        const date = parseDateLocal(assignment.date);
        const weekday = this.getWeekday(date);
        if (doctor.excludedWeekdays.includes(weekday)) {
          warnings++;
        }
      }

      // Same doctor assigned to same time slot twice on same day
      const slotKey = `${assignment.doctorId}-${assignment.date}-${assignment.timeSlot}`;
      if (doctorSlotKeys.has(slotKey)) {
        warnings++;
      }
      doctorSlotKeys.add(slotKey);

      // Rest day violation
      if (restDays.get(assignment.doctorId)?.has(assignment.date)) {
        warnings++;
      }

      const room = this.rooms.find(r => r.id === assignment.roomId);
      const slot = room?.slots.find(s => s.timeSlot === assignment.timeSlot);

      if (slot?.requiresNextDayRest) {
        const nextDay = parseDateLocal(assignment.date);
        nextDay.setDate(nextDay.getDate() + 1);
        const nextDayStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;
        restDays.get(assignment.doctorId)!.add(nextDayStr);
      }

      if (slot?.isFullDayExclusive) {
        if (exclusiveDays.get(assignment.doctorId)?.has(assignment.date)) {
          warnings++;
        }
        exclusiveDays.get(assignment.doctorId)!.add(assignment.date);
      }
    }

    // Check for understaffed slots
    const requirements = this.buildRequirements();
    for (const req of requirements) {
      const hasAssignment = schedule.assignments.some(
        a => a.date === req.date && a.roomId === req.roomId && a.timeSlot === req.timeSlot
      );
      if (!hasAssignment) {
        warnings++;
      }
    }

    return warnings;
  }

  private calculateCost(stats: DoctorStats[]): number {
    if (stats.length === 0) return Infinity;

    // If we have prior stats, combine them with current stats for cost calculation
    const combinedStats = stats.map(s => {
      const priorStat = this.priorStats.get(s.doctorId);
      if (!priorStat) return s;
      
      // Combine current month stats with prior year stats
      const combinedShiftsByRoom: Record<string, number> = { ...s.shiftsByRoom };
      for (const [roomId, count] of Object.entries(priorStat.shiftsByRoom)) {
        combinedShiftsByRoom[roomId] = (combinedShiftsByRoom[roomId] || 0) + count;
      }
      
      const combinedShiftsByTimeSlot: Record<TimeSlot, number> = { ...s.shiftsByTimeSlot };
      for (const [timeSlot, count] of Object.entries(priorStat.shiftsByTimeSlot)) {
        combinedShiftsByTimeSlot[timeSlot as TimeSlot] = (combinedShiftsByTimeSlot[timeSlot as TimeSlot] || 0) + count;
      }
      
      return {
        ...s,
        totalShifts: s.totalShifts + priorStat.totalShifts,
        totalHours: s.totalHours + priorStat.totalHours,
        distinctDays: s.distinctDays + (priorStat.totalShifts > 0 ? priorStat.totalShifts : 0),
        weekendShifts: s.weekendShifts + priorStat.weekendShifts,
        criticalShifts: s.criticalShifts + priorStat.criticalShifts,
        shiftsByRoom: combinedShiftsByRoom,
        shiftsByTimeSlot: combinedShiftsByTimeSlot,
      };
    });

    const avgShifts = combinedStats.reduce((sum, s) => sum + s.totalShifts, 0) / combinedStats.length;
    const avgHours = combinedStats.reduce((sum, s) => sum + s.totalHours, 0) / combinedStats.length;
    const avgDays = combinedStats.reduce((sum, s) => sum + s.distinctDays, 0) / combinedStats.length;
    const avgWeekend = combinedStats.reduce((sum, s) => sum + s.weekendShifts, 0) / combinedStats.length;
    const avgCritical = combinedStats.reduce((sum, s) => sum + s.criticalShifts, 0) / combinedStats.length;

    const varianceShifts = combinedStats.reduce((sum, s) => sum + Math.pow(s.totalShifts - avgShifts, 2), 0) / combinedStats.length;
    const varianceHours = combinedStats.reduce((sum, s) => sum + Math.pow(s.totalHours - avgHours, 2), 0) / combinedStats.length;
    const varianceDays = combinedStats.reduce((sum, s) => sum + Math.pow(s.distinctDays - avgDays, 2), 0) / combinedStats.length;
    const varianceWeekend = combinedStats.reduce((sum, s) => sum + Math.pow(s.weekendShifts - avgWeekend, 2), 0) / combinedStats.length;
    const varianceCritical = combinedStats.reduce((sum, s) => sum + Math.pow(s.criticalShifts - avgCritical, 2), 0) / combinedStats.length;

    let variancePerRoom = 0;
    for (const room of this.rooms) {
      const avgRoom = combinedStats.reduce((sum, s) => sum + (s.shiftsByRoom[room.id] || 0), 0) / combinedStats.length;
      variancePerRoom += combinedStats.reduce((sum, s) => sum + Math.pow((s.shiftsByRoom[room.id] || 0) - avgRoom, 2), 0) / combinedStats.length;
    }

    const cost = 
      varianceShifts * 1.0 +
      varianceHours * 0.1 +
      varianceDays * 1.2 +
      varianceWeekend * 1.5 +
      varianceCritical * 1.8 +
      variancePerRoom * 0.8;

    return cost;
  }

  private buildRequirements(): SlotRequirement[] {
    const requirements: SlotRequirement[] = [];
    const daysInMonth = new Date(this.config.year, this.config.month, 0).getDate();

    const holidayMap = new Map<string, HolidayConfig>();
    for (const holiday of this.config.holidays) {
      holidayMap.set(holiday.date, holiday);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(this.config.year, this.config.month - 1, day);
      const weekday = this.getWeekday(date);
      const dateStr = `${this.config.year}-${String(this.config.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isWeekendOrHoliday = this.isWeekendOrHoliday(date, dateStr);
      const holidayConfig = holidayMap.get(dateStr);

      for (const room of this.rooms) {
        if (holidayConfig && (holidayConfig.disabledRooms || []).includes(room.id)) {
          continue;
        }

        for (const slot of room.slots) {
          if (slot.weekday === weekday) {
            requirements.push({
              date: dateStr,
              roomId: room.id,
              roomName: room.name,
              timeSlot: slot.timeSlot,
              isWeekendOrHoliday,
              isCritical: slot.isCritical,
              requiresNextDayRest: slot.requiresNextDayRest,
              isFullDayExclusive: slot.isFullDayExclusive,
            });
          }
        }
      }
    }

    return requirements;
  }

  private isWeekendOrHoliday(date: Date, dateStr: string): boolean {
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) return true;
    return this.config.holidays.some(h => h.date === dateStr);
  }

  private getWeekday(date: Date): Weekday {
    const dayIndex = date.getDay();
    const mapping: Weekday[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return mapping[dayIndex];
  }

  private isDoctorDateBlocked(doctorId: string, date: string): boolean {
    const mode = this.config.doctorAvailabilityMode?.[doctorId] || 'exclusion';
    if (mode === 'availability') {
      const available = this.config.doctorDateAvailability?.[doctorId] || [];
      return available.length > 0 && !available.includes(date);
    }
    const excluded = this.config.doctorDateExclusions?.[doctorId] || [];
    return excluded.includes(date);
  }

  private createSeededRandom(seed: number): () => number {
    let state = Math.max(1, Math.floor(seed * 2147483646) + 1);
    return () => {
      state = (state * 16807) % 2147483647;
      return (state - 1) / 2147483646;
    };
  }

  private assignDoctors(requirements: SlotRequirement[], seed: number = Math.random()): Assignment[] {
    const seededRandom = this.createSeededRandom(seed);
    // Seed with pre-filled (locked) assignments
    const lockedAssignments: Assignment[] = (this.config.prefilledAssignments || []).map(a => ({ ...a, locked: true }));
    const assignments: Assignment[] = [...lockedAssignments];
    const doctorShiftCounts: Map<string, number> = new Map();
    const doctorWeekendCounts: Map<string, number> = new Map();
    const doctorCriticalCounts: Map<string, number> = new Map();
    const doctorRoomCounts: Map<string, Map<string, number>> = new Map();
    const doctorTimeSlotCounts: Map<string, Map<TimeSlot, number>> = new Map();
    const doctorLastRoom: Map<string, Map<string, string>> = new Map();
    const doctorRestDays: Map<string, Set<string>> = new Map();
    const doctorExclusiveDays: Map<string, Set<string>> = new Map();

    // Initialize with prior stats if available (for year-based balancing)
    for (const doctor of this.doctors) {
      const priorStat = this.priorStats.get(doctor.id);

      doctorShiftCounts.set(doctor.id, priorStat?.totalShifts || 0);
      doctorWeekendCounts.set(doctor.id, priorStat?.weekendShifts || 0);
      doctorCriticalCounts.set(doctor.id, priorStat?.criticalShifts || 0);
      doctorRoomCounts.set(doctor.id, new Map());
      doctorTimeSlotCounts.set(doctor.id, new Map());
      doctorLastRoom.set(doctor.id, new Map());
      doctorRestDays.set(doctor.id, new Set());
      doctorExclusiveDays.set(doctor.id, new Set());

      for (const room of this.rooms) {
        const priorRoomCount = priorStat?.shiftsByRoom[room.id] || 0;
        doctorRoomCounts.get(doctor.id)!.set(room.id, priorRoomCount);
      }
      for (const timeSlot of TIME_SLOTS) {
        const priorTimeSlotCount = priorStat?.shiftsByTimeSlot[timeSlot] || 0;
        doctorTimeSlotCounts.get(doctor.id)!.set(timeSlot, priorTimeSlotCount);
      }
    }

    // Seed tracking maps with pre-filled assignment counts
    for (const pa of lockedAssignments) {
      if (!doctorShiftCounts.has(pa.doctorId)) continue;
      doctorShiftCounts.set(pa.doctorId, (doctorShiftCounts.get(pa.doctorId) || 0) + 1);

      const paDate = parseDateLocal(pa.date);
      if (this.isWeekendOrHoliday(paDate, pa.date)) {
        doctorWeekendCounts.set(pa.doctorId, (doctorWeekendCounts.get(pa.doctorId) || 0) + 1);
      }

      const room = this.rooms.find(r => r.id === pa.roomId);
      const slot = room?.slots.find(s => s.timeSlot === pa.timeSlot);
      if (slot?.isCritical) {
        doctorCriticalCounts.set(pa.doctorId, (doctorCriticalCounts.get(pa.doctorId) || 0) + 1);
      }

      doctorRoomCounts.get(pa.doctorId)?.set(pa.roomId, (doctorRoomCounts.get(pa.doctorId)?.get(pa.roomId) || 0) + 1);
      doctorTimeSlotCounts.get(pa.doctorId)?.set(pa.timeSlot, (doctorTimeSlotCounts.get(pa.doctorId)?.get(pa.timeSlot) || 0) + 1);
      doctorLastRoom.get(pa.doctorId)?.set(pa.date, pa.roomId);

      if (slot?.requiresNextDayRest) {
        const nextDay = parseDateLocal(pa.date);
        nextDay.setDate(nextDay.getDate() + 1);
        const nextDayStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;
        doctorRestDays.get(pa.doctorId)?.add(nextDayStr);
      }
      if (slot?.isFullDayExclusive) {
        doctorExclusiveDays.get(pa.doctorId)?.add(pa.date);
      }
    }

    const processedRequirementIds = new Set<string>();
    
    // First: assign day groups (highest priority - specific days must be worked together)
    this.assignDayGroupRequirements(
      requirements, assignments, doctorShiftCounts, doctorWeekendCounts, doctorCriticalCounts,
      doctorRoomCounts, doctorTimeSlotCounts, doctorLastRoom, doctorRestDays, doctorExclusiveDays,
      processedRequirementIds, seededRandom
    );

    // Second: assign consecutive shifts (N shifts in a row per doctor)
    this.assignConsecutiveShiftsRequirements(
      requirements, assignments, doctorShiftCounts, doctorWeekendCounts, doctorCriticalCounts,
      doctorRoomCounts, doctorTimeSlotCounts, doctorLastRoom, doctorRestDays, doctorExclusiveDays,
      processedRequirementIds, seededRandom
    );

    const remainingRequirements = requirements.filter(req => 
      !processedRequirementIds.has(`${req.date}-${req.roomId}-${req.timeSlot}`)
    );

    const criticalRequirements = remainingRequirements.filter(req => req.isCritical);
    const nonCriticalRequirements = remainingRequirements.filter(req => !req.isCritical);

    const groupByDate = (reqs: SlotRequirement[]) => {
      const grouped = new Map<string, SlotRequirement[]>();
      for (const req of reqs) {
        if (!grouped.has(req.date)) {
          grouped.set(req.date, []);
        }
        grouped.get(req.date)!.push(req);
      }
      return grouped;
    };

    const criticalByDate = groupByDate(criticalRequirements);
    const nonCriticalByDate = groupByDate(nonCriticalRequirements);

    const allDates = [...new Set([...criticalByDate.keys(), ...nonCriticalByDate.keys()])].sort();

    for (const date of allDates) {
      const dateCritical = criticalByDate.get(date) || [];
      const dateNonCritical = nonCriticalByDate.get(date) || [];

      const sortedCritical = [...dateCritical].sort((a, b) => {
        if (a.isWeekendOrHoliday !== b.isWeekendOrHoliday) {
          return a.isWeekendOrHoliday ? -1 : 1;
        }
        return TIME_SLOT_ORDER[a.timeSlot] - TIME_SLOT_ORDER[b.timeSlot];
      });

      const sortedNonCritical = [...dateNonCritical].sort((a, b) => {
        if (a.isWeekendOrHoliday !== b.isWeekendOrHoliday) {
          return a.isWeekendOrHoliday ? -1 : 1;
        }
        return TIME_SLOT_ORDER[a.timeSlot] - TIME_SLOT_ORDER[b.timeSlot];
      });

      for (const requirement of sortedCritical) {
        this.assignToRequirement(
          requirement, assignments, doctorShiftCounts, doctorWeekendCounts,
          doctorCriticalCounts, doctorRoomCounts, doctorTimeSlotCounts, doctorLastRoom, doctorRestDays, doctorExclusiveDays,
          seededRandom
        );
      }

      for (const requirement of sortedNonCritical) {
        this.assignToRequirement(
          requirement, assignments, doctorShiftCounts, doctorWeekendCounts,
          doctorCriticalCounts, doctorRoomCounts, doctorTimeSlotCounts, doctorLastRoom, doctorRestDays, doctorExclusiveDays,
          seededRandom
        );
      }
    }

    return assignments.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return TIME_SLOT_ORDER[a.timeSlot] - TIME_SLOT_ORDER[b.timeSlot];
    });
  }

  private assignDayGroupRequirements(
    requirements: SlotRequirement[],
    assignments: Assignment[],
    doctorShiftCounts: Map<string, number>,
    doctorWeekendCounts: Map<string, number>,
    doctorCriticalCounts: Map<string, number>,
    doctorRoomCounts: Map<string, Map<string, number>>,
    doctorTimeSlotCounts: Map<string, Map<TimeSlot, number>>,
    doctorLastRoom: Map<string, Map<string, string>>,
    doctorRestDays: Map<string, Set<string>>,
    doctorExclusiveDays: Map<string, Set<string>>,
    processedRequirementIds: Set<string>,
    seededRandom: () => number
  ): void {
    for (const room of this.rooms) {
      const dayGroups = room.dayGroups || [];
      if (dayGroups.length === 0) continue;

      for (const dayGroup of dayGroups) {
        if (dayGroup.days.length === 0) continue;

        const groupInstances = this.findDayGroupInstances(dayGroup, room.id, requirements);

        for (const instance of groupInstances) {
          const instanceRequirements = instance.requirements;
          if (instanceRequirements.length === 0) continue;

          // Filter out requirements already satisfied by pre-filled assignments
          const unresolvedReqs = instanceRequirements.filter(
            req => !assignments.some(a => a.locked && a.date === req.date && a.roomId === req.roomId && a.timeSlot === req.timeSlot)
          );
          if (unresolvedReqs.length === 0) {
            for (const req of instanceRequirements) {
              processedRequirementIds.add(`${req.date}-${req.roomId}-${req.timeSlot}`);
            }
            continue;
          }

          const doctor = this.findBestDoctorForDayGroup(
            unresolvedReqs, assignments, doctorShiftCounts, doctorWeekendCounts,
            doctorCriticalCounts, doctorRoomCounts, doctorRestDays, doctorExclusiveDays,
            seededRandom
          );

          if (!doctor) continue;

          for (const req of unresolvedReqs) {
            assignments.push({
              id: generateId(),
              date: req.date,
              roomId: req.roomId,
              roomName: req.roomName,
              timeSlot: req.timeSlot,
              doctorId: doctor.id,
              doctorName: doctor.name,
            });

            doctorShiftCounts.set(doctor.id, (doctorShiftCounts.get(doctor.id) || 0) + 1);
            if (req.isWeekendOrHoliday) {
              doctorWeekendCounts.set(doctor.id, (doctorWeekendCounts.get(doctor.id) || 0) + 1);
            }
            if (req.isCritical) {
              doctorCriticalCounts.set(doctor.id, (doctorCriticalCounts.get(doctor.id) || 0) + 1);
            }
            doctorRoomCounts.get(doctor.id)!.set(req.roomId, (doctorRoomCounts.get(doctor.id)!.get(req.roomId) || 0) + 1);
            doctorTimeSlotCounts.get(doctor.id)!.set(req.timeSlot, (doctorTimeSlotCounts.get(doctor.id)!.get(req.timeSlot) || 0) + 1);
            doctorLastRoom.get(doctor.id)!.set(req.date, req.roomId);
            if (req.requiresNextDayRest) {
              const nextDay = parseDateLocal(req.date);
              nextDay.setDate(nextDay.getDate() + 1);
              const nextDayStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;
              doctorRestDays.get(doctor.id)!.add(nextDayStr);
            }
            if (req.isFullDayExclusive) {
              doctorExclusiveDays.get(doctor.id)!.add(req.date);
            }

            processedRequirementIds.add(`${req.date}-${req.roomId}-${req.timeSlot}`);
          }
        }
      }
    }
  }

  private findDayGroupInstances(
    dayGroup: DayGroup,
    roomId: string,
    requirements: SlotRequirement[]
  ): { startDate: string; requirements: SlotRequirement[] }[] {
    const roomRequirements = requirements.filter(r => r.roomId === roomId);
    const sortedGroupDays = [...dayGroup.days].sort((a, b) => 
      WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)
    );

    if (sortedGroupDays.length === 0) return [];

    const instances: { startDate: string; requirements: SlotRequirement[] }[] = [];
    const daysInMonth = new Date(this.config.year, this.config.month, 0).getDate();
    const processedDates = new Set<string>();

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(this.config.year, this.config.month - 1, day);
      const weekday = this.getWeekday(date);
      const dateStr = `${this.config.year}-${String(this.config.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      if (processedDates.has(dateStr)) continue;

      if (dayGroup.days.includes(weekday)) {
        const instanceDates: string[] = [];
        const tempDate = new Date(date);

        while (dayGroup.days.includes(this.getWeekday(tempDate))) {
          const tempDateStr = `${tempDate.getFullYear()}-${String(tempDate.getMonth() + 1).padStart(2, '0')}-${String(tempDate.getDate()).padStart(2, '0')}`;
          
          if (tempDate.getMonth() + 1 !== this.config.month) break;
          
          instanceDates.push(tempDateStr);
          processedDates.add(tempDateStr);
          tempDate.setDate(tempDate.getDate() + 1);
        }

        const instanceReqs = roomRequirements.filter(r => instanceDates.includes(r.date));
        if (instanceReqs.length > 0) {
          instances.push({
            startDate: instanceDates[0],
            requirements: instanceReqs,
          });
        }
      }
    }

    return instances;
  }

  private findBestDoctorForDayGroup(
    groupRequirements: SlotRequirement[],
    assignments: Assignment[],
    doctorShiftCounts: Map<string, number>,
    _doctorWeekendCounts: Map<string, number>,
    _doctorCriticalCounts: Map<string, number>,
    doctorRoomCounts: Map<string, Map<string, number>>,
    doctorRestDays: Map<string, Set<string>>,
    doctorExclusiveDays: Map<string, Set<string>>,
    seededRandom: () => number
  ): Doctor | null {
    const groupDates = [...new Set(groupRequirements.map(r => r.date))];
    const roomId = groupRequirements[0]?.roomId;

    const eligibleDoctors = this.doctors.filter(doctor => {
      if (doctor.excludedRooms.includes(roomId)) return false;

      for (const req of groupRequirements) {
        const date = parseDateLocal(req.date);
        const weekday = this.getWeekday(date);
        if (doctor.excludedWeekdays.includes(weekday)) return false;

        if (this.isDoctorDateBlocked(doctor.id, req.date)) return false;

        const restDays = doctorRestDays.get(doctor.id)!;
        if (restDays.has(req.date)) return false;

        const exclusiveDays = doctorExclusiveDays.get(doctor.id)!;
        if (exclusiveDays.has(req.date)) return false;
      }

      for (const dateStr of groupDates) {
        const alreadyAssignedThisRoom = assignments.some(
          a => a.date === dateStr && a.roomId === roomId && a.doctorId === doctor.id
        );
        if (alreadyAssignedThisRoom) return false;
      }

      return true;
    });

    if (eligibleDoctors.length === 0) return null;

    const randomFactors = new Map<string, number>();
    for (const doctor of eligibleDoctors) {
      randomFactors.set(doctor.id, seededRandom());
    }

    const sortedDoctors = [...eligibleDoctors].sort((a, b) => {
      const aShifts = doctorShiftCounts.get(a.id) || 0;
      const bShifts = doctorShiftCounts.get(b.id) || 0;
      if (aShifts !== bShifts) return aShifts - bShifts;

      const aRoomCount = doctorRoomCounts.get(a.id)!.get(roomId) || 0;
      const bRoomCount = doctorRoomCounts.get(b.id)!.get(roomId) || 0;
      if (aRoomCount !== bRoomCount) return aRoomCount - bRoomCount;

      return (randomFactors.get(a.id) || 0) - (randomFactors.get(b.id) || 0);
    });

    return sortedDoctors[0] || null;
  }

  private assignConsecutiveShiftsRequirements(
    requirements: SlotRequirement[],
    assignments: Assignment[],
    doctorShiftCounts: Map<string, number>,
    doctorWeekendCounts: Map<string, number>,
    doctorCriticalCounts: Map<string, number>,
    doctorRoomCounts: Map<string, Map<string, number>>,
    doctorTimeSlotCounts: Map<string, Map<TimeSlot, number>>,
    doctorLastRoom: Map<string, Map<string, string>>,
    doctorRestDays: Map<string, Set<string>>,
    doctorExclusiveDays: Map<string, Set<string>>,
    processedRequirementIds: Set<string>,
    seededRandom: () => number
  ): void {
    for (const room of this.rooms) {
      const consecutiveShifts = room.consecutiveShifts;
      if (!consecutiveShifts || consecutiveShifts <= 0) continue;
      // Skip if room has day groups (they take precedence and are mutually exclusive)
      if ((room.dayGroups || []).length > 0) continue;

      // Get all requirements for this room, sorted chronologically
      const roomRequirements = requirements.filter(r => r.roomId === room.id);
      if (roomRequirements.length === 0) continue;

      const sortedRequirements = [...roomRequirements].sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        return TIME_SLOT_ORDER[a.timeSlot] - TIME_SLOT_ORDER[b.timeSlot];
      });

      // Filter out requirements already satisfied by pre-filled assignments
      const expandedSlots: { req: SlotRequirement; slotIndex: number }[] = [];
      for (const req of sortedRequirements) {
        const hasLocked = assignments.some(
          a => a.locked && a.date === req.date && a.roomId === req.roomId && a.timeSlot === req.timeSlot
        );
        if (!hasLocked) {
          expandedSlots.push({ req, slotIndex: 0 });
        }
      }

      // Group expanded slots into blocks of consecutiveShifts
      for (let blockStart = 0; blockStart < expandedSlots.length; blockStart += consecutiveShifts) {
        const blockSlots = expandedSlots.slice(blockStart, blockStart + consecutiveShifts);
        if (blockSlots.length === 0) continue;

        // Find best doctor for this block
        const doctor = this.findBestDoctorForConsecutiveBlock(
          blockSlots.map(s => s.req),
          assignments,
          doctorShiftCounts,
          doctorWeekendCounts,
          doctorCriticalCounts,
          doctorRoomCounts,
          doctorRestDays,
          doctorExclusiveDays,
          seededRandom
        );

        if (!doctor) continue;

        // Assign doctor to all slots in this block
        for (const { req } of blockSlots) {
          // Check if already assigned (same doctor to same slot)
          const alreadyAssigned = assignments.some(
            a => a.date === req.date && a.roomId === req.roomId &&
                 a.timeSlot === req.timeSlot && a.doctorId === doctor.id
          );
          
          if (alreadyAssigned) continue;

          assignments.push({
            id: generateId(),
            date: req.date,
            roomId: req.roomId,
            roomName: req.roomName,
            timeSlot: req.timeSlot,
            doctorId: doctor.id,
            doctorName: doctor.name,
          });

          doctorShiftCounts.set(doctor.id, (doctorShiftCounts.get(doctor.id) || 0) + 1);
          if (req.isWeekendOrHoliday) {
            doctorWeekendCounts.set(doctor.id, (doctorWeekendCounts.get(doctor.id) || 0) + 1);
          }
          if (req.isCritical) {
            doctorCriticalCounts.set(doctor.id, (doctorCriticalCounts.get(doctor.id) || 0) + 1);
          }
          doctorRoomCounts.get(doctor.id)!.set(req.roomId, (doctorRoomCounts.get(doctor.id)!.get(req.roomId) || 0) + 1);
          doctorTimeSlotCounts.get(doctor.id)!.set(req.timeSlot, (doctorTimeSlotCounts.get(doctor.id)!.get(req.timeSlot) || 0) + 1);
          doctorLastRoom.get(doctor.id)!.set(req.date, req.roomId);
          if (req.requiresNextDayRest) {
            const nextDay = parseDateLocal(req.date);
            nextDay.setDate(nextDay.getDate() + 1);
            const nextDayStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;
            doctorRestDays.get(doctor.id)!.add(nextDayStr);
          }
          if (req.isFullDayExclusive) {
            doctorExclusiveDays.get(doctor.id)!.add(req.date);
          }

          processedRequirementIds.add(`${req.date}-${req.roomId}-${req.timeSlot}`);
        }
      }
    }
  }

  private findBestDoctorForConsecutiveBlock(
    blockRequirements: SlotRequirement[],
    assignments: Assignment[],
    doctorShiftCounts: Map<string, number>,
    _doctorWeekendCounts: Map<string, number>,
    _doctorCriticalCounts: Map<string, number>,
    doctorRoomCounts: Map<string, Map<string, number>>,
    doctorRestDays: Map<string, Set<string>>,
    doctorExclusiveDays: Map<string, Set<string>>,
    seededRandom: () => number
  ): Doctor | null {
    const roomId = blockRequirements[0]?.roomId;

    const eligibleDoctors = this.doctors.filter(doctor => {
      if (doctor.excludedRooms.includes(roomId)) return false;

      for (const req of blockRequirements) {
        const date = parseDateLocal(req.date);
        const weekday = this.getWeekday(date);
        if (doctor.excludedWeekdays.includes(weekday)) return false;

        if (this.isDoctorDateBlocked(doctor.id, req.date)) return false;

        const restDays = doctorRestDays.get(doctor.id)!;
        if (restDays.has(req.date)) return false;

        const exclusiveDays = doctorExclusiveDays.get(doctor.id)!;
        if (exclusiveDays.has(req.date)) return false;

        // Check if already assigned to same time slot on same day
        const alreadyAssignedSameSlot = assignments.some(
          a => a.date === req.date && a.timeSlot === req.timeSlot && a.doctorId === doctor.id
        );
        if (alreadyAssignedSameSlot) return false;

        // Check full day exclusive constraint
        if (req.isFullDayExclusive) {
          const hasOtherShiftsSameDay = assignments.some(
            a => a.date === req.date && a.doctorId === doctor.id
          );
          if (hasOtherShiftsSameDay) return false;
        }
      }

      return true;
    });

    if (eligibleDoctors.length === 0) return null;

    // Add random factor for variation
    const randomFactors = new Map<string, number>();
    for (const doctor of eligibleDoctors) {
      randomFactors.set(doctor.id, seededRandom());
    }

    const sortedDoctors = [...eligibleDoctors].sort((a, b) => {
      const aShifts = doctorShiftCounts.get(a.id) || 0;
      const bShifts = doctorShiftCounts.get(b.id) || 0;
      if (aShifts !== bShifts) return aShifts - bShifts;

      const aRoomCount = doctorRoomCounts.get(a.id)!.get(roomId) || 0;
      const bRoomCount = doctorRoomCounts.get(b.id)!.get(roomId) || 0;
      if (aRoomCount !== bRoomCount) return aRoomCount - bRoomCount;

      return (randomFactors.get(a.id) || 0) - (randomFactors.get(b.id) || 0);
    });

    return sortedDoctors[0] || null;
  }

  private assignToRequirement(
    requirement: SlotRequirement,
    assignments: Assignment[],
    doctorShiftCounts: Map<string, number>,
    doctorWeekendCounts: Map<string, number>,
    doctorCriticalCounts: Map<string, number>,
    doctorRoomCounts: Map<string, Map<string, number>>,
    doctorTimeSlotCounts: Map<string, Map<TimeSlot, number>>,
    doctorLastRoom: Map<string, Map<string, string>>,
    doctorRestDays: Map<string, Set<string>>,
    doctorExclusiveDays: Map<string, Set<string>>,
    seededRandom: () => number
  ): void {
    const date = parseDateLocal(requirement.date);
    const weekday = this.getWeekday(date);

    const eligibleDoctors = this.doctors.filter(doctor => {
      if (doctor.excludedRooms.includes(requirement.roomId)) return false;
      if (doctor.excludedWeekdays.includes(weekday)) return false;

      if (this.isDoctorDateBlocked(doctor.id, requirement.date)) return false;

      const restDays = doctorRestDays.get(doctor.id)!;
      if (restDays.has(requirement.date)) return false;

      const exclusiveDays = doctorExclusiveDays.get(doctor.id)!;
      if (exclusiveDays.has(requirement.date)) return false;

      const alreadyAssignedSameSlot = assignments.some(
        assignment => assignment.date === requirement.date &&
          assignment.doctorId === doctor.id &&
          assignment.timeSlot === requirement.timeSlot
      );
      if (alreadyAssignedSameSlot) return false;

      if (requirement.isFullDayExclusive) {
        const hasOtherShiftsSameDay = assignments.some(
          assignment => assignment.date === requirement.date && assignment.doctorId === doctor.id
        );
        if (hasOtherShiftsSameDay) return false;
      }

      return true;
    });

    const randomFactors = new Map<string, number>();
    for (const doctor of eligibleDoctors) {
      randomFactors.set(doctor.id, seededRandom());
    }

    const sortedDoctors = [...eligibleDoctors].sort((a, b) => {
      if (requirement.isCritical) {
        const aCritical = doctorCriticalCounts.get(a.id) || 0;
        const bCritical = doctorCriticalCounts.get(b.id) || 0;
        if (aCritical !== bCritical) return aCritical - bCritical;
      }

      if (requirement.isWeekendOrHoliday) {
        const aWeekends = doctorWeekendCounts.get(a.id) || 0;
        const bWeekends = doctorWeekendCounts.get(b.id) || 0;
        if (aWeekends !== bWeekends) return aWeekends - bWeekends;
      }

      const aLastRoomOnDate = doctorLastRoom.get(a.id)?.get(requirement.date);
      const bLastRoomOnDate = doctorLastRoom.get(b.id)?.get(requirement.date);
      const aSameRoom = aLastRoomOnDate === requirement.roomId ? 1 : 0;
      const bSameRoom = bLastRoomOnDate === requirement.roomId ? 1 : 0;
      if (aSameRoom !== bSameRoom) return bSameRoom - aSameRoom;

      const aShifts = doctorShiftCounts.get(a.id) || 0;
      const bShifts = doctorShiftCounts.get(b.id) || 0;
      if (aShifts !== bShifts) return aShifts - bShifts;

      const aRoomCount = doctorRoomCounts.get(a.id)!.get(requirement.roomId) || 0;
      const bRoomCount = doctorRoomCounts.get(b.id)!.get(requirement.roomId) || 0;
      if (aRoomCount !== bRoomCount) return aRoomCount - bRoomCount;

      const aTimeSlotCount = doctorTimeSlotCounts.get(a.id)!.get(requirement.timeSlot) || 0;
      const bTimeSlotCount = doctorTimeSlotCounts.get(b.id)!.get(requirement.timeSlot) || 0;
      if (aTimeSlotCount !== bTimeSlotCount) return aTimeSlotCount - bTimeSlotCount;

      return (randomFactors.get(a.id) || 0) - (randomFactors.get(b.id) || 0);
    });

    // Skip if already satisfied by a pre-filled assignment
    const hasLocked = assignments.some(
      a => a.locked && a.date === requirement.date && a.roomId === requirement.roomId && a.timeSlot === requirement.timeSlot
    );
    if (hasLocked || sortedDoctors.length === 0) return;

    const doctor = sortedDoctors[0];
    assignments.push({
      id: generateId(),
      date: requirement.date,
      roomId: requirement.roomId,
      roomName: requirement.roomName,
      timeSlot: requirement.timeSlot,
      doctorId: doctor.id,
      doctorName: doctor.name,
    });

    doctorShiftCounts.set(doctor.id, (doctorShiftCounts.get(doctor.id) || 0) + 1);

    if (requirement.isWeekendOrHoliday) {
      doctorWeekendCounts.set(doctor.id, (doctorWeekendCounts.get(doctor.id) || 0) + 1);
    }

    if (requirement.isCritical) {
      doctorCriticalCounts.set(doctor.id, (doctorCriticalCounts.get(doctor.id) || 0) + 1);
    }

    const roomCounts = doctorRoomCounts.get(doctor.id)!;
    roomCounts.set(requirement.roomId, (roomCounts.get(requirement.roomId) || 0) + 1);

    const timeSlotCounts = doctorTimeSlotCounts.get(doctor.id)!;
    timeSlotCounts.set(requirement.timeSlot, (timeSlotCounts.get(requirement.timeSlot) || 0) + 1);

    doctorLastRoom.get(doctor.id)!.set(requirement.date, requirement.roomId);

    if (requirement.requiresNextDayRest) {
      const nextDay = parseDateLocal(requirement.date);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;
      doctorRestDays.get(doctor.id)!.add(nextDayStr);
    }

    if (requirement.isFullDayExclusive) {
      doctorExclusiveDays.get(doctor.id)!.add(requirement.date);
    }
  }

  static calculateStats(schedule: MonthlySchedule, doctors: Doctor[], rooms: OperativeRoom[]): DoctorStats[] {
    const criticalSlots = new Set<string>();
    for (const room of rooms) {
      for (const slot of room.slots) {
        if (slot.isCritical) {
          criticalSlots.add(`${room.id}-${slot.timeSlot}`);
        }
      }
    }

    return doctors.map(doctor => {
      const doctorAssignments = schedule.assignments.filter(a => a.doctorId === doctor.id);

      const shiftsByRoom: Record<string, number> = {};
      for (const room of rooms) {
        shiftsByRoom[room.id] = doctorAssignments.filter(a => a.roomId === room.id).length;
      }

      const shiftsByTimeSlot: Record<TimeSlot, number> = {
        '08:00-14:00': doctorAssignments.filter(a => a.timeSlot === '08:00-14:00').length,
        '14:00-20:00': doctorAssignments.filter(a => a.timeSlot === '14:00-20:00').length,
        '20:00-08:00': doctorAssignments.filter(a => a.timeSlot === '20:00-08:00').length,
      };

      const weekendShifts = doctorAssignments.filter(a => {
        const date = parseDateLocal(a.date);
        const dayOfWeek = date.getDay();
        return dayOfWeek === 0 || dayOfWeek === 6 || schedule.holidays.includes(a.date);
      }).length;

      const criticalShifts = doctorAssignments.filter(a => {
        return criticalSlots.has(`${a.roomId}-${a.timeSlot}`);
      }).length;

      const totalHours = doctorAssignments.reduce((sum, a) => {
        return sum + TIME_SLOT_HOURS[a.timeSlot];
      }, 0);

      const distinctDays = new Set(doctorAssignments.map(a => a.date)).size;

      return {
        doctorId: doctor.id,
        doctorName: doctor.name,
        doctorColor: doctor.color,
        totalShifts: doctorAssignments.length,
        totalHours,
        distinctDays,
        weekendShifts,
        criticalShifts,
        shiftsByRoom,
        shiftsByTimeSlot,
      };
    });
  }

  /**
   * Calculate aggregated stats from prior months of the same year.
   * Used to balance new month generation based on year-to-date statistics.
   */
  static calculatePriorYearStats(
    year: number,
    currentMonth: number,
    doctors: Doctor[],
    rooms: OperativeRoom[],
    getActiveScheduleForMonth: (year: number, month: number) => MonthlySchedule | null
  ): YearPriorStatsResult {
    const monthsCovered: number[] = [];
    
    // Initialize aggregated stats for each doctor
    const aggregatedStats = new Map<string, PriorDoctorStats>();
    for (const doctor of doctors) {
      const shiftsByRoom: Record<string, number> = {};
      for (const room of rooms) {
        shiftsByRoom[room.id] = 0;
      }
      
      aggregatedStats.set(doctor.id, {
        doctorId: doctor.id,
        totalShifts: 0,
        totalHours: 0,
        weekendShifts: 0,
        criticalShifts: 0,
        shiftsByRoom,
        shiftsByTimeSlot: {
          '08:00-14:00': 0,
          '14:00-20:00': 0,
          '20:00-08:00': 0,
        },
      });
    }

    // Build set of critical slots
    const criticalSlots = new Set<string>();
    for (const room of rooms) {
      for (const slot of room.slots) {
        if (slot.isCritical) {
          criticalSlots.add(`${room.id}-${slot.timeSlot}`);
        }
      }
    }

    // Aggregate stats from months 1 to currentMonth-1 of the same year
    for (let month = 1; month < currentMonth; month++) {
      const schedule = getActiveScheduleForMonth(year, month);
      if (!schedule) continue;

      monthsCovered.push(month);

      for (const assignment of schedule.assignments) {
        const stats = aggregatedStats.get(assignment.doctorId);
        if (!stats) continue;

        stats.totalShifts++;
        stats.totalHours += TIME_SLOT_HOURS[assignment.timeSlot];

        // Weekend/holiday shifts
        const date = parseDateLocal(assignment.date);
        if (date.getDay() === 0 || date.getDay() === 6 || schedule.holidays.includes(assignment.date)) {
          stats.weekendShifts++;
        }

        // Critical shifts
        if (criticalSlots.has(`${assignment.roomId}-${assignment.timeSlot}`)) {
          stats.criticalShifts++;
        }

        // By room
        if (stats.shiftsByRoom[assignment.roomId] !== undefined) {
          stats.shiftsByRoom[assignment.roomId]++;
        }

        // By time slot
        stats.shiftsByTimeSlot[assignment.timeSlot]++;
      }
    }

    return {
      stats: Array.from(aggregatedStats.values()),
      monthsCovered,
    };
  }
}
