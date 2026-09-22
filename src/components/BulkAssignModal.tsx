import { useMemo, useState } from 'react';
import {
  Assignment,
  Doctor,
  MonthlySchedule,
  OperativeRoom,
  Weekday,
  WEEKDAYS,
  WEEKEND_WEEKDAYS,
  WORKING_WEEKDAYS,
} from '../models/types';
import { ShiftTypeIndex } from '../domain/shiftTypes';
import { AvailabilityRules, RoomSlotIndex, findViolations } from '../domain/validation';
import { Modal } from './ui/Modal';
import { MiniCalendar } from './MiniCalendar';
import { buildMonthDays, formatDayMonth } from '../utils/date';
import { generateId } from '../utils/id';
import './BulkAssignModal.css';

interface BulkAssignModalProps {
  schedule: MonthlySchedule;
  rooms: OperativeRoom[];
  doctors: Doctor[];
  shiftTypes: ShiftTypeIndex;
  availability: AvailabilityRules;
  /** Valori pre-selezionati, quando si parte da una cella del calendario. */
  initial?: { date?: string; roomId?: string; shiftTypeId?: string };
  onApply: (assignments: Assignment[], replacedIds: string[]) => void;
  onClose: () => void;
}

type CandidateStatus = 'ok' | 'duplicate' | 'occupied' | 'conflict' | 'noSlot';

interface Candidate {
  key: string;
  date: string;
  room: OperativeRoom;
  shiftTypeId: string;
  status: CandidateStatus;
  /** Turno di un altro dottore che occupa lo stesso posto. */
  occupiedBy?: Assignment;
  issue?: string;
}

const STATUS_LABELS: Record<CandidateStatus, string> = {
  ok: 'Da aggiungere',
  duplicate: 'Già presente',
  occupied: 'Posto occupato',
  conflict: 'Con conflitto',
  noSlot: 'Turno non previsto',
};

/**
 * Aggiunta di più turni in una sola operazione: si scelgono giorni, sale e
 * fasce, e l'anteprima mostra esattamente cosa verrà creato, segnalando
 * duplicati, posti già occupati e violazioni dei vincoli.
 */
export function BulkAssignModal({
  schedule,
  rooms,
  doctors,
  shiftTypes,
  availability,
  initial,
  onApply,
  onClose,
}: BulkAssignModalProps) {
  const days = useMemo(
    () => buildMonthDays(schedule.year, schedule.month),
    [schedule.year, schedule.month],
  );
  const slotIndex = useMemo(() => new RoomSlotIndex(rooms), [rooms]);

  const [doctorId, setDoctorId] = useState<string>(doctors[0]?.id ?? '');
  const [selectedDates, setSelectedDates] = useState<Set<string>>(
    () => new Set(initial?.date ? [initial.date] : []),
  );
  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<string>>(
    () => new Set(initial?.roomId ? [initial.roomId] : []),
  );
  const [selectedShiftTypeIds, setSelectedShiftTypeIds] = useState<Set<string>>(
    () => new Set(initial?.shiftTypeId ? [initial.shiftTypeId] : []),
  );
  const [replaceOccupied, setReplaceOccupied] = useState(false);
  const [includeConflicts, setIncludeConflicts] = useState(false);

  const doctor = doctors.find(candidate => candidate.id === doctorId);

  const toggleIn = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const selectWeekdays = (weekdays: Weekday[]) => {
    const matching = days.filter(day => weekdays.includes(day.weekday)).map(day => day.date);
    const allSelected = matching.every(date => selectedDates.has(date));
    const next = new Set(selectedDates);
    for (const date of matching) {
      if (allSelected) next.delete(date);
      else next.add(date);
    }
    setSelectedDates(next);
  };

  /**
   * Tutte le combinazioni richieste, ognuna con il proprio esito. La verifica
   * dei vincoli è fatta simulando l'inserimento sul calendario reale, così le
   * regole sono le stesse che valgono per il resto dell'applicazione.
   */
  const candidates = useMemo<Candidate[]>(() => {
    if (!doctor) return [];

    const dates = [...selectedDates].sort();
    const chosenRooms = rooms.filter(room => selectedRoomIds.has(room.id));
    const chosenShiftTypes = shiftTypes.all.filter(shiftType => selectedShiftTypeIds.has(shiftType.id));
    if (dates.length === 0 || chosenRooms.length === 0 || chosenShiftTypes.length === 0) return [];

    const proposed: Assignment[] = [];
    const drafts: Omit<Candidate, 'status' | 'issue'>[] = [];

    for (const date of dates) {
      const weekday = days.find(day => day.date === date)!.weekday;

      for (const room of chosenRooms) {
        for (const shiftType of chosenShiftTypes) {
          const key = `${date}|${room.id}|${shiftType.id}`;
          const hasSlot = slotIndex.slot(room.id, weekday, shiftType.id) !== undefined;
          const existing = schedule.assignments.filter(
            assignment => assignment.date === date
              && assignment.roomId === room.id
              && assignment.shiftTypeId === shiftType.id,
          );
          const mine = existing.find(assignment => assignment.doctorId === doctor.id);
          const other = existing.find(assignment => assignment.doctorId !== doctor.id);

          drafts.push({ key, date, room, shiftTypeId: shiftType.id, occupiedBy: other });

          if (!hasSlot || mine) continue;
          if (other && !replaceOccupied) continue;

          proposed.push({
            id: `bulk-${key}`,
            date,
            roomId: room.id,
            roomName: room.name,
            shiftTypeId: shiftType.id,
            doctorId: doctor.id,
            doctorName: doctor.name,
          });
        }
      }
    }

    // Le violazioni si valutano sul calendario risultante, non sui soli turni
    // nuovi: un vincolo come lo smontante dipende dai giorni vicini.
    const replacedIds = new Set(
      replaceOccupied
        ? drafts.filter(draft => draft.occupiedBy).map(draft => draft.occupiedBy!.id)
        : [],
    );
    const simulated = [
      ...schedule.assignments.filter(assignment => !replacedIds.has(assignment.id)),
      ...proposed,
    ];
    const report = findViolations(simulated, {
      rooms,
      doctors,
      shiftTypes,
      availability,
      slotIndex,
    });

    return drafts.map(draft => {
      const weekday = days.find(day => day.date === draft.date)!.weekday;
      if (!slotIndex.slot(draft.room.id, weekday, draft.shiftTypeId)) {
        return { ...draft, status: 'noSlot' as const };
      }

      const mine = schedule.assignments.some(
        assignment => assignment.date === draft.date
          && assignment.roomId === draft.room.id
          && assignment.shiftTypeId === draft.shiftTypeId
          && assignment.doctorId === doctor.id,
      );
      if (mine) return { ...draft, status: 'duplicate' as const };

      if (draft.occupiedBy && !replaceOccupied) {
        return {
          ...draft,
          status: 'occupied' as const,
          issue: `assegnato a ${draft.occupiedBy.doctorName}`,
        };
      }

      const violations = report.byAssignment.get(`bulk-${draft.key}`);
      if (violations && violations.length > 0) {
        return { ...draft, status: 'conflict' as const, issue: violations[0].label };
      }

      return { ...draft, status: 'ok' as const };
    });
  }, [
    doctor, doctors, selectedDates, selectedRoomIds, selectedShiftTypeIds,
    rooms, shiftTypes, availability, slotIndex, schedule.assignments, days,
    replaceOccupied,
  ]);

  const counts = useMemo(() => {
    const result: Record<CandidateStatus, number> = {
      ok: 0, duplicate: 0, occupied: 0, conflict: 0, noSlot: 0,
    };
    for (const candidate of candidates) result[candidate.status]++;
    return result;
  }, [candidates]);

  const toCreate = candidates.filter(candidate =>
    candidate.status === 'ok' || (candidate.status === 'conflict' && includeConflicts));

  const apply = () => {
    if (!doctor || toCreate.length === 0) return;

    const assignments: Assignment[] = toCreate.map(candidate => ({
      id: generateId(),
      date: candidate.date,
      roomId: candidate.room.id,
      roomName: candidate.room.name,
      shiftTypeId: candidate.shiftTypeId,
      doctorId: doctor.id,
      doctorName: doctor.name,
    }));

    const replacedIds = replaceOccupied
      ? toCreate.filter(candidate => candidate.occupiedBy).map(candidate => candidate.occupiedBy!.id)
      : [];

    onApply(assignments, replacedIds);
    onClose();
  };

  const roomsWithSlots = rooms.filter(room => room.slots.length > 0);

  return (
    <Modal
      title="Aggiungi turni"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="spacer hint">
            {toCreate.length > 0
              ? `${toCreate.length} turn${toCreate.length === 1 ? 'o' : 'i'} da aggiungere`
              : candidates.length === 0
                ? 'Seleziona dottore, giorni, sale e fasce'
                : 'Nessun turno da aggiungere fra quelli selezionati'}
          </span>
          <button type="button" className="btn" onClick={onClose}>Annulla</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={toCreate.length === 0}
            onClick={apply}
          >
            Aggiungi {toCreate.length > 0 ? toCreate.length : ''}
          </button>
        </>
      }
    >
      <div className="bulk stack">
        <div className="field">
          <span className="label">Dottore</span>
          <div className="row-wrap">
            {doctors.map(candidate => (
              <button
                key={candidate.id}
                type="button"
                className={`doctor-pill ${doctorId === candidate.id ? 'on' : ''}`}
                style={doctorId === candidate.id
                  ? { borderColor: candidate.color, background: `${candidate.color}22` }
                  : undefined}
                onClick={() => setDoctorId(candidate.id)}
              >
                <span className="dot" style={{ background: candidate.color }} />
                {candidate.name}
              </button>
            ))}
          </div>
        </div>

        <div className="bulk-columns">
          <div className="field">
            <span className="label">Giorni ({selectedDates.size})</span>
            <div className="row-wrap bulk-presets">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => selectWeekdays(WEEKDAYS)}>
                Tutti
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => selectWeekdays(WORKING_WEEKDAYS)}>
                Lun–Ven
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => selectWeekdays(WEEKEND_WEEKDAYS)}>
                Weekend
              </button>
              {selectedDates.size > 0 && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelectedDates(new Set())}>
                  Azzera
                </button>
              )}
            </div>
            <MiniCalendar
              year={schedule.year}
              month={schedule.month}
              getDayState={date => ({
                selection: selectedDates.has(date) ? 'full' : 'none',
                color: doctor?.color ?? '#3b82f6',
              })}
              onDayClick={date => setSelectedDates(toggleIn(selectedDates, date))}
              onWeekdayClick={weekday => selectWeekdays([weekday])}
            />
            <p className="hint">
              Clicca l&apos;intestazione di un giorno per selezionare tutta la colonna.
            </p>
          </div>

          <div className="bulk-side">
            <div className="field">
              <span className="label">Sale ({selectedRoomIds.size})</span>
              <div className="row-wrap">
                {roomsWithSlots.map(room => (
                  <button
                    key={room.id}
                    type="button"
                    className={`select-pill ${selectedRoomIds.has(room.id) ? 'on' : ''}`}
                    style={selectedRoomIds.has(room.id)
                      ? { borderColor: room.color, background: `${room.color}22` }
                      : undefined}
                    onClick={() => setSelectedRoomIds(toggleIn(selectedRoomIds, room.id))}
                  >
                    <span className="dot" style={{ background: room.color }} />
                    {room.name}
                  </button>
                ))}
              </div>
              {roomsWithSlots.length > 1 && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => setSelectedRoomIds(
                    selectedRoomIds.size === roomsWithSlots.length
                      ? new Set()
                      : new Set(roomsWithSlots.map(room => room.id)))}
                >
                  {selectedRoomIds.size === roomsWithSlots.length ? 'Nessuna' : 'Tutte le sale'}
                </button>
              )}
            </div>

            <div className="field">
              <span className="label">Fasce ({selectedShiftTypeIds.size})</span>
              <div className="row-wrap">
                {shiftTypes.all.map(shiftType => (
                  <button
                    key={shiftType.id}
                    type="button"
                    className={`select-pill ${selectedShiftTypeIds.has(shiftType.id) ? 'on' : ''}`}
                    style={selectedShiftTypeIds.has(shiftType.id)
                      ? { borderColor: shiftType.color, background: `${shiftType.color}22` }
                      : undefined}
                    onClick={() => setSelectedShiftTypeIds(
                      toggleIn(selectedShiftTypeIds, shiftType.id))}
                  >
                    <span className="dot" style={{ background: shiftType.color }} />
                    {shiftType.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <span className="label">Opzioni</span>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={replaceOccupied}
                  onChange={event => setReplaceOccupied(event.target.checked)}
                />
                <span>Sostituisci i turni già assegnati ad altri</span>
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={includeConflicts}
                  onChange={event => setIncludeConflicts(event.target.checked)}
                />
                <span>Aggiungi anche i turni con conflitti</span>
              </label>
            </div>
          </div>
        </div>

        {candidates.length > 0 && (
          <div className="field">
            <span className="label">Anteprima</span>
            <div className="bulk-counts">
              {(Object.keys(STATUS_LABELS) as CandidateStatus[])
                .filter(status => counts[status] > 0)
                .map(status => (
                  <span key={status} className={`bulk-count ${status}`}>
                    {counts[status]} {STATUS_LABELS[status].toLowerCase()}
                  </span>
                ))}
            </div>

            <ul className="bulk-list">
              {candidates.map(candidate => {
                const included = candidate.status === 'ok'
                  || (candidate.status === 'conflict' && includeConflicts);
                return (
                  <li key={candidate.key} className={`bulk-item ${candidate.status} ${included ? 'included' : ''}`}>
                    <span className="bulk-when">{formatDayMonth(candidate.date)}</span>
                    <span className="bulk-what" style={{ color: candidate.room.color }}>
                      {candidate.room.name}
                    </span>
                    <span className="bulk-shift">
                      {shiftTypes.get(candidate.shiftTypeId).name}
                    </span>
                    <span className="bulk-status">
                      {included ? 'aggiunto' : STATUS_LABELS[candidate.status].toLowerCase()}
                      {candidate.issue && ` — ${candidate.issue}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
