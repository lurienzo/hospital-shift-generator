import { useCallback, useMemo, useState } from 'react';
import { Assignment, MonthlySchedule } from '../models/types';
import { StorageService } from '../services/StorageService';
import { computeStats, buildStatColumns, standardDeviation } from '../domain/stats';
import {
  AvailabilityRules,
  RoomSlotIndex,
  Violation,
  buildRequirements,
  findCoverageGaps,
  findViolations,
  primaryViolation,
} from '../domain/validation';
import { RotationTracker } from '../domain/rotation';
import { EMPTY_HOURS_REPORT, buildHoursReport } from '../domain/hours';
import { measureLengthPreference } from '../domain/preferences';
import { useConfig } from '../state/configContext';
import { ScheduleVersionManager } from './ScheduleVersionManager';
import { StatsTable } from './StatsTable';
import { BulkAssignModal } from './BulkAssignModal';
import { Popover } from './ui/Popover';
import {
  MONTH_NAMES_SHORT,
  WEEKDAY_SHORT_BY_INDEX,
  buildMonthDays,
  getDaysInMonth,
  formatDayMonth,
  formatMonthLabel,
  mondayFirstIndex,
} from '../utils/date';
import { generateId } from '../utils/id';
import './MonthlyCalendar.css';

interface MonthlyCalendarProps {
  schedule: MonthlySchedule | null;
  onScheduleChange: (schedule: MonthlySchedule | null) => void;
  onNavigateToGenerate: (year: number, month: number) => void;
  hasUnsavedChanges: boolean;
  isNewDraft: boolean;
  savedVersionId: string | null;
  versionsRevision: number;
  onLoadVersion: (schedule: MonthlySchedule, versionId: string) => void;
  onSaveVersion: (name: string, createNew: boolean) => void;
  onDiscardChanges: () => void;
  onDuplicateVersion: (sourceVersionId: string, newName: string) => void;
  onVersionsChanged: () => void;
}

type CalendarView = 'rooms' | 'doctors' | 'month';

const VIEW_LABELS: Record<CalendarView, string> = {
  rooms: 'Per sala',
  doctors: 'Per dottore',
  month: 'Griglia mese',
};

export function MonthlyCalendar({
  schedule,
  onScheduleChange,
  onNavigateToGenerate,
  hasUnsavedChanges,
  isNewDraft,
  savedVersionId,
  versionsRevision,
  onLoadVersion,
  onSaveVersion,
  onDiscardChanges,
  onDuplicateVersion,
  onVersionsChanged,
}: MonthlyCalendarProps) {
  const {
    rooms, doctors, shiftTypes, shiftTypeIndex,
    rotationRule, rotationScheme, hoursTarget, doctorRules, lengthScale,
  } = useConfig();

  const [view, setView] = useState<CalendarView>('rooms');
  const [selectedYear, setSelectedYear] = useState(schedule?.year ?? new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(schedule?.month ?? new Date().getMonth() + 1);
  const [editing, setEditing] = useState<{ assignment: Assignment; anchor: HTMLElement } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [bulkTarget, setBulkTarget] = useState<
    { date?: string; roomId?: string; shiftTypeId?: string } | null
  >(null);

  const year = schedule?.year ?? selectedYear;
  const month = schedule?.month ?? selectedMonth;

  const versionCounts = useMemo(
    () => StorageService.countVersionsByMonth(selectedYear),
    // `versionsRevision` non compare nel calcolo ma ne invalida il risultato: i dati
    // vivono in localStorage, che React non osserva.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedYear, versionsRevision],
  );

  const generationConfig = useMemo(
    () => StorageService.loadGenerationConfig(year, month),
    [year, month],
  );

  const availability = useMemo(
    () => new AvailabilityRules(generationConfig ?? {}),
    [generationConfig],
  );

  const slotIndex = useMemo(() => new RoomSlotIndex(rooms), [rooms]);

  // La rotazione riprende dal mese precedente, così i primi giorni non
  // risultano fuori pattern solo perché manca il riferimento.
  const rotation = useMemo(() => {
    if (!rotationScheme || !schedule) return undefined;

    const previous = schedule.month === 1
      ? StorageService.getActiveVersion(schedule.year - 1, 12)
      : StorageService.getActiveVersion(schedule.year, schedule.month - 1);

    const tracker = new RotationTracker(rotationScheme, rotationRule, shiftTypeIndex);
    tracker.seed(previous?.schedule.assignments ?? []);
    return tracker;
  }, [rotationScheme, rotationRule, shiftTypeIndex, schedule]);

  /**
   * Il mese precedente serve alle settimane a cavallo: senza, i primi giorni
   * sembrerebbero sempre sotto il minimo di ore.
   */
  const priorAssignments = useMemo(() => {
    if (!schedule) return [];
    const previous = schedule.month === 1
      ? StorageService.getActiveVersion(schedule.year - 1, 12)
      : StorageService.getActiveVersion(schedule.year, schedule.month - 1);
    return previous?.schedule.assignments ?? [];
  }, [schedule]);

  const hours = useMemo(() => {
    if (!schedule) return EMPTY_HOURS_REPORT;

    const firstDay = `${schedule.year}-${String(schedule.month).padStart(2, '0')}-01`;
    const earliestPrior = priorAssignments.reduce<string | null>(
      (earliest, item) => (earliest === null || item.date < earliest ? item.date : earliest),
      null,
    );

    return buildHoursReport({
      year: schedule.year,
      month: schedule.month,
      target: hoursTarget,
      doctors,
      shiftTypes: shiftTypeIndex,
      assignments: [...priorAssignments, ...schedule.assignments],
      known: {
        from: earliestPrior !== null && earliestPrior < firstDay ? earliestPrior : firstDay,
        to: `${schedule.year}-${String(schedule.month).padStart(2, '0')}-${getDaysInMonth(schedule.year, schedule.month)}`,
      },
    });
  }, [schedule, hoursTarget, doctors, shiftTypeIndex, priorAssignments]);

  const lengthPreference = useMemo(() => {
    if (!schedule) return new Map();
    return measureLengthPreference(schedule.assignments, doctors, shiftTypeIndex, lengthScale);
  }, [schedule, doctors, shiftTypeIndex, lengthScale]);

  const hoursIssueCount = hours.issues.length + hours.balanceIssues.length;

  const report = useMemo(() => {
    if (!schedule) return null;
    return findViolations(schedule.assignments, {
      rooms,
      doctors,
      shiftTypes: shiftTypeIndex,
      availability,
      slotIndex,
      rotation,
      rules: doctorRules,
      hours,
    });
  }, [
    schedule, rooms, doctors, shiftTypeIndex, availability, slotIndex,
    rotation, doctorRules, hours,
  ]);

  const gaps = useMemo(() => {
    if (!schedule) return [];
    const holidays = generationConfig?.holidays
      ?? schedule.holidays.map(date => ({ date, disabledRooms: [] }));
    return findCoverageGaps(
      buildRequirements(rooms, schedule.year, schedule.month, holidays),
      schedule.assignments,
    );
  }, [schedule, rooms, generationConfig]);

  const stats = useMemo(() => {
    if (!schedule) return [];
    return computeStats([schedule], { doctors, rooms, shiftTypes: shiftTypeIndex, slotIndex });
  }, [schedule, doctors, rooms, shiftTypeIndex, slotIndex]);

  const statColumns = useMemo(
    () => buildStatColumns({
      rooms,
      shiftTypes,
      includeCritical: stats.some(stat => stat.criticalShifts > 0),
    }),
    [rooms, shiftTypes, stats],
  );

  const days = useMemo(() => buildMonthDays(year, month), [year, month]);
  const holidayDates = useMemo(() => new Set(schedule?.holidays ?? []), [schedule]);

  const assignmentsByDate = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const assignment of schedule?.assignments ?? []) {
      const bucket = map.get(assignment.date);
      if (bucket) bucket.push(assignment);
      else map.set(assignment.date, [assignment]);
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => shiftTypeIndex.compare(a.shiftTypeId, b.shiftTypeId));
    }
    return map;
  }, [schedule, shiftTypeIndex]);

  // ----- Navigazione fra i mesi -----

  const goToMonth = (targetYear: number, targetMonth: number) => {
    if (hasUnsavedChanges
      && !window.confirm('Ci sono modifiche non salvate. Cambiare mese e perderle?')) {
      return;
    }

    setSelectedYear(targetYear);
    setSelectedMonth(targetMonth);

    const active = StorageService.getActiveVersion(targetYear, targetMonth);
    if (active) onLoadVersion(active.schedule, active.id);
    else onScheduleChange(null);
  };

  // ----- Modifica delle assegnazioni -----

  const updateAssignments = useCallback((next: Assignment[]) => {
    if (!schedule) return;
    onScheduleChange({
      ...schedule,
      assignments: [...next].sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return shiftTypeIndex.compare(a.shiftTypeId, b.shiftTypeId);
      }),
    });
  }, [schedule, onScheduleChange, shiftTypeIndex]);

  const changeDoctor = (assignmentId: string, doctorId: string) => {
    if (!schedule) return;
    const doctor = doctors.find(candidate => candidate.id === doctorId);
    if (!doctor) return;

    updateAssignments(schedule.assignments.map(assignment =>
      assignment.id === assignmentId
        ? { ...assignment, doctorId: doctor.id, doctorName: doctor.name }
        : assignment));
    setEditing(null);
  };

  const removeAssignment = (assignmentId: string) => {
    if (!schedule) return;
    updateAssignments(schedule.assignments.filter(assignment => assignment.id !== assignmentId));
    setEditing(null);
  };

  const duplicateToNextDay = (assignment: Assignment) => {
    if (!schedule) return;
    const nextDate = days.find(day => day.date > assignment.date)?.date;
    if (!nextDate) return;

    updateAssignments([...schedule.assignments, {
      ...assignment,
      id: generateId(),
      date: nextDate,
      locked: undefined,
    }]);
    setEditing(null);
  };

  const applyBulk = (created: Assignment[], replacedIds: string[]) => {
    if (!schedule) return;
    const removed = new Set(replacedIds);
    updateAssignments([
      ...schedule.assignments.filter(assignment => !removed.has(assignment.id)),
      ...created,
    ]);
  };

  /** Scambia i medici di due turni, se lo scambio non crea doppioni. */
  const swapDoctors = (firstId: string, secondId: string) => {
    if (!schedule || firstId === secondId) return;

    const first = schedule.assignments.find(assignment => assignment.id === firstId);
    const second = schedule.assignments.find(assignment => assignment.id === secondId);
    if (!first || !second) return;

    updateAssignments(schedule.assignments.map(assignment => {
      if (assignment.id === firstId) {
        return { ...assignment, doctorId: second.doctorId, doctorName: second.doctorName };
      }
      if (assignment.id === secondId) {
        return { ...assignment, doctorId: first.doctorId, doctorName: first.doctorName };
      }
      return assignment;
    }));
  };

  const swapBlockedReason = (firstId: string, secondId: string): string | null => {
    if (!schedule || firstId === secondId) return null;

    const first = schedule.assignments.find(assignment => assignment.id === firstId);
    const second = schedule.assignments.find(assignment => assignment.id === secondId);
    if (!first || !second) return 'Turno non trovato';
    if (first.locked || second.locked) return 'Turno fissato';
    if (first.doctorId === second.doctorId) return 'Stesso dottore';

    const occupies = (doctorId: string, target: Assignment, excluded: string[]) =>
      schedule.assignments.some(assignment =>
        !excluded.includes(assignment.id)
        && assignment.date === target.date
        && assignment.shiftTypeId === target.shiftTypeId
        && assignment.doctorId === doctorId);

    if (occupies(first.doctorId, second, [firstId, secondId])) {
      return `${first.doctorName} è già in quel turno`;
    }
    if (occupies(second.doctorId, first, [firstId, secondId])) {
      return `${second.doctorName} è già in questo turno`;
    }

    return null;
  };

  const handleDrop = (targetId: string) => {
    if (!dragging) return;
    const blocked = swapBlockedReason(dragging, targetId);
    if (!blocked) swapDoctors(dragging, targetId);
    setDragging(null);
    setDragOver(null);
  };

  const violationOf = (assignmentId: string): Violation | undefined =>
    report ? primaryViolation(report, assignmentId) : undefined;

  const doctorColor = (doctorId: string) =>
    doctors.find(doctor => doctor.id === doctorId)?.color ?? '#64748b';

  // ----- Riepilogo -----

  const summary = useMemo(() => {
    const total = stats.reduce((sum, stat) => sum + stat.totalShifts, 0);
    const average = stats.length > 0 ? total / stats.length : 0;
    return {
      total,
      average,
      deviation: standardDeviation(stats.map(stat => stat.totalShifts), average),
      weekend: stats.length > 0
        ? stats.reduce((sum, stat) => sum + stat.weekendShifts, 0) / stats.length
        : 0,
    };
  }, [stats]);

  return (
    <div className="calendar stack">
      {/* ---------------- Navigazione mesi ---------------- */}
      <section className="month-nav">
        <div className="month-nav-head">
          <span className="label">Mesi salvati</span>
          <div className="row">
            <button
              type="button"
              className="btn-icon"
              onClick={() => setSelectedYear(selectedYear - 1)}
              aria-label="Anno precedente"
            >◀</button>
            <strong className="month-nav-year">{selectedYear}</strong>
            <button
              type="button"
              className="btn-icon"
              onClick={() => setSelectedYear(selectedYear + 1)}
              aria-label="Anno successivo"
            >▶</button>
          </div>
        </div>

        <div className="month-nav-grid">
          {MONTH_NAMES_SHORT.map((name, index) => {
            const monthNumber = index + 1;
            const count = versionCounts[index];
            const isCurrent = schedule?.year === selectedYear && schedule.month === monthNumber;

            return (
              <button
                key={name}
                type="button"
                className={`month-chip ${isCurrent ? 'current' : ''} ${count > 0 ? 'has-versions' : ''}`}
                onClick={() => goToMonth(selectedYear, monthNumber)}
                title={count > 0
                  ? `${count} version${count === 1 ? 'e' : 'i'} salvat${count === 1 ? 'a' : 'e'}`
                  : 'Nessuna versione salvata'}
              >
                <span>{name}</span>
                {count > 0 && <span className="month-chip-count">{count}</span>}
              </button>
            );
          })}
        </div>
      </section>

      {!schedule ? (
        <div className="empty-state">
          <h2>Nessun calendario per {formatMonthLabel(selectedYear, selectedMonth)}</h2>
          <p>
            Scegli un mese che contiene versioni salvate, oppure genera un nuovo calendario per
            questo mese.
          </p>
          <button
            type="button"
            className="btn btn-accent btn-lg"
            onClick={() => onNavigateToGenerate(selectedYear, selectedMonth)}
          >
            Genera calendario
          </button>
        </div>
      ) : (
        <>
          <ScheduleVersionManager
            schedule={schedule}
            hasUnsavedChanges={hasUnsavedChanges}
            isNewDraft={isNewDraft}
            savedVersionId={savedVersionId}
            revision={versionsRevision}
            onLoadVersion={onLoadVersion}
            onSaveVersion={onSaveVersion}
            onDiscardChanges={onDiscardChanges}
            onDuplicateVersion={onDuplicateVersion}
            onVersionsChanged={onVersionsChanged}
          />

          <div className="calendar-toolbar">
            <h2>{formatMonthLabel(schedule.year, schedule.month)}</h2>

            <div className="segmented">
              {(Object.keys(VIEW_LABELS) as CalendarView[]).map(candidate => (
                <button
                  key={candidate}
                  type="button"
                  className={view === candidate ? 'active' : ''}
                  onClick={() => setView(candidate)}
                >
                  {VIEW_LABELS[candidate]}
                </button>
              ))}
            </div>

            <div className="row">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setBulkTarget({})}
                disabled={doctors.length === 0 || rooms.length === 0}
              >
                Aggiungi turni
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => StorageService.downloadCSV(schedule, rooms, doctors, shiftTypes)}
              >
                Scarica CSV
              </button>
            </div>
          </div>

          <div className="stat-grid">
            <div className="stat-card tone-primary">
              <span className="value">{summary.total}</span>
              <span className="label">Turni totali</span>
            </div>
            <div className="stat-card">
              <span className="value">{summary.average.toFixed(1)}</span>
              <span className="label">Media per dottore</span>
            </div>
            <div className="stat-card" title="Più bassa, più equa la distribuzione">
              <span className="value">{summary.deviation.toFixed(2)}</span>
              <span className="label">Dev. standard</span>
            </div>
            <div className="stat-card tone-warning">
              <span className="value">{summary.weekend.toFixed(1)}</span>
              <span className="label">Weekend per dottore</span>
            </div>
            {hoursTarget.enabled && (
              <div
                className={`stat-card ${hoursIssueCount > 0 ? 'tone-warning' : 'tone-accent'}`}
                title={hoursTarget.enforcement === 'balance'
                  ? 'Conta il bilancio complessivo: i periodi oltre il massimo che si recuperano non sono contati'
                  : 'Periodi fuori dall\u2019intervallo di ore richiesto'}
              >
                <span className="value">{hoursIssueCount}</span>
                <span className="label">Ore fuori intervallo</span>
              </div>
            )}
            {gaps.length > 0 && (
              <div className="stat-card tone-danger">
                <span className="value">{gaps.length}</span>
                <span className="label">Turni scoperti</span>
              </div>
            )}
            {report && report.errors.length > 0 && (
              <div className="stat-card tone-danger">
                <span className="value">{report.errors.length}</span>
                <span className="label">Errori</span>
              </div>
            )}
            {report && report.warnings.length > 0 && (
              <div className="stat-card tone-info">
                <span className="value">{report.warnings.length}</span>
                <span className="label">Avvisi</span>
              </div>
            )}
          </div>

          {gaps.length > 0 && (
            <details className="gaps-panel">
              <summary>
                {gaps.length} turn{gaps.length === 1 ? 'o' : 'i'} senza dottore assegnato
              </summary>
              <ul className="gaps-list">
                {gaps.map(gap => (
                  <li key={`${gap.date}-${gap.roomId}-${gap.shiftTypeId}`}>
                    <button
                      type="button"
                      className="gap-item"
                      onClick={() => setBulkTarget({
                        date: gap.date,
                        roomId: gap.roomId,
                        shiftTypeId: gap.shiftTypeId,
                      })}
                    >
                      <span className="gap-date">{formatDayMonth(gap.date)}</span>
                      <span className="gap-room">{gap.roomName}</span>
                      <span className="gap-shift">{shiftTypeIndex.get(gap.shiftTypeId).name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <p className="legend">
            <span className="legend-item">
              <span className="legend-swatch weekend-swatch" />
              Weekend o festivo
            </span>
            <span className="legend-item">
              Clicca un turno per cambiare dottore, trascinalo su un altro per scambiarli.
            </span>
          </p>

          {/* ---------------- Vista per sala ---------------- */}
          {view === 'rooms' && (
            <div className="table-scroll">
              <table className="table calendar-table">
                <thead>
                  <tr>
                    <th className="sticky-left day-col">Giorno</th>
                    {rooms.map(room => (
                      <th key={room.id} style={{ boxShadow: `inset 0 -2px 0 ${room.color}` }}>
                        {room.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {days.map(day => {
                    const special = day.isWeekend || holidayDates.has(day.date);
                    const dayAssignments = assignmentsByDate.get(day.date) ?? [];

                    return (
                      <tr key={day.date} className={special ? 'special-day' : ''}>
                        <td className="sticky-left day-col">
                          <span className="day-number">{day.day}</span>
                          <span className="day-weekday">
                            {WEEKDAY_SHORT_BY_INDEX[day.weekdayIndex]}
                          </span>
                          {holidayDates.has(day.date) && !day.isWeekend && (
                            <span className="holiday-dot" title="Festivo" />
                          )}
                        </td>

                        {rooms.map(room => (
                          <td key={room.id} className="assignments-cell">
                            <div className="chips">
                              {dayAssignments
                                .filter(assignment => assignment.roomId === room.id)
                                .map(assignment => (
                                  <AssignmentChip
                                    key={assignment.id}
                                    assignment={assignment}
                                    label={assignment.doctorName}
                                    detail={shiftTypeIndex.get(assignment.shiftTypeId).code}
                                    color={doctorColor(assignment.doctorId)}
                                    violation={violationOf(assignment.id)}
                                    isDragging={dragging === assignment.id}
                                    dragState={dragOver === assignment.id && dragging
                                      ? swapBlockedReason(dragging, assignment.id) === null
                                        ? 'allowed' : 'blocked'
                                      : null}
                                    onSelect={anchor => setEditing({ assignment, anchor })}
                                    onDragStart={() => setDragging(assignment.id)}
                                    onDragEnd={() => { setDragging(null); setDragOver(null); }}
                                    onDragOver={() => setDragOver(assignment.id)}
                                    onDrop={() => handleDrop(assignment.id)}
                                  />
                                ))}

                              {room.slots.some(slot => slot.weekday === day.weekday) && (
                                <button
                                  type="button"
                                  className="chip-add"
                                  title={`Aggiungi un turno in ${room.name}`}
                                  onClick={() => setBulkTarget({ date: day.date, roomId: room.id })}
                                >
                                  +
                                </button>
                              )}
                            </div>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ---------------- Vista per dottore ---------------- */}
          {view === 'doctors' && (
            <div className="table-scroll">
              <table className="table calendar-table">
                <thead>
                  <tr>
                    <th className="sticky-left day-col">Giorno</th>
                    {doctors.map(doctor => (
                      <th key={doctor.id} style={{ boxShadow: `inset 0 -2px 0 ${doctor.color}` }}>
                        <span className="row-name">
                          <span className="dot" style={{ background: doctor.color }} />
                          {doctor.name}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {days.map(day => {
                    const special = day.isWeekend || holidayDates.has(day.date);
                    const dayAssignments = assignmentsByDate.get(day.date) ?? [];

                    return (
                      <tr key={day.date} className={special ? 'special-day' : ''}>
                        <td className="sticky-left day-col">
                          <span className="day-number">{day.day}</span>
                          <span className="day-weekday">
                            {WEEKDAY_SHORT_BY_INDEX[day.weekdayIndex]}
                          </span>
                        </td>

                        {doctors.map(doctor => {
                          const own = dayAssignments.filter(
                            assignment => assignment.doctorId === doctor.id);
                          const unavailable = availability.isBlocked(doctor.id, day.date);

                          return (
                            <td
                              key={doctor.id}
                              className={`assignments-cell ${unavailable && own.length === 0 ? 'unavailable-cell' : ''}`}
                            >
                              {unavailable && own.length === 0 && (
                                <span className="cell-note">non disp.</span>
                              )}
                              <div className="chips">
                                {own.map(assignment => (
                                  <AssignmentChip
                                    key={assignment.id}
                                    assignment={assignment}
                                    label={assignment.roomName}
                                    detail={shiftTypeIndex.get(assignment.shiftTypeId).code}
                                    color={rooms.find(room => room.id === assignment.roomId)?.color ?? '#64748b'}
                                    violation={violationOf(assignment.id)}
                                    isDragging={dragging === assignment.id}
                                    dragState={dragOver === assignment.id && dragging
                                      ? swapBlockedReason(dragging, assignment.id) === null
                                        ? 'allowed' : 'blocked'
                                      : null}
                                    onSelect={anchor => setEditing({ assignment, anchor })}
                                    onDragStart={() => setDragging(assignment.id)}
                                    onDragEnd={() => { setDragging(null); setDragOver(null); }}
                                    onDragOver={() => setDragOver(assignment.id)}
                                    onDrop={() => handleDrop(assignment.id)}
                                  />
                                ))}
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

          {/* ---------------- Griglia del mese ---------------- */}
          {view === 'month' && (
            <div className="month-grid">
              <div className="month-grid-head">
                {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map((name, index) => (
                  <span key={name} className={index >= 5 ? 'weekend' : ''}>{name}</span>
                ))}
              </div>

              <div className="month-grid-body">
                {Array.from({ length: mondayFirstIndex(days[0].date) }, (_, index) => (
                  <div key={`blank-${index}`} className="month-cell blank" />
                ))}

                {days.map(day => {
                  const special = day.isWeekend || holidayDates.has(day.date);
                  const dayAssignments = assignmentsByDate.get(day.date) ?? [];

                  return (
                    <div key={day.date} className={`month-cell ${special ? 'special' : ''}`}>
                      <div className="month-cell-head">
                        <span>{day.day}</span>
                        {holidayDates.has(day.date) && !day.isWeekend && (
                          <span className="holiday-dot" title="Festivo" />
                        )}
                      </div>

                      <div className="month-cell-body">
                        {rooms.map(room => {
                          const own = dayAssignments.filter(
                            assignment => assignment.roomId === room.id);
                          if (own.length === 0) return null;

                          return (
                            <div key={room.id} className="month-room-group">
                              <span
                                className="month-room-label"
                                style={{ background: `${room.color}26`, borderColor: room.color }}
                              >
                                {room.name}
                              </span>
                              {own.map(assignment => {
                                const violation = violationOf(assignment.id);
                                return (
                                  <button
                                    key={assignment.id}
                                    type="button"
                                    className={`month-assignment ${violation ? violation.severity : ''} ${assignment.locked ? 'locked' : ''}`}
                                    style={{ borderLeftColor: doctorColor(assignment.doctorId) }}
                                    title={[
                                      `${assignment.doctorName} — ${shiftTypeIndex.get(assignment.shiftTypeId).name}`,
                                      assignment.locked ? 'Turno fissato' : null,
                                      violation?.detail,
                                    ].filter(Boolean).join('\n')}
                                    onClick={event => setEditing({
                                      assignment,
                                      anchor: event.currentTarget,
                                    })}
                                  >
                                    <span className="month-assignment-time">
                                      {shiftTypeIndex.get(assignment.shiftTypeId).code}
                                    </span>
                                    <span className="month-assignment-doctor">
                                      {assignment.doctorName}
                                    </span>
                                  </button>
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
            </div>
          )}

          {/* ---------------- Ore e preferenze ---------------- */}
          {(hours.issues.length > 0 || hours.balanceIssues.length > 0
            || hours.compensated.length > 0 || lengthPreference.size > 0) && (
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h3>Ore e preferenze</h3>
                  <p className="hint">
                    Segnalazioni che non sono errori: indicano scostamenti dalle ore richieste e
                    dalle preferenze dichiarate dai dottori.
                  </p>
                </div>
              </div>

              {hours.balanceIssues.length > 0 && (
                <div className="field">
                  <span className="label">
                    Bilancio complessivo fuori intervallo
                  </span>
                  <ul className="issue-list">
                    {hours.balanceIssues.map(balance => {
                      const doctor = doctors.find(candidate => candidate.id === balance.doctorId);
                      if (!doctor) return null;
                      return (
                        <li key={balance.doctorId} className={`issue-row ${balance.status}`}>
                          <span className="issue-who">
                            <span className="dot" style={{ background: doctor.color }} />
                            {doctor.name}
                          </span>
                          <span className="issue-when">
                            {balance.periods}{' '}
                            {hours.target.period === 'week'
                              ? `settiman${balance.periods === 1 ? 'a' : 'e'}`
                              : `mes${balance.periods === 1 ? 'e' : 'i'}`}
                          </span>
                          <span className="issue-value">{formatHours(balance.hours)}</span>
                          <span className="issue-detail">
                            {balance.status === 'below'
                              ? `${formatHours(balance.gap)} sotto il totale minimo di ${formatHours(balance.expected.min)}`
                              : `${formatHours(balance.gap)} oltre il totale massimo di ${formatHours(balance.expected.max)}`}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {hours.issues.length > 0 && (
                <div className="field">
                  <span className="label">
                    Periodi fuori intervallo ({hours.target.min}–{hours.target.max} per{' '}
                    {hours.target.period === 'week' ? 'settimana' : 'mese'})
                  </span>
                  <ul className="issue-list">
                    {hours.issues.map(entry => {
                      const doctor = doctors.find(candidate => candidate.id === entry.doctorId);
                      if (!doctor) return null;
                      return (
                        <li
                          key={`${entry.doctorId}-${entry.period.key}`}
                          className={`issue-row ${entry.status}`}
                        >
                          <span className="issue-who">
                            <span className="dot" style={{ background: doctor.color }} />
                            {doctor.name}
                          </span>
                          <span className="issue-when">{entry.period.label}</span>
                          <span className="issue-value">{formatHours(entry.hours)}</span>
                          <span className="issue-detail">
                            {entry.status === 'below'
                              ? `${formatHours(entry.gap)} sotto il minimo`
                              : `${formatHours(entry.gap)} oltre il massimo`}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {hours.compensated.length > 0 && (
                <div className="field">
                  <span className="label">Periodi oltre il massimo, recuperati</span>
                  <ul className="issue-list">
                    {hours.compensated.map(entry => {
                      const doctor = doctors.find(candidate => candidate.id === entry.doctorId);
                      if (!doctor) return null;
                      const balance = hours.balances.find(
                        candidate => candidate.doctorId === entry.doctorId,
                      );
                      return (
                        <li
                          key={`${entry.doctorId}-${entry.period.key}`}
                          className={`issue-row ${balance?.status === 'ok' ? 'ok' : 'above'}`}
                        >
                          <span className="issue-who">
                            <span className="dot" style={{ background: doctor.color }} />
                            {doctor.name}
                          </span>
                          <span className="issue-when">{entry.period.label}</span>
                          <span className="issue-value">{formatHours(entry.hours)}</span>
                          <span className="issue-detail">
                            {formatHours(entry.gap)} oltre il massimo
                            {balance && balance.status === 'ok'
                              && `, recuperate: totale ${formatHours(balance.hours)} su ${formatHours(balance.expected.min)}–${formatHours(balance.expected.max)}`}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {lengthPreference.size > 0 && (
                <div className="field">
                  <span className="label">Durata dei turni preferita</span>
                  <ul className="issue-list">
                    {[...lengthPreference.entries()].map(([doctorId, entry]) => {
                      const doctor = doctors.find(candidate => candidate.id === doctorId);
                      if (!doctor) return null;
                      return (
                        <li
                          key={doctorId}
                          className={`issue-row ${entry.against > entry.preferred ? 'below' : 'ok'}`}
                        >
                          <span className="issue-who">
                            <span className="dot" style={{ background: doctor.color }} />
                            {doctor.name}
                          </span>
                          <span className="issue-when">
                            {doctor.shiftLengthPreference === 'long' ? 'turni lunghi' : 'turni brevi'}
                          </span>
                          <span className="issue-value">{Math.round(entry.ratio * 100)}%</span>
                          <span className="issue-detail">
                            {entry.preferred} come preferisce
                            {entry.against > 0 && `, ${entry.against} no`}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </section>
          )}

          {/* ---------------- Riepilogo per dottore ---------------- */}
          <section className="panel">
            <div className="panel-header">
              <h3>Riepilogo per dottore</h3>
              <span className="hint">{formatMonthLabel(schedule.year, schedule.month)}</span>
            </div>
            <StatsTable stats={stats} columns={statColumns} />
          </section>
        </>
      )}

      {/* ---------------- Modifica di un turno ---------------- */}
      {editing && schedule && (
        <Popover anchor={editing.anchor} onClose={() => setEditing(null)} minWidth={250}>
          <div className="popover-header">
            <span>
              {formatDayMonth(editing.assignment.date)} · {editing.assignment.roomName} ·{' '}
              {shiftTypeIndex.get(editing.assignment.shiftTypeId).name}
            </span>
          </div>

          {editing.assignment.locked && (
            <p className="popover-note">
              Turno fissato nella configurazione di generazione. Le modifiche qui valgono solo
              per questa versione del calendario.
            </p>
          )}

          <div className="popover-list">
            {doctors.map(doctor => {
              const busy = schedule.assignments.some(assignment =>
                assignment.id !== editing.assignment.id
                && assignment.date === editing.assignment.date
                && assignment.shiftTypeId === editing.assignment.shiftTypeId
                && assignment.doctorId === doctor.id);
              const blocked = availability.isBlocked(
                doctor.id, editing.assignment.date, editing.assignment.shiftTypeId);
              const isCurrent = doctor.id === editing.assignment.doctorId;

              return (
                <button
                  key={doctor.id}
                  type="button"
                  className={`popover-item ${isCurrent ? 'current' : ''}`}
                  disabled={busy || isCurrent}
                  title={busy ? 'Già assegnato a questo turno' : undefined}
                  onClick={() => changeDoctor(editing.assignment.id, doctor.id)}
                >
                  <span className="dot" style={{ background: doctor.color }} />
                  {doctor.name}
                  {busy && <span className="trailing">occupato</span>}
                  {!busy && blocked && <span className="trailing">non disp.</span>}
                </button>
              );
            })}
          </div>

          <div className="popover-footer">
            <button
              type="button"
              className="popover-item"
              onClick={() => duplicateToNextDay(editing.assignment)}
            >
              Copia sul giorno successivo
            </button>
            <button
              type="button"
              className="popover-item danger"
              onClick={() => removeAssignment(editing.assignment.id)}
            >
              Rimuovi turno
            </button>
          </div>
        </Popover>
      )}

      {/* ---------------- Aggiunta multipla ---------------- */}
      {bulkTarget && schedule && (
        <BulkAssignModal
          schedule={schedule}
          rooms={rooms}
          doctors={doctors}
          shiftTypes={shiftTypeIndex}
          availability={availability}
          initial={bulkTarget}
          onApply={applyBulk}
          onClose={() => setBulkTarget(null)}
        />
      )}
    </div>
  );
}

function formatHours(hours: number): string {
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

// ---------------------------------------------------------------------------

interface AssignmentChipProps {
  assignment: Assignment;
  label: string;
  detail: string;
  color: string;
  violation?: Violation;
  isDragging: boolean;
  dragState: 'allowed' | 'blocked' | null;
  onSelect: (anchor: HTMLElement) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}

function AssignmentChip({
  assignment,
  label,
  detail,
  color,
  violation,
  isDragging,
  dragState,
  onSelect,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: AssignmentChipProps) {
  const classes = [
    'chip',
    assignment.locked ? 'locked' : '',
    violation ? violation.severity : '',
    isDragging ? 'dragging' : '',
    dragState === 'allowed' ? 'drop-allowed' : '',
    dragState === 'blocked' ? 'drop-blocked' : '',
  ].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={classes}
      style={{ borderLeftColor: color }}
      draggable={!assignment.locked}
      title={[
        label,
        assignment.locked ? 'Turno fissato' : null,
        violation ? `${violation.label}: ${violation.detail}` : null,
      ].filter(Boolean).join('\n')}
      onClick={event => onSelect(event.currentTarget)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={event => { event.preventDefault(); onDragOver(); }}
      onDrop={event => { event.preventDefault(); onDrop(); }}
    >
      <span className="chip-label">{label}</span>
      <span className="chip-detail">{detail}</span>
      {assignment.locked && <span className="chip-flag" title="Turno fissato">fix</span>}
      {violation && (
        <span className={`chip-flag ${violation.severity}`} title={violation.detail}>
          {violation.severity === 'error' ? '!' : '?'}
        </span>
      )}
    </button>
  );
}
