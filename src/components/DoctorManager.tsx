import { useState } from 'react';
import { Doctor, OperativeRoom, Weekday, WEEKDAYS, WEEKDAY_LABELS, DOCTOR_COLORS } from '../models/types';
import { generateId } from '../utils/idGenerator';
import './DoctorManager.css';

interface DoctorManagerProps {
  doctors: Doctor[];
  rooms: OperativeRoom[];
  onDoctorsChange: (doctors: Doctor[]) => void;
}

export function DoctorManager({ doctors, rooms, onDoctorsChange }: DoctorManagerProps) {
  const [newDoctorName, setNewDoctorName] = useState('');
  const [expandedDoctor, setExpandedDoctor] = useState<string | null>(null);

  const getNextColor = (): string => {
    const usedColors = doctors.map(doctor => doctor.color);
    const availableColor = DOCTOR_COLORS.find(color => !usedColors.includes(color));
    return availableColor || DOCTOR_COLORS[doctors.length % DOCTOR_COLORS.length];
  };

  const addDoctor = () => {
    if (!newDoctorName.trim()) return;

    const newDoctor: Doctor = {
      id: generateId(),
      name: newDoctorName.trim().toUpperCase(),
      color: getNextColor(),
      excludedRooms: [],
      excludedWeekdays: [],
    };

    onDoctorsChange([...doctors, newDoctor]);
    setNewDoctorName('');
  };

  const removeDoctor = (doctorId: string) => {
    onDoctorsChange(doctors.filter(doctor => doctor.id !== doctorId));
  };

  const updateDoctorColor = (doctorId: string, color: string) => {
    onDoctorsChange(
      doctors.map(doctor => (doctor.id === doctorId ? { ...doctor, color } : doctor))
    );
  };

  const toggleRoomExclusion = (doctorId: string, roomId: string) => {
    onDoctorsChange(
      doctors.map(doctor => {
        if (doctor.id !== doctorId) return doctor;

        const excludedRooms = doctor.excludedRooms.includes(roomId)
          ? doctor.excludedRooms.filter(id => id !== roomId)
          : [...doctor.excludedRooms, roomId];

        return { ...doctor, excludedRooms };
      })
    );
  };

  const toggleWeekdayExclusion = (doctorId: string, weekday: Weekday) => {
    onDoctorsChange(
      doctors.map(doctor => {
        if (doctor.id !== doctorId) return doctor;

        const excludedWeekdays = doctor.excludedWeekdays.includes(weekday)
          ? doctor.excludedWeekdays.filter(day => day !== weekday)
          : [...doctor.excludedWeekdays, weekday];

        return { ...doctor, excludedWeekdays };
      })
    );
  };

  return (
    <div className="doctor-manager">
      <div className="add-doctor-form">
        <input
          type="text"
          value={newDoctorName}
          onChange={event => setNewDoctorName(event.target.value)}
          placeholder="Nome dottore (es. Rossi)"
          onKeyDown={event => event.key === 'Enter' && addDoctor()}
        />
        <button onClick={addDoctor} className="btn-add">
          + Aggiungi Dottore
        </button>
      </div>

      <div className="doctors-grid">
        {doctors.map(doctor => (
          <div key={doctor.id} className="doctor-card" style={{ borderTopColor: doctor.color }}>
            <div className="doctor-header">
              <input
                type="color"
                className="doctor-color-picker"
                value={doctor.color}
                onChange={event => updateDoctorColor(doctor.id, event.target.value)}
                title="Cambia colore"
              />
              <div className="doctor-avatar" style={{ background: doctor.color }}>
                {doctor.name.charAt(0)}
              </div>
              <h3>{doctor.name}</h3>
              <div className="doctor-actions">
                <button
                  className="btn-expand"
                  onClick={() => setExpandedDoctor(expandedDoctor === doctor.id ? null : doctor.id)}
                >
                  {expandedDoctor === doctor.id ? '▼' : '▶'}
                </button>
                <button className="btn-remove" onClick={() => removeDoctor(doctor.id)}>
                  ✕
                </button>
              </div>
            </div>

            {expandedDoctor === doctor.id && (
              <div className="doctor-preferences">
                <div className="preference-section">
                  <h4>Esclusioni Sale Operative</h4>
                  <div className="preference-grid">
                    {rooms.map(room => (
                      <label
                        key={room.id}
                        className={`preference-item ${doctor.excludedRooms.includes(room.id) ? 'excluded' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={doctor.excludedRooms.includes(room.id)}
                          onChange={() => toggleRoomExclusion(doctor.id, room.id)}
                        />
                        <span>{room.name}</span>
                      </label>
                    ))}
                    {rooms.length === 0 && (
                      <p className="no-data">Nessuna sala configurata</p>
                    )}
                  </div>
                </div>

                <div className="preference-section">
                  <h4>Esclusioni Giorni della Settimana</h4>
                  <div className="preference-grid weekdays">
                    {WEEKDAYS.map(weekday => (
                      <label
                        key={weekday}
                        className={`preference-item ${doctor.excludedWeekdays.includes(weekday) ? 'excluded' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={doctor.excludedWeekdays.includes(weekday)}
                          onChange={() => toggleWeekdayExclusion(doctor.id, weekday)}
                        />
                        <span>{WEEKDAY_LABELS[weekday]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {expandedDoctor !== doctor.id && (
              <div className="doctor-summary">
                {doctor.excludedRooms.length > 0 && (
                  <span className="exclusion-badge rooms">
                    {doctor.excludedRooms.length} sale escluse
                  </span>
                )}
                {doctor.excludedWeekdays.length > 0 && (
                  <span className="exclusion-badge days">
                    {doctor.excludedWeekdays.length} giorni esclusi
                  </span>
                )}
                {doctor.excludedRooms.length === 0 && doctor.excludedWeekdays.length === 0 && (
                  <span className="no-exclusions">Nessuna esclusione</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {doctors.length === 0 && (
        <div className="empty-state">
          <p>Nessun dottore configurato. Aggiungi i dottori per iniziare.</p>
        </div>
      )}
    </div>
  );
}
