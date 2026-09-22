import {
  HOURS_ENFORCEMENT_LABELS,
  HOURS_PERIOD_LABELS,
  HoursEnforcement,
  HoursPeriod,
  HoursTarget,
} from '../models/types';
import { useConfig } from '../state/configContext';
import './HoursTargetEditor.css';

/**
 * Ore minime e massime che ogni medico dovrebbe svolgere.
 *
 * Il minimo orienta la scelta del generatore, che serve prima chi è sotto
 * soglia. Il massimo può essere un tetto invalicabile oppure una soglia
 * recuperabile nei periodi vicini, che è il comportamento predefinito perché
 * corrisponde a come funziona un reparto. Le eccezioni per singolo medico si
 * impostano nella sua scheda.
 */
export function HoursTargetEditor() {
  const { hoursTarget, setHoursTarget, doctors } = useConfig();

  const update = (changes: Partial<HoursTarget>) =>
    setHoursTarget({ ...hoursTarget, ...changes });

  const parseHours = (value: string, fallback: number) => {
    const parsed = Number.parseFloat(value.replace(',', '.'));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };

  const invalid = hoursTarget.max > 0 && hoursTarget.min > hoursTarget.max;
  const withOverride = doctors.filter(doctor => doctor.hoursOverride !== undefined);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Ore per medico</h3>
          <p className="hint">
            Quante ore ciascuno dovrebbe svolgere nel periodo indicato. Il minimo guida la
            distribuzione; per il massimo si sceglie se sia invalicabile o recuperabile.
          </p>
        </div>
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={hoursTarget.enabled}
          onChange={event => update({ enabled: event.target.checked })}
        />
        <span>Controlla le ore svolte</span>
      </label>

      {hoursTarget.enabled && (
        <>
          <div className="field-row hours-fields">
            <div className="field">
              <span className="label">Periodo</span>
              <div className="segmented">
                {(Object.keys(HOURS_PERIOD_LABELS) as HoursPeriod[]).map(period => (
                  <button
                    key={period}
                    type="button"
                    className={hoursTarget.period === period ? 'active' : ''}
                    onClick={() => update({ period })}
                  >
                    Per {HOURS_PERIOD_LABELS[period]}
                  </button>
                ))}
              </div>
            </div>

            <div className="field field-hours">
              <label htmlFor="hours-min">Minimo</label>
              <div className="hours-input">
                <input
                  id="hours-min"
                  className={`input ${invalid ? 'invalid' : ''}`}
                  type="number"
                  min={0}
                  max={200}
                  step={1}
                  value={hoursTarget.min}
                  onChange={event => update({ min: parseHours(event.target.value, hoursTarget.min) })}
                />
                <span className="hours-unit">ore</span>
              </div>
            </div>

            <div className="field field-hours">
              <label htmlFor="hours-max">Massimo</label>
              <div className="hours-input">
                <input
                  id="hours-max"
                  className={`input ${invalid ? 'invalid' : ''}`}
                  type="number"
                  min={0}
                  max={200}
                  step={1}
                  value={hoursTarget.max}
                  onChange={event => update({ max: parseHours(event.target.value, hoursTarget.max) })}
                />
                <span className="hours-unit">ore</span>
              </div>
            </div>
          </div>

          <div className="field">
            <span className="label">Il massimo</span>
            <div className="segmented">
              {(Object.keys(HOURS_ENFORCEMENT_LABELS) as HoursEnforcement[]).map(mode => (
                <button
                  key={mode}
                  type="button"
                  className={hoursTarget.enforcement === mode ? 'active' : ''}
                  onClick={() => update({ enforcement: mode })}
                >
                  {HOURS_ENFORCEMENT_LABELS[mode]}
                </button>
              ))}
            </div>
            <p className="hint">
              {hoursTarget.enforcement === 'balance' ? (
                <>
                  {hoursTarget.period === 'week'
                    ? 'Una settimana può andare'
                    : 'Un mese può andare'}{' '}
                  oltre le {hoursTarget.max} ore, purché si recuperi nei periodi vicini:
                  quello che viene controllato è il totale. Su quattro{' '}
                  {hoursTarget.period === 'week' ? 'settimane complete' : 'mesi completi'} il
                  totale ammesso va da {hoursTarget.min * 4} a {hoursTarget.max * 4} ore.
                </>
              ) : (
                <>
                  Le {hoursTarget.max} ore non vengono superate in{' '}
                  {hoursTarget.period === 'week' ? 'nessuna settimana' : 'nessun mese'},
                  anche a costo di lasciare un turno scoperto.
                </>
              )}
            </p>
          </div>

          {invalid ? (
            <p className="form-error">Il minimo non può superare il massimo.</p>
          ) : (
            <p className="hint">
              Ogni medico dovrebbe svolgere fra {hoursTarget.min} e {hoursTarget.max} ore
              per {HOURS_PERIOD_LABELS[hoursTarget.period]}.
              {hoursTarget.period === 'week' && (
                <>
                  {' '}Le settimane a cavallo di due mesi vengono giudicate sul minimo solo se
                  il mese precedente è già stato salvato: le ore dei giorni non visibili
                  possono soltanto aggiungersi.
                </>
              )}
            </p>
          )}

          {withOverride.length > 0 && (
            <p className="hint">
              Con ore proprie:{' '}
              {withOverride.map(doctor =>
                `${doctor.name} (${doctor.hoursOverride!.min}–${doctor.hoursOverride!.max})`,
              ).join(', ')}.
            </p>
          )}
        </>
      )}
    </section>
  );
}
