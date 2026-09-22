import { useState } from 'react';
import { Doctor, DOCTOR_COLORS } from '../models/types';
import { useConfig } from '../state/configContext';
import { DoctorPreferences } from './DoctorPreferences';
import { generateId } from '../utils/id';
import './DoctorManager.css';

export function DoctorManager() {
  const { doctors, setDoctors, rotationRule, setRotationRule } = useConfig();

  const [newDoctorName, setNewDoctorName] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const nextColor = () => {
    const used = new Set(doctors.map(doctor => doctor.color));
    return DOCTOR_COLORS.find(color => !used.has(color))
      ?? DOCTOR_COLORS[doctors.length % DOCTOR_COLORS.length];
  };

  const addDoctor = () => {
    const name = newDoctorName.trim();
    if (!name) return;

    if (doctors.some(doctor => doctor.name.toLowerCase() === name.toLowerCase())) {
      window.alert(`Esiste già un dottore chiamato "${name}".`);
      return;
    }

    setDoctors([...doctors, {
      id: generateId(),
      name,
      color: nextColor(),
      excludedRooms: [],
      weekdayRules: [],
      shiftLengthPreference: 'none',
    }]);
    setNewDoctorName('');
  };

  const replaceDoctor = (next: Doctor) => {
    setDoctors(doctors.map(other => (other.id === next.id ? next : other)));
  };

  const removeDoctor = (doctor: Doctor) => {
    const inRotation = rotationRule.doctorIds.includes(doctor.id);
    const message = inRotation
      ? `Eliminare "${doctor.name}"?\n\nVerrà rimosso anche dalla rotazione del servizio.`
      : `Eliminare "${doctor.name}"?`;
    if (!window.confirm(message)) return;

    setDoctors(doctors.filter(other => other.id !== doctor.id));

    // Un dottore eliminato non può restare nell'elenco della rotazione:
    // lascerebbe una posizione vuota nel giro.
    if (inRotation) {
      setRotationRule({
        ...rotationRule,
        doctorIds: rotationRule.doctorIds.filter(id => id !== doctor.id),
      });
    }

    if (expandedId === doctor.id) setExpandedId(null);
  };

  return (
    <div className="doctor-manager stack">
      <form className="add-row" onSubmit={event => { event.preventDefault(); addDoctor(); }}>
        <input
          className="input"
          value={newDoctorName}
          placeholder="Nome del dottore (es. Rossi)"
          onChange={event => setNewDoctorName(event.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={!newDoctorName.trim()}>
          Aggiungi dottore
        </button>
      </form>

      {doctors.length === 0 ? (
        <div className="empty-state">
          <h2>Nessun dottore configurato</h2>
          <p>
            Aggiungi le persone da inserire nei turni. Per ciascuna potrai indicare i giorni in
            cui non lavora, quelli che preferisce evitare e la durata di turno che preferisce.
          </p>
        </div>
      ) : (
        <div className="doctor-grid">
          {doctors.map(doctor => {
            const expanded = expandedId === doctor.id;

            return (
              <article
                key={doctor.id}
                className={`doctor-card ${expanded ? 'expanded' : ''}`}
                style={{ borderTopColor: doctor.color }}
              >
                <header className="doctor-header">
                  <span className="doctor-avatar" style={{ background: doctor.color }}>
                    {doctor.name.charAt(0).toUpperCase()}
                  </span>

                  {renamingId === doctor.id ? (
                    <input
                      className="input"
                      defaultValue={doctor.name}
                      autoFocus
                      onBlur={event => {
                        const name = event.target.value.trim();
                        if (name) replaceDoctor({ ...doctor, name });
                        setRenamingId(null);
                      }}
                      onKeyDown={event => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') setRenamingId(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="doctor-name"
                      onClick={() => setRenamingId(doctor.id)}
                      title="Clicca per rinominare"
                    >
                      {doctor.name}
                    </button>
                  )}

                  <input
                    className="color-input"
                    type="color"
                    value={doctor.color}
                    onChange={event => replaceDoctor({ ...doctor, color: event.target.value })}
                    title="Colore del dottore"
                    aria-label={`Colore di ${doctor.name}`}
                  />
                  <button
                    type="button"
                    className="btn-icon danger"
                    onClick={() => removeDoctor(doctor)}
                    aria-label={`Elimina ${doctor.name}`}
                  >✕</button>
                </header>

                <button
                  type="button"
                  className="doctor-toggle"
                  onClick={() => setExpandedId(expanded ? null : doctor.id)}
                  aria-expanded={expanded}
                >
                  {describeDoctor(doctor)}
                  <span className="doctor-toggle-icon">{expanded ? '▴' : '▾'}</span>
                </button>

                {expanded && (
                  <DoctorPreferences doctor={doctor} onChange={replaceDoctor} />
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Riepilogo compatto di vincoli e preferenze, mostrato a scheda chiusa. */
function describeDoctor(doctor: Doctor): string {
  const parts: string[] = [];

  if (doctor.excludedRooms.length > 0) {
    const count = doctor.excludedRooms.length;
    parts.push(count === 1 ? '1 sala esclusa' : `${count} sale escluse`);
  }

  const never = doctor.weekdayRules.filter(rule => rule.level === 'never').length;
  const avoid = doctor.weekdayRules.filter(rule => rule.level === 'avoid').length;
  if (never > 0) parts.push(`${never} divieto${never === 1 ? '' : 'i'}`);
  if (avoid > 0) parts.push(`${avoid} preferenz${avoid === 1 ? 'a' : 'e'}`);

  if (doctor.shiftLengthPreference === 'long') parts.push('turni lunghi');
  if (doctor.shiftLengthPreference === 'short') parts.push('turni brevi');
  if (doctor.hoursOverride) {
    parts.push(`${doctor.hoursOverride.min}–${doctor.hoursOverride.max}h`);
  }

  return parts.length === 0 ? 'Nessun vincolo' : parts.join(' · ');
}
