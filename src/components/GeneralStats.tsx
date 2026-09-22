import { useMemo, useState } from 'react';
import { StorageService } from '../services/StorageService';
import { buildStatColumns, computeStats, standardDeviation } from '../domain/stats';
import { RoomSlotIndex } from '../domain/validation';
import { blockLabel } from '../domain/shiftTypes';
import { useConfig } from '../state/configContext';
import { StatsTable } from './StatsTable';
import { MONTH_NAMES, MONTH_NAMES_SHORT } from '../utils/date';
import './GeneralStats.css';

interface GeneralStatsProps {
  /** Cambia quando le versioni salvate sono state modificate. */
  revision: number;
}

/**
 * Statistiche aggregate sulle versioni attive di ciascun mese. Il calcolo usa
 * lo stesso motore della vista mensile, così i due non possono discordare.
 */
export function GeneralStats({ revision }: GeneralStatsProps) {
  const { rooms, doctors, shiftTypes, shiftTypeIndex } = useConfig();
  const [balanceMetric, setBalanceMetric] = useState<string>('shifts');

  const activeVersions = useMemo(
    () => StorageService.getAllActiveVersions(),
    // `revision` non compare nel calcolo ma ne invalida il risultato: i dati
    // vivono in localStorage, che React non osserva.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revision],
  );

  const availableYears = useMemo(() => {
    const years = new Set(activeVersions.map(version => version.schedule.year));
    if (years.size === 0) years.add(new Date().getFullYear());
    return [...years].sort((a, b) => a - b);
  }, [activeVersions]);

  const [selectedYear, setSelectedYear] = useState<number>(() => new Date().getFullYear());
  const year = availableYears.includes(selectedYear)
    ? selectedYear
    : availableYears[availableYears.length - 1];

  const versionsForYear = useMemo(
    () => activeVersions.filter(version => version.schedule.year === year),
    [activeVersions, year],
  );

  const monthsCovered = useMemo(
    () => versionsForYear.map(version => version.schedule.month).sort((a, b) => a - b),
    [versionsForYear],
  );

  const slotIndex = useMemo(() => new RoomSlotIndex(rooms), [rooms]);

  const stats = useMemo(
    () => computeStats(
      versionsForYear.map(version => version.schedule),
      { doctors, rooms, shiftTypes: shiftTypeIndex, slotIndex },
    ),
    [versionsForYear, doctors, rooms, shiftTypeIndex, slotIndex],
  );

  const columns = useMemo(
    () => buildStatColumns({
      rooms,
      shiftTypes,
      months: monthsCovered.map(month => ({ year, month })),
      includeCritical: stats.some(stat => stat.criticalShifts > 0),
    }),
    [rooms, shiftTypes, monthsCovered, year, stats],
  );

  const summary = useMemo(() => {
    const totalShifts = stats.reduce((sum, stat) => sum + stat.totalShifts, 0);
    const totalHours = stats.reduce((sum, stat) => sum + stat.totalHours, 0);
    const averageShifts = stats.length > 0 ? totalShifts / stats.length : 0;

    return {
      totalShifts,
      totalHours,
      averageShifts,
      averageHours: stats.length > 0 ? totalHours / stats.length : 0,
      deviation: standardDeviation(stats.map(stat => stat.totalShifts), averageShifts),
    };
  }, [stats]);

  const metric = columns.find(column => column.key === balanceMetric) ?? columns[0];

  const balance = useMemo(() => {
    if (!metric || stats.length === 0) return null;

    const values = stats.map(metric.value);
    const max = Math.max(...values, 1);
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;

    const rows = [...stats]
      .sort((a, b) => metric.value(b) - metric.value(a))
      .map(stat => {
        const value = metric.value(stat);
        return {
          stat,
          value,
          share: (value / max) * 100,
          deviation: value - average,
        };
      });

    return { rows, average };
  }, [metric, stats]);

  if (doctors.length === 0) {
    return (
      <div className="empty-state">
        <h2>Nessun dottore configurato</h2>
        <p>Aggiungi dei dottori per vedere le statistiche di questo servizio.</p>
      </div>
    );
  }

  return (
    <div className="general-stats stack">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Statistiche del servizio</h3>
            <p className="hint">
              Somma delle versioni attive di ciascun mese. Per includere un mese, rendi attiva
              una delle sue versioni dal calendario.
            </p>
          </div>
          <div className="field field-narrow">
            <label htmlFor="stats-year">Anno</label>
            <select
              id="stats-year"
              className="select"
              value={year}
              onChange={event => setSelectedYear(Number(event.target.value))}
            >
              {availableYears.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="months-coverage">
          {MONTH_NAMES_SHORT.map((name, index) => {
            const version = versionsForYear.find(
              candidate => candidate.schedule.month === index + 1);
            return (
              <span
                key={name}
                className={`month-mark ${version ? 'covered' : ''}`}
                title={version
                  ? `${version.name} — ${version.schedule.assignments.length} turni`
                  : `Nessuna versione attiva per ${MONTH_NAMES[index]}`}
              >
                {name}
              </span>
            );
          })}
        </div>

        {monthsCovered.length === 0 && (
          <p className="hint no-data">
            Nessuna versione attiva per il {year}. Genera e salva un calendario, poi rendilo
            attivo per vederlo qui.
          </p>
        )}
      </section>

      {monthsCovered.length > 0 && (
        <>
          <div className="stat-grid">
            <div className="stat-card tone-primary">
              <span className="value">{summary.totalShifts}</span>
              <span className="label">Turni totali</span>
            </div>
            <div className="stat-card">
              <span className="value">{summary.totalHours}</span>
              <span className="label">Ore totali</span>
            </div>
            <div className="stat-card">
              <span className="value">{summary.averageShifts.toFixed(1)}</span>
              <span className="label">Turni per dottore</span>
            </div>
            <div className="stat-card">
              <span className="value">{summary.averageHours.toFixed(1)}</span>
              <span className="label">Ore per dottore</span>
            </div>
            <div className="stat-card tone-info">
              <span className="value">{summary.deviation.toFixed(2)}</span>
              <span className="label">Dev. standard turni</span>
            </div>
            <div className="stat-card tone-accent">
              <span className="value">{monthsCovered.length}</span>
              <span className="label">Mesi considerati</span>
            </div>
          </div>

          {shiftTypeIndex.rotational.length > 0 && (
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h3>Fasce a rotazione</h3>
                  <p className="hint">
                    Quante volte ciascuno ha coperto un blocco intero. È qui che si vede se la
                    rotazione è equa: i valori dovrebbero essere vicini fra loro.
                  </p>
                </div>
              </div>

              <div className="rotation-summary">
                {shiftTypeIndex.rotational.map(shiftType => {
                  const values = stats.map(stat => stat.blocksByShiftType[shiftType.id] ?? 0);
                  const total = values.reduce((sum, value) => sum + value, 0);
                  const average = values.length > 0 ? total / values.length : 0;

                  return (
                    <div key={shiftType.id} className="rotation-card">
                      <div className="rotation-card-head">
                        <span className="dot" style={{ background: shiftType.color }} />
                        <strong>{shiftType.name}</strong>
                        <span className="hint">1 blocco = 1 {blockLabel(shiftType)}</span>
                      </div>

                      {total === 0 ? (
                        <p className="hint">Nessun blocco assegnato nel {year}.</p>
                      ) : (
                        <ul className="rotation-rows">
                          {[...stats]
                            .sort((a, b) =>
                              (b.blocksByShiftType[shiftType.id] ?? 0)
                              - (a.blocksByShiftType[shiftType.id] ?? 0))
                            .map(stat => {
                              const value = stat.blocksByShiftType[shiftType.id] ?? 0;
                              const difference = value - average;
                              return (
                                <li key={stat.doctorId}>
                                  <span className="rotation-name">
                                    <span className="dot" style={{ background: stat.doctorColor }} />
                                    {stat.doctorName}
                                  </span>
                                  <span className="rotation-blocks">
                                    {Array.from({ length: value }, (_, index) => (
                                      <span
                                        key={index}
                                        className="rotation-block"
                                        style={{ background: shiftType.color }}
                                      />
                                    ))}
                                    {value === 0 && <span className="rotation-none">—</span>}
                                  </span>
                                  <span className="rotation-value">{value}</span>
                                  <span className={`rotation-delta ${deviationClass(difference)}`}>
                                    {difference > 0 ? '+' : ''}{difference.toFixed(1)}
                                  </span>
                                </li>
                              );
                            })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-header">
              <h3>Dettaglio per dottore</h3>
            </div>
            <StatsTable stats={stats} columns={columns} />
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h3>Bilanciamento</h3>
                <p className="hint">
                  Scegli una metrica per vedere come è distribuita fra i dottori.
                </p>
              </div>
            </div>

            <div className="metric-picker">
              <button
                type="button"
                className={`metric-btn ${balanceMetric === 'shifts' ? 'active' : ''}`}
                onClick={() => setBalanceMetric('shifts')}
              >
                Turni totali
              </button>
              {columns
                .filter(column => column.key !== 'shifts' && column.group !== 'month')
                .map(column => (
                  <button
                    key={column.key}
                    type="button"
                    className={`metric-btn ${balanceMetric === column.key ? 'active' : ''}`}
                    style={column.color && balanceMetric === column.key
                      ? { borderColor: column.color, background: `${column.color}22` }
                      : undefined}
                    onClick={() => setBalanceMetric(column.key)}
                    title={column.title}
                  >
                    {column.color && (
                      <span className="dot" style={{ background: column.color }} />
                    )}
                    {column.label}
                    {column.subLabel && <span className="metric-unit">{column.subLabel}</span>}
                  </button>
                ))}
            </div>

            {balance && metric && (
              <div className="balance">
                <p className="hint balance-caption">
                  {metric.label}
                  {metric.subLabel ? ` (${metric.subLabel})` : ''} — media {balance.average.toFixed(1)}
                </p>

                {balance.rows.map(row => (
                  <div key={row.stat.doctorId} className="balance-row">
                    <span className="balance-name" style={{ color: row.stat.doctorColor }}>
                      {row.stat.doctorName}
                    </span>
                    <span className="balance-track">
                      <span
                        className="balance-fill"
                        style={{ width: `${row.share}%`, background: row.stat.doctorColor }}
                      />
                      <span className="balance-value">{row.value}</span>
                    </span>
                    <span className={`balance-delta ${deviationClass(row.deviation)}`}>
                      {row.deviation > 0 ? '+' : ''}{row.deviation.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** Classifica lo scarto dalla media: entro un turno è considerato equilibrato. */
function deviationClass(deviation: number): string {
  if (Math.abs(deviation) <= 1) return 'balanced';
  return deviation > 0 ? 'high' : 'low';
}
