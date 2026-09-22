import { useMemo } from 'react';
import { RotationRule } from '../models/types';
import { describeScheme, isSchemeUsable, workingStepCount } from '../domain/schemes';
import { useConfig } from '../state/configContext';
import './RotationRuleEditor.css';

/**
 * Regola di rotazione del servizio: lo schema che i medici cercano di
 * seguire, valido per tutte le sale.
 *
 * Non c'è un giorno di partenza da impostare. La posizione di ciascun medico
 * nello schema deriva dal turno che ha svolto più recentemente, quindi la
 * rotazione si avvia da sola col primo calendario generato e prosegue da dove
 * era arrivata nei mesi successivi.
 */
export function RotationRuleEditor() {
  const {
    rooms, doctors, schemes, shiftTypeIndex, rotationRule, setRotationRule, rotationScheme,
  } = useConfig();

  const usableSchemes = useMemo(
    () => schemes.filter(scheme => scheme.steps.length > 0 && isSchemeUsable(scheme, shiftTypeIndex)),
    [schemes, shiftTypeIndex],
  );

  const update = (changes: Partial<RotationRule>) =>
    setRotationRule({ ...rotationRule, ...changes });

  const participants = rotationRule.doctorIds.length > 0
    ? doctors.filter(doctor => rotationRule.doctorIds.includes(doctor.id))
    : doctors;

  /** Turni che il servizio richiede in una giornata tipo, per stimare la copertura. */
  const dailyDemand = useMemo(() => {
    const perWeekday = new Map<string, number>();
    for (const room of rooms) {
      for (const slot of room.slots) {
        perWeekday.set(slot.weekday, (perWeekday.get(slot.weekday) ?? 0) + 1);
      }
    }
    const counts = [...perWeekday.values()];
    return counts.length > 0 ? Math.max(...counts) : 0;
  }, [rooms]);

  const workingSteps = rotationScheme ? workingStepCount(rotationScheme) : 0;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Rotazione del servizio</h3>
          <p className="hint">
            Lo schema che i medici cercano di seguire, su tutte le sale del servizio. Non è
            legato a una sala né a un giorno fisso: la posizione di ciascuno dipende dal turno
            che ha svolto più recentemente, quindi chi ha fatto la notte è atteso in smonto il
            giorno dopo, qualunque sala gliela avesse data.
          </p>
        </div>
      </div>

      <div className="field-row">
        <div className="field rotation-scheme-field">
          <label htmlFor="rotation-scheme">Schema da seguire</label>
          <select
            id="rotation-scheme"
            className="select"
            value={rotationRule.schemeId}
            onChange={event => update({ schemeId: event.target.value })}
          >
            <option value="">Nessuna rotazione</option>
            {usableSchemes.map(scheme => (
              <option key={scheme.id} value={scheme.id}>{scheme.name}</option>
            ))}
          </select>
        </div>

        {rotationScheme && (
          <div className="field">
            <span className="label">Quanto vincola</span>
            <div className="segmented">
              <button
                type="button"
                className={rotationRule.strength === 'preference' ? 'active' : ''}
                onClick={() => update({ strength: 'preference' })}
              >
                Da seguire
              </button>
              <button
                type="button"
                className={rotationRule.strength === 'binding' ? 'active' : ''}
                onClick={() => update({ strength: 'binding' })}
              >
                Vincolante
              </button>
            </div>
          </div>
        )}
      </div>

      {usableSchemes.length === 0 && (
        <p className="hint">
          Non ci sono schemi utilizzabili: creane uno qui sotto, oppure verifica che le fasce
          che gli schemi citano esistano ancora.
        </p>
      )}

      {rotationScheme && (
        <>
          <p className="rotation-sequence">
            {describeScheme(rotationScheme, shiftTypeIndex)}
            <span className="hint"> — giro di {rotationScheme.steps.length} giorni</span>
          </p>

          <p className="hint">
            {rotationRule.strength === 'binding'
              ? 'Nei giorni di smonto e riposo previsti dallo schema non verrà assegnato nessun turno, anche a costo di lasciarlo scoperto.'
              : 'Il generatore segue la rotazione quando può, ma non lascia turni scoperti per rispettarla. Gli scostamenti sono segnalati nel calendario come avvisi.'}
          </p>

          <div className="field">
            <span className="label">
              A chi si applica{rotationRule.doctorIds.length === 0 ? ' — tutti' : ` — ${participants.length} di ${doctors.length}`}
            </span>
            <div className="row-wrap">
              <button
                type="button"
                className={`select-pill ${rotationRule.doctorIds.length === 0 ? 'on' : ''}`}
                onClick={() => update({ doctorIds: [] })}
              >
                Tutti i dottori
              </button>
              {doctors.map(doctor => {
                const included = rotationRule.doctorIds.length === 0
                  || rotationRule.doctorIds.includes(doctor.id);
                return (
                  <button
                    key={doctor.id}
                    type="button"
                    className={`select-pill ${included ? 'on' : ''}`}
                    style={included ? { borderColor: doctor.color, background: `${doctor.color}22` } : undefined}
                    onClick={() => {
                      // Il primo clic parte dall'insieme completo, altrimenti
                      // escludere una persona vorrebbe dire prima elencarle tutte.
                      const current = rotationRule.doctorIds.length === 0
                        ? doctors.map(other => other.id)
                        : rotationRule.doctorIds;
                      const next = current.includes(doctor.id)
                        ? current.filter(id => id !== doctor.id)
                        : [...current, doctor.id];
                      update({ doctorIds: next.length === doctors.length ? [] : next });
                    }}
                  >
                    <span className="dot" style={{ background: doctor.color }} />
                    {doctor.name}
                  </button>
                );
              })}
            </div>
            {doctors.length === 0 && (
              <p className="hint">Aggiungi dei dottori perché la rotazione abbia effetto.</p>
            )}
          </div>

          {workingSteps > 0 && participants.length > 0 && dailyDemand > 0 && (
            <p className={`rotation-coverage ${participants.length >= dailyDemand * rotationScheme.steps.length / workingSteps ? 'ok' : 'tight'}`}>
              {coverageNote(participants.length, rotationScheme.steps.length, workingSteps, dailyDemand)}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Stima se i medici bastano a sostenere la rotazione.
 *
 * In un giro di L giorni con W giornate lavorative, ogni medico copre W turni
 * ogni L giorni: per coprire D turni al giorno servono almeno D · L / W
 * persone.
 */
function coverageNote(
  participants: number,
  cycleLength: number,
  workingSteps: number,
  dailyDemand: number,
): string {
  const needed = Math.ceil((dailyDemand * cycleLength) / workingSteps);

  if (participants >= needed) {
    return `Con ${participants} dottori la rotazione si sostiene: per coprire fino a `
      + `${dailyDemand} turni al giorno ne servono ${needed}.`;
  }

  return `Per coprire fino a ${dailyDemand} turni al giorno servirebbero ${needed} dottori, `
    + `ma nella rotazione ce ne sono ${participants}: i turni in eccesso verranno assegnati `
    + 'fuori rotazione, cercando comunque l’equilibrio.';
}
