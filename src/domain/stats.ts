import {
  Doctor,
  DoctorStats,
  MonthlySchedule,
  OperativeRoom,
  ShiftType,
} from '../models/types';
import { ShiftTypeIndex, blockLabel, isRotational } from './shiftTypes';
import { RoomSlotIndex } from './validation';
import { MONTH_NAMES_SHORT, isWeekendISODate, monthKey } from '../utils/date';

export interface StatsContext {
  doctors: Doctor[];
  rooms: OperativeRoom[];
  shiftTypes: ShiftTypeIndex;
  slotIndex?: RoomSlotIndex;
}

/**
 * Unico punto in cui si calcolano le statistiche dei medici: vale per un
 * singolo mese (vista calendario), per più mesi (statistiche generali) e per
 * l'export CSV, così i tre non possono divergere.
 */
export function computeStats(
  schedules: MonthlySchedule[],
  context: StatsContext,
): DoctorStats[] {
  const { doctors, rooms, shiftTypes } = context;
  const slotIndex = context.slotIndex ?? new RoomSlotIndex(rooms);

  const byDoctor = new Map<string, DoctorStats>();
  const daysWorked = new Map<string, Set<string>>();
  // Un blocco a rotazione conta una volta sola, per quanti giorni lo componga:
  // si raccolgono gli identificativi dei blocchi toccati e si contano alla fine.
  const blocksTouched = new Map<string, Set<string>>();

  for (const doctor of doctors) {
    byDoctor.set(doctor.id, {
      doctorId: doctor.id,
      doctorName: doctor.name,
      doctorColor: doctor.color,
      totalShifts: 0,
      totalHours: 0,
      distinctDays: 0,
      weekendShifts: 0,
      criticalShifts: 0,
      shiftsByRoom: Object.fromEntries(rooms.map(room => [room.id, 0])),
      shiftsByShiftType: Object.fromEntries(shiftTypes.all.map(type => [type.id, 0])),
      shiftsByMonth: {},
      blocksByShiftType: Object.fromEntries(shiftTypes.rotational.map(type => [type.id, 0])),
    });
    daysWorked.set(doctor.id, new Set());
    blocksTouched.set(doctor.id, new Set());
  }

  for (const schedule of schedules) {
    const holidays = new Set(schedule.holidays);
    const key = monthKey(schedule.year, schedule.month);

    for (const assignment of schedule.assignments) {
      const stats = byDoctor.get(assignment.doctorId);
      if (!stats) continue;

      stats.totalShifts++;
      stats.totalHours += shiftTypes.hours(assignment.shiftTypeId);
      daysWorked.get(assignment.doctorId)!.add(assignment.date);

      if (isWeekendISODate(assignment.date) || holidays.has(assignment.date)) {
        stats.weekendShifts++;
      }
      if (slotIndex.isCritical(assignment.roomId, assignment.date, assignment.shiftTypeId)) {
        stats.criticalShifts++;
      }
      if (assignment.roomId in stats.shiftsByRoom) {
        stats.shiftsByRoom[assignment.roomId]++;
      }
      if (assignment.shiftTypeId in stats.shiftsByShiftType) {
        stats.shiftsByShiftType[assignment.shiftTypeId]++;
      }
      stats.shiftsByMonth[key] = (stats.shiftsByMonth[key] ?? 0) + 1;

      const blockIndex = shiftTypes.blockIndex(assignment.shiftTypeId, assignment.date);
      if (blockIndex !== null) {
        blocksTouched.get(assignment.doctorId)!.add(`${assignment.shiftTypeId}|${blockIndex}`);
      }
    }
  }

  for (const [doctorId, dates] of daysWorked) {
    byDoctor.get(doctorId)!.distinctDays = dates.size;
  }

  for (const [doctorId, blocks] of blocksTouched) {
    const stats = byDoctor.get(doctorId)!;
    for (const block of blocks) {
      const shiftTypeId = block.slice(0, block.lastIndexOf('|'));
      stats.blocksByShiftType[shiftTypeId] = (stats.blocksByShiftType[shiftTypeId] ?? 0) + 1;
    }
  }

  return [...byDoctor.values()];
}

// ---------------------------------------------------------------------------
// Colonne delle tabelle
// ---------------------------------------------------------------------------

export type ColumnGroup = 'identity' | 'load' | 'quality' | 'room' | 'shift' | 'block' | 'month';

export interface StatColumn {
  key: string;
  label: string;
  /** Unità mostrata sotto l'etichetta, es. "sett." per i blocchi. */
  subLabel?: string;
  title?: string;
  group: ColumnGroup;
  /** Prima colonna di un gruppo: la tabella disegna un separatore a sinistra. */
  startsGroup?: boolean;
  color?: string;
  value: (stat: DoctorStats) => number;
  format?: (value: number) => string;
}

const asHours = (value: number) => `${round(value)}h`;

/**
 * Colonne numeriche della tabella statistiche. Sale, fasce orarie e mesi sono
 * configurabili, quindi le colonne si costruiscono dai dati invece di essere
 * scritte a mano nei componenti.
 */
export function buildStatColumns(options: {
  rooms: OperativeRoom[];
  shiftTypes: ShiftType[];
  months?: { year: number; month: number }[];
  includeCritical?: boolean;
}): StatColumn[] {
  const { rooms, shiftTypes, months = [], includeCritical = true } = options;

  const columns: StatColumn[] = [
    { key: 'shifts', label: 'Turni', group: 'load', value: stat => stat.totalShifts },
    { key: 'days', label: 'Giorni', group: 'load', value: stat => stat.distinctDays },
    { key: 'hours', label: 'Ore', group: 'load', value: stat => stat.totalHours, format: asHours },
    {
      key: 'weekend',
      label: 'Weekend',
      title: 'Turni di sabato, domenica o festivi',
      group: 'quality',
      startsGroup: true,
      value: stat => stat.weekendShifts,
    },
  ];

  if (includeCritical) {
    columns.push({
      key: 'critical',
      label: 'Critici',
      title: 'Turni marcati come critici nelle impostazioni della sala',
      group: 'quality',
      value: stat => stat.criticalShifts,
    });
  }

  shiftTypes.forEach((shiftType, index) => {
    columns.push({
      key: `shift-${shiftType.id}`,
      label: shiftType.name,
      title: `${shiftType.name} ${shiftType.start}-${shiftType.end} — turni singoli`,
      group: 'shift',
      startsGroup: index === 0,
      color: shiftType.color,
      value: stat => stat.shiftsByShiftType[shiftType.id] ?? 0,
    });
  });

  // Le fasce a rotazione hanno una colonna aggiuntiva col numero di blocchi:
  // è quella che conta per l'equità, perché una settimana di diurnismo va
  // confrontata con le settimane degli altri, non coi turni singoli.
  const rotational = shiftTypes.filter(isRotational);
  rotational.forEach((shiftType, index) => {
    columns.push({
      key: `block-${shiftType.id}`,
      label: shiftType.name,
      subLabel: blockLabel(shiftType) === 'settimana' ? 'sett.' : 'blocchi',
      title: `${shiftType.name} — blocchi completati (1 blocco = ${blockLabel(shiftType)})`,
      group: 'block',
      startsGroup: index === 0,
      color: shiftType.color,
      value: stat => stat.blocksByShiftType[shiftType.id] ?? 0,
    });
  });

  rooms.forEach((room, index) => {
    columns.push({
      key: `room-${room.id}`,
      label: room.name,
      group: 'room',
      startsGroup: index === 0,
      color: room.color,
      value: stat => stat.shiftsByRoom[room.id] ?? 0,
    });
  });

  months.forEach(({ year, month }, index) => {
    const key = monthKey(year, month);
    columns.push({
      key: `month-${key}`,
      label: MONTH_NAMES_SHORT[month - 1],
      title: `Turni di ${MONTH_NAMES_SHORT[month - 1]} ${year}`,
      group: 'month',
      startsGroup: index === 0,
      value: stat => stat.shiftsByMonth[key] ?? 0,
    });
  });

  return columns;
}

export interface ColumnSummary {
  total: number;
  average: number;
  stdDev: number;
}

export function summarizeColumns(
  stats: DoctorStats[],
  columns: StatColumn[],
): Record<string, ColumnSummary> {
  const summary: Record<string, ColumnSummary> = {};

  for (const column of columns) {
    const values = stats.map(column.value);
    const total = values.reduce((sum, value) => sum + value, 0);
    const average = values.length > 0 ? total / values.length : 0;
    summary[column.key] = { total, average, stdDev: standardDeviation(values, average) };
  }

  return summary;
}

export function standardDeviation(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Comparatore per ordinare la tabella in base a una colonna. */
export function statsComparator(
  column: StatColumn | undefined,
  direction: 'asc' | 'desc',
): (a: DoctorStats, b: DoctorStats) => number {
  const sign = direction === 'asc' ? 1 : -1;

  if (!column) {
    return (a, b) => sign * a.doctorName.localeCompare(b.doctorName, 'it');
  }

  return (a, b) => {
    const difference = column.value(a) - column.value(b);
    if (difference !== 0) return sign * difference;
    return a.doctorName.localeCompare(b.doctorName, 'it');
  };
}
