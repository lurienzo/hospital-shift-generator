import { useMemo, useState } from 'react';
import { Assignment, Doctor, OperativeRoom } from '../models/types';
import { ShiftTypeIndex } from '../domain/shiftTypes';
import { RoomSlotIndex } from '../domain/validation';
import { Popover } from './ui/Popover';
import { WEEKDAY_SHORT_BY_INDEX, buildMonthDays, formatDayMonth } from '../utils/date';
import { generateId } from '../utils/id';
import './PrefilledGrid.css';

interface PrefilledGridProps {
  year: number;
  month: number;
  rooms: OperativeRoom[];
  doctors: Doctor[];
  shiftTypes: ShiftTypeIndex;
  assignments: Assignment[];
  onChange: (assignments: Assignment[]) => void;
}

interface CellTarget {
  date: string;
  roomId: string;
  shiftTypeId: string;
  anchor: HTMLElement;
}

/**
 * Griglia dei turni pre-compilati: le assegnazioni fissate qui restano
 * invariate durante la generazione.
 */
export function PrefilledGrid({
  year,
  month,
  rooms,
  doctors,
  shiftTypes,
  assignments,
  onChange,
}: PrefilledGridProps) {
  const [target, setTarget] = useState<CellTarget | null>(null);
  const days = useMemo(() => buildMonthDays(year, month), [year, month]);
  const slotIndex = useMemo(() => new RoomSlotIndex(rooms), [rooms]);

  // Una colonna per ogni coppia sala + fascia effettivamente configurata.
  const columns = useMemo(
    () => rooms.flatMap(room => {
      const used = new Set(room.slots.map(slot => slot.shiftTypeId));
      return shiftTypes.all
        .filter(shiftType => used.has(shiftType.id))
        .map(shiftType => ({ room, shiftType }));
    }),
    [rooms, shiftTypes],
  );

  const byCell = useMemo(() => {
    const map = new Map<string, Assignment>();
    for (const assignment of assignments) {
      map.set(`${assignment.date}|${assignment.roomId}|${assignment.shiftTypeId}`, assignment);
    }
    return map;
  }, [assignments]);

  const assign = (cell: CellTarget, doctor: Doctor) => {
    const room = rooms.find(candidate => candidate.id === cell.roomId);
    if (!room) return;

    const others = assignments.filter(assignment => !(
      assignment.date === cell.date
      && assignment.roomId === cell.roomId
      && assignment.shiftTypeId === cell.shiftTypeId
    ));

    onChange([...others, {
      id: generateId(),
      date: cell.date,
      roomId: room.id,
      roomName: room.name,
      shiftTypeId: cell.shiftTypeId,
      doctorId: doctor.id,
      doctorName: doctor.name,
      locked: true,
    }]);
    setTarget(null);
  };

  const clear = (assignment: Assignment) => {
    onChange(assignments.filter(other => other.id !== assignment.id));
    setTarget(null);
  };

  if (columns.length === 0) {
    return (
      <p className="hint">
        Configura i turni settimanali di almeno una sala per poter pre-compilare delle
        assegnazioni.
      </p>
    );
  }

  const selectedAssignment = target
    ? byCell.get(`${target.date}|${target.roomId}|${target.shiftTypeId}`)
    : undefined;

  return (
    <>
      <div className="prefilled-scroll">
        <table className="prefilled-grid">
          <thead>
            <tr>
              <th className="sticky-left day-head">Giorno</th>
              {columns.map(({ room, shiftType }) => (
                <th key={`${room.id}-${shiftType.id}`} style={{ borderBottomColor: room.color }}>
                  <span className="col-room" style={{ color: room.color }}>{room.name}</span>
                  <span className="col-shift">{shiftType.code}</span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {days.map(day => (
              <tr key={day.date} className={day.isWeekend ? 'weekend' : ''}>
                <th className="sticky-left day-head">
                  <span className="day-number">{day.day}</span>
                  <span className="day-weekday">{WEEKDAY_SHORT_BY_INDEX[day.weekdayIndex]}</span>
                </th>

                {columns.map(({ room, shiftType }) => {
                  const slot = slotIndex.slot(room.id, day.weekday, shiftType.id);
                  if (!slot) {
                    return (
                      <td
                        key={`${room.id}-${shiftType.id}`}
                        className="cell unavailable"
                        title="Turno non previsto in questo giorno"
                      />
                    );
                  }

                  const existing = byCell.get(`${day.date}|${room.id}|${shiftType.id}`);
                  const doctor = existing
                    ? doctors.find(candidate => candidate.id === existing.doctorId)
                    : undefined;
                  const isTarget = target?.date === day.date
                    && target.roomId === room.id
                    && target.shiftTypeId === shiftType.id;

                  return (
                    <td key={`${room.id}-${shiftType.id}`} className="cell">
                      <button
                        type="button"
                        className={`cell-button ${existing ? 'filled' : ''} ${isTarget ? 'active' : ''}`}
                        style={existing && doctor
                          ? { borderColor: doctor.color, color: doctor.color }
                          : undefined}
                        title={existing
                          ? `${existing.doctorName} — clicca per cambiare o rimuovere`
                          : 'Clicca per fissare un dottore'}
                        onClick={event => setTarget({
                          date: day.date,
                          roomId: room.id,
                          shiftTypeId: shiftType.id,
                          anchor: event.currentTarget,
                        })}
                      >
                        {existing ? (doctor?.name ?? existing.doctorName) : '+'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {target && (
        <Popover anchor={target.anchor} onClose={() => setTarget(null)} minWidth={220}>
          <div className="popover-header">
            <span>
              {formatDayMonth(target.date)} ·{' '}
              {rooms.find(room => room.id === target.roomId)?.name} ·{' '}
              {shiftTypes.get(target.shiftTypeId).code}
            </span>
          </div>
          <div className="popover-list">
            {doctors.length === 0 && <p className="hint">Nessun dottore configurato.</p>}
            {doctors.map(doctor => (
              <button
                key={doctor.id}
                type="button"
                className={`popover-item ${selectedAssignment?.doctorId === doctor.id ? 'current' : ''}`}
                onClick={() => assign(target, doctor)}
              >
                <span className="dot" style={{ background: doctor.color }} />
                {doctor.name}
              </button>
            ))}
          </div>
          {selectedAssignment && (
            <div className="popover-footer">
              <button
                type="button"
                className="popover-item danger"
                onClick={() => clear(selectedAssignment)}
              >
                Rimuovi turno fissato
              </button>
            </div>
          )}
        </Popover>
      )}
    </>
  );
}
