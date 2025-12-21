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
    const assignments = this.assignDoctors(requirements);

    return {
      year: this.config.year,
      month: this.config.month,
      holidays: this.config.holidays.map(h => h.date),
      assignments,
    };
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
        for (const slot of room.slots) {
          if (slot.weekday === weekday) {
            if (holidayConfig && holidayConfig.disabledSlots.includes(slot.timeSlot)) {
              continue;
            }

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

  private assignDoctors(requirements: SlotRequirement[]): Assignment[] {
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
    this.assignDayGroupRequirements(
      requirements, assignments, doctorShiftCounts, doctorWeekendCounts, doctorCriticalCounts,
      doctorRoomCounts, doctorTimeSlotCounts, doctorLastRoom, doctorRestDays, doctorExclusiveDays,
      processedRequirementIds
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
          doctorCriticalCounts, doctorRoomCounts, doctorTimeSlotCounts, doctorLastRoom, doctorRestDays, doctorExclusiveDays
        );
      }

      for (const requirement of sortedNonCritical) {
        this.assignToRequirement(
          requirement, assignments, doctorShiftCounts, doctorWeekendCounts,
          doctorCriticalCounts, doctorRoomCounts, doctorTimeSlotCounts, doctorLastRoom, doctorRestDays, doctorExclusiveDays
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
    doctorExclusiveDays: Map<string, Set<string>>
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
      return aTimeSlotCount - bTimeSlotCount;
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

      return {
        doctorId: doctor.id,
        doctorName: doctor.name,
        doctorColor: doctor.color,
        totalShifts: doctorAssignments.length,
        weekendShifts,
        criticalShifts,
        shiftsByRoom,
        shiftsByTimeSlot,
      };
    });
  }
}
