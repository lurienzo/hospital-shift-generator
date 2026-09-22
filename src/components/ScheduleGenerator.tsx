import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Assignment,
  DoctorDateMode,
  GenerationConfig,
  HolidayConfig,
  MonthlySchedule,
} from '../models/types';
import {
  EFFORT_PRESETS,
  EffortLevel,
  GenerationProgress,
  ScheduleGeneratorService,
} from '../services/ScheduleGeneratorService';
import { StorageService } from '../services/StorageService';
import { buildRequirements } from '../domain/validation';
import { useConfig } from '../state/configContext';
import { MiniCalendar, MiniCalendarDayState } from './MiniCalendar';
import { PrefilledGrid } from './PrefilledGrid';
import { MONTH_NAMES, formatDayMonth, getYearRange } from '../utils/date';
import './ScheduleGenerator.css';

interface ScheduleGeneratorProps {
  onScheduleGenerated: (schedule: MonthlySchedule) => void;
  preselected: { year: number; month: number } | null;
}

const EMPTY_CONFIG = {
  holidays: [] as HolidayConfig[],
  doctorDateExclusions: {} as Record<string, string[]>,
  doctorDateAvailability: {} as Record<string, string[]>,
  doctorAvailabilityMode: {} as Record<string, DoctorDateMode>,
  prefilledAssignments: [] as Assignment[],
};

export function ScheduleGenerator({ onScheduleGenerated, preselected }: ScheduleGeneratorProps) {
  const { rooms, doctors, shiftTypes, shiftTypeIndex, schemes, rotationRule, rotationScheme } = useConfig();

  const today = new Date();
  const [year, setYear] = useState(preselected?.year ?? today.getFullYear());
  const [month, setMonth] = useState(preselected?.month ?? today.getMonth() + 1);
  const [effort, setEffort] = useState<EffortLevel>('standard');
  const [useYearBalance, setUseYearBalance] = useState(true);

  const [monthConfig, setMonthConfig] = useState(EMPTY_CONFIG);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
  const [editingHoliday, setEditingHoliday] = useState<string | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [lastRun, setLastRun] = useState<{ gaps: number; errors: number; warnings: number } | null>(null);

  useEffect(() => {
    if (preselected) {
      setYear(preselected.year);
      setMonth(preselected.month);
    }
  }, [preselected]);

  // La configurazione è per mese: cambiando mese si ricarica quella salvata.
  useEffect(() => {
    const stored = StorageService.loadGenerationConfig(year, month);
    setMonthConfig(stored
      ? {
          holidays: stored.holidays,
          doctorDateExclusions: stored.doctorDateExclusions,
          doctorDateAvailability: stored.doctorDateAvailability,
          doctorAvailabilityMode: stored.doctorAvailabilityMode,
          prefilledAssignments: stored.prefilledAssignments,
        }
      : EMPTY_CONFIG);
    setSelectedDoctorId(null);
    setEditingHoliday(null);
    setLastRun(null);
  }, [year, month]);

  const persist = useCallback((changes: Partial<typeof EMPTY_CONFIG>) => {
    setMonthConfig(current => {
      const next = { ...current, ...changes };
      StorageService.saveGenerationConfig({ year, month, ...next });
      return next;
    });
  }, [year, month]);

  const requirements = useMemo(
    () => buildRequirements(rooms, year, month, monthConfig.holidays),
    [rooms, year, month, monthConfig.holidays],
  );

  const priorYear = useMemo(() => {
    if (!useYearBalance || month === 1) return null;
    return ScheduleGeneratorService.collectPriorYearStats({
      year,
      upToMonth: month,
      doctors,
      rooms,
      shiftTypes: shiftTypeIndex,
      loadSchedule: (targetYear, targetMonth) =>
        StorageService.getActiveVersion(targetYear, targetMonth)?.schedule ?? null,
    });
  }, [useYearBalance, year, month, doctors, rooms, shiftTypeIndex]);

  const canGenerate = rooms.length > 0 && doctors.length > 0 && requirements.length > 0;

  const handleGenerate = async () => {
    if (!canGenerate || isGenerating) return;

    setIsGenerating(true);
    setProgress(null);
    setLastRun(null);

    const config: GenerationConfig = { year, month, ...monthConfig };

    // Il mese precedente serve ai blocchi a rotazione che lo scavalcano.
    const previous = month === 1
      ? StorageService.getActiveVersion(year - 1, 12)
      : StorageService.getActiveVersion(year, month - 1);

    const generator = new ScheduleGeneratorService({
      rooms,
      doctors,
      shiftTypes: shiftTypeIndex,
      schemes,
      config,
      rotationRule,
      priorStats: useYearBalance ? priorYear?.stats : undefined,
      priorAssignments: previous?.schedule.assignments,
    });

    try {
      const result = await generator.generate(EFFORT_PRESETS[effort].attempts, setProgress);
      setLastRun({
        gaps: result.coverageGaps,
        errors: result.errors,
        warnings: result.warnings,
      });
      onScheduleGenerated(result.schedule);
    } catch (error) {
      console.error('Generazione non riuscita', error);
      window.alert(
        `La generazione non è riuscita: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsGenerating(false);
      setProgress(null);
    }
  };

  // ----- Festivi -----

  const holidayAt = (date: string) => monthConfig.holidays.find(holiday => holiday.date === date);

  const toggleHoliday = (date: string) => {
    const existing = holidayAt(date);
    if (existing) {
      persist({ holidays: monthConfig.holidays.filter(holiday => holiday.date !== date) });
      if (editingHoliday === date) setEditingHoliday(null);
    } else {
      persist({ holidays: [...monthConfig.holidays, { date, disabledRooms: [] }] });
      setEditingHoliday(date);
    }
  };

  const toggleHolidayRoom = (date: string, roomId: string) => {
    persist({
      holidays: monthConfig.holidays.map(holiday => holiday.date === date
        ? {
            ...holiday,
            disabledRooms: holiday.disabledRooms.includes(roomId)
              ? holiday.disabledRooms.filter(id => id !== roomId)
              : [...holiday.disabledRooms, roomId],
          }
        : holiday),
    });
  };

  const holidayDayState = (date: string): MiniCalendarDayState => {
    const holiday = holidayAt(date);
    return {
      selection: holiday ? 'full' : 'none',
      color: '#f5a524',
      highlighted: editingHoliday === date,
      title: holiday
        ? 'Festivo — clicca per rimuoverlo'
        : 'Clicca per segnarlo come festivo',
      marker: holiday && holiday.disabledRooms.length > 0
        ? <span className="mini-day-marker">{holiday.disabledRooms.length}</span>
        : undefined,
    };
  };

  // ----- Disponibilità dei dottori -----

  const doctorMode = (doctorId: string): DoctorDateMode =>
    monthConfig.doctorAvailabilityMode[doctorId] ?? 'exclusion';

  const doctorEntries = (doctorId: string): string[] => {
    const mode = doctorMode(doctorId);
    return (mode === 'exclusion'
      ? monthConfig.doctorDateExclusions[doctorId]
      : monthConfig.doctorDateAvailability[doctorId]) ?? [];
  };

  const setDoctorEntries = (doctorId: string, entries: string[]) => {
    if (doctorMode(doctorId) === 'exclusion') {
      persist({
        doctorDateExclusions: { ...monthConfig.doctorDateExclusions, [doctorId]: entries },
      });
    } else {
      persist({
        doctorDateAvailability: { ...monthConfig.doctorDateAvailability, [doctorId]: entries },
      });
    }
  };

  /** Alterna la giornata intera, o una singola fascia se indicata. */
  const toggleDoctorEntry = (doctorId: string, date: string, shiftTypeId?: string) => {
    const entries = doctorEntries(doctorId);
    const slotsOfDay = shiftTypes.map(shiftType => `${date}:${shiftType.id}`);

    if (!shiftTypeId) {
      const hasAny = entries.includes(date) || entries.some(entry => entry.startsWith(`${date}:`));
      setDoctorEntries(doctorId, hasAny
        ? entries.filter(entry => entry !== date && !entry.startsWith(`${date}:`))
        : [...entries, date]);
      return;
    }

    const entry = `${date}:${shiftTypeId}`;

    if (entries.includes(entry)) {
      setDoctorEntries(doctorId, entries.filter(other => other !== entry));
      return;
    }

    if (entries.includes(date)) {
      // La giornata intera era selezionata: la si scompone nelle altre fasce.
      setDoctorEntries(doctorId, [
        ...entries.filter(other => other !== date),
        ...slotsOfDay.filter(slot => slot !== entry),
      ]);
      return;
    }

    const next = [...entries, entry];
    const allSlots = slotsOfDay.every(slot => next.includes(slot));
    setDoctorEntries(doctorId, allSlots
      ? [...next.filter(other => !other.startsWith(`${date}:`)), date]
      : next);
  };

  const dayShiftTypes = (doctorId: string, date: string): Set<string> => {
    const entries = doctorEntries(doctorId);
    if (entries.includes(date)) return new Set(shiftTypes.map(shiftType => shiftType.id));
    return new Set(entries
      .filter(entry => entry.startsWith(`${date}:`))
      .map(entry => entry.slice(date.length + 1)));
  };

  const availabilityDayState = (doctorId: string, date: string): MiniCalendarDayState => {
    const entries = doctorEntries(doctorId);
    const mode = doctorMode(doctorId);
    const doctor = doctors.find(candidate => candidate.id === doctorId);

    const full = entries.includes(date);
    const partial = !full && entries.some(entry => entry.startsWith(`${date}:`));

    return {
      selection: full ? 'full' : partial ? 'partial' : 'none',
      color: mode === 'exclusion' ? (doctor?.color ?? '#f2585b') : '#10b981',
      title: full || partial
        ? 'Clicca per azzerare la giornata'
        : mode === 'exclusion'
          ? 'Clicca per escludere la giornata'
          : 'Clicca per renderla disponibile',
    };
  };

  const selectedDoctor = doctors.find(doctor => doctor.id === selectedDoctorId);
  const editedHoliday = editingHoliday ? holidayAt(editingHoliday) : undefined;

  return (
    <div className="generator stack">
      {/* ---------------- Comandi ---------------- */}
      <section className="panel generator-controls">
        <div className="field-row">
          <div className="field">
            <label htmlFor="gen-month">Mese</label>
            <select
              id="gen-month"
              className="select"
              value={month}
              onChange={event => setMonth(Number(event.target.value))}
            >
              {MONTH_NAMES.map((name, index) => (
                <option key={name} value={index + 1}>{name}</option>
              ))}
            </select>
          </div>

          <div className="field field-narrow">
            <label htmlFor="gen-year">Anno</label>
            <select
              id="gen-year"
              className="select"
              value={year}
              onChange={event => setYear(Number(event.target.value))}
            >
              {getYearRange().map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <span className="label">Qualità della ricerca</span>
            <div className="segmented">
              {(Object.keys(EFFORT_PRESETS) as EffortLevel[]).map(level => (
                <button
                  key={level}
                  type="button"
                  className={effort === level ? 'active' : ''}
                  onClick={() => setEffort(level)}
                  title={`${EFFORT_PRESETS[level].attempts} tentativi`}
                >
                  {EFFORT_PRESETS[level].label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="btn btn-accent btn-lg generate-button"
            onClick={handleGenerate}
            disabled={!canGenerate || isGenerating}
          >
            {isGenerating ? <><span className="spinner" />Generazione…</> : 'Genera calendario'}
          </button>
        </div>

        <div className="generator-facts">
          <span><strong>{rooms.length}</strong> sale</span>
          <span><strong>{doctors.length}</strong> dottori</span>
          <span><strong>{requirements.length}</strong> turni da coprire</span>
          {monthConfig.holidays.length > 0 && (
            <span><strong>{monthConfig.holidays.length}</strong> festivi</span>
          )}
          {monthConfig.prefilledAssignments.length > 0 && (
            <span><strong>{monthConfig.prefilledAssignments.length}</strong> pre-compilati</span>
          )}
        </div>

        {rotationScheme && (
          <p className="hint">
            Rotazione del servizio attiva: <strong>{rotationScheme.name}</strong>
            {rotationRule.strength === 'binding'
              ? ' — vincolante nei giorni di smonto e riposo.'
              : ' — seguita quando possibile.'}
          </p>
        )}

        <label className="checkbox">
          <input
            type="checkbox"
            checked={useYearBalance}
            onChange={event => setUseYearBalance(event.target.checked)}
          />
          <span>Bilancia tenendo conto dei mesi precedenti del {year}</span>
        </label>

        {useYearBalance && (
          <p className="hint">
            {month === 1
              ? 'Gennaio è il primo mese dell’anno: non ci sono mesi precedenti da considerare.'
              : priorYear && priorYear.monthsCovered.length > 0
                ? `Carico già accumulato in: ${priorYear.monthsCovered.map(m => MONTH_NAMES[m - 1]).join(', ')}.`
                : `Nessuna versione attiva salvata per i mesi precedenti del ${year}: il bilanciamento parte da zero.`}
          </p>
        )}

        {!canGenerate && (
          <ul className="generator-blockers">
            {rooms.length === 0 && <li>Aggiungi almeno una sala operativa.</li>}
            {rooms.length > 0 && requirements.length === 0 && (
              <li>Nessun turno configurato: apri una sala e definisci i turni della settimana.</li>
            )}
            {doctors.length === 0 && <li>Aggiungi almeno un dottore.</li>}
          </ul>
        )}

        {isGenerating && progress && (
          <div className="progress">
            <div className="progress-head">
              <span>{progress.current} di {progress.total} tentativi</span>
              <span>{progress.percentage}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress.percentage}%` }} />
            </div>
            <div className="progress-detail">
              <span>{progress.validSchedules} soluzioni senza errori</span>
              {progress.bestScore !== null && (
                <span>punteggio migliore {progress.bestScore.toFixed(1)}</span>
              )}
            </div>
          </div>
        )}

        {lastRun && (
          <div className={`run-summary ${lastRun.gaps === 0 && lastRun.errors === 0 ? 'ok' : 'attention'}`}>
            {lastRun.gaps === 0 && lastRun.errors === 0
              ? `Calendario generato senza errori${lastRun.warnings > 0 ? `, con ${lastRun.warnings} avvisi` : ''}.`
              : `Calendario generato con ${lastRun.gaps} turni scoperti e ${lastRun.errors} errori. `
                + 'Controlla disponibilità ed esclusioni, oppure prova con una ricerca più accurata.'}
          </div>
        )}
      </section>

      {/* ---------------- Festivi ---------------- */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Festivi del mese</h3>
            <p className="hint">
              I festivi contano come weekend nel bilanciamento. Per ciascuno puoi indicare quali
              sale restano chiuse.
            </p>
          </div>
        </div>

        <div className="split">
          <MiniCalendar
            year={year}
            month={month}
            getDayState={holidayDayState}
            onDayClick={date => {
              if (holidayAt(date)) setEditingHoliday(editingHoliday === date ? null : date);
              else toggleHoliday(date);
            }}
          />

          <div className="split-side">
            {editedHoliday ? (
              <>
                <div className="panel-header">
                  <h4>{formatDayMonth(editedHoliday.date)}</h4>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => toggleHoliday(editedHoliday.date)}
                  >
                    Non è festivo
                  </button>
                </div>
                <span className="label">Sale chiuse in questo giorno</span>
                <div className="row-wrap">
                  {rooms.map(room => {
                    const disabled = editedHoliday.disabledRooms.includes(room.id);
                    return (
                      <button
                        key={room.id}
                        type="button"
                        className={`exclusion-pill ${disabled ? 'on' : ''}`}
                        onClick={() => toggleHolidayRoom(editedHoliday.date, room.id)}
                      >
                        <span className="dot" style={{ background: room.color }} />
                        {room.name}
                      </button>
                    );
                  })}
                  {rooms.length === 0 && <p className="hint">Nessuna sala configurata.</p>}
                </div>
              </>
            ) : monthConfig.holidays.length > 0 ? (
              <>
                <span className="label">Festivi impostati</span>
                <div className="row-wrap">
                  {[...monthConfig.holidays]
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map(holiday => (
                      <button
                        key={holiday.date}
                        type="button"
                        className="badge badge-warning holiday-chip"
                        onClick={() => setEditingHoliday(holiday.date)}
                      >
                        {formatDayMonth(holiday.date)}
                        {holiday.disabledRooms.length > 0 && ` · −${holiday.disabledRooms.length} sale`}
                      </button>
                    ))}
                </div>
              </>
            ) : (
              <p className="hint">Nessun festivo impostato per questo mese.</p>
            )}
          </div>
        </div>
      </section>

      {/* ---------------- Disponibilità ---------------- */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Disponibilità e assenze del mese</h3>
            <p className="hint">
              Scegli un dottore e segna i giorni. Puoi lavorare sulla giornata intera o sulle
              singole fasce, cliccando le sigle dentro il giorno.
            </p>
          </div>
        </div>

        {doctors.length === 0 ? (
          <p className="hint">Nessun dottore configurato.</p>
        ) : (
          <>
            <div className="row-wrap doctor-selector">
              {doctors.map(doctor => {
                const count = doctorEntries(doctor.id).length;
                const mode = doctorMode(doctor.id);
                return (
                  <button
                    key={doctor.id}
                    type="button"
                    className={`doctor-pill ${selectedDoctorId === doctor.id ? 'on' : ''}`}
                    style={selectedDoctorId === doctor.id
                      ? { borderColor: doctor.color, background: `${doctor.color}22` }
                      : undefined}
                    onClick={() => setSelectedDoctorId(
                      selectedDoctorId === doctor.id ? null : doctor.id)}
                  >
                    <span className="dot" style={{ background: doctor.color }} />
                    {doctor.name}
                    {count > 0 && (
                      <span className={`badge ${mode === 'availability' ? 'badge-accent' : 'badge-danger'}`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {selectedDoctor && (
              <div className="availability-editor">
                <div className="row-wrap">
                  <div className="segmented">
                    <button
                      type="button"
                      className={doctorMode(selectedDoctor.id) === 'exclusion' ? 'active' : ''}
                      onClick={() => persist({
                        doctorAvailabilityMode: {
                          ...monthConfig.doctorAvailabilityMode,
                          [selectedDoctor.id]: 'exclusion',
                        },
                      })}
                    >
                      Assenze
                    </button>
                    <button
                      type="button"
                      className={doctorMode(selectedDoctor.id) === 'availability' ? 'active' : ''}
                      onClick={() => persist({
                        doctorAvailabilityMode: {
                          ...monthConfig.doctorAvailabilityMode,
                          [selectedDoctor.id]: 'availability',
                        },
                      })}
                    >
                      Solo disponibilità
                    </button>
                  </div>

                  {doctorEntries(selectedDoctor.id).length > 0 && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => setDoctorEntries(selectedDoctor.id, [])}
                    >
                      Azzera
                    </button>
                  )}
                </div>

                <p className="hint">
                  {doctorMode(selectedDoctor.id) === 'exclusion'
                    ? `I giorni segnati sono quelli in cui ${selectedDoctor.name} non è disponibile.`
                    : `Sono segnati i giorni in cui ${selectedDoctor.name} è disponibile: fuori da questi non verrà assegnato. Un elenco vuoto non applica nessun vincolo.`}
                </p>

                <MiniCalendar
                  year={year}
                  month={month}
                  getDayState={date => availabilityDayState(selectedDoctor.id, date)}
                  onDayClick={date => toggleDoctorEntry(selectedDoctor.id, date)}
                  renderDayDetail={date => {
                    const active = dayShiftTypes(selectedDoctor.id, date);
                    if (active.size === 0) return null;
                    return (
                      <span className="mini-day-slots">
                        {shiftTypes.map(shiftType => (
                          <span
                            key={shiftType.id}
                            role="button"
                            tabIndex={-1}
                            className={`mini-slot ${active.has(shiftType.id) ? 'on' : ''}`}
                            title={`${shiftType.name} ${shiftType.start}-${shiftType.end}`}
                            onClick={event => {
                              event.stopPropagation();
                              toggleDoctorEntry(selectedDoctor.id, date, shiftType.id);
                            }}
                          >
                            {shiftType.code}
                          </span>
                        ))}
                      </span>
                    );
                  }}
                />
              </div>
            )}
          </>
        )}
      </section>

      {/* ---------------- Turni pre-compilati ---------------- */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>
              Turni fissati
              {monthConfig.prefilledAssignments.length > 0 && (
                <span className="badge badge-primary">{monthConfig.prefilledAssignments.length}</span>
              )}
            </h3>
            <p className="hint">
              Assegnazioni decise a mano che la generazione non modifica.
            </p>
          </div>
          {monthConfig.prefilledAssignments.length > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => persist({ prefilledAssignments: [] })}
            >
              Rimuovi tutti
            </button>
          )}
        </div>

        <PrefilledGrid
          year={year}
          month={month}
          rooms={rooms}
          doctors={doctors}
          shiftTypes={shiftTypeIndex}
          assignments={monthConfig.prefilledAssignments}
          onChange={assignments => persist({ prefilledAssignments: assignments })}
        />
      </section>
    </div>
  );
}
