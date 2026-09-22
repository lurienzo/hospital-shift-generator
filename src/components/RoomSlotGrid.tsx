import { useMemo } from 'react';
import {
  OperativeRoom,
  ScheduleSlot,
  ShiftType,
  Weekday,
  WEEKDAYS,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
  WEEKEND_WEEKDAYS,
  WORKING_WEEKDAYS,
} from '../models/types';
import { blockLabel, isRotational, shiftsOverlap } from '../domain/shiftTypes';
import { generateId } from '../utils/id';
import './RoomSlotGrid.css';

interface RoomSlotGridProps {
  room: OperativeRoom;
  shiftTypes: ShiftType[];
  onChange: (slots: ScheduleSlot[]) => void;
}

type FlagKey = 'isCritical' | 'requiresNextDayRest' | 'requiresSecondDayRest' | 'isFullDayExclusive';

const FLAGS: { key: FlagKey; letter: string; name: string; description: string }[] = [
  {
    key: 'isCritical',
    letter: 'C',
    name: 'Critico',
    description: 'Turno pesante: il generatore lo distribuisce in modo equo fra i dottori',
  },
  {
    key: 'requiresNextDayRest',
    letter: 'S',
    name: 'Smontante',
    description: 'Il giorno dopo il dottore non può lavorare',
  },
  {
    key: 'requiresSecondDayRest',
    letter: 'R',
    name: 'Riposo 2° giorno',
    description: 'Anche il secondo giorno dopo è di riposo (vincolo morbido)',
  },
  {
    key: 'isFullDayExclusive',
    letter: 'E',
    name: 'Esclusivo',
    description: 'Il dottore non può coprire altri turni nella stessa giornata',
  },
];

/**
 * Griglia dei turni settimanali di una sala: una riga per fascia oraria, una
 * colonna per giorno. Le fasce sono configurabili, quindi le righe seguono
 * quelle effettivamente definite.
 */
export function RoomSlotGrid({ room, shiftTypes, onChange }: RoomSlotGridProps) {
  const slotByCell = useMemo(() => {
    const map = new Map<string, ScheduleSlot>();
    for (const slot of room.slots) map.set(`${slot.weekday}|${slot.shiftTypeId}`, slot);
    return map;
  }, [room.slots]);

  const slotAt = (weekday: Weekday, shiftTypeId: string) =>
    slotByCell.get(`${weekday}|${shiftTypeId}`);

  /** Crea uno slot con impostazioni sensate ricavate dalla fascia. */
  const makeSlot = (weekday: Weekday, shiftType: ShiftType): ScheduleSlot => {
    const overnight = shiftType.end <= shiftType.start;
    return {
      id: generateId(),
      weekday,
      shiftTypeId: shiftType.id,
      isCritical: overnight,
      requiresNextDayRest: overnight,
      requiresSecondDayRest: false,
      isFullDayExclusive: overnight,
    };
  };

  const addSlots = (weekdays: Weekday[], shiftType: ShiftType) => {
    const added = weekdays
      .filter(weekday => !slotAt(weekday, shiftType.id))
      .map(weekday => makeSlot(weekday, shiftType));
    if (added.length > 0) onChange([...room.slots, ...added]);
  };

  const removeSlots = (weekdays: Weekday[], shiftTypeId: string) => {
    const targets = new Set(weekdays);
    onChange(room.slots.filter(
      slot => !(targets.has(slot.weekday) && slot.shiftTypeId === shiftTypeId)));
  };

  const toggleCell = (weekday: Weekday, shiftType: ShiftType) => {
    const existing = slotAt(weekday, shiftType.id);
    if (existing) onChange(room.slots.filter(slot => slot.id !== existing.id));
    else onChange([...room.slots, makeSlot(weekday, shiftType)]);
  };

  const toggleFlag = (slotId: string, flag: FlagKey) => {
    onChange(room.slots.map(slot =>
      slot.id === slotId ? { ...slot, [flag]: !slot[flag] } : slot));
  };

  /** Attiva o disattiva un flag su tutta la riga, seguendo la maggioranza. */
  const toggleRowFlag = (shiftTypeId: string, flag: FlagKey) => {
    const rowSlots = room.slots.filter(slot => slot.shiftTypeId === shiftTypeId);
    if (rowSlots.length === 0) return;
    const enable = !rowSlots.every(slot => slot[flag]);
    onChange(room.slots.map(slot =>
      slot.shiftTypeId === shiftTypeId ? { ...slot, [flag]: enable } : slot));
  };

  const rowState = (shiftTypeId: string) => {
    const rowSlots = room.slots.filter(slot => slot.shiftTypeId === shiftTypeId);
    return {
      count: rowSlots.length,
      allDays: rowSlots.length === WEEKDAYS.length,
    };
  };

  if (shiftTypes.length === 0) {
    return (
      <p className="hint">
        Nessuna fascia oraria configurata. Aggiungine una in Impostazioni.
      </p>
    );
  }

  return (
    <div className="slot-grid-wrapper">
      <div className="slot-grid-scroll">
        <table className="slot-grid">
          <thead>
            <tr>
              <th className="corner">Fascia</th>
              {WEEKDAYS.map(weekday => (
                <th
                  key={weekday}
                  className={WEEKEND_WEEKDAYS.includes(weekday) ? 'weekend' : ''}
                  title={WEEKDAY_LABELS[weekday]}
                >
                  {WEEKDAY_SHORT_LABELS[weekday]}
                </th>
              ))}
              <th className="row-actions-col">Riga</th>
            </tr>
          </thead>

          <tbody>
            {shiftTypes.map(shiftType => {
              const state = rowState(shiftType.id);
              const conflicting = shiftTypes.filter(other =>
                other.id !== shiftType.id
                && shiftsOverlap(shiftType, other)
                && room.slots.some(slot => slot.shiftTypeId === other.id));

              return (
                <tr key={shiftType.id}>
                  <th className="shift-label" style={{ borderLeftColor: shiftType.color }}>
                    <span className="shift-label-name">{shiftType.name}</span>
                    <span className="shift-label-time">{shiftType.start}–{shiftType.end}</span>
                    {isRotational(shiftType) && (
                      <span className="badge badge-accent" title={`Assegnata a blocchi di 1 ${blockLabel(shiftType)}`}>
                        rotazione
                      </span>
                    )}
                    {conflicting.length > 0 && (
                      <span className="shift-label-warning" title={`Si sovrappone a ${conflicting.map(c => c.name).join(', ')} nella stessa sala`}>
                        sovrapposta
                      </span>
                    )}
                  </th>

                  {WEEKDAYS.map(weekday => {
                    const slot = slotAt(weekday, shiftType.id);
                    const isWeekend = WEEKEND_WEEKDAYS.includes(weekday);

                    if (!slot) {
                      return (
                        <td key={weekday} className={`slot-cell ${isWeekend ? 'weekend' : ''}`}>
                          <button
                            type="button"
                            className="slot-add"
                            onClick={() => toggleCell(weekday, shiftType)}
                            title={`Aggiungi ${shiftType.name} di ${WEEKDAY_LABELS[weekday].toLowerCase()}`}
                            aria-label={`Aggiungi ${shiftType.name} di ${WEEKDAY_LABELS[weekday]}`}
                          >
                            +
                          </button>
                        </td>
                      );
                    }

                    return (
                      <td
                        key={weekday}
                        className={`slot-cell active ${isWeekend ? 'weekend' : ''}`}
                        style={{ background: `${shiftType.color}1f`, borderColor: `${shiftType.color}66` }}
                      >
                        <div className="slot-flags">
                          {FLAGS.map(flag => (
                            <button
                              key={flag.key}
                              type="button"
                              className={`flag ${slot[flag.key] ? 'on' : ''}`}
                              aria-pressed={slot[flag.key]}
                              title={`${flag.name} — ${flag.description}`}
                              onClick={() => toggleFlag(slot.id, flag.key)}
                            >
                              {flag.letter}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="slot-remove"
                            onClick={() => toggleCell(weekday, shiftType)}
                            title="Rimuovi turno"
                            aria-label={`Rimuovi ${shiftType.name} di ${WEEKDAY_LABELS[weekday]}`}
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    );
                  })}

                  <td className="row-actions">
                    <div className="row-actions-line">
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => state.allDays
                          ? removeSlots(WEEKDAYS, shiftType.id)
                          : addSlots(WEEKDAYS, shiftType)}
                        title={state.allDays ? 'Rimuovi da tutti i giorni' : 'Aggiungi a tutti i giorni'}
                      >
                        {state.allDays ? 'Svuota' : 'Tutti'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => addSlots(WORKING_WEEKDAYS, shiftType)}
                        title="Aggiungi da lunedì a venerdì"
                      >
                        Lun–Ven
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => addSlots(WEEKEND_WEEKDAYS, shiftType)}
                        title="Aggiungi sabato e domenica"
                      >
                        Weekend
                      </button>
                    </div>

                    {state.count > 0 && (
                      <div className="row-actions-line">
                        <span className="row-flag-label">Flag riga</span>
                        {FLAGS.map(flag => (
                          <button
                            key={flag.key}
                            type="button"
                            className="flag row-flag"
                            onClick={() => toggleRowFlag(shiftType.id, flag.key)}
                            title={`${flag.name} su tutti i giorni di ${shiftType.name}`}
                          >
                            {flag.letter}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="legend slot-grid-legend">
        {FLAGS.map(flag => (
          <span key={flag.key} className="legend-item" title={flag.description}>
            <span className="flag on static">{flag.letter}</span>
            {flag.name}
          </span>
        ))}
      </div>
    </div>
  );
}
