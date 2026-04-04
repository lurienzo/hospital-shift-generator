export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export const WEEKDAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
export const WEEKDAYS_ONLY: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
export const WEEKEND_ONLY: Weekday[] = ['saturday', 'sunday'];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Lunedì',
  tuesday: 'Martedì',
  wednesday: 'Mercoledì',
  thursday: 'Giovedì',
  friday: 'Venerdì',
  saturday: 'Sabato',
  sunday: 'Domenica',
};

export type TimeSlot = '08:00-14:00' | '14:00-20:00' | '20:00-08:00';

export const TIME_SLOTS: TimeSlot[] = ['08:00-14:00', '14:00-20:00', '20:00-08:00'];

export const TIME_SLOT_LABELS: Record<TimeSlot, string> = {
  '08:00-14:00': 'Mattina (08:00-14:00)',
  '14:00-20:00': 'Pomeriggio (14:00-20:00)',
  '20:00-08:00': 'Notte (20:00-08:00)',
};

export const TIME_SLOT_SHORT_LABELS: Record<TimeSlot, string> = {
  '08:00-14:00': 'Mattina',
  '14:00-20:00': 'Pomeriggio',
  '20:00-08:00': 'Notte',
};

export const TIME_SLOT_TIME_LABELS: Record<TimeSlot, string> = {
  '08:00-14:00': '08-14',
  '14:00-20:00': '14-20',
  '20:00-08:00': '20-08',
};

export const TIME_SLOT_ORDER: Record<TimeSlot, number> = {
  '08:00-14:00': 0,
  '14:00-20:00': 1,
  '20:00-08:00': 2,
};

export interface ScheduleSlot {
  id: string;
  weekday: Weekday;
  timeSlot: TimeSlot;
  isCritical: boolean;
  requiresNextDayRest: boolean;
  requiresSecondDayRest?: boolean;
  isFullDayExclusive: boolean;
}

export interface DayGroup {
  id: string;
  days: Weekday[];
}

export interface OperativeRoom {
  id: string;
  name: string;
  color: string;
  slots: ScheduleSlot[];
  dayGroups: DayGroup[];
  consecutiveShifts?: number;
  consecutiveStartDay?: Weekday;
}

export const DOCTOR_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e91e63', '#00bcd4', '#ff5722', '#607d8b',
  '#8bc34a', '#ff9800', '#795548', '#009688', '#673ab7',
  '#03a9f4', '#cddc39', '#ffc107', '#4caf50', '#2196f3',
];

export interface Doctor {
  id: string;
  name: string;
  color: string;
  excludedRooms: string[];
  excludedWeekdays: Weekday[];
}

export interface Assignment {
  id: string;
  date: string;
  roomId: string;
  roomName: string;
  timeSlot: TimeSlot;
  doctorId: string;
  doctorName: string;
  locked?: boolean;
}

export interface HolidayConfig {
  date: string;
  disabledRooms: string[];
}

export type DoctorDateMode = 'exclusion' | 'availability';

export interface GenerationConfig {
  year: number;
  month: number;
  holidays: HolidayConfig[];
  doctorDateExclusions: Record<string, string[]>;
  doctorDateAvailability: Record<string, string[]>;
  doctorAvailabilityMode: Record<string, DoctorDateMode>;
  prefilledAssignments?: Assignment[];
}

export interface MonthlySchedule {
  year: number;
  month: number;
  holidays: string[];
  assignments: Assignment[];
}

export interface ScheduleVersion {
  id: string;
  name: string;
  schedule: MonthlySchedule;
  createdAt: string;
  isActive: boolean;
}

export function getMonthKey(year: number, month: number): string {
  return `${year}-${month}`;
}

export function parseMonthKey(key: string): { year: number; month: number } {
  const [year, month] = key.split('-').map(Number);
  return { year, month };
}

export const TIME_SLOT_HOURS: Record<TimeSlot, number> = {
  '08:00-14:00': 6,
  '14:00-20:00': 6,
  '20:00-08:00': 12,
};

export interface DoctorStats {
  doctorId: string;
  doctorName: string;
  doctorColor: string;
  totalShifts: number;
  totalHours: number;
  distinctDays: number;
  weekendShifts: number;
  criticalShifts: number;
  shiftsByRoom: Record<string, number>;
  shiftsByTimeSlot: Record<TimeSlot, number>;
}
