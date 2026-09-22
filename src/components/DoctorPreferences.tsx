import {
  Doctor,
  HOURS_PERIOD_LABELS,
  RuleLevel,
  ShiftLengthPreference,
  Weekday,
  WEEKDAYS,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
} from '../models/types';
import {
  SHIFT_LENGTH_LABELS,
  nextRuleLevel,
  setWeekdayRule,
} from '../domain/preferences';
import { useConfig } from '../state/configContext';
import './DoctorPreferences.css';

interface DoctorPreferencesProps {
  doctor: Doctor;
  onChange: (doctor: Doctor) => void;
}

const LEVEL_LABELS: Record<RuleLevel, string> = {
  avoid: 'preferisce evitare',
  never: 'non lavora mai',
};

/**
 * Preferenze e divieti di un medico.
 *
 * La griglia mette insieme le due cose su tre livelli, perché sono la stessa
 * domanda posta con diversa insistenza: un clic marca la casella come "da
 * evitare" (avviso), due clic come "mai" (errore), tre la liberano. La riga
 * "tutto il giorno" agisce sulla giornata intera.
 */
export function DoctorPreferences({ doctor, onChange }: DoctorPreferencesProps) {
  const { shiftTypes, doctorRules, lengthScale, hoursTarget, rooms } = useConfig();

  const cycle = (weekday: Weekday, shiftTypeId: string | null) => {
    const current = doctorRules.exactLevel(doctor.id, weekday, shiftTypeId);
    onChange(setWeekdayRule(doctor, weekday, shiftTypeId, nextRuleLevel(current)));
  };

  const cellTitle = (weekday: Weekday, shiftTypeId: string | null, name: string) => {
    const exact = doctorRules.exactLevel(doctor.id, weekday, shiftTypeId);
    const effective = shiftTypeId === null
      ? exact
      : doctorRules.levelFor(doctor.id, weekday, shiftTypeId);

    const what = shiftTypeId === null
      ? `${WEEKDAY_LABELS[weekday]}, tutto il giorno`
      : `${WEEKDAY_LABELS[weekday]} — ${name}`;

    if (exact === null && effective !== null) {
      return `${what}: ${LEVEL_LABELS[effective]} per la regola di giornata`;
    }
    return effective === null
      ? `${what}: nessun vincolo. Clicca per "preferisce evitare"`
      : `${what}: ${LEVEL_LABELS[effective]}. Clicca per cambiare`;
  };

  const levelClass = (level: RuleLevel | null, inherited: boolean) => {
    if (level === null) return '';
    return `${level} ${inherited ? 'inherited' : ''}`;
  };

  const setLength = (preference: ShiftLengthPreference) =>
    onChange({ ...doctor, shiftLengthPreference: preference });

  const toggleHoursOverride = (enabled: boolean) => {
    onChange({
      ...doctor,
      hoursOverride: enabled ? { min: hoursTarget.min, max: hoursTarget.max } : undefined,
    });
  };

  const setOverride = (changes: Partial<{ min: number; max: number }>) => {
    const current = doctor.hoursOverride ?? { min: hoursTarget.min, max: hoursTarget.max };
    onChange({ ...doctor, hoursOverride: { ...current, ...changes } });
  };

  return (
    <div className="doctor-preferences">
      {/* ----- Sale escluse ----- */}
      <div className="field">
        <span className="label">Sale in cui non lavora</span>
        {rooms.length === 0 ? (
          <p className="hint">Nessuna sala configurata.</p>
        ) : (
          <div className="row-wrap">
            {rooms.map(room => (
              <button
                key={room.id}
                type="button"
                className={`exclusion-pill ${doctor.excludedRooms.includes(room.id) ? 'on' : ''}`}
                onClick={() => onChange({
                  ...doctor,
                  excludedRooms: doctor.excludedRooms.includes(room.id)
                    ? doctor.excludedRooms.filter(id => id !== room.id)
                    : [...doctor.excludedRooms, room.id],
                })}
              >
                <span className="dot" style={{ background: room.color }} />
                {room.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ----- Griglia giorni e fasce ----- */}
      <div className="field">
        <span className="label">Giorni e fasce</span>
        <div className="rules-grid-scroll">
          <table className="rules-grid">
            <thead>
              <tr>
                <th />
                {WEEKDAYS.map(weekday => (
                  <th key={weekday} title={WEEKDAY_LABELS[weekday]}>
                    {WEEKDAY_SHORT_LABELS[weekday]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="whole-day-row">
                <th>Tutto il giorno</th>
                {WEEKDAYS.map(weekday => {
                  const level = doctorRules.exactLevel(doctor.id, weekday, null);
                  return (
                    <td key={weekday}>
                      <button
                        type="button"
                        className={`rule-cell ${levelClass(level, false)}`}
                        title={cellTitle(weekday, null, '')}
                        onClick={() => cycle(weekday, null)}
                      >
                        {level === 'never' ? '✕' : level === 'avoid' ? '~' : ''}
                      </button>
                    </td>
                  );
                })}
              </tr>

              {shiftTypes.map(shiftType => (
                <tr key={shiftType.id}>
                  <th style={{ borderLeftColor: shiftType.color }}>
                    {shiftType.name}
                    <span className="rule-row-time">{shiftType.start}–{shiftType.end}</span>
                  </th>
                  {WEEKDAYS.map(weekday => {
                    const exact = doctorRules.exactLevel(doctor.id, weekday, shiftType.id);
                    const effective = doctorRules.levelFor(doctor.id, weekday, shiftType.id);
                    return (
                      <td key={weekday}>
                        <button
                          type="button"
                          className={`rule-cell ${levelClass(effective, exact === null)}`}
                          title={cellTitle(weekday, shiftType.id, shiftType.name)}
                          onClick={() => cycle(weekday, shiftType.id)}
                        >
                          {effective === 'never' ? '✕' : effective === 'avoid' ? '~' : ''}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="legend rules-legend">
          <span className="legend-item">
            <span className="rule-cell avoid static">~</span>
            Preferisce evitare — avviso
          </span>
          <span className="legend-item">
            <span className="rule-cell never static">✕</span>
            Non lavora mai — errore
          </span>
          <span className="legend-item">
            <span className="rule-cell avoid inherited static">~</span>
            Dalla regola di giornata
          </span>
        </div>
      </div>

      {/* ----- Durata dei turni ----- */}
      <div className="field">
        <span className="label">Durata dei turni preferita</span>
        <div className="segmented">
          {(Object.keys(SHIFT_LENGTH_LABELS) as ShiftLengthPreference[]).map(preference => (
            <button
              key={preference}
              type="button"
              className={doctor.shiftLengthPreference === preference ? 'active' : ''}
              onClick={() => setLength(preference)}
              disabled={preference !== 'none' && !lengthScale.meaningful}
            >
              {SHIFT_LENGTH_LABELS[preference]}
            </button>
          ))}
        </div>
        <p className="hint">
          {lengthScale.meaningful ? (
            <>
              In questo servizio è considerato lungo un turno da {formatHours(lengthScale.threshold)}
              {' '}o più, visto che le fasce vanno da {formatHours(lengthScale.shortest)} a
              {' '}{formatHours(lengthScale.longest)}. È una preferenza: orienta la scelta, non
              la impone.
            </>
          ) : (
            <>
              Tutte le fasce configurate hanno la stessa durata, quindi la distinzione fra
              turni lunghi e brevi non si applica.
            </>
          )}
        </p>
      </div>

      {/* ----- Ore proprie ----- */}
      {hoursTarget.enabled && (
        <div className="field">
          <span className="label">Ore per {HOURS_PERIOD_LABELS[hoursTarget.period]}</span>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={doctor.hoursOverride !== undefined}
              onChange={event => toggleHoursOverride(event.target.checked)}
            />
            <span>
              Ore diverse da quelle del servizio
              {doctor.hoursOverride === undefined
                && ` (ora ${hoursTarget.min}–${hoursTarget.max})`}
            </span>
          </label>

          {doctor.hoursOverride && (
            <div className="field-row hours-fields">
              <div className="field field-hours">
                <label htmlFor={`min-${doctor.id}`}>Minimo</label>
                <div className="hours-input">
                  <input
                    id={`min-${doctor.id}`}
                    className="input"
                    type="number"
                    min={0}
                    max={200}
                    value={doctor.hoursOverride.min}
                    onChange={event => setOverride({ min: Number(event.target.value) })}
                  />
                  <span className="hours-unit">ore</span>
                </div>
              </div>
              <div className="field field-hours">
                <label htmlFor={`max-${doctor.id}`}>Massimo</label>
                <div className="hours-input">
                  <input
                    id={`max-${doctor.id}`}
                    className="input"
                    type="number"
                    min={0}
                    max={200}
                    value={doctor.hoursOverride.max}
                    onChange={event => setOverride({ max: Number(event.target.value) })}
                  />
                  <span className="hours-unit">ore</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <p className="hint">
        Ferie e disponibilità di un singolo mese si impostano nella sezione Genera.
      </p>
    </div>
  );
}

function formatHours(hours: number): string {
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}
