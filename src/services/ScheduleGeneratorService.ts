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

interface SlotRequirement {
  date: string;
  roomId: string;
  roomName: string;
  timeSlot: TimeSlot;
  count: number;
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

export class ScheduleGeneratorService {
  private rooms: OperativeRoom[];
  private doctors: Doctor[];
  private config: GenerationConfig;

  constructor(rooms: OperativeRoom[], doctors: Doctor[], config: GenerationConfig) {
    this.rooms = rooms;
    this.doctors = doctors;
    this.config = config;
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
    attempts: number = 10000,
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

    for (const doctor of this.doctors) {
      restDays.set(doctor.id, new Set());
      exclusiveDays.set(doctor.id, new Set());
    }

    const sortedAssignments = [...schedule.assignments].sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return TIME_SLOT_ORDER[a.timeSlot] - TIME_SLOT_ORDER[b.timeSlot];
    });

    for (const assignment of sortedAssignments) {
      const doctorExclusions = this.config.doctorDateExclusions[assignment.doctorId] || [];
      if (doctorExclusions.includes(assignment.date)) {
        warnings++;
      }

      if (restDays.get(assignment.doctorId)?.has(assignment.date)) {
        warnings++;
      }

      const room = this.rooms.find(r => r.id === assignment.roomId);
      const slot = room?.slots.find(s => s.timeSlot === assignment.timeSlot);

      if (slot?.requiresNextDayRest) {
        const nextDay = new Date(assignment.date);
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

    return warnings;
  }

  private calculateCost(stats: DoctorStats[]): number {
    if (stats.length === 0) return Infinity;

    const avgShifts = stats.reduce((sum, s) => sum + s.totalShifts, 0) / stats.length;
    const avgHours = stats.reduce((sum, s) => sum + s.totalHours, 0) / stats.length;
    const avgDays = stats.reduce((sum, s) => sum + s.distinctDays, 0) / stats.length;
    const avgWeekend = stats.reduce((sum, s) => sum + s.weekendShifts, 0) / stats.length;
    const avgCritical = stats.reduce((sum, s) => sum + s.criticalShifts, 0) / stats.length;

    const varianceShifts = stats.reduce((sum, s) => sum + Math.pow(s.totalShifts - avgShifts, 2), 0) / stats.length;
    const varianceHours = stats.reduce((sum, s) => sum + Math.pow(s.totalHours - avgHours, 2), 0) / stats.length;
    const varianceDays = stats.reduce((sum, s) => sum + Math.pow(s.distinctDays - avgDays, 2), 0) / stats.length;
    const varianceWeekend = stats.reduce((sum, s) => sum + Math.pow(s.weekendShifts - avgWeekend, 2), 0) / stats.length;
    const varianceCritical = stats.reduce((sum, s) => sum + Math.pow(s.criticalShifts - avgCritical, 2), 0) / stats.length;

    let variancePerRoom = 0;
    for (const room of this.rooms) {
      const avgRoom = stats.reduce((sum, s) => sum + (s.shiftsByRoom[room.id] || 0), 0) / stats.length;
      variancePerRoom += stats.reduce((sum, s) => sum + Math.pow((s.shiftsByRoom[room.id] || 0) - avgRoom, 2), 0) / stats.length;
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
              count: slot.requiredDoctors,
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

  private createSeededRandom(seed: number): () => number {
    let state = seed * 2147483647;
    return () => {
      state = (state * 16807) % 2147483647;
      return (state - 1) / 2147483646;
    };
  }

  private assignDoctors(requirements: SlotRequirement[], seed: number = Math.random()): Assignment[] {
    const seededRandom = this.createSeededRandom(seed);
    const assignments: Assignment[] = [];
    const doctorShiftCounts: Map<string, number> = new Map();
    const doctorWeekendCounts: Map<string, number> = new Map();
    const doctorCriticalCounts: Map<string, number> = new Map();
    const doctorRoomCounts: Map<string, Map<string, number>> = new Map();
    const doctorTimeSlotCounts: Map<string, Map<TimeSlot, number>> = new Map();
    const doctorLastRoom: Map<string, Map<string, string>> = new Map();
    const doctorRestDays: Map<string, Set<string>> = new Map();
    const doctorExclusiveDays: Map<string, Set<string>> = new Map();

    for (const doctor of this.doctors) {
      doctorShiftCounts.set(doctor.id, 0);
      doctorWeekendCounts.set(doctor.id, 0);
      doctorCriticalCounts.set(doctor.id, 0);
      doctorRoomCounts.set(doctor.id, new Map());
      doctorTimeSlotCounts.set(doctor.id, new Map());
      doctorLastRoom.set(doctor.id, new Map());
      doctorRestDays.set(doctor.id, new Set());
      doctorExclusiveDays.set(doctor.id, new Set());
      for (const room of this.rooms) {
        doctorRoomCounts.get(doctor.id)!.set(room.id, 0);
      }
      for (const timeSlot of TIME_SLOTS) {
        doctorTimeSlotCounts.get(doctor.id)!.set(timeSlot, 0);
      }
    }

    const processedRequirementIds = new Set<string>();
    
    // First: assign day groups (highest priority - specific days must be worked together)
    this.assignDayGroupRequirements(
      requirements, assignments, doctorShiftCounts, doctorWeekendCounts, doctorCriticalCounts,
      doctorRoomCounts, doctorTimeSlotCounts, doctorLastRoom, doctorRestDays, doctorExclusiveDays,
      processedRequirementIds
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
    processedRequirementIds: Set<string>
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

          const maxDoctorsNeeded = Math.max(...instanceRequirements.map(r => r.count));

          for (let doctorSlot = 0; doctorSlot < maxDoctorsNeeded; doctorSlot++) {
            const doctor = this.findBestDoctorForDayGroup(
              instanceRequirements, assignments, doctorShiftCounts, doctorWeekendCounts,
              doctorCriticalCounts, doctorRoomCounts, doctorRestDays, doctorExclusiveDays
            );

            if (!doctor) continue;

            for (const req of instanceRequirements) {
              if (req.count <= doctorSlot) continue;

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
                const nextDay = new Date(req.date);
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
    doctorExclusiveDays: Map<string, Set<string>>
  ): Doctor | null {
    const groupDates = [...new Set(groupRequirements.map(r => r.date))];
    const roomId = groupRequirements[0]?.roomId;

    const eligibleDoctors = this.doctors.filter(doctor => {
      if (doctor.excludedRooms.includes(roomId)) return false;

      for (const req of groupRequirements) {
        const date = new Date(req.date);
        const weekday = this.getWeekday(date);
        if (doctor.excludedWeekdays.includes(weekday)) return false;

        const doctorExcludedDates = this.config.doctorDateExclusions[doctor.id] || [];
        if (doctorExcludedDates.includes(req.date)) return false;

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

    const sortedDoctors = [...eligibleDoctors].sort((a, b) => {
      const aShifts = doctorShiftCounts.get(a.id) || 0;
      const bShifts = doctorShiftCounts.get(b.id) || 0;
      if (aShifts !== bShifts) return aShifts - bShifts;

      const aRoomCount = doctorRoomCounts.get(a.id)!.get(roomId) || 0;
      const bRoomCount = doctorRoomCounts.get(b.id)!.get(roomId) || 0;
      return aRoomCount - bRoomCount;
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

      // Expand requirements by count (if a slot needs 2 doctors, it appears twice)
      const expandedSlots: { req: SlotRequirement; slotIndex: number }[] = [];
      for (const req of sortedRequirements) {
        for (let i = 0; i < req.count; i++) {
          expandedSlots.push({ req, slotIndex: i });
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
            const nextDay = new Date(req.date);
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
        const date = new Date(req.date);
        const weekday = this.getWeekday(date);
        if (doctor.excludedWeekdays.includes(weekday)) return false;

        const doctorExcludedDates = this.config.doctorDateExclusions[doctor.id] || [];
        if (doctorExcludedDates.includes(req.date)) return false;

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
    const date = new Date(requirement.date);
    const weekday = this.getWeekday(date);

    const eligibleDoctors = this.doctors.filter(doctor => {
      if (doctor.excludedRooms.includes(requirement.roomId)) return false;
      if (doctor.excludedWeekdays.includes(weekday)) return false;

      const doctorExcludedDates = this.config.doctorDateExclusions[doctor.id] || [];
      if (doctorExcludedDates.includes(requirement.date)) return false;

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

    for (let i = 0; i < requirement.count && i < sortedDoctors.length; i++) {
      const doctor = sortedDoctors[i];
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
        const nextDay = new Date(requirement.date);
        nextDay.setDate(nextDay.getDate() + 1);
        const nextDayStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;
        doctorRestDays.get(doctor.id)!.add(nextDayStr);
      }

      if (requirement.isFullDayExclusive) {
        doctorExclusiveDays.get(doctor.id)!.add(requirement.date);
      }
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
        const date = new Date(a.date);
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
}
