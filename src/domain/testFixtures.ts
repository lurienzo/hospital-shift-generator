import {
  Assignment,
  DEFAULT_SHIFT_TYPES,
  Doctor,
  OperativeRoom,
  ScheduleSlot,
  ShiftType,
  Weekday,
  WeekdayRule,
  WEEKDAYS,
} from '../models/types';

/** Costruttori usati dai test per tenere i casi leggibili. */

export const MORNING = DEFAULT_SHIFT_TYPES[0];
export const AFTERNOON = DEFAULT_SHIFT_TYPES[1];
export const NIGHT = DEFAULT_SHIFT_TYPES[2];

export const LONG: ShiftType = {
  id: 'long', name: 'Lunga', code: 'L', start: '08:00', end: '20:00',
  color: '#10b981', order: 3,
};

export const DIURNISMO: ShiftType = {
  id: 'diurnismo', name: 'Diurnismo', code: 'D', start: '08:00', end: '16:00',
  color: '#06b6d4', order: 4,
  rotational: true, blockLengthDays: 7, blockStartWeekday: 'monday',
};

export function makeDoctor(id: string, overrides: Partial<Doctor> = {}): Doctor {
  return {
    id,
    name: id.toUpperCase(),
    color: '#3b82f6',
    excludedRooms: [],
    weekdayRules: [],
    shiftLengthPreference: 'none',
    ...overrides,
  };
}

/** Regola per giorno, con `shiftTypeId` nullo per la giornata intera. */
export function rule(
  weekday: Weekday,
  level: 'avoid' | 'never',
  shiftTypeId: string | null = null,
): WeekdayRule {
  return { weekday, shiftTypeId, level };
}

export function makeSlot(
  weekday: Weekday,
  shiftTypeId: string,
  overrides: Partial<ScheduleSlot> = {},
): ScheduleSlot {
  return {
    id: `${weekday}-${shiftTypeId}`,
    weekday,
    shiftTypeId,
    isCritical: false,
    requiresNextDayRest: false,
    requiresSecondDayRest: false,
    isFullDayExclusive: false,
    ...overrides,
  };
}

export function makeRoom(
  id: string,
  slots: ScheduleSlot[],
  overrides: Partial<OperativeRoom> = {},
): OperativeRoom {
  return {
    id,
    name: id.toUpperCase(),
    color: '#e74c3c',
    slots,
    dayGroups: [],
    ...overrides,
  };
}

/** Slot della stessa fascia su tutti i giorni indicati. */
export function slotsOn(
  weekdays: Weekday[],
  shiftTypeId: string,
  overrides: Partial<ScheduleSlot> = {},
): ScheduleSlot[] {
  return weekdays.map(weekday => makeSlot(weekday, shiftTypeId, overrides));
}

export const EVERY_DAY = WEEKDAYS;
export const WORKDAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

export function makeAssignment(
  id: string,
  date: string,
  roomId: string,
  shiftTypeId: string,
  doctorId: string,
  overrides: Partial<Assignment> = {},
): Assignment {
  return {
    id,
    date,
    roomId,
    roomName: roomId.toUpperCase(),
    shiftTypeId,
    doctorId,
    doctorName: doctorId.toUpperCase(),
    ...overrides,
  };
}
