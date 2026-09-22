import { useMemo } from 'react';
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
import { buildCyclePreview, describeScheme, isSchemeUsable, suggestOffsetStep } from '../domain/schemes';
import { useConfig } from '../state/configContext';
import { formatISODate, mondayFirstIndex } from '../utils/date';
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
  cycle: 'Ciclo turni',
};

const MODE_DESCRIPTIONS: Record<RotationMode, string> = {
  none: 'Ogni turno viene assegnato singolarmente, cercando il massimo equilibrio fra i dottori.',
  consecutive: 'Ogni dottore copre N turni di fila prima di passare il testimone.',
  dayGroups: 'I giorni dello stesso gruppo vengono affidati allo stesso dottore nella medesima settimana.',
  cycle: 'I dottori avanzano di un passo dello schema ogni giorno, partendo sfasati fra loro.',
};

/**
 * Modalità di rotazione di una sala. Sono alternative fra loro: scegliere una
 * modalità azzera la configurazione delle altre, così non si accumulano
 * vincoli contraddittori nei dati salvati.
 */
export function RoomRotation({ room, onChange }: RoomRotationProps) {
  const { doctors, schemes, shiftTypeIndex } = useConfig();
  const mode = getRotationMode(room);

  const usableSchemes = useMemo(
    () => schemes.filter(scheme => scheme.steps.length > 0 && isSchemeUsable(scheme, shiftTypeIndex)),
    [schemes, shiftTypeIndex],
  );

  const selectMode = (next: RotationMode) => {
    if (next === mode) return;

    switch (next) {
      case 'none':
        onChange({ consecutiveShifts: undefined, consecutiveStartDay: undefined, dayGroups: [], cycle: undefined });
        break;
      case 'consecutive':
        onChange({ consecutiveShifts: 2, consecutiveStartDay: undefined, dayGroups: [], cycle: undefined });
        break;
      case 'dayGroups':
        onChange({
          consecutiveShifts: undefined,
          consecutiveStartDay: undefined,
          cycle: undefined,
          dayGroups: [{ id: generateId(), days: [] }],
        });
        break;
      case 'cycle': {
        const scheme = usableSchemes[0];
        onChange({
          consecutiveShifts: undefined,
          consecutiveStartDay: undefined,
          dayGroups: [],
          cycle: {
            schemeId: scheme?.id ?? '',
            startDate: '',
            doctorIds: doctors.map(doctor => doctor.id),
            offsetStep: suggestOffsetStep(scheme?.steps.length ?? 1, doctors.length),
          },
        });
        break;
      }
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
              disabled={candidate === 'cycle' && usableSchemes.length === 0}
              title={candidate === 'cycle' && usableSchemes.length === 0
                ? 'Serve almeno uno schema turni con dei passi'
                : MODE_DESCRIPTIONS[candidate]}
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

      {mode === 'cycle' && room.cycle && (
        <CycleConfig
          room={room}
          onChange={onChange}
          schemes={usableSchemes}
          doctors={doctors}
          shiftTypeIndex={shiftTypeIndex}
        />
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

// ---------------------------------------------------------------------------

interface CycleConfigProps extends RoomRotationProps {
  schemes: ReturnType<typeof useConfig>['schemes'];
  doctors: ReturnType<typeof useConfig>['doctors'];
  shiftTypeIndex: ReturnType<typeof useConfig>['shiftTypeIndex'];
}

function CycleConfig({ room, onChange, schemes, doctors, shiftTypeIndex }: CycleConfigProps) {
  const cycle = room.cycle!;
  const scheme = schemes.find(candidate => candidate.id === cycle.schemeId);

  const update = (changes: Partial<typeof cycle>) => onChange({ cycle: { ...cycle, ...changes } });

  const anchor = cycle.startDate || nextMonday();
  const preview = useMemo(() => {
    if (!scheme) return null;
    return buildCyclePreview(
      scheme,
      cycle.doctorIds,
      cycle.offsetStep,
      anchor,
      14,
      shiftTypeIndex,
    );
  }, [scheme, cycle.doctorIds, cycle.offsetStep, anchor, shiftTypeIndex]);

  const toggleDoctor = (doctorId: string) => {
    const next = cycle.doctorIds.includes(doctorId)
      ? cycle.doctorIds.filter(id => id !== doctorId)
      : [...cycle.doctorIds, doctorId];
    update({ doctorIds: next });
  };

  const moveDoctor = (doctorId: string, direction: -1 | 1) => {
    const order = [...cycle.doctorIds];
    const index = order.indexOf(doctorId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    update({ doctorIds: order });
  };

  const doctorName = (doctorId: string) =>
    doctors.find(doctor => doctor.id === doctorId)?.name ?? '—';
  const doctorColor = (doctorId: string) =>
    doctors.find(doctor => doctor.id === doctorId)?.color ?? '#64748b';

  const coversFully = scheme !== undefined
    && cycle.doctorIds.length >= scheme.steps.filter(step => step.kind === 'shift').length;

  return (
    <div className="rotation-config">
      <div className="field-row">
        <div className="field">
          <label htmlFor={`cycle-scheme-${room.id}`}>Schema</label>
          <select
            id={`cycle-scheme-${room.id}`}
            className="select"
            value={cycle.schemeId}
            onChange={event => {
              const next = schemes.find(candidate => candidate.id === event.target.value);
              update({
                schemeId: event.target.value,
                offsetStep: suggestOffsetStep(next?.steps.length ?? 1, cycle.doctorIds.length),
              });
            }}
          >
            <option value="">Seleziona uno schema</option>
            {schemes.map(candidate => (
              <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
            ))}
          </select>
        </div>

        <div className="field field-narrow">
          <label htmlFor={`cycle-offset-${room.id}`}>Sfasamento</label>
          <input
            id={`cycle-offset-${room.id}`}
            className="input"
            type="number"
            min={1}
            max={Math.max(1, scheme?.steps.length ?? 1)}
            value={cycle.offsetStep}
            onChange={event => {
              const parsed = Number.parseInt(event.target.value, 10);
              update({ offsetStep: Number.isFinite(parsed) && parsed > 0 ? parsed : 1 });
            }}
          />
        </div>

        <div className="field field-narrow">
          <label htmlFor={`cycle-start-${room.id}`}>Inizio ciclo</label>
          <input
            id={`cycle-start-${room.id}`}
            className="input"
            type="date"
            value={cycle.startDate}
            onChange={event => update({ startDate: event.target.value })}
          />
        </div>
      </div>

      {scheme && (
        <p className="hint">
          {describeScheme(scheme, shiftTypeIndex)}
          {!cycle.startDate && ' — senza data di inizio il ciclo parte dal primo del mese.'}
        </p>
      )}

      <div className="field">
        <span className="label">Dottori nel ciclo ({cycle.doctorIds.length})</span>
        <div className="row-wrap">
          {doctors.map(doctor => (
            <button
              key={doctor.id}
              type="button"
              className={`doctor-pill ${cycle.doctorIds.includes(doctor.id) ? 'on' : ''}`}
              style={cycle.doctorIds.includes(doctor.id)
                ? { borderColor: doctor.color, background: `${doctor.color}22` }
                : undefined}
              onClick={() => toggleDoctor(doctor.id)}
            >
              <span className="dot" style={{ background: doctor.color }} />
              {doctor.name}
            </button>
          ))}
        </div>
        {doctors.length === 0 && <p className="hint">Aggiungi dei dottori per usare il ciclo.</p>}
      </div>

      {cycle.doctorIds.length > 0 && (
        <div className="field">
          <span className="label">Ordine di ingresso</span>
          <ol className="cycle-order">
            {cycle.doctorIds.map((doctorId, index) => (
              <li key={doctorId}>
                <span className="cycle-position">{index + 1}</span>
                <span className="dot" style={{ background: doctorColor(doctorId) }} />
                <span className="cycle-doctor-name">{doctorName(doctorId)}</span>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => moveDoctor(doctorId, -1)}
                  disabled={index === 0}
                  aria-label="Sposta su"
                >↑</button>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => moveDoctor(doctorId, 1)}
                  disabled={index === cycle.doctorIds.length - 1}
                  aria-label="Sposta giù"
                >↓</button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {preview && preview.rows.length > 0 && (
        <div className="field">
          <span className="label">Anteprima (14 giorni da {anchor})</span>
          <div className="cycle-preview-scroll">
            <table className="cycle-preview">
              <thead>
                <tr>
                  <th>Dottore</th>
                  {preview.dates.map(date => (
                    <th key={date} className={mondayFirstIndex(date) >= 5 ? 'weekend' : ''}>
                      {Number(date.slice(8, 10))}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map(row => (
                  <tr key={row.doctorId}>
                    <th>
                      <span className="dot" style={{ background: doctorColor(row.doctorId) }} />
                      {doctorName(row.doctorId)}
                    </th>
                    {row.codes.map((code, index) => (
                      <td key={index} className={code === 'S' || code === 'R' ? 'off' : ''}>
                        {code}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!coversFully && (
            <p className="hint">
              I dottori nel ciclo sono meno dei turni da coprire: i turni rimasti liberi
              verranno assegnati normalmente, cercando l&apos;equilibrio fra tutti.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Primo lunedì da oggi, usato come proposta di inizio ciclo. */
function nextMonday(): string {
  const date = new Date();
  const offset = (8 - (date.getDay() || 7)) % 7;
  date.setDate(date.getDate() + offset);
  return formatISODate(date);
}
