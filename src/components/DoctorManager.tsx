import { useState } from 'react';
import { Doctor, DOCTOR_COLORS, Weekday, WEEKDAYS, WEEKDAY_LABELS } from '../models/types';
import { useConfig } from '../state/configContext';
import { generateId } from '../utils/id';
import './DoctorManager.css';

export function DoctorManager() {
  const { doctors, setDoctors, rooms, rotationRule, setRotationRule } = useConfig();

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
      excludedWeekdays: [],
    }]);
    setNewDoctorName('');
  };

  const updateDoctor = (doctorId: string, changes: Partial<Doctor>) => {
    setDoctors(doctors.map(doctor => (doctor.id === doctorId ? { ...doctor, ...changes } : doctor)));
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

  const toggleRoom = (doctor: Doctor, roomId: string) => {
    updateDoctor(doctor.id, {
      excludedRooms: doctor.excludedRooms.includes(roomId)
        ? doctor.excludedRooms.filter(id => id !== roomId)
        : [...doctor.excludedRooms, roomId],
    });
  };

  const toggleWeekday = (doctor: Doctor, weekday: Weekday) => {
    updateDoctor(doctor.id, {
      excludedWeekdays: doctor.excludedWeekdays.includes(weekday)
        ? doctor.excludedWeekdays.filter(day => day !== weekday)
        : [...doctor.excludedWeekdays, weekday],
    });
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
            Aggiungi le persone da inserire nei turni. Per ciascuna potrai indicare le sale e i
            giorni della settimana in cui non lavora mai.
          </p>
        </div>
      ) : (
        <div className="doctor-grid">
          {doctors.map(doctor => {
            const expanded = expandedId === doctor.id;
            const exclusions = doctor.excludedRooms.length + doctor.excludedWeekdays.length;

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
                        if (name) updateDoctor(doctor.id, { name });
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
                    onChange={event => updateDoctor(doctor.id, { color: event.target.value })}
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
                  {exclusions === 0
                    ? 'Nessuna esclusione'
                    : `${exclusions} esclusion${exclusions === 1 ? 'e' : 'i'}`}
                  <span className="doctor-toggle-icon">{expanded ? '▴' : '▾'}</span>
                </button>

                {expanded && (
                  <div className="doctor-body">
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
                              onClick={() => toggleRoom(doctor, room.id)}
                            >
                              <span className="dot" style={{ background: room.color }} />
                              {room.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="field">
                      <span className="label">Giorni in cui non lavora</span>
                      <div className="row-wrap">
                        {WEEKDAYS.map(weekday => (
                          <button
                            key={weekday}
                            type="button"
                            className={`exclusion-pill ${doctor.excludedWeekdays.includes(weekday) ? 'on' : ''}`}
                            onClick={() => toggleWeekday(doctor, weekday)}
                          >
                            {WEEKDAY_LABELS[weekday]}
                          </button>
                        ))}
                      </div>
                    </div>

                    <p className="hint">
                      Queste esclusioni valgono sempre. Ferie e disponibilità di un singolo mese
                      si impostano nella sezione Genera.
                    </p>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
