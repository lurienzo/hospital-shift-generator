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

  const addAssignment = (date: string, roomId: string, timeSlot: TimeSlot, doctorId: string) => {
    const doctor = doctors.find(d => d.id === doctorId);
    const room = rooms.find(r => r.id === roomId);
    if (!doctor || !room) return;

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

    const newAssignments = schedule.assignments.map(a =>
      a.id === assignmentId
        ? { ...a, doctorId: doctor.id, doctorName: doctor.name }
        : a
    );
    onScheduleChange({ ...schedule, assignments: newAssignments });
    setEditingCell(null);
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
      </div>

      <div className="calendar-legend">
        <span className="legend-item">
          <span className="legend-color weekend-legend"></span>
          Weekend/Festivo
        </span>
        <span className="legend-tip">💡 Clicca su un turno per modificarlo, o sul + per aggiungerne uno</span>
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
                            
                            return (
                              <div
                                key={assignment.id}
                                className={`assignment-chip ${isEditing ? 'editing' : ''}`}
                                style={{ 
                                  backgroundColor: getDoctorColor(assignment.doctorId) + '30',
                                  borderColor: getDoctorColor(assignment.doctorId)
                                }}
                                onClick={() => setEditingCell({ date: dateStr, roomId: room.id, timeSlot: assignment.timeSlot })}
                                title={`${assignment.doctorName} - ${TIME_SLOT_LABELS[assignment.timeSlot]}`}
                              >
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
                                    {doctors.map(doctor => (
                                      <button
                                        key={doctor.id}
                                        className={`dropdown-item ${doctor.id === assignment.doctorId ? 'current' : ''}`}
                                        style={{ borderLeftColor: doctor.color }}
                                        onClick={() => changeAssignmentDoctor(assignment.id, doctor.id)}
                                      >
                                        <span className="doctor-dot" style={{ backgroundColor: doctor.color }}></span>
                                        {doctor.name}
                                      </button>
                                    ))}
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
                  {doctors.map(doctor => (
                    <button
                      key={doctor.id}
                      className="doctor-select-btn"
                      style={{ borderColor: doctor.color, backgroundColor: doctor.color + '20' }}
                      onClick={() => addAssignment(showAddModal.date, showAddModal.roomId, showAddModal.timeSlot, doctor.id)}
                    >
                      <span className="doctor-dot" style={{ backgroundColor: doctor.color }}></span>
                      {doctor.name}
                    </button>
                  ))}
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
                <th>Totale</th>
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
