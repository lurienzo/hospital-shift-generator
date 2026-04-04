import { useState, useMemo, useEffect, useCallback } from 'react';
import { Doctor, OperativeRoom, MonthlySchedule, GenerationConfig, HolidayConfig, DoctorDateMode, Assignment, TimeSlot, WEEKDAYS, TIME_SLOT_TIME_LABELS } from '../models/types';
import { ScheduleGeneratorService, GenerationProgress } from '../services/ScheduleGeneratorService';
import { StorageService } from '../services/StorageService';
import { MONTH_NAMES_FULL, getYearRange } from '../utils/constants';
import { generateId } from '../utils/idGenerator';
import './ScheduleGenerator.css';

interface ScheduleGeneratorProps {
  rooms: OperativeRoom[];
  doctors: Doctor[];
  onScheduleGenerated: (schedule: MonthlySchedule) => void;
  preselectedYear?: number | null;
  preselectedMonth?: number | null;
}

export function ScheduleGenerator({ rooms, doctors, onScheduleGenerated, preselectedYear, preselectedMonth }: ScheduleGeneratorProps) {
  const currentDate = new Date();
  const [year, setYear] = useState(preselectedYear ?? currentDate.getFullYear());
  const [month, setMonth] = useState(preselectedMonth ?? currentDate.getMonth() + 1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [holidays, setHolidays] = useState<HolidayConfig[]>([]);
  const [doctorDateExclusions, setDoctorDateExclusions] = useState<Record<string, string[]>>({});
  const [doctorDateAvailability, setDoctorDateAvailability] = useState<Record<string, string[]>>({});
  const [doctorAvailabilityMode, setDoctorAvailabilityMode] = useState<Record<string, DoctorDateMode>>({});
  const [prefilledAssignments, setPrefilledAssignments] = useState<Assignment[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<string | null>(null);
  const [editingHoliday, setEditingHoliday] = useState<string | null>(null);
  const [useYearBalance, setUseYearBalance] = useState(true);
  const [pfSlot, setPfSlot] = useState<{ date: string; roomId: string; timeSlot: TimeSlot } | null>(null);

  // Update year/month when preselected values change
  useEffect(() => {
    if (preselectedYear !== null && preselectedYear !== undefined) {
      setYear(preselectedYear);
    }
    if (preselectedMonth !== null && preselectedMonth !== undefined) {
      setMonth(preselectedMonth);
    }
  }, [preselectedYear, preselectedMonth]);

  const monthNames = MONTH_NAMES_FULL;

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

  const saveConfig = useCallback((
    newHolidays: HolidayConfig[],
    newExclusions: Record<string, string[]>,
    newAvailability: Record<string, string[]>,
    newModes: Record<string, DoctorDateMode>,
    newPrefilled?: Assignment[],
  ) => {
    StorageService.saveGenerationConfig({
      year,
      month,
      holidays: newHolidays,
      doctorDateExclusions: newExclusions,
      doctorDateAvailability: newAvailability,
      doctorAvailabilityMode: newModes,
      prefilledAssignments: newPrefilled ?? prefilledAssignments,
    });
  }, [year, month, prefilledAssignments]);

  const loadMonthConfig = useCallback((targetYear: number, targetMonth: number) => {
    const savedConfig = StorageService.loadGenerationConfig(targetYear, targetMonth);
    if (savedConfig) {
      setHolidays(savedConfig.holidays);
      setDoctorDateExclusions(savedConfig.doctorDateExclusions);
      setDoctorDateAvailability(savedConfig.doctorDateAvailability || {});
      setDoctorAvailabilityMode(savedConfig.doctorAvailabilityMode || {});
      setPrefilledAssignments(savedConfig.prefilledAssignments || []);
    } else {
      setHolidays([]);
      setDoctorDateExclusions({});
      setDoctorDateAvailability({});
      setDoctorAvailabilityMode({});
      setPrefilledAssignments([]);
    }
    setSelectedDoctor(null);
    setEditingHoliday(null);
  }, []);

  useEffect(() => {
    loadMonthConfig(year, month);
  }, [year, month, loadMonthConfig]);

  const canGenerate = rooms.length > 0 && doctors.length > 0 && rooms.some(room => room.slots.length > 0);

  // Calculate prior stats for year balancing
  const priorYearStats = useMemo(() => {
    if (!useYearBalance || month === 1) return null;
    
    const getActiveScheduleForMonth = (targetYear: number, targetMonth: number) => {
      const version = StorageService.getActiveVersion(targetYear, targetMonth);
      return version?.schedule || null;
    };

    const result = ScheduleGeneratorService.calculatePriorYearStats(
      year,
      month,
      doctors,
      rooms,
      getActiveScheduleForMonth
    );

    return result;
  }, [useYearBalance, year, month, doctors, rooms]);

  const getHolidayConfig = (dateStr: string): HolidayConfig | undefined => {
    return holidays.find(h => h.date === dateStr);
  };

  const toggleHoliday = (dateStr: string) => {
    const existing = getHolidayConfig(dateStr);
    let newHolidays: HolidayConfig[];
    if (existing) {
      newHolidays = holidays.filter(h => h.date !== dateStr);
      if (editingHoliday === dateStr) {
        setEditingHoliday(null);
      }
    } else {
      newHolidays = [...holidays, { date: dateStr, disabledRooms: [] }];
    }
    setHolidays(newHolidays);
    saveConfig(newHolidays, doctorDateExclusions, doctorDateAvailability, doctorAvailabilityMode);
  };

  const toggleHolidayRoom = (dateStr: string, roomId: string) => {
    const newHolidays = holidays.map(h => {
      if (h.date !== dateStr) return h;
      const currentDisabledRooms = h.disabledRooms || [];
      const disabledRooms = currentDisabledRooms.includes(roomId)
        ? currentDisabledRooms.filter(r => r !== roomId)
        : [...currentDisabledRooms, roomId];
      return { ...h, disabledRooms };
    });
    setHolidays(newHolidays);
    saveConfig(newHolidays, doctorDateExclusions, doctorDateAvailability, doctorAvailabilityMode);
  };

  const toggleDoctorDateExclusion = (doctorId: string, dateStr: string) => {
    const currentExclusions = doctorDateExclusions[doctorId] || [];
    const newExclusions = currentExclusions.includes(dateStr)
      ? currentExclusions.filter(d => d !== dateStr)
      : [...currentExclusions, dateStr];
    const newDoctorDateExclusions = { ...doctorDateExclusions, [doctorId]: newExclusions };
    setDoctorDateExclusions(newDoctorDateExclusions);
    saveConfig(holidays, newDoctorDateExclusions, doctorDateAvailability, doctorAvailabilityMode);
  };

  const toggleDoctorDateAvailability = (doctorId: string, dateStr: string) => {
    const current = doctorDateAvailability[doctorId] || [];
    const updated = current.includes(dateStr)
      ? current.filter(d => d !== dateStr)
      : [...current, dateStr];
    const newAvailability = { ...doctorDateAvailability, [doctorId]: updated };
    setDoctorDateAvailability(newAvailability);
    saveConfig(holidays, doctorDateExclusions, newAvailability, doctorAvailabilityMode);
  };

  const toggleDoctorMode = (doctorId: string, mode: DoctorDateMode) => {
    const newModes = { ...doctorAvailabilityMode, [doctorId]: mode };
    setDoctorAvailabilityMode(newModes);
    saveConfig(holidays, doctorDateExclusions, doctorDateAvailability, newModes);
  };

  const getSelectedDoctorMode = (): DoctorDateMode => {
    if (!selectedDoctor) return 'exclusion';
    return doctorAvailabilityMode[selectedDoctor] || 'exclusion';
  };

  const getDoctorDateCount = (doctorId: string): number => {
    const mode = doctorAvailabilityMode[doctorId] || 'exclusion';
    if (mode === 'availability') {
      return doctorDateAvailability[doctorId]?.length || 0;
    }
    return doctorDateExclusions[doctorId]?.length || 0;
  };

  const handleGenerate = async () => {
    if (!canGenerate) return;

    setIsGenerating(true);
    setGenerationProgress(null);

    const config: GenerationConfig = {
      year,
      month,
      holidays,
      doctorDateExclusions,
      doctorDateAvailability,
      doctorAvailabilityMode,
      prefilledAssignments,
    };
    
    // Pass prior year stats if year balancing is enabled
    const priorStats = useYearBalance && priorYearStats ? priorYearStats.stats : undefined;
    const generator = new ScheduleGeneratorService(rooms, doctors, config, priorStats);
    
    try {
      const result = await generator.generateOptimized(300, (progress) => {
        setGenerationProgress(progress);
      });
      onScheduleGenerated(result.schedule);
    } catch (error) {
      console.error('Generation error:', error);
      alert(`Errore durante la generazione: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsGenerating(false);
      setGenerationProgress(null);
    }
  };

  const handleMonthChange = (newMonth: number) => {
    setMonth(newMonth);
  };

  const handleYearChange = (newYear: number) => {
    setYear(newYear);
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
            <select value={month} onChange={event => handleMonthChange(Number(event.target.value))}>
              {monthNames.map((name, index) => (
                <option key={index} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="select-group">
            <label>Anno</label>
            <select value={year} onChange={event => handleYearChange(Number(event.target.value))}>
              {getYearRange().map(yearOption => (
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
              Ottimizzazione...
            </>
          ) : (
            '⚡ Genera Calendario Ottimizzato'
          )}
        </button>
      </div>

      <div className="year-balance-section">
        <label className="year-balance-toggle">
          <input
            type="checkbox"
            checked={useYearBalance}
            onChange={e => setUseYearBalance(e.target.checked)}
          />
          <span className="toggle-label">
            📊 Bilancia con statistiche anno {year}
          </span>
        </label>
        {useYearBalance && (
          <div className="year-balance-info">
            {month === 1 ? (
              <span className="info-note">
                ℹ️ Gennaio è il primo mese, non ci sono mesi precedenti da considerare.
              </span>
            ) : priorYearStats && priorYearStats.monthsCovered.length > 0 ? (
              <span className="info-active">
                ✅ Bilanciamento basato su: {priorYearStats.monthsCovered.map(m => monthNames[m - 1]).join(', ')}
              </span>
            ) : (
              <span className="info-warning">
                ⚠️ Nessuna versione attiva trovata per i mesi precedenti del {year}.
                Salva versioni per Gen-{monthNames[month - 2]} per abilitare il bilanciamento.
              </span>
            )}
          </div>
        )}
      </div>

      {isGenerating && generationProgress && (
        <div className="generation-progress">
          <div className="progress-header">
            <span className="progress-title">🔄 Generazione in corso...</span>
            <span className="progress-percentage">{generationProgress.percentage}%</span>
          </div>
          <div className="progress-bar-container">
            <div 
              className="progress-bar-fill" 
              style={{ width: `${generationProgress.percentage}%` }}
            ></div>
          </div>
          <div className="progress-stats">
            <span>📊 {generationProgress.current.toLocaleString()} / {generationProgress.total.toLocaleString()} tentativi</span>
            <span>✅ {generationProgress.validSchedules} schedules valide</span>
            {generationProgress.bestCost !== null && (
              <span>🎯 Costo migliore: {generationProgress.bestCost.toFixed(2)}</span>
            )}
          </div>
        </div>
      )}

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
                    title={isWeekend ? 'Weekend' : isHoliday ? 'Festivo - clicca per configurare sale' : 'Clicca per segnare come festivo'}
                  >
                    {day}
                    {isHoliday && (holidayConfig!.disabledRooms || []).length > 0 && (
                      <span className="disabled-indicator">{(holidayConfig!.disabledRooms || []).length}</span>
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
              <p className="config-hint">Seleziona le sale da disabilitare per questo giorno:</p>
              <div className="room-toggles">
                {rooms.map(room => {
                  const holidayConfig = getHolidayConfig(editingHoliday);
                  const isDisabled = (holidayConfig?.disabledRooms || []).includes(room.id);
                  return (
                    <button
                      key={room.id}
                      className={`room-toggle ${isDisabled ? 'disabled-room' : 'enabled-room'}`}
                      style={{ borderColor: room.color }}
                      onClick={() => toggleHolidayRoom(editingHoliday, room.id)}
                    >
                      <span className="room-name">{room.name}</span>
                      <span className="room-status">{isDisabled ? '❌' : '✅'}</span>
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
                    {(holiday.disabledRooms || []).length > 0 && (
                      <span className="disabled-count">-{(holiday.disabledRooms || []).length} sale</span>
                    )}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div className="config-block doctor-exclusions-config">
          <h3>📋 Disponibilita / Esclusioni per Dottore</h3>
          <p className="config-description">Seleziona un dottore, scegli la modalita, e clicca sui giorni</p>

          <div className="doctor-selector">
            {doctors.map(doctor => {
              const mode = doctorAvailabilityMode[doctor.id] || 'exclusion';
              const count = getDoctorDateCount(doctor.id);
              return (
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
                  {count > 0 && (
                    <span className={mode === 'availability' ? 'availability-count' : 'exclusion-count'}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {selectedDoctor && (
            <div className="doctor-date-exclusions">
              <div className="mode-toggle">
                <button
                  className={`mode-btn ${getSelectedDoctorMode() === 'exclusion' ? 'active' : ''}`}
                  onClick={() => toggleDoctorMode(selectedDoctor, 'exclusion')}
                >
                  🚫 Esclusioni
                </button>
                <button
                  className={`mode-btn ${getSelectedDoctorMode() === 'availability' ? 'active' : ''}`}
                  onClick={() => toggleDoctorMode(selectedDoctor, 'availability')}
                >
                  ✅ Disponibilita
                </button>
              </div>

              {getSelectedDoctorMode() === 'availability' && (doctorDateAvailability[selectedDoctor]?.length || 0) === 0 && (
                <p className="mode-hint">Clicca sui giorni in cui il dottore e disponibile. Se nessun giorno e selezionato, nessun vincolo viene applicato.</p>
              )}

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
                    const doctor = doctors.find(d => d.id === selectedDoctor);
                    const holidayConfig = getHolidayConfig(dateStr);
                    const isHoliday = !!holidayConfig;
                    const isWeekendOrHoliday = isWeekend || isHoliday;
                    const mode = getSelectedDoctorMode();
                    const isExcluded = mode === 'exclusion' && doctorDateExclusions[selectedDoctor]?.includes(dateStr);
                    const isAvailable = mode === 'availability' && doctorDateAvailability[selectedDoctor]?.includes(dateStr);
                    const isSelected = isExcluded || isAvailable;

                    return (
                      <button
                        key={day}
                        className={`mini-day ${isWeekendOrHoliday ? 'weekend-or-holiday' : ''} ${isExcluded ? 'excluded' : ''} ${isAvailable ? 'available' : ''}`}
                        style={isSelected ? { backgroundColor: doctor?.color } : {}}
                        onClick={() => {
                          if (mode === 'exclusion') {
                            toggleDoctorDateExclusion(selectedDoctor, dateStr);
                          } else {
                            toggleDoctorDateAvailability(selectedDoctor, dateStr);
                          }
                        }}
                        title={mode === 'exclusion'
                          ? (isExcluded ? 'Escluso - clicca per rimuovere' : 'Clicca per escludere')
                          : (isAvailable ? 'Disponibile - clicca per rimuovere' : 'Clicca per segnare come disponibile')
                        }
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

        <div className="config-block prefilled-config">
          <h3>
            🔒 Turni Pre-compilati
            {prefilledAssignments.length > 0 && (
              <span className="prefilled-count">{prefilledAssignments.length}</span>
            )}
          </h3>
          <p className="config-description">
            Clicca una cella per assegnare un dottore. Il turno restera fisso durante la generazione.
          </p>

          <div className="pf-grid-container">
            <div className="pf-grid-header">
              <div className="pf-grid-cell pf-day-col">G.</div>
              {rooms.flatMap(room =>
                room.slots
                  .map(s => s.timeSlot)
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .sort((a, b) => {
                    const order: Record<string, number> = { '08:00-14:00': 0, '14:00-20:00': 1, '20:00-08:00': 2 };
                    return (order[a] || 0) - (order[b] || 0);
                  })
                  .map(ts => {
                    return (
                      <div key={`${room.id}-${ts}`} className="pf-grid-cell pf-header-cell" style={{ color: room.color }}>
                        {room.name.substring(0, 3)}<span className="pf-slot-label">{TIME_SLOT_TIME_LABELS[ts as TimeSlot]}</span>
                      </div>
                    );
                  })
              )}
            </div>
            <div className="pf-grid-body">
              {calendarDays.map(({ day, dateStr, isWeekend }) => {
                const date = new Date(year, month - 1, day);
                const weekday = WEEKDAYS[(date.getDay() + 6) % 7];
                const wdLabel = weekdayNames[date.getDay()];
                return (
                  <div key={day} className={`pf-grid-row ${isWeekend ? 'pf-weekend-row' : ''}`}>
                    <div className="pf-grid-cell pf-day-col">
                      <span className="pf-day-num">{day}</span>
                      <span className="pf-day-wd">{wdLabel}</span>
                    </div>
                    {rooms.flatMap(room =>
                      room.slots
                        .map(s => s.timeSlot)
                        .filter((v, i, a) => a.indexOf(v) === i)
                        .sort((a, b) => {
                          const order: Record<string, number> = { '08:00-14:00': 0, '14:00-20:00': 1, '20:00-08:00': 2 };
                          return (order[a] || 0) - (order[b] || 0);
                        })
                        .map(ts => {
                          const slot = room.slots.find(s => s.weekday === weekday && s.timeSlot === ts);
                          if (!slot) {
                            return <div key={`${room.id}-${ts}`} className="pf-grid-cell pf-cell-disabled" />;
                          }

                          const cellAssignments = prefilledAssignments.filter(
                            a => a.date === dateStr && a.roomId === room.id && a.timeSlot === ts
                          );
                          const maxDoctors = slot.requiredDoctors;
                          const isFull = cellAssignments.length >= maxDoctors;
                          const isSelected = pfSlot?.date === dateStr && pfSlot?.roomId === room.id && pfSlot?.timeSlot === ts;

                          return (
                            <div
                              key={`${room.id}-${ts}`}
                              className={`pf-grid-cell pf-cell ${isSelected ? 'pf-cell-selected' : ''} ${cellAssignments.length > 0 ? 'pf-cell-filled' : ''}`}
                              onClick={() => {
                                if (!isFull) {
                                  setPfSlot(isSelected ? null : { date: dateStr, roomId: room.id, timeSlot: ts as TimeSlot });
                                } else {
                                  setPfSlot(null);
                                }
                              }}
                              title={isFull ? `${cellAssignments.map(a => a.doctorName).join(', ')} (pieno)` : 'Clicca per assegnare'}
                            >
                              {cellAssignments.map(a => {
                                const doc = doctors.find(d => d.id === a.doctorId);
                                return (
                                  <span
                                    key={a.id}
                                    className="pf-cell-doctor"
                                    style={{ color: doc?.color, borderColor: doc?.color }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const updated = prefilledAssignments.filter(pa => pa.id !== a.id);
                                      setPrefilledAssignments(updated);
                                      saveConfig(holidays, doctorDateExclusions, doctorDateAvailability, doctorAvailabilityMode, updated);
                                    }}
                                    title={`${doc?.name} — clicca per rimuovere`}
                                  >
                                    {doc?.name?.substring(0, 3) || '?'}
                                  </span>
                                );
                              })}
                              {!isFull && !isSelected && cellAssignments.length === 0 && (
                                <span className="pf-cell-empty">+</span>
                              )}
                              {isSelected && <span className="pf-cell-empty">...</span>}
                            </div>
                          );
                        })
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {pfSlot && (
            <div className="pf-doctor-picker">
              <span className="pf-picker-label">
                {parseInt(pfSlot.date.split('-')[2])} {monthNames[month - 1]} — {rooms.find(r => r.id === pfSlot.roomId)?.name} {TIME_SLOT_TIME_LABELS[pfSlot.timeSlot]}
              </span>
              <div className="pf-doctor-buttons">
                {doctors
                  .filter(d => !prefilledAssignments.some(
                    a => a.date === pfSlot.date && a.roomId === pfSlot.roomId && a.timeSlot === pfSlot.timeSlot && a.doctorId === d.id
                  ))
                  .map(d => (
                  <button
                    key={d.id}
                    className="pf-doctor-btn"
                    style={{ borderColor: d.color, color: d.color }}
                    onClick={() => {
                      const room = rooms.find(r => r.id === pfSlot.roomId);
                      if (!room) return;
                      const newAssignment: Assignment = {
                        id: generateId(),
                        date: pfSlot.date,
                        roomId: pfSlot.roomId,
                        roomName: room.name,
                        timeSlot: pfSlot.timeSlot,
                        doctorId: d.id,
                        doctorName: d.name,
                        locked: true,
                      };
                      const updated = [...prefilledAssignments, newAssignment];
                      setPrefilledAssignments(updated);
                      saveConfig(holidays, doctorDateExclusions, doctorDateAvailability, doctorAvailabilityMode, updated);
                      // Check if slot is now full
                      const slot = room.slots.find(s => s.timeSlot === pfSlot.timeSlot);
                      const newCount = updated.filter(
                        a => a.date === pfSlot.date && a.roomId === pfSlot.roomId && a.timeSlot === pfSlot.timeSlot
                      ).length;
                      if (slot && newCount >= slot.requiredDoctors) {
                        setPfSlot(null);
                      }
                    }}
                  >
                    {d.name}
                  </button>
                ))}
                <button className="pf-doctor-btn pf-cancel-btn" onClick={() => setPfSlot(null)}>✕</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
