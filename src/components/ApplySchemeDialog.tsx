import { useMemo, useState } from 'react';
import {
  OperativeRoom,
  ScheduleSlot,
  ShiftScheme,
  Weekday,
  WEEKDAYS,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
} from '../models/types';
import { ShiftTypeIndex } from '../domain/shiftTypes';
import { buildSchemeSlots, describeScheme, isSchemeUsable, mergeSchemeSlots } from '../domain/schemes';
import { Modal } from './ui/Modal';
import './ApplySchemeDialog.css';

interface ApplySchemeDialogProps {
  room: OperativeRoom;
  schemes: ShiftScheme[];
  shiftTypes: ShiftTypeIndex;
  onApply: (slots: ScheduleSlot[]) => void;
  onClose: () => void;
}

/**
 * Applica uno schema turni alla griglia settimanale di una sala. La sequenza
 * viene distribuita sui sette giorni a partire da quello scelto, ripetendosi
 * se più corta della settimana.
 */
export function ApplySchemeDialog({
  room,
  schemes,
  shiftTypes,
  onApply,
  onClose,
}: ApplySchemeDialogProps) {
  const usable = useMemo(
    () => schemes.filter(scheme => scheme.steps.length > 0 && isSchemeUsable(scheme, shiftTypes)),
    [schemes, shiftTypes],
  );

  const [schemeId, setSchemeId] = useState(usable[0]?.id ?? '');
  const [startWeekday, setStartWeekday] = useState<Weekday>('monday');
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');

  const scheme = usable.find(candidate => candidate.id === schemeId);

  const drafts = useMemo(
    () => (scheme ? buildSchemeSlots(scheme, startWeekday, shiftTypes) : []),
    [scheme, startWeekday, shiftTypes],
  );

  const result = useMemo(
    () => mergeSchemeSlots(room.slots, drafts, mode),
    [room.slots, drafts, mode],
  );

  const added = result.length - (mode === 'replace' ? 0 : room.slots.length);
  const removed = mode === 'replace'
    ? room.slots.filter(existing => !result.some(
        slot => slot.weekday === existing.weekday && slot.shiftTypeId === existing.shiftTypeId)).length
    : 0;

  if (usable.length === 0) {
    return (
      <Modal title="Applica schema turni" size="sm" onClose={onClose}>
        <p className="hint">
          Non ci sono schemi utilizzabili. Creane uno in Impostazioni, oppure verifica che le
          fasce orarie citate dagli schemi esistano ancora.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title={`Applica schema a ${room.name}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="spacer hint">
            {mode === 'replace'
              ? `${result.length} turni dopo la sostituzione`
              : `+${Math.max(0, added)} turni, ${room.slots.length} già presenti`}
          </span>
          <button type="button" className="btn" onClick={onClose}>Annulla</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!scheme}
            onClick={() => { onApply(result); onClose(); }}
          >
            Applica
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="field-row">
          <div className="field">
            <label htmlFor="apply-scheme">Schema</label>
            <select
              id="apply-scheme"
              className="select"
              value={schemeId}
              onChange={event => setSchemeId(event.target.value)}
            >
              {usable.map(candidate => (
                <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="apply-start">Inizia da</label>
            <select
              id="apply-start"
              className="select"
              value={startWeekday}
              onChange={event => setStartWeekday(event.target.value as Weekday)}
            >
              {WEEKDAYS.map(weekday => (
                <option key={weekday} value={weekday}>{WEEKDAY_LABELS[weekday]}</option>
              ))}
            </select>
          </div>
        </div>

        {scheme && (
          <p className="hint">{describeScheme(scheme, shiftTypes)} — ciclo di {scheme.steps.length} giorni</p>
        )}

        <div className="field">
          <span className="label">Turni già presenti nella sala</span>
          <div className="segmented">
            <button
              type="button"
              className={mode === 'merge' ? 'active' : ''}
              onClick={() => setMode('merge')}
            >
              Mantieni e aggiungi
            </button>
            <button
              type="button"
              className={mode === 'replace' ? 'active' : ''}
              onClick={() => setMode('replace')}
            >
              Sostituisci tutto
            </button>
          </div>
          {mode === 'replace' && removed > 0 && (
            <p className="hint warning-text">
              {removed} turni configurati verranno rimossi.
            </p>
          )}
        </div>

        <div className="field">
          <span className="label">Risultato</span>
          <div className="apply-preview">
            {WEEKDAYS.map(weekday => {
              const daySlots = result
                .filter(slot => slot.weekday === weekday)
                .sort((a, b) => shiftTypes.compare(a.shiftTypeId, b.shiftTypeId));
              const fromScheme = new Set(drafts
                .filter(draft => draft.weekday === weekday)
                .map(draft => draft.shiftTypeId));

              return (
                <div key={weekday} className="apply-day">
                  <span className="apply-weekday">{WEEKDAY_SHORT_LABELS[weekday]}</span>
                  {daySlots.length === 0 ? (
                    <span className="apply-empty">—</span>
                  ) : daySlots.map(slot => {
                    const shiftType = shiftTypes.get(slot.shiftTypeId);
                    return (
                      <span
                        key={slot.shiftTypeId}
                        className={`apply-slot ${fromScheme.has(slot.shiftTypeId) ? 'new' : ''}`}
                        style={{ borderLeftColor: shiftType.color }}
                        title={fromScheme.has(slot.shiftTypeId)
                          ? `${shiftType.name} — dallo schema`
                          : `${shiftType.name} — già presente`}
                      >
                        {shiftType.name}
                        {(slot.requiresNextDayRest || slot.isFullDayExclusive) && (
                          <span className="apply-flags">
                            {slot.requiresNextDayRest && 'S'}
                            {slot.requiresSecondDayRest && 'R'}
                            {slot.isFullDayExclusive && 'E'}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <p className="hint">
            I turni evidenziati arrivano dallo schema. I flag di smontante e riposo sono dedotti
            dai passi di smonto e riposo della sequenza.
          </p>
        </div>
      </div>
    </Modal>
  );
}
