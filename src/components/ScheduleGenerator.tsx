import { useState, useMemo } from 'react';
import { Doctor, OperativeRoom, MonthlySchedule, GenerationConfig, HolidayConfig, TimeSlot, TIME_SLOTS, TIME_SLOT_SHORT_LABELS } from '../models/types';
import { ScheduleGeneratorService } from '../services/ScheduleGeneratorService';
import './ScheduleGenerator.css';

interface ScheduleGeneratorProps {
  rooms: OperativeRoom[];
  doctors: Doctor[];
  onScheduleGenerated: (schedule: MonthlySchedule) => void;
}

export function ScheduleGenerator({ rooms, doctors, onScheduleGenerated }: ScheduleGeneratorProps) {
  const currentDate = new Date();
  const [year, setYear] = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [holidays, setHolidays] = useState<HolidayConfig[]>([]);
  const [doctorDateExclusions, setDoctorDateExclusions] = useState<Record<string, string[]>>({});
  const [selectedDoctor, setSelectedDoctor] = useState<string | null>(null);
  const [editingHoliday, setEditingHoliday] = useState<string | null>(null);

  const monthNames = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
  ];

  const weekdayNames = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

  const daysInMonth = useMemo(() => new Date(year, month, 0).getDate(), [year, month]);

  const calendarDays = useMemo(() => {
    const days: { day: number; dateStr: string; isWeekend: boolean; weekday: number }[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      const weekday = date.getDay();
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      days.push({ day, dateStr, isWeekend: weekday === 0 || weekday === 6, weekday });
    }
    return days;
  }, [year, month, daysInMonth]);

  const canGenerate = rooms.length > 0 && doctors.length > 0 && rooms.some(room => room.slots.length > 0);

  const getHolidayConfig = (dateStr: string): HolidayConfig | undefined => {
    return holidays.find(h => h.date === dateStr);
  };

  const toggleHoliday = (dateStr: string) => {
    const existing = getHolidayConfig(dateStr);
    if (existing) {
      setHolidays(prev => prev.filter(h => h.date !== dateStr));
      if (editingHoliday === dateStr) {
        setEditingHoliday(null);
      }
    } else {
      setHolidays(prev => [...prev, { date: dateStr, disabledSlots: [] }]);
    }
  };

  const toggleHolidaySlot = (dateStr: string, slot: TimeSlot) => {
    setHolidays(prev => prev.map(h => {
      if (h.date !== dateStr) return h;
      const disabledSlots = h.disabledSlots.includes(slot)
        ? h.disabledSlots.filter(s => s !== slot)
        : [...h.disabledSlots, slot];
      return { ...h, disabledSlots };
    }));
  };

  const toggleDoctorDateExclusion = (doctorId: string, dateStr: string) => {
    setDoctorDateExclusions(prev => {
      const currentExclusions = prev[doctorId] || [];
      const newExclusions = currentExclusions.includes(dateStr)
        ? currentExclusions.filter(d => d !== dateStr)
        : [...currentExclusions, dateStr];
      return { ...prev, [doctorId]: newExclusions };
    });
  };

  const handleGenerate = () => {
    if (!canGenerate) return;

    setIsGenerating(true);

    setTimeout(() => {
      const config: GenerationConfig = {
        year,
        month,
        holidays,
        doctorDateExclusions,
      };
      const generator = new ScheduleGeneratorService(rooms, doctors, config);
      const schedule = generator.generate();
      onScheduleGenerated(schedule);
      setIsGenerating(false);
    }, 300);
  };

  const resetMonthConfig = () => {
    setHolidays([]);
    setDoctorDateExclusions({});
    setSelectedDoctor(null);
    setEditingHoliday(null);
  };

  return (
    <div className="schedule-generator">
      <div className="generator-header">
        <h2>Genera Calendario Turni</h2>
        <p>Seleziona mese e anno, configura festivi e esclusioni, poi genera il calendario.</p>
      </div>

      <div className="generator-controls">
        <div className="date-selector">
          <div className="select-group">
            <label>Mese</label>
            <select value={month} onChange={event => { setMonth(Number(event.target.value)); resetMonthConfig(); }}>
              {monthNames.map((name, index) => (
                <option key={index} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="select-group">
            <label>Anno</label>
            <select value={year} onChange={event => { setYear(Number(event.target.value)); resetMonthConfig(); }}>
              {[2024, 2025, 2026, 2027].map(yearOption => (
                <option key={yearOption} value={yearOption}>
                  {yearOption}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          className={`btn-generate ${isGenerating ? 'generating' : ''}`}
          onClick={handleGenerate}
          disabled={!canGenerate || isGenerating}
        >
          {isGenerating ? (
            <>
              <span className="spinner"></span>
              Generazione...
            </>
          ) : (
            '⚡ Genera Calendario'
          )}
        </button>
      </div>

      {!canGenerate && (
        <div className="generator-warnings">
          {rooms.length === 0 && (
            <p className="warning">⚠️ Aggiungi almeno una sala operativa</p>
          )}
          {rooms.length > 0 && !rooms.some(room => room.slots.length > 0) && (
            <p className="warning">⚠️ Configura almeno un turno per una sala</p>
          )}
          {doctors.length === 0 && (
            <p className="warning">⚠️ Aggiungi almeno un dottore</p>
          )}
        </div>
      )}

      <div className="generator-summary">
        <div className="summary-item">
          <span className="summary-value">{rooms.length}</span>
          <span className="summary-label">Sale Operative</span>
        </div>
        <div className="summary-item">
          <span className="summary-value">{doctors.length}</span>
          <span className="summary-label">Dottori</span>
        </div>
        <div className="summary-item">
          <span className="summary-value">
            {rooms.reduce((total, room) => total + room.slots.reduce((slotTotal, slot) => slotTotal + slot.requiredDoctors, 0), 0)}
          </span>
          <span className="summary-label">Turni/Settimana</span>
        </div>
      </div>

      <div className="month-config-section">
        <div className="config-block holidays-config">
          <h3>🎄 Festivi del Mese</h3>
          <p className="config-description">
            Clicca sui giorni per marcarli come festivi (contano come weekend).
            Clicca di nuovo su un festivo per configurare i turni disabilitati.
          </p>
          <div className="mini-calendar">
            <div className="mini-calendar-header">
              {weekdayNames.map(name => (
                <span key={name} className="mini-day-header">{name}</span>
              ))}
            </div>
            <div className="mini-calendar-grid">
              {Array.from({ length: new Date(year, month - 1, 1).getDay() }).map((_, index) => (
                <span key={`empty-${index}`} className="mini-day empty"></span>
              ))}
              {calendarDays.map(({ day, dateStr, isWeekend }) => {
                const holidayConfig = getHolidayConfig(dateStr);
                const isHoliday = !!holidayConfig;
                const isBeingEdited = editingHoliday === dateStr;
                return (
                  <button
                    key={day}
                    className={`mini-day ${isWeekend || isHoliday ? 'weekend-or-holiday' : ''} ${isBeingEdited ? 'editing' : ''}`}
                    onClick={() => {
                      if (isHoliday && !isWeekend) {
                        setEditingHoliday(editingHoliday === dateStr ? null : dateStr);
                      } else if (!isWeekend) {
                        toggleHoliday(dateStr);
                      }
                    }}
                    title={isWeekend ? 'Weekend' : isHoliday ? 'Festivo - clicca per configurare turni' : 'Clicca per segnare come festivo'}
                  >
                    {day}
                    {isHoliday && holidayConfig!.disabledSlots.length > 0 && (
                      <span className="disabled-indicator">{holidayConfig!.disabledSlots.length}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {editingHoliday && (
            <div className="holiday-config-panel">
              <div className="holiday-config-header">
                <span>
                  Configura festivo: <strong>{parseInt(editingHoliday.split('-')[2])} {monthNames[month - 1]}</strong>
                </span>
                <button className="btn-remove-holiday" onClick={() => { toggleHoliday(editingHoliday); }}>
                  🗑️ Rimuovi festivo
                </button>
              </div>
              <p className="config-hint">Seleziona i turni da disabilitare per questo giorno:</p>
              <div className="slot-toggles">
                {TIME_SLOTS.map(slot => {
                  const holidayConfig = getHolidayConfig(editingHoliday);
                  const isDisabled = holidayConfig?.disabledSlots.includes(slot);
                  return (
                    <button
                      key={slot}
                      className={`slot-toggle ${isDisabled ? 'disabled-slot' : 'enabled-slot'}`}
                      onClick={() => toggleHolidaySlot(editingHoliday, slot)}
                    >
                      {TIME_SLOT_SHORT_LABELS[slot]}
                      <span className="slot-status">{isDisabled ? '❌' : '✅'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {holidays.length > 0 && !editingHoliday && (
            <div className="selected-holidays">
              <strong>Festivi:</strong>
              {holidays.sort((a, b) => a.date.localeCompare(b.date)).map(holiday => {
                const day = parseInt(holiday.date.split('-')[2]);
                return (
                  <span
                    key={holiday.date}
                    className="holiday-badge"
                    onClick={() => setEditingHoliday(holiday.date)}
                  >
                    {day} {monthNames[month - 1]}
                    {holiday.disabledSlots.length > 0 && (
                      <span className="disabled-count">-{holiday.disabledSlots.length}</span>
                    )}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div className="config-block doctor-exclusions-config">
          <h3>🚫 Esclusioni Date per Dottore</h3>
          <p className="config-description">Seleziona un dottore e clicca sui giorni da escludere per questo mese</p>
          
          <div className="doctor-selector">
            {doctors.map(doctor => (
              <button
                key={doctor.id}
                className={`doctor-btn ${selectedDoctor === doctor.id ? 'active' : ''}`}
                style={{ 
                  backgroundColor: selectedDoctor === doctor.id ? doctor.color : 'transparent',
                  borderColor: doctor.color,
                  color: selectedDoctor === doctor.id ? 'white' : doctor.color
                }}
                onClick={() => setSelectedDoctor(selectedDoctor === doctor.id ? null : doctor.id)}
              >
                {doctor.name}
                {(doctorDateExclusions[doctor.id]?.length || 0) > 0 && (
                  <span className="exclusion-count">{doctorDateExclusions[doctor.id].length}</span>
                )}
              </button>
            ))}
          </div>

          {selectedDoctor && (
            <div className="doctor-date-exclusions">
              <div className="mini-calendar">
                <div className="mini-calendar-header">
                  {weekdayNames.map(name => (
                    <span key={name} className="mini-day-header">{name}</span>
                  ))}
                </div>
                <div className="mini-calendar-grid">
                  {Array.from({ length: new Date(year, month - 1, 1).getDay() }).map((_, index) => (
                    <span key={`empty-${index}`} className="mini-day empty"></span>
                  ))}
                  {calendarDays.map(({ day, dateStr, isWeekend }) => {
                    const isExcluded = doctorDateExclusions[selectedDoctor]?.includes(dateStr);
                    const doctor = doctors.find(d => d.id === selectedDoctor);
                    const holidayConfig = getHolidayConfig(dateStr);
                    const isHoliday = !!holidayConfig;
                    const isWeekendOrHoliday = isWeekend || isHoliday;
                    return (
                      <button
                        key={day}
                        className={`mini-day ${isWeekendOrHoliday ? 'weekend-or-holiday' : ''} ${isExcluded ? 'excluded' : ''}`}
                        style={isExcluded ? { backgroundColor: doctor?.color } : {}}
                        onClick={() => toggleDoctorDateExclusion(selectedDoctor, dateStr)}
                        title={isExcluded ? 'Escluso - clicca per rimuovere' : 'Clicca per escludere'}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
