import { useState, useMemo } from 'react';
import { MonthlySchedule, OperativeRoom, Doctor, Assignment, TimeSlot, TIME_SLOTS, TIME_SLOT_LABELS, TIME_SLOT_ORDER } from '../models/types';
import { ScheduleGeneratorService } from '../services/ScheduleGeneratorService';
import { StorageService } from '../services/StorageService';
import { generateId } from '../utils/idGenerator';
import './MonthlyCalendar.css';

interface MonthlyCalendarProps {
  schedule: MonthlySchedule;
  rooms: OperativeRoom[];
  doctors: Doctor[];
  onScheduleChange: (schedule: MonthlySchedule) => void;
}

interface EditingCell {
  date: string;
  roomId: string;
  timeSlot: TimeSlot;
}

export function MonthlyCalendar({ schedule, rooms, doctors, onScheduleChange }: MonthlyCalendarProps) {
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [showAddModal, setShowAddModal] = useState<EditingCell | null>(null);
  const [draggingAssignment, setDraggingAssignment] = useState<string | null>(null);
  const [dragOverAssignment, setDragOverAssignment] = useState<string | null>(null);

  const doctorDateExclusions = useMemo(() => {
    const config = StorageService.loadGenerationConfig(schedule.year, schedule.month);
    return config?.doctorDateExclusions || {};
  }, [schedule.year, schedule.month]);

  const isDoctorOnVacation = (date: string, doctorId: string): boolean => {
    const exclusions = doctorDateExclusions[doctorId] || [];
    return exclusions.includes(date);
  };

  const monthNames = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
  ];

  const weekdayNames = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

  const daysInMonth = new Date(schedule.year, schedule.month, 0).getDate();
  const stats = ScheduleGeneratorService.calculateStats(schedule, doctors, rooms);

  const getDoctorColor = (doctorId: string): string => {
    const doctor = doctors.find(d => d.id === doctorId);
    return doctor?.color || '#888';
  };

  const isWeekendOrHoliday = (dateStr: string): { isWeekend: boolean; isHoliday: boolean } => {
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday = schedule.holidays.includes(dateStr);
    return { isWeekend, isHoliday };
  };

  const handleDownloadCSV = () => {
    StorageService.downloadCSV(schedule, rooms);
  };

  const removeAssignment = (assignmentId: string) => {
    const newAssignments = schedule.assignments.filter(a => a.id !== assignmentId);
    onScheduleChange({ ...schedule, assignments: newAssignments });
  };

  const isDoctorAlreadyAssigned = (date: string, timeSlot: TimeSlot, doctorId: string, excludeAssignmentId?: string): boolean => {
    return schedule.assignments.some(
      a => a.date === date && 
           a.timeSlot === timeSlot && 
           a.doctorId === doctorId &&
           a.id !== excludeAssignmentId
    );
  };

  const isDoctorOnRestDay = (date: string, doctorId: string): boolean => {
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
    if (isDoctorOnVacation(assignment.date, assignment.doctorId)) {
      return 'Ferie';
    }

    if (isDoctorOnRestDay(assignment.date, assignment.doctorId)) {
      return 'Smontante';
    }

    const isThisExclusive = isFullDayExclusiveShift(assignment.roomId, assignment.timeSlot);
    const otherSameDayAssignments = schedule.assignments.filter(
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
    return schedule.assignments.filter(a => getAssignmentInvalidReason(a) !== null);
  }, [schedule.assignments, rooms, doctorDateExclusions]);

  const getNextDayStr = (date: string): string => {
    const currentDate = new Date(date);
    const nextDate = new Date(currentDate);
    nextDate.setDate(nextDate.getDate() + 1);
    return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
  };

  const getDoctorNextDayAssignmentsCount = (date: string, doctorId: string): number => {
    const nextDayStr = getNextDayStr(date);
    return schedule.assignments.filter(a => a.date === nextDayStr && a.doctorId === doctorId).length;
  };

  const getDoctorSameDayOtherAssignmentsCount = (date: string, doctorId: string, excludeAssignmentId?: string): number => {
    return schedule.assignments.filter(a => a.date === date && a.doctorId === doctorId && a.id !== excludeAssignmentId).length;
  };

  const hasDoctorExclusiveShiftOnDay = (date: string, doctorId: string): boolean => {
    const sameDayAssignments = schedule.assignments.filter(a => a.date === date && a.doctorId === doctorId);
    return sameDayAssignments.some(a => isFullDayExclusiveShift(a.roomId, a.timeSlot));
  };

  const addAssignment = (date: string, roomId: string, timeSlot: TimeSlot, doctorId: string) => {
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
    const assignment1 = schedule.assignments.find(a => a.id === assignmentId1);
    const assignment2 = schedule.assignments.find(a => a.id === assignmentId2);
    if (!assignment1 || !assignment2) return { for1: null, for2: null };

    let warning1: string | null = null;
    let warning2: string | null = null;

    if (isDoctorOnVacation(assignment2.date, assignment1.doctorId)) {
      warning1 = 'Ferie';
    } else if (isDoctorOnRestDay(assignment2.date, assignment1.doctorId)) {
      warning1 = 'Smontante';
    }

    if (isDoctorOnVacation(assignment1.date, assignment2.doctorId)) {
      warning2 = 'Ferie';
    } else if (isDoctorOnRestDay(assignment1.date, assignment2.doctorId)) {
      warning2 = 'Smontante';
    }

    return { for1: warning1, for2: warning2 };
  };

  const swapAssignmentDoctors = (assignmentId1: string, assignmentId2: string) => {
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

  return (
    <div className="monthly-calendar">
      <div className="calendar-header">
        <h2>{monthNames[schedule.month - 1]} {schedule.year}</h2>
        <button className="btn-download" onClick={handleDownloadCSV}>
          📥 Scarica CSV
        </button>
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
                                className={`assignment-chip ${isEditing ? 'editing' : ''} ${isDragging ? 'dragging' : ''} ${dragState.isOver && !dragState.isBlocked ? 'drag-over' : ''} ${dragState.isOver && dragState.isBlocked ? 'drag-blocked' : ''} ${dragState.isOver && !dragState.isBlocked && (dragState.warnings.for1 || dragState.warnings.for2) ? 'drag-warning' : ''}`}
                                style={{ 
                                  backgroundColor: getDoctorColor(assignment.doctorId) + '30',
                                  borderColor: getDoctorColor(assignment.doctorId)
                                }}
                                draggable={!isEditing}
                                onDragStart={() => handleDragStart(assignment.id)}
                                onDragEnd={handleDragEnd}
                                onDragOver={(e) => handleDragOver(e, assignment.id)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, assignment.id)}
                                onClick={() => setEditingCell({ date: dateStr, roomId: room.id, timeSlot: assignment.timeSlot })}
                                title={dragTitle}
                              >
                                {invalidReason && <span className="invalid-icon">⚠️</span>}
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
                                      const isOnVacation = isDoctorOnVacation(dateStr, doctor.id);
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
                    const isOnVacation = isDoctorOnVacation(showAddModal.date, doctor.id);
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
                <th>Dottore</th>
                <th>Turni</th>
                <th>Ore</th>
                <th className="weekend-header">Weekend</th>
                {totalCriticalShifts > 0 && <th className="critical-header">Critici</th>}
                {rooms.map(room => (
                  <th key={room.id}>
                    {room.name}
                  </th>
                ))}
                <th>Mattina</th>
                <th>Pomeriggio</th>
                <th>Notte</th>
              </tr>
            </thead>
            <tbody>
              {stats.sort((a, b) => b.totalShifts - a.totalShifts).map(stat => (
                <tr key={stat.doctorId}>
                  <td className="doctor-name-cell">
                    <span className="doctor-dot" style={{ backgroundColor: stat.doctorColor }}></span>
                    {stat.doctorName}
                  </td>
                  <td className="total-cell">
                    <span className="total-badge" style={{ background: stat.doctorColor }}>{stat.totalShifts}</span>
                  </td>
                  <td className="hours-cell">{stat.totalHours}h</td>
                  <td className="weekend-cell">{stat.weekendShifts}</td>
                  {totalCriticalShifts > 0 && <td className="critical-cell">{stat.criticalShifts}</td>}
                  {rooms.map(room => (
                    <td key={room.id}>
                      {stat.shiftsByRoom[room.id] || 0}
                    </td>
                  ))}
                  <td>{stat.shiftsByTimeSlot['08:00-14:00']}</td>
                  <td>{stat.shiftsByTimeSlot['14:00-20:00']}</td>
                  <td>{stat.shiftsByTimeSlot['20:00-08:00']}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
