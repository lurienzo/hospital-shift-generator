import { useMemo, useState } from 'react';
import {
  DEFAULT_BLOCK_LENGTH_DAYS,
  DEFAULT_BLOCK_START_WEEKDAY,
  SHIFT_TYPE_COLORS,
  ShiftScheme,
  ShiftType,
  WEEKDAYS,
  WEEKDAY_LABELS,
} from '../models/types';
import {
  blockLabel,
  blockLengthOf,
  blockStartOf,
  isRotational,
  shiftDurationHours,
  shiftsOverlap,
  validateShiftType,
} from '../domain/shiftTypes';
import { useConfig } from '../state/configContext';
import { SchemeEditor } from './SchemeEditor';
import { ServiceManager } from './ServiceManager';
import { RotationRuleEditor } from './RotationRuleEditor';
import { generateId } from '../utils/id';
import './Settings.css';

type Draft = Omit<ShiftType, 'order'>;

function emptyDraft(existingCount: number): Draft {
  return {
    id: '',
    name: '',
    code: '',
    start: '08:00',
    end: '14:00',
    color: SHIFT_TYPE_COLORS[existingCount % SHIFT_TYPE_COLORS.length],
    rotational: false,
    blockLengthDays: DEFAULT_BLOCK_LENGTH_DAYS,
    blockStartWeekday: DEFAULT_BLOCK_START_WEEKDAY,
  };
}

interface SettingsProps {
  hasUnsavedChanges: boolean;
}

export function Settings({ hasUnsavedChanges }: SettingsProps) {
  const {
    shiftTypes, setShiftTypes, rooms, schemes, customSchemes, setCustomSchemes,
    shiftTypeIndex, rotationRule, setRotationRule,
  } = useConfig();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingScheme, setEditingScheme] = useState<ShiftScheme | null>(null);

  /** Quante volte una fascia è usata nella griglia settimanale delle sale. */
  const usageByShiftType = useMemo(() => {
    const usage = new Map<string, number>();
    for (const room of rooms) {
      for (const slot of room.slots) {
        usage.set(slot.shiftTypeId, (usage.get(slot.shiftTypeId) ?? 0) + 1);
      }
    }
    return usage;
  }, [rooms]);

  const schemesByShiftType = useMemo(() => {
    const usage = new Map<string, string[]>();
    for (const scheme of schemes) {
      for (const step of scheme.steps) {
        if (step.kind !== 'shift') continue;
        const names = usage.get(step.shiftTypeId) ?? [];
        if (!names.includes(scheme.name)) usage.set(step.shiftTypeId, [...names, scheme.name]);
      }
    }
    return usage;
  }, [schemes]);

  const startEdit = (shiftType: ShiftType) => {
    setError(null);
    setDraft({ ...shiftType });
  };

  const startCreate = () => {
    setError(null);
    setDraft(emptyDraft(shiftTypes.length));
  };

  const saveDraft = () => {
    if (!draft) return;

    const normalized: Draft = {
      ...draft,
      name: draft.name.trim(),
      code: draft.code.trim().toUpperCase(),
    };

    const validationError = validateShiftType(
      { ...normalized, id: normalized.id || '__new__' },
      shiftTypes,
    );
    if (validationError) {
      setError(validationError);
      return;
    }

    if (normalized.id) {
      setShiftTypes(shiftTypes.map(shiftType =>
        shiftType.id === normalized.id ? { ...shiftType, ...normalized } : shiftType));
    } else {
      setShiftTypes([
        ...shiftTypes,
        {
          ...normalized,
          id: generateId(),
          order: shiftTypes.length > 0 ? Math.max(...shiftTypes.map(s => s.order)) + 1 : 0,
        },
      ]);
    }

    setDraft(null);
    setError(null);
  };

  const removeShiftType = (shiftType: ShiftType) => {
    const slotUsage = usageByShiftType.get(shiftType.id) ?? 0;
    const schemeUsage = schemesByShiftType.get(shiftType.id) ?? [];

    const warnings = [
      slotUsage > 0 && `è usata in ${slotUsage} turn${slotUsage === 1 ? 'o' : 'i'} delle sale`,
      schemeUsage.length > 0 && `compare negli schemi: ${schemeUsage.join(', ')}`,
    ].filter(Boolean);

    const message = warnings.length > 0
      ? `Eliminare la fascia "${shiftType.name}"?\n\nAttenzione: ${warnings.join(' e ')}.\n`
        + 'I turni già salvati nei calendari resteranno visibili ma senza orario.'
      : `Eliminare la fascia "${shiftType.name}"?`;

    if (!window.confirm(message)) return;

    setShiftTypes(shiftTypes.filter(other => other.id !== shiftType.id));
    if (draft?.id === shiftType.id) setDraft(null);
  };

  const move = (shiftType: ShiftType, direction: -1 | 1) => {
    const ordered = [...shiftTypes];
    const index = ordered.findIndex(other => other.id === shiftType.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;

    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    setShiftTypes(ordered.map((other, position) => ({ ...other, order: position })));
  };

  const saveScheme = (scheme: ShiftScheme) => {
    const exists = customSchemes.some(other => other.id === scheme.id);
    setCustomSchemes(exists
      ? customSchemes.map(other => (other.id === scheme.id ? scheme : other))
      : [...customSchemes, scheme]);
    setEditingScheme(null);
  };

  const removeScheme = (scheme: ShiftScheme) => {
    const isActiveRotation = rotationRule.schemeId === scheme.id;
    const message = isActiveRotation
      ? `Eliminare lo schema "${scheme.name}"?\n\nÈ la rotazione attiva del servizio, che resterà senza schema.`
      : `Eliminare lo schema "${scheme.name}"?`;

    if (!window.confirm(message)) return;

    setCustomSchemes(customSchemes.filter(other => other.id !== scheme.id));
    if (isActiveRotation) setRotationRule({ ...rotationRule, schemeId: '' });
  };

  return (
    <div className="settings stack">
      <ServiceManager hasUnsavedChanges={hasUnsavedChanges} />

      {/* ---------------- Fasce orarie ---------------- */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Fasce orarie</h3>
            <p className="hint">
              Le fasce disponibili quando configuri i turni di una sala. Puoi modificare gli
              orari, aggiungerne di nuove e marcare quelle a rotazione.
            </p>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={startCreate}>
            Aggiungi fascia
          </button>
        </div>

        <ul className="shift-type-list">
          {shiftTypes.map((shiftType, index) => {
            const overlaps = shiftTypes.filter(other =>
              other.id !== shiftType.id && shiftsOverlap(shiftType, other));

            return (
              <li key={shiftType.id} className="shift-type-row">
                <span className="shift-swatch" style={{ background: shiftType.color }} />

                <div className="shift-identity">
                  <span className="shift-name">
                    {shiftType.name}
                    <span className="shift-code">{shiftType.code}</span>
                    {isRotational(shiftType) && (
                      <span className="badge badge-accent" title={`Blocchi di 1 ${blockLabel(shiftType)}`}>
                        rotazione
                      </span>
                    )}
                  </span>
                  <span className="shift-meta">
                    {shiftType.start}–{shiftType.end} · {formatHours(shiftDurationHours(shiftType))}
                    {isRotational(shiftType) && (
                      <> · blocco di 1 {blockLabel(shiftType)} da {WEEKDAY_LABELS[blockStartOf(shiftType)].toLowerCase()}</>
                    )}
                  </span>
                  {overlaps.length > 0 && (
                    <span className="shift-overlap">
                      Si sovrappone a {overlaps.map(other => other.name).join(', ')}: un dottore
                      non può coprirle nella stessa giornata.
                    </span>
                  )}
                </div>

                <span className="shift-usage hint">
                  {usageByShiftType.get(shiftType.id)
                    ? `${usageByShiftType.get(shiftType.id)} turni`
                    : 'non usata'}
                </span>

                <div className="row">
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => move(shiftType, -1)}
                    disabled={index === 0}
                    aria-label="Sposta su"
                  >↑</button>
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => move(shiftType, 1)}
                    disabled={index === shiftTypes.length - 1}
                    aria-label="Sposta giù"
                  >↓</button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => startEdit(shiftType)}
                  >Modifica</button>
                  <button
                    type="button"
                    className="btn-icon danger"
                    onClick={() => removeShiftType(shiftType)}
                    disabled={shiftTypes.length === 1}
                    title={shiftTypes.length === 1 ? 'Serve almeno una fascia' : 'Elimina'}
                    aria-label="Elimina"
                  >✕</button>
                </div>
              </li>
            );
          })}
        </ul>

        {draft && (
          <ShiftTypeForm
            draft={draft}
            error={error}
            onChange={setDraft}
            onSave={saveDraft}
            onCancel={() => { setDraft(null); setError(null); }}
          />
        )}
      </section>

      {/* ---------------- Schemi turni ---------------- */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Schemi turni</h3>
            <p className="hint">
              Sequenze standard di turni e riposi, es. pomeriggio → lunga → notte → smonto →
              riposo. Si applicano a una sala per riempire la settimana, oppure come ciclo di
              rotazione dei dottori.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setEditingScheme({ id: generateId(), name: '', steps: [] })}
          >
            Nuovo schema
          </button>
        </div>

        <ul className="scheme-list">
          {schemes.map(scheme => (
            <li key={scheme.id} className="scheme-row">
              <div className="scheme-info">
                <span className="scheme-name">
                  {scheme.name}
                  {scheme.builtIn && <span className="badge">predefinito</span>}
                </span>
                <span className="scheme-steps">
                  {scheme.steps.length === 0 ? (
                    <em className="hint">Nessun passo</em>
                  ) : scheme.steps.map((step, index) => (
                    <span key={index} className={`step-chip ${step.kind !== 'shift' ? 'off' : ''}`}
                      style={step.kind === 'shift'
                        ? { borderColor: shiftTypeIndex.get(step.shiftTypeId).color }
                        : undefined}
                    >
                      {step.kind === 'shift'
                        ? shiftTypeIndex.get(step.shiftTypeId).name
                        : step.kind === 'smonto' ? 'Smonto' : 'Riposo'}
                    </span>
                  ))}
                </span>
              </div>

              <div className="row">
                <span className="hint">{scheme.steps.length} giorni</span>
                {scheme.builtIn ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setEditingScheme({
                      ...scheme,
                      id: generateId(),
                      name: `${scheme.name} (copia)`,
                      builtIn: undefined,
                    })}
                  >Duplica</button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setEditingScheme(scheme)}
                    >Modifica</button>
                    <button
                      type="button"
                      className="btn-icon danger"
                      onClick={() => removeScheme(scheme)}
                      aria-label="Elimina"
                    >✕</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <RotationRuleEditor />

      {editingScheme && (
        <SchemeEditor
          scheme={editingScheme}
          shiftTypes={shiftTypes}
          onSave={saveScheme}
          onClose={() => setEditingScheme(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface ShiftTypeFormProps {
  draft: Draft;
  error: string | null;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}

function ShiftTypeForm({ draft, error, onChange, onSave, onCancel }: ShiftTypeFormProps) {
  const update = (changes: Partial<Draft>) => onChange({ ...draft, ...changes });
  const hours = /^\d{2}:\d{2}$/.test(draft.start) && /^\d{2}:\d{2}$/.test(draft.end)
    ? shiftDurationHours({ ...draft, order: 0 })
    : null;

  return (
    <form
      className="shift-type-form"
      onSubmit={event => { event.preventDefault(); onSave(); }}
    >
      <h4>{draft.id ? 'Modifica fascia' : 'Nuova fascia'}</h4>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="st-name">Nome</label>
          <input
            id="st-name"
            className="input"
            value={draft.name}
            placeholder="es. Diurnismo"
            onChange={event => update({ name: event.target.value })}
            autoFocus
          />
        </div>

        <div className="field field-narrow">
          <label htmlFor="st-code">Sigla</label>
          <input
            id="st-code"
            className="input"
            value={draft.code}
            maxLength={2}
            placeholder="D"
            onChange={event => update({ code: event.target.value.toUpperCase() })}
          />
        </div>

        <div className="field field-narrow">
          <label htmlFor="st-start">Inizio</label>
          <input
            id="st-start"
            className="input"
            type="time"
            value={draft.start}
            onChange={event => update({ start: event.target.value })}
          />
        </div>

        <div className="field field-narrow">
          <label htmlFor="st-end">Fine</label>
          <input
            id="st-end"
            className="input"
            type="time"
            value={draft.end}
            onChange={event => update({ end: event.target.value })}
          />
        </div>

        <div className="field field-narrow">
          <label htmlFor="st-color">Colore</label>
          <input
            id="st-color"
            className="color-input"
            type="color"
            value={draft.color}
            onChange={event => update({ color: event.target.value })}
          />
        </div>

        {hours !== null && (
          <p className="form-note">
            Durata: {formatHours(hours)}
            {hours > 12 && ' — controlla gli orari, sembra molto lunga'}
          </p>
        )}
      </div>

      <div className="rotational-block">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.rotational ?? false}
            onChange={event => update({ rotational: event.target.checked })}
          />
          <span>Fascia a rotazione</span>
        </label>
        <p className="hint">
          Il turno non si assegna giorno per giorno: lo stesso dottore copre tutto il blocco
          (es. una settimana di diurnismo), e il blocco vale una unità sola nel conteggio
          dell&apos;equità. La rotazione resta bilanciata anche fra mesi diversi.
        </p>

        {draft.rotational && (
          <div className="field-row">
            <div className="field field-narrow">
              <label htmlFor="st-block-length">Durata blocco</label>
              <select
                id="st-block-length"
                className="select"
                value={blockLengthOf({ ...draft, order: 0 })}
                onChange={event => update({ blockLengthDays: Number(event.target.value) })}
              >
                <option value={7}>1 settimana</option>
                <option value={14}>2 settimane</option>
                <option value={3}>3 giorni</option>
                <option value={4}>4 giorni</option>
                <option value={5}>5 giorni</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="st-block-start">Il blocco inizia il</label>
              <select
                id="st-block-start"
                className="select"
                value={blockStartOf({ ...draft, order: 0 })}
                onChange={event => update({ blockStartWeekday: event.target.value as ShiftType['blockStartWeekday'] })}
              >
                {WEEKDAYS.map(weekday => (
                  <option key={weekday} value={weekday}>{WEEKDAY_LABELS[weekday]}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>Annulla</button>
        <button type="submit" className="btn btn-primary">Salva</button>
      </div>
    </form>
  );
}

function formatHours(hours: number): string {
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}
