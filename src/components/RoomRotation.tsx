import {
  DayGroup,
  OperativeRoom,
  RotationMode,
  Weekday,
  WEEKDAYS,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
  getRotationMode,
} from '../models/types';
import { generateId } from '../utils/id';
import './RoomRotation.css';

interface RoomRotationProps {
  room: OperativeRoom;
  onChange: (changes: Partial<OperativeRoom>) => void;
}

const MODE_LABELS: Record<RotationMode, string> = {
  none: 'Nessuna',
  consecutive: 'Turni consecutivi',
  dayGroups: 'Gruppi di giorni',
};

const MODE_DESCRIPTIONS: Record<RotationMode, string> = {
  none: 'Ogni turno viene assegnato singolarmente, cercando il massimo equilibrio fra i dottori.',
  consecutive: 'Ogni dottore copre N turni di fila prima di passare il testimone.',
  dayGroups: 'I giorni dello stesso gruppo vengono affidati allo stesso dottore nella medesima settimana.',
};

/**
 * Continuità dei turni all'interno di una singola sala. Le modalità sono
 * alternative fra loro: scegliendone una si azzera la configurazione delle
 * altre, così non si accumulano vincoli contraddittori nei dati salvati.
 *
 * La rotazione dello schema di servizio è un'altra cosa e vive nelle
 * impostazioni: riguarda la successione delle giornate di un medico su tutte
 * le sale, non la continuità dentro una sala.
 */
export function RoomRotation({ room, onChange }: RoomRotationProps) {
  const mode = getRotationMode(room);

  const selectMode = (next: RotationMode) => {
    if (next === mode) return;

    switch (next) {
      case 'none':
        onChange({ consecutiveShifts: undefined, consecutiveStartDay: undefined, dayGroups: [] });
        break;
      case 'consecutive':
        onChange({ consecutiveShifts: 2, consecutiveStartDay: undefined, dayGroups: [] });
        break;
      case 'dayGroups':
        onChange({
          consecutiveShifts: undefined,
          consecutiveStartDay: undefined,
          dayGroups: [{ id: generateId(), days: [] }],
        });
        break;
    }
  };

  return (
    <section className="rotation">
      <div className="rotation-modes">
        <span className="label">Rotazione dei dottori</span>
        <div className="segmented">
          {(Object.keys(MODE_LABELS) as RotationMode[]).map(candidate => (
            <button
              key={candidate}
              type="button"
              className={mode === candidate ? 'active' : ''}
              onClick={() => selectMode(candidate)}
              title={MODE_DESCRIPTIONS[candidate]}
            >
              {MODE_LABELS[candidate]}
            </button>
          ))}
        </div>
        <p className="hint">{MODE_DESCRIPTIONS[mode]}</p>
      </div>

      {mode === 'consecutive' && (
        <ConsecutiveConfig room={room} onChange={onChange} />
      )}

      {mode === 'dayGroups' && (
        <DayGroupsConfig room={room} onChange={onChange} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function ConsecutiveConfig({ room, onChange }: RoomRotationProps) {
  const value = room.consecutiveShifts ?? 2;
  const weeklyBlocks = value === 7;

  return (
    <div className="rotation-config">
      <div className="field-row">
        <div className="field field-narrow">
          <label htmlFor={`cons-${room.id}`}>Turni di fila</label>
          <input
            id={`cons-${room.id}`}
            className="input"
            type="number"
            min={1}
            max={31}
            value={value}
            onChange={event => {
              const parsed = Number.parseInt(event.target.value, 10);
              onChange({ consecutiveShifts: Number.isFinite(parsed) && parsed > 0 ? parsed : 1 });
            }}
          />
        </div>

        <div className="field">
          <label htmlFor={`cons-start-${room.id}`}>Allinea i blocchi a un giorno</label>
          <select
            id={`cons-start-${room.id}`}
            className="select"
            value={room.consecutiveStartDay ?? ''}
            onChange={event => onChange({
              consecutiveStartDay: event.target.value ? (event.target.value as Weekday) : undefined,
            })}
          >
            <option value="">Nessun allineamento</option>
            {WEEKDAYS.map(weekday => (
              <option key={weekday} value={weekday}>{WEEKDAY_LABELS[weekday]}</option>
            ))}
          </select>
        </div>
      </div>

      <p className="hint">
        {room.consecutiveStartDay
          ? `Un nuovo blocco comincia ogni ${WEEKDAY_LABELS[room.consecutiveStartDay].toLowerCase()}, indipendentemente da quanti turni contenga.`
          : `I blocchi sono di ${value} turni consecutivi in ordine cronologico.`}
        {weeklyBlocks && !room.consecutiveStartDay && ' Con 7 turni conviene allinearli a un giorno fisso.'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DayGroupsConfig({ room, onChange }: RoomRotationProps) {
  const groups = room.dayGroups;

  const updateGroups = (next: DayGroup[]) => onChange({ dayGroups: next });

  const toggleDay = (groupId: string, weekday: Weekday) => {
    updateGroups(groups.map(group => {
      if (group.id !== groupId) return group;
      const days = group.days.includes(weekday)
        ? group.days.filter(day => day !== weekday)
        : [...group.days, weekday];
      return { ...group, days: days.sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)) };
    }));
  };

  /** Un giorno può stare in un solo gruppo, altrimenti i vincoli si scontrano. */
  const dayOwner = (weekday: Weekday, groupId: string) =>
    groups.find(group => group.id !== groupId && group.days.includes(weekday));

  return (
    <div className="rotation-config">
      <div className="day-groups">
        {groups.map((group, index) => (
          <div key={group.id} className="day-group">
            <span className="day-group-index">Gruppo {index + 1}</span>
            <div className="day-toggles">
              {WEEKDAYS.map(weekday => {
                const owner = dayOwner(weekday, group.id);
                return (
                  <button
                    key={weekday}
                    type="button"
                    className={`day-toggle ${group.days.includes(weekday) ? 'on' : ''}`}
                    disabled={owner !== undefined}
                    title={owner
                      ? `Già nel gruppo ${groups.indexOf(owner) + 1}`
                      : WEEKDAY_LABELS[weekday]}
                    onClick={() => toggleDay(group.id, weekday)}
                  >
                    {WEEKDAY_SHORT_LABELS[weekday]}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="btn-icon danger"
              onClick={() => updateGroups(groups.filter(other => other.id !== group.id))}
              aria-label={`Rimuovi gruppo ${index + 1}`}
            >✕</button>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="btn btn-sm"
        onClick={() => updateGroups([...groups, { id: generateId(), days: [] }])}
      >
        Aggiungi gruppo
      </button>

      {groups.some(group => group.days.length === 0) && (
        <p className="hint">Un gruppo senza giorni selezionati viene ignorato.</p>
      )}
    </div>
  );
}
