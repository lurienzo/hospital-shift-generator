import { useMemo, useState } from 'react';
import { SchemeStep, ShiftScheme, ShiftType, WEEKDAYS, WEEKDAY_SHORT_LABELS } from '../models/types';
import { ShiftTypeIndex } from '../domain/shiftTypes';
import { buildSchemeSlots } from '../domain/schemes';
import { Modal } from './ui/Modal';
import './SchemeEditor.css';

interface SchemeEditorProps {
  scheme: ShiftScheme;
  shiftTypes: ShiftType[];
  onSave: (scheme: ShiftScheme) => void;
  onClose: () => void;
}

/**
 * Compositore di uno schema turni: una sequenza di passi giornalieri, ognuno
 * un turno da coprire oppure un giorno non lavorativo.
 */
export function SchemeEditor({ scheme, shiftTypes, onSave, onClose }: SchemeEditorProps) {
  const [name, setName] = useState(scheme.name);
  const [steps, setSteps] = useState<SchemeStep[]>(scheme.steps);

  const index = useMemo(() => new ShiftTypeIndex(shiftTypes), [shiftTypes]);

  // Anteprima della settimana risultante, per far vedere subito quali flag di
  // riposo lo schema produce.
  const preview = useMemo(
    () => buildSchemeSlots({ ...scheme, name, steps }, 'monday', index),
    [scheme, name, steps, index],
  );

  const addStep = (step: SchemeStep) => setSteps(current => [...current, step]);

  const removeStep = (position: number) =>
    setSteps(current => current.filter((_, i) => i !== position));

  const moveStep = (position: number, direction: -1 | 1) => {
    const target = position + direction;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[position], next[target]] = [next[target], next[position]];
    setSteps(next);
  };

  const canSave = name.trim().length > 0 && steps.length > 0;

  const describe = (step: SchemeStep) =>
    step.kind === 'shift'
      ? index.get(step.shiftTypeId).name
      : step.kind === 'smonto' ? 'Smonto' : 'Riposo';

  return (
    <Modal
      title={scheme.steps.length > 0 || scheme.name ? 'Modifica schema' : 'Nuovo schema'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="spacer hint">
            {steps.length > 0 && `Ciclo di ${steps.length} giorni`}
          </span>
          <button type="button" className="btn" onClick={onClose}>Annulla</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSave}
            onClick={() => onSave({ ...scheme, name: name.trim(), steps })}
          >
            Salva schema
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="field">
          <label htmlFor="scheme-name">Nome dello schema</label>
          <input
            id="scheme-name"
            className="input"
            value={name}
            placeholder="es. Ciclo 5 giorni"
            onChange={event => setName(event.target.value)}
            autoFocus
          />
        </div>

        <div className="field">
          <span className="label">Sequenza</span>
          {steps.length === 0 ? (
            <p className="hint">
              Aggiungi i passi in ordine. Ogni passo è un giorno del ciclo.
            </p>
          ) : (
            <ol className="step-sequence">
              {steps.map((step, position) => (
                <li
                  key={position}
                  className={`sequence-step ${step.kind !== 'shift' ? 'off' : ''}`}
                  style={step.kind === 'shift'
                    ? { borderLeftColor: index.get(step.shiftTypeId).color }
                    : undefined}
                >
                  <span className="step-index">{position + 1}</span>
                  <span className="step-name">{describe(step)}</span>
                  <span className="step-controls">
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => moveStep(position, -1)}
                      disabled={position === 0}
                      aria-label="Sposta indietro"
                    >←</button>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => moveStep(position, 1)}
                      disabled={position === steps.length - 1}
                      aria-label="Sposta avanti"
                    >→</button>
                    <button
                      type="button"
                      className="btn-icon danger"
                      onClick={() => removeStep(position)}
                      aria-label="Rimuovi passo"
                    >✕</button>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="field">
          <span className="label">Aggiungi un passo</span>
          <div className="row-wrap">
            {index.all.map(shiftType => (
              <button
                key={shiftType.id}
                type="button"
                className="btn btn-sm"
                style={{ borderColor: shiftType.color }}
                onClick={() => addStep({ kind: 'shift', shiftTypeId: shiftType.id })}
              >
                <span className="dot" style={{ background: shiftType.color }} />
                {shiftType.name}
              </button>
            ))}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => addStep({ kind: 'smonto' })}>
              + Smonto
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => addStep({ kind: 'riposo' })}>
              + Riposo
            </button>
          </div>
          <p className="hint">
            Smonto e riposo non sono turni da coprire: indicano i giorni in cui il dottore non
            lavora. Un turno seguito da uno smonto rende automaticamente smontante il giorno
            successivo.
          </p>
        </div>

        {steps.length > 0 && (
          <div className="field">
            <span className="label">Anteprima settimana (partendo da lunedì)</span>
            <div className="scheme-preview">
              {WEEKDAYS.map((weekday, position) => {
                const step = steps[position % steps.length];
                const slot = preview.find(candidate => candidate.weekday === weekday);
                return (
                  <div key={weekday} className={`preview-day ${step.kind !== 'shift' ? 'off' : ''}`}>
                    <span className="preview-weekday">{WEEKDAY_SHORT_LABELS[weekday]}</span>
                    <span className="preview-step">{describe(step)}</span>
                    {slot && (
                      <span className="preview-flags">
                        {slot.requiresNextDayRest && <span title="Il giorno dopo è smontante">smont.</span>}
                        {slot.requiresSecondDayRest && <span title="Anche il secondo giorno è di riposo">+rip.</span>}
                        {slot.isFullDayExclusive && <span title="Nessun altro turno nella giornata">escl.</span>}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
