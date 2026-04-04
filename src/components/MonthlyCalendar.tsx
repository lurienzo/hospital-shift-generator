import { useState, useMemo, useEffect, useCallback } from 'react';
import { MonthlySchedule, OperativeRoom, Doctor, Assignment, TimeSlot, TIME_SLOTS, TIME_SLOT_LABELS, TIME_SLOT_ORDER, TIME_SLOT_TIME_LABELS } from '../models/types';
import { ScheduleGeneratorService } from '../services/ScheduleGeneratorService';
import { StorageService } from '../services/StorageService';
import { generateId } from '../utils/idGenerator';
import { MONTH_NAMES_FULL, MONTH_NAMES_SHORT } from '../utils/constants';
import { ScheduleVersionManager } from './ScheduleVersionManager';
import './MonthlyCalendar.css';

interface MonthlyCalendarProps {
  schedule: MonthlySchedule | null;
  rooms: OperativeRoom[];
  doctors: Doctor[];
  onScheduleChange: (schedule: MonthlySchedule | null) => void;
  onNavigateToGenerate: (year: number, month: number) => void;
  hasUnsavedChanges: boolean;
  isNewDraft: boolean;
  savedVersionId: string | null;
  onLoadVersion: (schedule: MonthlySchedule, versionId: string) => void;
  onSaveVersion: (name: string, createNew: boolean) => void;
  onDiscardChanges: () => void;
  onDuplicateVersion: (sourceVersionId: string, newName: string) => void;
}

interface EditingCell {
  date: string;
  roomId: string;
  timeSlot: TimeSlot;
}

type CalendarView = 'rooms' | 'doctors' | 'monthly';
type SortColumn = 'name' | 'shifts' | 'days' | 'hours' | 'weekend' | 'critical' | 'morning' | 'afternoon' | 'night' | `room-${string}`;
type SortDirection = 'asc' | 'desc';

export function MonthlyCalendar({ 
  schedule, 
  rooms, 
  doctors, 
  onScheduleChange, 
  onNavigateToGenerate, 
  hasUnsavedChanges,
  isNewDraft,
  savedVersionId,
  onLoadVersion,
  onSaveVersion,
  onDiscardChanges,
  onDuplicateVersion
}: MonthlyCalendarProps) {
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [showAddModal, setShowAddModal] = useState<EditingCell | null>(null);
  const [draggingAssignment, setDraggingAssignment] = useState<string | null>(null);
  const [dragOverAssignment, setDragOverAssignment] = useState<string | null>(null);
  const [calendarView, setCalendarView] = useState<CalendarView>('rooms');
  const [sortColumn, setSortColumn] = useState<SortColumn>('shifts');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  
  // Month navigation state
  const [selectedYear, setSelectedYear] = useState<number>(schedule?.year || new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(schedule?.month || new Date().getMonth() + 1);
  
  // Update selection when schedule changes externally
  useEffect(() => {
    if (schedule) {
      setSelectedYear(schedule.year);
      setSelectedMonth(schedule.month);
    }
  }, [schedule?.year, schedule?.month]);
  
  // Get all months with saved versions
  const monthsWithVersions = useMemo(() => {
    return StorageService.getMonthsWithVersions();
  }, [schedule]); // Re-check when schedule changes
  
  
  const handleMonthChange = useCallback((year: number, month: number) => {
    // Warn about unsaved changes before navigating
    if (hasUnsavedChanges) {
      if (!window.confirm('Hai modifiche non salvate. Vuoi davvero cambiare mese?')) {
        return;
      }
    }
    
    setSelectedYear(year);
    setSelectedMonth(month);
    
    const activeVersion = StorageService.getActiveVersion(year, month);
    if (activeVersion) {
      onLoadVersion(activeVersion.schedule, activeVersion.id);
    } else {
      onScheduleChange(null);
    }
  }, [onScheduleChange, onLoadVersion, hasUnsavedChanges]);
  
  const handleYearChange = useCallback((year: number) => {
    // Warn about unsaved changes before navigating
    if (hasUnsavedChanges) {
      if (!window.confirm('Hai modifiche non salvate. Vuoi davvero cambiare anno?')) {
        return;
      }
    }
    
    setSelectedYear(year);
    
    // Try to load the same month in the new year, or show empty state
    const activeVersion = StorageService.getActiveVersion(year, selectedMonth);
    if (activeVersion) {
      onLoadVersion(activeVersion.schedule, activeVersion.id);
    } else {
      onScheduleChange(null);
    }
  }, [selectedMonth, hasUnsavedChanges, onLoadVersion, onScheduleChange]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const getSortIndicator = (column: SortColumn) => {
    if (sortColumn !== column) return '';
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  };

  const generationConfig = useMemo(() => {
    if (!schedule) return null;
    return StorageService.loadGenerationConfig(schedule.year, schedule.month);
  }, [schedule?.year, schedule?.month, schedule]);

  const doctorDateExclusions = generationConfig?.doctorDateExclusions || {};
  const doctorDateAvailability = generationConfig?.doctorDateAvailability || {};
  const doctorAvailabilityMode = generationConfig?.doctorAvailabilityMode || {};

  const isDoctorDateBlocked = (date: string, doctorId: string): boolean => {
    const mode = doctorAvailabilityMode[doctorId] || 'exclusion';
    if (mode === 'availability') {
      const available = doctorDateAvailability[doctorId] || [];
      return available.length > 0 && !available.includes(date);
    }
    const exclusions = doctorDateExclusions[doctorId] || [];
    return exclusions.includes(date);
  };

  const monthNames = MONTH_NAMES_FULL;

  const weekdayNames = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  const weekdayNamesFull = ['Lunedi', 'Martedi', 'Mercoledi', 'Giovedi', 'Venerdi', 'Sabato', 'Domenica'];

  const daysInMonth = schedule ? new Date(schedule.year, schedule.month, 0).getDate() : 0;
  const stats = schedule ? ScheduleGeneratorService.calculateStats(schedule, doctors, rooms) : [];

  const getDoctorColor = (doctorId: string): string => {
    const doctor = doctors.find(d => d.id === doctorId);
    return doctor?.color || '#888';
  };

  const isWeekendOrHoliday = (dateStr: string): { isWeekend: boolean; isHoliday: boolean } => {
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday = schedule?.holidays.includes(dateStr) || false;
    return { isWeekend, isHoliday };
  };

  const handleDownloadCSV = () => {
    if (!schedule) return;
    StorageService.downloadCSV(schedule, rooms, doctors);
  };

  const removeAssignment = (assignmentId: string) => {
    if (!schedule) return;
    const newAssignments = schedule.assignments.filter(a => a.id !== assignmentId);
    onScheduleChange({ ...schedule, assignments: newAssignments });
  };

  const isDoctorAlreadyAssigned = (date: string, timeSlot: TimeSlot, doctorId: string, excludeAssignmentId?: string): boolean => {
    if (!schedule) return false;
    return schedule.assignments.some(
      a => a.date === date && 
           a.timeSlot === timeSlot && 
           a.doctorId === doctorId &&
           a.id !== excludeAssignmentId
    );
  };

  const isDoctorOnRestDay = (date: string, doctorId: string): boolean => {
    if (!schedule) return false;
    const currentDate = new Date(date);
    const previousDate = new Date(currentDate);
    previousDate.setDate(previousDate.getDate() - 1);
    const previousDateStr = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}-${String(previousDate.getDate()).padStart(2, '0')}`;

    const previousDayAssignments = schedule.assignments.filter(
      a => a.date === previousDateStr && a.doctorId === doctorId
    );

    for (const assignment of previousDayAssignments) {
      const room = rooms.find(r => r.id === assignment.roomId);
      if (room) {
        const slot = room.slots.find(s => s.timeSlot === assignment.timeSlot);
        if (slot?.requiresNextDayRest) {
          return true;
        }
      }
    }
    return false;
  };

  const isDoctorOnSecondRestDay = (date: string, doctorId: string): boolean => {
    if (!schedule) return false;
    const currentDate = new Date(date);
    const twoDaysAgo = new Date(currentDate);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const twoDaysAgoStr = `${twoDaysAgo.getFullYear()}-${String(twoDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(twoDaysAgo.getDate()).padStart(2, '0')}`;

    const twoDaysAgoAssignments = schedule.assignments.filter(
      a => a.date === twoDaysAgoStr && a.doctorId === doctorId
    );

    for (const assignment of twoDaysAgoAssignments) {
      const room = rooms.find(r => r.id === assignment.roomId);
      if (room) {
        const slot = room.slots.find(s => s.timeSlot === assignment.timeSlot);
        if (slot?.requiresSecondDayRest) {
          return true;
        }
      }
    }
    return false;
  };

  const getDoctorUnavailabilityReason = (date: string, timeSlot: TimeSlot, doctorId: string, excludeAssignmentId?: string): string | null => {
    if (isDoctorAlreadyAssigned(date, timeSlot, doctorId, excludeAssignmentId)) {
      return 'Occupato';
    }
    return null;
  };

  const isRestRequiredShift = (roomId: string, timeSlot: TimeSlot): boolean => {
    const room = rooms.find(r => r.id === roomId);
    if (!room) return false;
    const slot = room.slots.find(s => s.timeSlot === timeSlot);
    return slot?.requiresNextDayRest || false;
  };

  const isFullDayExclusiveShift = (roomId: string, timeSlot: TimeSlot): boolean => {
    const room = rooms.find(r => r.id === roomId);
    if (!room) return false;
    const slot = room.slots.find(s => s.timeSlot === timeSlot);
    return slot?.isFullDayExclusive || false;
  };

  const getAssignmentInvalidReason = (assignment: Assignment): string | null => {
    if (isDoctorDateBlocked(assignment.date, assignment.doctorId)) {
      return 'Non disponibile';
    }

    if (isDoctorOnRestDay(assignment.date, assignment.doctorId)) {
      return 'Smontante';
    }

    if (isDoctorOnSecondRestDay(assignment.date, assignment.doctorId)) {
      return 'Riposo';
    }

    const isThisExclusive = isFullDayExclusiveShift(assignment.roomId, assignment.timeSlot);
    const otherSameDayAssignments = (schedule?.assignments || []).filter(
      a => a.date === assignment.date && a.doctorId === assignment.doctorId && a.id !== assignment.id
    );

    if (isThisExclusive && otherSameDayAssignments.length > 0) {
      return 'Montante';
    }

    if (otherSameDayAssignments.some(a => isFullDayExclusiveShift(a.roomId, a.timeSlot))) {
      return 'Montante';
    }

    return null;
  };

  const invalidAssignments = useMemo(() => {
    if (!schedule) return [];
    return schedule.assignments.filter(a => getAssignmentInvalidReason(a) !== null);
  }, [schedule, rooms, generationConfig]);

  const getNextDayStr = (date: string): string => {
    const currentDate = new Date(date);
    const nextDate = new Date(currentDate);
    nextDate.setDate(nextDate.getDate() + 1);
    return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
  };

  const getDoctorNextDayAssignmentsCount = (date: string, doctorId: string): number => {
    if (!schedule) return 0;
    const nextDayStr = getNextDayStr(date);
    return schedule.assignments.filter(a => a.date === nextDayStr && a.doctorId === doctorId).length;
  };

  const getDoctorSameDayOtherAssignmentsCount = (date: string, doctorId: string, excludeAssignmentId?: string): number => {
    if (!schedule) return 0;
    return schedule.assignments.filter(a => a.date === date && a.doctorId === doctorId && a.id !== excludeAssignmentId).length;
  };

  const hasDoctorExclusiveShiftOnDay = (date: string, doctorId: string): boolean => {
    if (!schedule) return false;
    const sameDayAssignments = schedule.assignments.filter(a => a.date === date && a.doctorId === doctorId);
    return sameDayAssignments.some(a => isFullDayExclusiveShift(a.roomId, a.timeSlot));
  };

  const addAssignment = (date: string, roomId: string, timeSlot: TimeSlot, doctorId: string) => {
    if (!schedule) return;
    const doctor = doctors.find(d => d.id === doctorId);
    const room = rooms.find(r => r.id === roomId);
    if (!doctor || !room) return;

    if (isDoctorAlreadyAssigned(date, timeSlot, doctorId)) {
      return;
    }

    const newAssignment: Assignment = {
      id: generateId(),
      date,
      roomId,
      roomName: room.name,
      timeSlot,
      doctorId,
      doctorName: doctor.name,
    };

    const newAssignments = [...schedule.assignments, newAssignment].sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return TIME_SLOT_ORDER[a.timeSlot] - TIME_SLOT_ORDER[b.timeSlot];
    });
    onScheduleChange({ ...schedule, assignments: newAssignments });
    setShowAddModal(null);
  };

  const changeAssignmentDoctor = (assignmentId: string, newDoctorId: string) => {
    if (!schedule) return;
    const doctor = doctors.find(d => d.id === newDoctorId);
    if (!doctor) return;

    const currentAssignment = schedule.assignments.find(a => a.id === assignmentId);
    if (!currentAssignment) return;

    if (isDoctorAlreadyAssigned(currentAssignment.date, currentAssignment.timeSlot, newDoctorId, assignmentId)) {
      return;
    }

    const newAssignments = schedule.assignments.map(a =>
      a.id === assignmentId
        ? { ...a, doctorId: doctor.id, doctorName: doctor.name }
        : a
    );
    onScheduleChange({ ...schedule, assignments: newAssignments });
    setEditingCell(null);
  };

  const getSwapBlockReason = (assignmentId1: string, assignmentId2: string): string | null => {
    if (!schedule) return 'Calendario non disponibile';
    if (assignmentId1 === assignmentId2) return null;

    const assignment1 = schedule.assignments.find(a => a.id === assignmentId1);
    const assignment2 = schedule.assignments.find(a => a.id === assignmentId2);
    if (!assignment1 || !assignment2) return 'Turno non trovato';

    const doctor1InSlot2 = schedule.assignments.some(a => 
      a.id !== assignmentId1 && 
      a.id !== assignmentId2 &&
      a.date === assignment2.date && 
      a.timeSlot === assignment2.timeSlot && 
      a.doctorId === assignment1.doctorId
    );

    const doctor2InSlot1 = schedule.assignments.some(a => 
      a.id !== assignmentId1 && 
      a.id !== assignmentId2 &&
      a.date === assignment1.date && 
      a.timeSlot === assignment1.timeSlot && 
      a.doctorId === assignment2.doctorId
    );

    if (doctor1InSlot2) {
      const doctor1 = doctors.find(d => d.id === assignment1.doctorId);
      return `${doctor1?.name || 'Dottore'} già presente in questo slot`;
    }

    if (doctor2InSlot1) {
      const doctor2 = doctors.find(d => d.id === assignment2.doctorId);
      return `${doctor2?.name || 'Dottore'} già presente nello slot di origine`;
    }

    return null;
  };

  const getSwapWarnings = (assignmentId1: string, assignmentId2: string): { for1: string | null; for2: string | null } => {
    if (!schedule) return { for1: null, for2: null };
    const assignment1 = schedule.assignments.find(a => a.id === assignmentId1);
    const assignment2 = schedule.assignments.find(a => a.id === assignmentId2);
    if (!assignment1 || !assignment2) return { for1: null, for2: null };

    let warning1: string | null = null;
    let warning2: string | null = null;

    if (isDoctorDateBlocked(assignment2.date, assignment1.doctorId)) {
      warning1 = 'Non disponibile';
    } else if (isDoctorOnRestDay(assignment2.date, assignment1.doctorId)) {
      warning1 = 'Smontante';
    } else if (isDoctorOnSecondRestDay(assignment2.date, assignment1.doctorId)) {
      warning1 = 'Riposo';
    }

    if (isDoctorDateBlocked(assignment1.date, assignment2.doctorId)) {
      warning2 = 'Non disponibile';
    } else if (isDoctorOnRestDay(assignment1.date, assignment2.doctorId)) {
      warning2 = 'Smontante';
    } else if (isDoctorOnSecondRestDay(assignment1.date, assignment2.doctorId)) {
      warning2 = 'Riposo';
    }

    return { for1: warning1, for2: warning2 };
  };

  const swapAssignmentDoctors = (assignmentId1: string, assignmentId2: string) => {
    if (!schedule) return;
    if (getSwapBlockReason(assignmentId1, assignmentId2)) return;

    const assignment1 = schedule.assignments.find(a => a.id === assignmentId1);
    const assignment2 = schedule.assignments.find(a => a.id === assignmentId2);
    if (!assignment1 || !assignment2) return;

    const newAssignments = schedule.assignments.map(a => {
      if (a.id === assignmentId1) {
        return { ...a, doctorId: assignment2.doctorId, doctorName: assignment2.doctorName };
      }
      if (a.id === assignmentId2) {
        return { ...a, doctorId: assignment1.doctorId, doctorName: assignment1.doctorName };
      }
      return a;
    });

    onScheduleChange({ ...schedule, assignments: newAssignments });
  };

  const handleDragStart = (assignmentId: string) => {
    setDraggingAssignment(assignmentId);
    setEditingCell(null);
  };

  const handleDragEnd = () => {
    setDraggingAssignment(null);
    setDragOverAssignment(null);
  };

  const handleDragOver = (event: React.DragEvent, assignmentId: string) => {
    if (draggingAssignment && draggingAssignment !== assignmentId) {
      const blockReason = getSwapBlockReason(draggingAssignment, assignmentId);
      if (!blockReason) {
        event.preventDefault();
      }
      setDragOverAssignment(assignmentId);
    }
  };

  const handleDragLeave = () => {
    setDragOverAssignment(null);
  };

  const handleDrop = (event: React.DragEvent, targetAssignmentId: string) => {
    event.preventDefault();
    if (draggingAssignment && draggingAssignment !== targetAssignmentId) {
      swapAssignmentDoctors(draggingAssignment, targetAssignmentId);
    }
    setDraggingAssignment(null);
    setDragOverAssignment(null);
  };

  const getDragOverState = (assignmentId: string): { isOver: boolean; isBlocked: boolean; blockReason: string | null; warnings: { for1: string | null; for2: string | null } } => {
    if (!draggingAssignment || dragOverAssignment !== assignmentId) {
      return { isOver: false, isBlocked: false, blockReason: null, warnings: { for1: null, for2: null } };
    }
    const blockReason = getSwapBlockReason(draggingAssignment, assignmentId);
    const warnings = getSwapWarnings(draggingAssignment, assignmentId);
    return { isOver: true, isBlocked: !!blockReason, blockReason, warnings };
  };

  const sortedAssignmentsForCell = (dateStr: string, roomId: string): Assignment[] => {
    if (!schedule) return [];
    return schedule.assignments
      .filter(a => a.date === dateStr && a.roomId === roomId)
      .sort((a, b) => TIME_SLOT_ORDER[a.timeSlot] - TIME_SLOT_ORDER[b.timeSlot]);
  };

  const totalShifts = stats.reduce((sum, stat) => sum + stat.totalShifts, 0);
  const avgShifts = doctors.length > 0 ? totalShifts / doctors.length : 0;
  const variance = doctors.length > 0
    ? Math.sqrt(stats.reduce((sum, stat) => sum + Math.pow(stat.totalShifts - avgShifts, 2), 0) / doctors.length)
    : 0;

  const totalWeekendShifts = stats.reduce((sum, stat) => sum + stat.weekendShifts, 0);
  const avgWeekendShifts = doctors.length > 0 ? totalWeekendShifts / doctors.length : 0;

  const totalCriticalShifts = stats.reduce((sum, stat) => sum + stat.criticalShifts, 0);
  const avgCriticalShifts = doctors.length > 0 ? totalCriticalShifts / doctors.length : 0;

  // Calculate summary statistics for the table footer
  const tableSummary = useMemo(() => {
    const numDoctors = stats.length || 1;
    
    const calcStdDev = (values: number[], mean: number): number => {
      if (values.length === 0) return 0;
      const squareDiffs = values.map(v => Math.pow(v - mean, 2));
      return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
    };

    const totals = {
      shifts: stats.reduce((sum, s) => sum + s.totalShifts, 0),
      days: stats.reduce((sum, s) => sum + s.distinctDays, 0),
      hours: stats.reduce((sum, s) => sum + s.totalHours, 0),
      weekend: stats.reduce((sum, s) => sum + s.weekendShifts, 0),
      critical: stats.reduce((sum, s) => sum + s.criticalShifts, 0),
      morning: stats.reduce((sum, s) => sum + s.shiftsByTimeSlot['08:00-14:00'], 0),
      afternoon: stats.reduce((sum, s) => sum + s.shiftsByTimeSlot['14:00-20:00'], 0),
      night: stats.reduce((sum, s) => sum + s.shiftsByTimeSlot['20:00-08:00'], 0),
      byRoom: rooms.reduce((acc, r) => {
        acc[r.id] = stats.reduce((sum, s) => sum + (s.shiftsByRoom[r.id] || 0), 0);
        return acc;
      }, {} as Record<string, number>),
    };

    const averages = {
      shifts: totals.shifts / numDoctors,
      days: totals.days / numDoctors,
      hours: totals.hours / numDoctors,
      weekend: totals.weekend / numDoctors,
      critical: totals.critical / numDoctors,
      morning: totals.morning / numDoctors,
      afternoon: totals.afternoon / numDoctors,
      night: totals.night / numDoctors,
      byRoom: rooms.reduce((acc, r) => {
        acc[r.id] = totals.byRoom[r.id] / numDoctors;
        return acc;
      }, {} as Record<string, number>),
    };

    const stdDevs = {
      shifts: calcStdDev(stats.map(s => s.totalShifts), averages.shifts),
      days: calcStdDev(stats.map(s => s.distinctDays), averages.days),
      hours: calcStdDev(stats.map(s => s.totalHours), averages.hours),
      weekend: calcStdDev(stats.map(s => s.weekendShifts), averages.weekend),
      critical: calcStdDev(stats.map(s => s.criticalShifts), averages.critical),
      morning: calcStdDev(stats.map(s => s.shiftsByTimeSlot['08:00-14:00']), averages.morning),
      afternoon: calcStdDev(stats.map(s => s.shiftsByTimeSlot['14:00-20:00']), averages.afternoon),
      night: calcStdDev(stats.map(s => s.shiftsByTimeSlot['20:00-08:00']), averages.night),
      byRoom: rooms.reduce((acc, r) => {
        acc[r.id] = calcStdDev(stats.map(s => s.shiftsByRoom[r.id] || 0), averages.byRoom[r.id]);
        return acc;
      }, {} as Record<string, number>),
    };

    return { totals, averages, stdDevs };
  }, [stats, rooms]);

  const monthNamesShort = MONTH_NAMES_SHORT;

  // Memoize version counts to avoid 12 localStorage reads per render
  const monthVersionCounts = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) =>
      StorageService.loadScheduleVersionsForMonth(selectedYear, i + 1).length
    );
  }, [selectedYear, schedule]);

  return (
    <div className="monthly-calendar">
      {/* Month Navigation */}
      <div className="month-navigation">
        <div className="month-nav-header">
          <span className="month-nav-label">📅 Navigazione Mesi Salvati</span>
          <div className="year-selector-nav">
            <button 
              className="nav-arrow"
              onClick={() => handleYearChange(selectedYear - 1)}
            >
              ◀
            </button>
            <span className="current-year">{selectedYear}</span>
            <button 
              className="nav-arrow"
              onClick={() => handleYearChange(selectedYear + 1)}
            >
              ▶
            </button>
          </div>
        </div>
        <div className="month-nav-grid">
          {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
            const versionCount = monthVersionCounts[month - 1];
            const hasVersions = versionCount > 0;
            const isSelected = selectedMonth === month;
            
            return (
              <button
                key={month}
                className={`month-nav-btn ${isSelected ? 'selected' : ''} ${hasVersions ? 'has-versions' : ''}`}
                onClick={() => handleMonthChange(selectedYear, month)}
                title={hasVersions ? `${versionCount} versione${versionCount !== 1 ? 'i' : ''} salvata${versionCount !== 1 ? 'e' : ''}` : 'Clicca per selezionare questo mese'}
              >
                <span className="month-nav-name">{monthNamesShort[month - 1]}</span>
                {hasVersions && <span className="version-count">{versionCount}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Empty state when no schedule */}
      {!schedule && (
        <div className="empty-calendar">
          <div className="empty-icon">📅</div>
          <h2>Nessun calendario per {monthNames[selectedMonth - 1]} {selectedYear}</h2>
          <p>
            {monthsWithVersions.length > 0 
              ? 'Seleziona un mese con versioni salvate dalla navigazione sopra, oppure genera un nuovo calendario.'
              : 'Non ci sono calendari salvati. Vai alla sezione "Genera" per creare un nuovo calendario turni.'
            }
          </p>
          <button onClick={() => onNavigateToGenerate(selectedYear, selectedMonth)}>
            ⚡ Genera Calendario
          </button>
        </div>
      )}

      {/* Calendar content when schedule exists */}
      {schedule && (
        <>
          <ScheduleVersionManager 
            schedule={schedule}
            hasUnsavedChanges={hasUnsavedChanges}
            isNewDraft={isNewDraft}
            savedVersionId={savedVersionId}
            onLoadVersion={onLoadVersion}
            onSaveVersion={onSaveVersion}
            onDiscardChanges={onDiscardChanges}
            onDuplicateVersion={onDuplicateVersion}
          />
          
          <div className="calendar-header">
            <h2>{monthNames[schedule.month - 1]} {schedule.year}</h2>
        <div className="calendar-header-actions">
          <div className="view-toggle">
            <button 
              className={`view-toggle-btn ${calendarView === 'rooms' ? 'active' : ''}`}
              onClick={() => setCalendarView('rooms')}
            >
              🏥 Per Sala
            </button>
            <button
              className={`view-toggle-btn ${calendarView === 'doctors' ? 'active' : ''}`}
              onClick={() => setCalendarView('doctors')}
            >
              👨‍⚕️ Per Dottore
            </button>
            <button
              className={`view-toggle-btn ${calendarView === 'monthly' ? 'active' : ''}`}
              onClick={() => setCalendarView('monthly')}
            >
              📅 Calendario
            </button>
          </div>
          <button className="btn-download" onClick={handleDownloadCSV}>
            📥 Scarica CSV
          </button>
        </div>
      </div>

      <div className="calendar-stats">
        <div className="stat-card">
          <span className="stat-value">{totalShifts}</span>
          <span className="stat-label">Turni Totali</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{avgShifts.toFixed(1)}</span>
          <span className="stat-label">Media/Dottore</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{variance.toFixed(2)}</span>
          <span className="stat-label">Varianza</span>
        </div>
        <div className="stat-card weekend-stat">
          <span className="stat-value">{avgWeekendShifts.toFixed(1)}</span>
          <span className="stat-label">Weekend/Dottore</span>
        </div>
        {totalCriticalShifts > 0 && (
          <div className="stat-card critical-stat">
            <span className="stat-value">{avgCriticalShifts.toFixed(1)}</span>
            <span className="stat-label">Critici/Dottore</span>
          </div>
        )}
        {invalidAssignments.length > 0 && (
          <div className="stat-card warning-stat">
            <span className="stat-value">⚠️ {invalidAssignments.length}</span>
            <span className="stat-label">Turni Invalidi</span>
          </div>
        )}
      </div>

      <div className="calendar-legend">
        <span className="legend-item">
          <span className="legend-color weekend-legend"></span>
          Weekend/Festivo
        </span>
        <span className="legend-tip">💡 Clicca su un turno per modificarlo, trascina per scambiare dottori, o premi + per aggiungere</span>
      </div>

      {calendarView === 'rooms' && (
      <div className="calendar-table-container">
        <table className="calendar-table">
          <thead>
            <tr>
              <th className="sticky-col day-col">Giorno</th>
              <th className="sticky-col weekday-col">Sett.</th>
              {rooms.map(room => (
                <th key={room.id}>
                  {room.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: daysInMonth }, (_, index) => {
              const day = index + 1;
              const date = new Date(schedule.year, schedule.month - 1, day);
              const weekday = date.getDay();
              const dateStr = `${schedule.year}-${String(schedule.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const { isWeekend, isHoliday } = isWeekendOrHoliday(dateStr);
              const isWeekendOrHolidayDay = isWeekend || isHoliday;

              return (
                <tr key={day} className={isWeekendOrHolidayDay ? 'weekend-or-holiday-row' : ''}>
                  <td className={`sticky-col day-col ${isWeekendOrHolidayDay ? 'weekend-day' : ''}`}>
                    {day}
                    {isHoliday && !isWeekend && <span className="holiday-marker">🎄</span>}
                  </td>
                  <td className={`sticky-col weekday-col ${isWeekendOrHolidayDay ? 'weekend-day' : ''}`}>
                    {weekdayNames[weekday]}
                  </td>
                  {rooms.map(room => {
                    const roomAssignments = sortedAssignmentsForCell(dateStr, room.id);

                    return (
                      <td key={room.id} className="assignment-cell">
                        <div className="assignments">
                          {roomAssignments.map((assignment) => {
                            const isEditing = editingCell?.date === dateStr && 
                              editingCell?.roomId === room.id && 
                              editingCell?.timeSlot === assignment.timeSlot;
                            const invalidReason = getAssignmentInvalidReason(assignment);
                            const isDragging = draggingAssignment === assignment.id;
                            const dragState = getDragOverState(assignment.id);
                            
                            let dragTitle = invalidReason 
                              ? `⚠️ ${assignment.doctorName} - ${invalidReason}` 
                              : `${assignment.doctorName} - ${TIME_SLOT_LABELS[assignment.timeSlot]} (trascina per scambiare)`;
                            
                            if (dragState.isOver && dragState.isBlocked) {
                              dragTitle = `❌ ${dragState.blockReason}`;
                            } else if (dragState.isOver && (dragState.warnings.for1 || dragState.warnings.for2)) {
                              const warningParts = [];
                              if (dragState.warnings.for1) warningParts.push(`⚠️ ${dragState.warnings.for1}`);
                              if (dragState.warnings.for2) warningParts.push(`⚠️ ${dragState.warnings.for2}`);
                              dragTitle = `Scambio con warning: ${warningParts.join(', ')}`;
                            }
                            
                            return (
                              <div
                                key={assignment.id}
                                className={`assignment-chip ${assignment.locked ? 'locked' : ''} ${isEditing ? 'editing' : ''} ${isDragging ? 'dragging' : ''} ${dragState.isOver && !dragState.isBlocked ? 'drag-over' : ''} ${dragState.isOver && dragState.isBlocked ? 'drag-blocked' : ''} ${dragState.isOver && !dragState.isBlocked && (dragState.warnings.for1 || dragState.warnings.for2) ? 'drag-warning' : ''}`}
                                style={{
                                  backgroundColor: getDoctorColor(assignment.doctorId) + '30',
                                  borderColor: getDoctorColor(assignment.doctorId)
                                }}
                                draggable={!isEditing && !assignment.locked}
                                onDragStart={() => !assignment.locked && handleDragStart(assignment.id)}
                                onDragEnd={handleDragEnd}
                                onDragOver={(e) => handleDragOver(e, assignment.id)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, assignment.id)}
                                onClick={() => !assignment.locked && setEditingCell({ date: dateStr, roomId: room.id, timeSlot: assignment.timeSlot })}
                                title={assignment.locked ? `🔒 ${assignment.doctorName} (pre-compilato)` : dragTitle}
                              >
                                {assignment.locked && <span className="lock-icon">🔒</span>}
                                {invalidReason && !assignment.locked && <span className="invalid-icon">⚠️</span>}
                                {dragState.isOver && dragState.isBlocked && (
                                  <div className="drag-tooltip drag-tooltip-blocked">
                                    ❌ {dragState.blockReason}
                                  </div>
                                )}
                                {dragState.isOver && !dragState.isBlocked && (dragState.warnings.for1 || dragState.warnings.for2) && (
                                  <div className="drag-tooltip drag-tooltip-warning">
                                    ⚠️ {dragState.warnings.for1 || dragState.warnings.for2}
                                  </div>
                                )}
                                <span 
                                  className="doctor-color-dot" 
                                  style={{ backgroundColor: getDoctorColor(assignment.doctorId) }}
                                ></span>
                                <span className="doctor-name">{assignment.doctorName}</span>
                                <span className="time-slot">{assignment.timeSlot.split('-')[0]}</span>
                                {isEditing && (
                                  <div className="edit-dropdown" onClick={e => e.stopPropagation()}>
                                    <div className="dropdown-header">
                                      <span>Cambia dottore</span>
                                      <button className="btn-close" onClick={() => setEditingCell(null)}>✕</button>
                                    </div>
                                    {doctors.map(doctor => {
                                      const unavailabilityReason = getDoctorUnavailabilityReason(dateStr, assignment.timeSlot, doctor.id, assignment.id);
                                      const isCurrent = doctor.id === assignment.doctorId;
                                      const isUnavailable = !!unavailabilityReason;
                                      const isRestShift = isRestRequiredShift(room.id, assignment.timeSlot);
                                      const isExclusiveShift = isFullDayExclusiveShift(room.id, assignment.timeSlot);
                                      const nextDayConflicts = isRestShift ? getDoctorNextDayAssignmentsCount(dateStr, doctor.id) : 0;
                                      const sameDayConflicts = isExclusiveShift ? getDoctorSameDayOtherAssignmentsCount(dateStr, doctor.id, assignment.id) : 0;
                                      const isOnRestDay = isDoctorOnRestDay(dateStr, doctor.id);
                                      const hasExclusiveConflict = hasDoctorExclusiveShiftOnDay(dateStr, doctor.id) && !isCurrent;
                                      const isOnVacation = isDoctorDateBlocked(dateStr, doctor.id);
                                      const hasWarning = (nextDayConflicts > 0 || sameDayConflicts > 0 || isOnRestDay || hasExclusiveConflict || isOnVacation) && !isCurrent;
                                      
                                      let warningText = '';
                                      if (isOnVacation) warningText = 'Ferie';
                                      else if (isOnRestDay) warningText = 'Smontante';
                                      else if (hasExclusiveConflict) warningText = 'Montante';
                                      else if (sameDayConflicts > 0) warningText = `${sameDayConflicts} oggi`;
                                      else if (nextDayConflicts > 0) warningText = `${nextDayConflicts} domani`;
                                      
                                      return (
                                        <button
                                          key={doctor.id}
                                          className={`dropdown-item ${isCurrent ? 'current' : ''} ${isUnavailable ? 'unavailable' : ''} ${hasWarning ? 'has-warning' : ''}`}
                                          style={{ borderLeftColor: doctor.color }}
                                          onClick={() => !isUnavailable && changeAssignmentDoctor(assignment.id, doctor.id)}
                                          disabled={isUnavailable}
                                          title={isUnavailable ? unavailabilityReason! : warningText ? `${warningText} - attenzione` : ''}
                                        >
                                          <span className="doctor-dot" style={{ backgroundColor: doctor.color }}></span>
                                          {doctor.name}
                                          {isUnavailable && <span className="unavailable-badge">{unavailabilityReason}</span>}
                                          {hasWarning && !isUnavailable && <span className="warning-badge">{isOnVacation ? '🏖️' : '⚠️'} {warningText}</span>}
                                        </button>
                                      );
                                    })}
                                    <button
                                      className="dropdown-item delete"
                                      onClick={() => { removeAssignment(assignment.id); setEditingCell(null); }}
                                    >
                                      🗑️ Rimuovi turno
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          <button
                            className="btn-add-assignment"
                            onClick={() => setShowAddModal({ date: dateStr, roomId: room.id, timeSlot: '08:00-14:00' })}
                            title="Aggiungi turno"
                          >
                            +
                          </button>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {calendarView === 'doctors' && (
      <div className="calendar-table-container">
        <table className="calendar-table doctor-calendar">
          <thead>
            <tr>
              <th className="sticky-col day-col">Giorno</th>
              <th className="sticky-col weekday-col">Sett.</th>
              {doctors.map(doctor => (
                <th key={doctor.id} style={{ borderBottomColor: doctor.color }}>
                  <span className="doctor-header">
                    <span className="doctor-dot" style={{ backgroundColor: doctor.color }}></span>
                    {doctor.name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: daysInMonth }, (_, index) => {
              const day = index + 1;
              const date = new Date(schedule.year, schedule.month - 1, day);
              const weekday = date.getDay();
              const dateStr = `${schedule.year}-${String(schedule.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const { isWeekend, isHoliday } = isWeekendOrHoliday(dateStr);
              const isWeekendOrHolidayDay = isWeekend || isHoliday;

              return (
                <tr key={day} className={isWeekendOrHolidayDay ? 'weekend-or-holiday-row' : ''}>
                  <td className={`sticky-col day-col ${isWeekendOrHolidayDay ? 'weekend-day' : ''}`}>
                    {day}
                    {isHoliday && !isWeekend && <span className="holiday-marker">🎄</span>}
                  </td>
                  <td className={`sticky-col weekday-col ${isWeekendOrHolidayDay ? 'weekend-day' : ''}`}>
                    {weekdayNames[weekday]}
                  </td>
                  {doctors.map(doctor => {
                    const doctorAssignments = schedule.assignments
                      .filter(a => a.date === dateStr && a.doctorId === doctor.id)
                      .sort((a, b) => TIME_SLOT_ORDER[a.timeSlot] - TIME_SLOT_ORDER[b.timeSlot]);
                    
                    const isOnVacation = isDoctorDateBlocked(dateStr, doctor.id);
                    const isOnRestDay = isDoctorOnRestDay(dateStr, doctor.id);

                    return (
                      <td 
                        key={doctor.id} 
                        className={`assignment-cell doctor-cell ${isOnVacation ? 'vacation-cell' : ''} ${isOnRestDay ? 'rest-cell' : ''}`}
                        style={{ borderLeftColor: doctor.color + '40' }}
                      >
                        {isOnVacation && doctorAssignments.length === 0 && (
                          <span className="cell-status vacation">🏖️</span>
                        )}
                        {isOnRestDay && !isOnVacation && doctorAssignments.length === 0 && (
                          <span className="cell-status rest">😴</span>
                        )}
                        <div className="assignments doctor-assignments">
                          {doctorAssignments.map((assignment) => {
                            const room = rooms.find(r => r.id === assignment.roomId);
                            const invalidReason = getAssignmentInvalidReason(assignment);
                            const isDragging = draggingAssignment === assignment.id;
                            const dragState = getDragOverState(assignment.id);
                            
                            return (
                              <div
                                key={assignment.id}
                                className={`assignment-chip-mini ${assignment.locked ? 'locked' : ''} ${isDragging ? 'dragging' : ''} ${dragState.isOver && !dragState.isBlocked ? 'drag-over' : ''} ${dragState.isOver && dragState.isBlocked ? 'drag-blocked' : ''} ${invalidReason && !assignment.locked ? 'has-warning' : ''}`}
                                style={{
                                  backgroundColor: (room?.color || '#888') + '30',
                                  borderColor: room?.color || '#888'
                                }}
                                draggable={!assignment.locked}
                                onDragStart={() => !assignment.locked && handleDragStart(assignment.id)}
                                onDragEnd={handleDragEnd}
                                onDragOver={(e) => handleDragOver(e, assignment.id)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, assignment.id)}
                                title={assignment.locked ? `🔒 ${room?.name || ''} (pre-compilato)` : `${room?.name || ''} - ${TIME_SLOT_LABELS[assignment.timeSlot]}${invalidReason ? ` ⚠️ ${invalidReason}` : ''}`}
                              >
                                {assignment.locked && <span className="lock-icon-mini">🔒</span>}
                                {invalidReason && !assignment.locked && <span className="invalid-icon-mini">⚠️</span>}
                                {dragState.isOver && dragState.isBlocked && (
                                  <div className="drag-tooltip drag-tooltip-blocked">
                                    ❌ {dragState.blockReason}
                                  </div>
                                )}
                                <span className="room-abbr">{room?.name?.slice(0, 3) || '?'}</span>
                                <span className="time-slot-mini">{assignment.timeSlot.split('-')[0]}</span>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {calendarView === 'monthly' && (
      <div className="monthly-grid-container">
        <div className="monthly-grid-header">
          {[1, 2, 3, 4, 5, 6, 0].map(dayIdx => (
            <div key={dayIdx} className={`monthly-grid-header-cell ${dayIdx === 0 || dayIdx === 6 ? 'weekend' : ''}`}>
              {weekdayNamesFull[dayIdx === 0 ? 6 : dayIdx - 1]}
            </div>
          ))}
        </div>
        <div className="monthly-grid-body">
          {(() => {
            const firstDayOfMonth = new Date(schedule.year, schedule.month - 1, 1);
            const startOffset = (firstDayOfMonth.getDay() + 6) % 7;
            const totalCells = startOffset + daysInMonth;
            const totalRows = Math.ceil(totalCells / 7);

            return Array.from({ length: totalRows }, (_, weekIdx) => (
              <div key={weekIdx} className="monthly-grid-week">
                {Array.from({ length: 7 }, (_, colIdx) => {
                  const cellIdx = weekIdx * 7 + colIdx;
                  const day = cellIdx - startOffset + 1;

                  if (day < 1 || day > daysInMonth) {
                    return <div key={colIdx} className="monthly-grid-cell empty" />;
                  }

                  const dateStr = `${schedule.year}-${String(schedule.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const weekendHoliday = isWeekendOrHoliday(dateStr);
                  const isWeekendOrHolidayDay = weekendHoliday.isWeekend || weekendHoliday.isHoliday;
                  const dayAssignments = schedule.assignments
                    .filter(a => a.date === dateStr)
                    .sort((a, b) => TIME_SLOT_ORDER[a.timeSlot] - TIME_SLOT_ORDER[b.timeSlot]);

                  const byRoom = new Map<string, typeof dayAssignments>();
                  for (const a of dayAssignments) {
                    if (!byRoom.has(a.roomId)) byRoom.set(a.roomId, []);
                    byRoom.get(a.roomId)!.push(a);
                  }

                  return (
                    <div key={colIdx} className={`monthly-grid-cell ${isWeekendOrHolidayDay ? 'weekend-or-holiday' : ''}`}>
                      <div className="monthly-grid-day-number">
                        {day}
                        {weekendHoliday.isHoliday && !weekendHoliday.isWeekend && <span className="holiday-marker">🎄</span>}
                      </div>
                      <div className="monthly-grid-assignments">
                        {rooms.map(room => {
                          const roomAssignments = byRoom.get(room.id);
                          if (!roomAssignments || roomAssignments.length === 0) return null;

                          return (
                            <div key={room.id} className="monthly-grid-room-group">
                              <div className="monthly-grid-room-label" style={{ backgroundColor: room.color + '30', borderColor: room.color }}>
                                {room.name}
                              </div>
                              {roomAssignments.map(assignment => {
                                const invalidReason = getAssignmentInvalidReason(assignment);
                                const timeLabel = TIME_SLOT_TIME_LABELS[assignment.timeSlot];
                                return (
                                  <div
                                    key={assignment.id}
                                    className={`monthly-grid-assignment ${assignment.locked ? 'locked' : ''} ${invalidReason && !assignment.locked ? 'has-warning' : ''}`}
                                    style={{ backgroundColor: getDoctorColor(assignment.doctorId) + '25', borderLeft: `3px solid ${getDoctorColor(assignment.doctorId)}` }}
                                    title={assignment.locked ? `🔒 ${assignment.doctorName} (pre-compilato)` : `${assignment.doctorName} - ${room.name} ${assignment.timeSlot}${invalidReason ? ` ⚠️ ${invalidReason}` : ''}`}
                                  >
                                    {assignment.locked && <span className="warning-dot">🔒</span>}
                                    {invalidReason && !assignment.locked && <span className="warning-dot">⚠️</span>}
                                    <span className="assignment-time">{timeLabel}</span>
                                    <span className="assignment-doctor">{assignment.doctorName}</span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ));
          })()}
        </div>
      </div>
      )}

      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Aggiungi Turno</h3>
              <button className="btn-close" onClick={() => setShowAddModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="modal-info">
                <strong>Data:</strong> {parseInt(showAddModal.date.split('-')[2])} {monthNames[schedule.month - 1]}
                <br />
                <strong>Sala:</strong> {rooms.find(r => r.id === showAddModal.roomId)?.name}
              </div>
              <div className="modal-field">
                <label>Fascia oraria</label>
                <div className="time-slot-buttons">
                  {TIME_SLOTS.map(slot => (
                    <button
                      key={slot}
                      className={`time-slot-btn ${showAddModal.timeSlot === slot ? 'active' : ''}`}
                      onClick={() => setShowAddModal({ ...showAddModal, timeSlot: slot })}
                    >
                      {TIME_SLOT_LABELS[slot]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="modal-field">
                <label>Dottore</label>
                <div className="doctor-buttons">
                  {doctors.map(doctor => {
                    const unavailabilityReason = getDoctorUnavailabilityReason(showAddModal.date, showAddModal.timeSlot, doctor.id);
                    const isUnavailable = !!unavailabilityReason;
                    const isOnRestDay = isDoctorOnRestDay(showAddModal.date, doctor.id);
                    const isRestShift = isRestRequiredShift(showAddModal.roomId, showAddModal.timeSlot);
                    const isExclusiveShift = isFullDayExclusiveShift(showAddModal.roomId, showAddModal.timeSlot);
                    const nextDayConflicts = isRestShift ? getDoctorNextDayAssignmentsCount(showAddModal.date, doctor.id) : 0;
                    const sameDayConflicts = isExclusiveShift ? getDoctorSameDayOtherAssignmentsCount(showAddModal.date, doctor.id) : 0;
                    const hasExclusiveConflict = hasDoctorExclusiveShiftOnDay(showAddModal.date, doctor.id);
                    const isOnVacation = isDoctorDateBlocked(showAddModal.date, doctor.id);
                    const hasWarning = isOnRestDay || nextDayConflicts > 0 || sameDayConflicts > 0 || hasExclusiveConflict || isOnVacation;
                    
                    let warningText = '';
                    if (isOnVacation) warningText = 'Ferie';
                    else if (isOnRestDay) warningText = 'Smontante';
                    else if (hasExclusiveConflict) warningText = 'Montante';
                    else if (sameDayConflicts > 0) warningText = `${sameDayConflicts} oggi`;
                    else if (nextDayConflicts > 0) warningText = `${nextDayConflicts} domani`;
                    
                    return (
                      <button
                        key={doctor.id}
                        className={`doctor-select-btn ${isUnavailable ? 'unavailable' : ''} ${hasWarning ? 'has-warning' : ''}`}
                        style={{ 
                          borderColor: doctor.color, 
                          backgroundColor: isUnavailable ? 'transparent' : doctor.color + '20',
                          opacity: isUnavailable ? 0.5 : 1
                        }}
                        onClick={() => !isUnavailable && addAssignment(showAddModal.date, showAddModal.roomId, showAddModal.timeSlot, doctor.id)}
                        disabled={isUnavailable}
                        title={isUnavailable ? unavailabilityReason! : warningText ? `${warningText} - attenzione` : ''}
                      >
                        <span className="doctor-dot" style={{ backgroundColor: doctor.color }}></span>
                        {doctor.name}
                        {isUnavailable && <span className="unavailable-text">{unavailabilityReason}</span>}
                        {hasWarning && !isUnavailable && <span className="warning-text">{isOnVacation ? '🏖️' : '⚠️'} {warningText}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="doctor-stats-section">
        <h3>Riepilogo per Dottore</h3>
        <div className="stats-table-container">
          <table className="stats-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => handleSort('name')}>Dottore{getSortIndicator('name')}</th>
                <th className="sortable" onClick={() => handleSort('shifts')}>Turni{getSortIndicator('shifts')}</th>
                <th className="sortable" onClick={() => handleSort('days')}>Giorni{getSortIndicator('days')}</th>
                <th className="sortable" onClick={() => handleSort('hours')}>Ore{getSortIndicator('hours')}</th>
                <th className="weekend-header sortable" onClick={() => handleSort('weekend')}>Weekend{getSortIndicator('weekend')}</th>
                {totalCriticalShifts > 0 && <th className="critical-header sortable" onClick={() => handleSort('critical')}>Critici{getSortIndicator('critical')}</th>}
                {rooms.map(room => (
                  <th key={room.id} className="sortable" onClick={() => handleSort(`room-${room.id}`)}>
                    {room.name}{getSortIndicator(`room-${room.id}`)}
                  </th>
                ))}
                <th className="timeslot-header separator-left sortable" onClick={() => handleSort('morning')}>Mattina{getSortIndicator('morning')}</th>
                <th className="timeslot-header sortable" onClick={() => handleSort('afternoon')}>Pomeriggio{getSortIndicator('afternoon')}</th>
                <th className="timeslot-header sortable" onClick={() => handleSort('night')}>Notte{getSortIndicator('night')}</th>
              </tr>
            </thead>
            <tbody>
              {[...stats].sort((a, b) => {
                let aValue: number | string = 0;
                let bValue: number | string = 0;
                
                switch (sortColumn) {
                  case 'name':
                    aValue = a.doctorName.toLowerCase();
                    bValue = b.doctorName.toLowerCase();
                    break;
                  case 'shifts':
                    aValue = a.totalShifts;
                    bValue = b.totalShifts;
                    break;
                  case 'days':
                    aValue = a.distinctDays;
                    bValue = b.distinctDays;
                    break;
                  case 'hours':
                    aValue = a.totalHours;
                    bValue = b.totalHours;
                    break;
                  case 'weekend':
                    aValue = a.weekendShifts;
                    bValue = b.weekendShifts;
                    break;
                  case 'critical':
                    aValue = a.criticalShifts;
                    bValue = b.criticalShifts;
                    break;
                  case 'morning':
                    aValue = a.shiftsByTimeSlot['08:00-14:00'];
                    bValue = b.shiftsByTimeSlot['08:00-14:00'];
                    break;
                  case 'afternoon':
                    aValue = a.shiftsByTimeSlot['14:00-20:00'];
                    bValue = b.shiftsByTimeSlot['14:00-20:00'];
                    break;
                  case 'night':
                    aValue = a.shiftsByTimeSlot['20:00-08:00'];
                    bValue = b.shiftsByTimeSlot['20:00-08:00'];
                    break;
                  default:
                    if (sortColumn.startsWith('room-')) {
                      const roomId = sortColumn.replace('room-', '');
                      aValue = a.shiftsByRoom[roomId] || 0;
                      bValue = b.shiftsByRoom[roomId] || 0;
                    }
                }
                
                if (typeof aValue === 'string' && typeof bValue === 'string') {
                  return sortDirection === 'asc' 
                    ? aValue.localeCompare(bValue) 
                    : bValue.localeCompare(aValue);
                }
                
                return sortDirection === 'asc' 
                  ? (aValue as number) - (bValue as number) 
                  : (bValue as number) - (aValue as number);
              }).map(stat => (
                <tr key={stat.doctorId}>
                  <td className="doctor-name-cell">
                    <span className="doctor-dot" style={{ backgroundColor: stat.doctorColor }}></span>
                    {stat.doctorName}
                  </td>
                  <td className="total-cell">
                    <span className="total-badge" style={{ background: stat.doctorColor }}>{stat.totalShifts}</span>
                  </td>
                  <td className="days-cell">{stat.distinctDays}</td>
                  <td className="hours-cell">{stat.totalHours}h</td>
                  <td className="weekend-cell">{stat.weekendShifts}</td>
                  {totalCriticalShifts > 0 && <td className="critical-cell">{stat.criticalShifts}</td>}
                  {rooms.map(room => (
                    <td key={room.id}>
                      {stat.shiftsByRoom[room.id] || 0}
                    </td>
                  ))}
                  <td className="timeslot-cell separator-left">{stat.shiftsByTimeSlot['08:00-14:00']}</td>
                  <td className="timeslot-cell">{stat.shiftsByTimeSlot['14:00-20:00']}</td>
                  <td className="timeslot-cell">{stat.shiftsByTimeSlot['20:00-08:00']}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="totals-row">
                <td className="footer-label">TOTALE</td>
                <td className="total-cell">{tableSummary.totals.shifts}</td>
                <td>{tableSummary.totals.days}</td>
                <td>{tableSummary.totals.hours}h</td>
                <td>{tableSummary.totals.weekend}</td>
                {totalCriticalShifts > 0 && <td>{tableSummary.totals.critical}</td>}
                {rooms.map(room => (
                  <td key={room.id}>{tableSummary.totals.byRoom[room.id]}</td>
                ))}
                <td className="separator-left">{tableSummary.totals.morning}</td>
                <td>{tableSummary.totals.afternoon}</td>
                <td>{tableSummary.totals.night}</td>
              </tr>
              <tr className="average-row">
                <td className="footer-label">MEDIA</td>
                <td>{tableSummary.averages.shifts.toFixed(1)}</td>
                <td>{tableSummary.averages.days.toFixed(1)}</td>
                <td>{tableSummary.averages.hours.toFixed(1)}h</td>
                <td>{tableSummary.averages.weekend.toFixed(1)}</td>
                {totalCriticalShifts > 0 && <td>{tableSummary.averages.critical.toFixed(1)}</td>}
                {rooms.map(room => (
                  <td key={room.id}>{tableSummary.averages.byRoom[room.id].toFixed(1)}</td>
                ))}
                <td className="separator-left">{tableSummary.averages.morning.toFixed(1)}</td>
                <td>{tableSummary.averages.afternoon.toFixed(1)}</td>
                <td>{tableSummary.averages.night.toFixed(1)}</td>
              </tr>
              <tr className="stddev-row">
                <td className="footer-label">DEV.STD</td>
                <td>{tableSummary.stdDevs.shifts.toFixed(2)}</td>
                <td>{tableSummary.stdDevs.days.toFixed(2)}</td>
                <td>{tableSummary.stdDevs.hours.toFixed(2)}</td>
                <td>{tableSummary.stdDevs.weekend.toFixed(2)}</td>
                {totalCriticalShifts > 0 && <td>{tableSummary.stdDevs.critical.toFixed(2)}</td>}
                {rooms.map(room => (
                  <td key={room.id}>{tableSummary.stdDevs.byRoom[room.id].toFixed(2)}</td>
                ))}
                <td className="separator-left">{tableSummary.stdDevs.morning.toFixed(2)}</td>
                <td>{tableSummary.stdDevs.afternoon.toFixed(2)}</td>
                <td>{tableSummary.stdDevs.night.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
