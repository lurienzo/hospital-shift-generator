import { useMemo, useState } from 'react';
import { Doctor, OperativeRoom, ScheduleVersion, TimeSlot, TIME_SLOT_HOURS, TIME_SLOTS, getMonthKey } from '../models/types';
import { StorageService } from '../services/StorageService';
import { ScheduleGeneratorService } from '../services/ScheduleGeneratorService';
import './GeneralStats.css';

interface GeneralStatsProps {
  doctors: Doctor[];
  rooms: OperativeRoom[];
}

interface AggregatedDoctorStats {
  doctorId: string;
  doctorName: string;
  doctorColor: string;
  totalShifts: number;
  totalHours: number;
  distinctDays: number;
  weekendShifts: number;
  criticalShifts: number;
  shiftsByRoom: Record<string, number>;
  shiftsByTimeSlot: Record<TimeSlot, number>;
  shiftsByMonth: Record<string, number>;
}

type SortColumn = 'name' | 'shifts' | 'hours' | 'days' | 'weekend' | 'critical' | 'morning' | 'afternoon' | 'night' | string;
type SortDirection = 'asc' | 'desc';

type BalanceMetric = 
  | 'total' 
  | 'morning' 
  | 'afternoon' 
  | 'night' 
  | 'weekend' 
  | 'critical' 
  | `room-${string}` 
  | `month-${string}`;

const monthNames = [
  'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu',
  'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic',
];

const monthNamesFull = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

export function GeneralStats({ doctors, rooms }: GeneralStatsProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('shifts');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [balanceMetric, setBalanceMetric] = useState<BalanceMetric>('total');

  const activeVersions = useMemo(() => {
    return StorageService.getAllActiveVersions();
  }, []);

  const activeVersionsForYear = useMemo(() => {
    return activeVersions.filter(v => v.schedule.year === selectedYear);
  }, [activeVersions, selectedYear]);

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    activeVersions.forEach(v => years.add(v.schedule.year));
    if (years.size === 0) {
      years.add(new Date().getFullYear());
    }
    return Array.from(years).sort();
  }, [activeVersions]);

  const aggregatedStats = useMemo((): AggregatedDoctorStats[] => {
    const doctorStatsMap = new Map<string, AggregatedDoctorStats>();

    // Initialize stats for all doctors
    for (const doctor of doctors) {
      doctorStatsMap.set(doctor.id, {
        doctorId: doctor.id,
        doctorName: doctor.name,
        doctorColor: doctor.color,
        totalShifts: 0,
        totalHours: 0,
        distinctDays: 0,
        weekendShifts: 0,
        criticalShifts: 0,
        shiftsByRoom: {},
        shiftsByTimeSlot: {
          '08:00-14:00': 0,
          '14:00-20:00': 0,
          '20:00-08:00': 0,
        },
        shiftsByMonth: {},
      });

      // Initialize room counts
      for (const room of rooms) {
        doctorStatsMap.get(doctor.id)!.shiftsByRoom[room.id] = 0;
      }
    }

    // Build set of critical slots
    const criticalSlots = new Set<string>();
    for (const room of rooms) {
      for (const slot of room.slots) {
        if (slot.isCritical) {
          criticalSlots.add(`${room.id}-${slot.timeSlot}`);
        }
      }
    }

    // Aggregate stats from all active versions for the selected year
    const allDaysWorked = new Map<string, Set<string>>(); // doctorId -> Set of dates

    for (const version of activeVersionsForYear) {
      const { schedule } = version;
      const monthKey = getMonthKey(schedule.year, schedule.month);

      for (const assignment of schedule.assignments) {
        const stats = doctorStatsMap.get(assignment.doctorId);
        if (!stats) continue;

        stats.totalShifts++;
        stats.totalHours += TIME_SLOT_HOURS[assignment.timeSlot];

        // Track distinct days
        if (!allDaysWorked.has(assignment.doctorId)) {
          allDaysWorked.set(assignment.doctorId, new Set());
        }
        allDaysWorked.get(assignment.doctorId)!.add(assignment.date);

        // Weekend shifts
        const date = new Date(assignment.date);
        if (date.getDay() === 0 || date.getDay() === 6) {
          stats.weekendShifts++;
        }

        // Critical shifts
        if (criticalSlots.has(`${assignment.roomId}-${assignment.timeSlot}`)) {
          stats.criticalShifts++;
        }

        // By room
        if (stats.shiftsByRoom[assignment.roomId] !== undefined) {
          stats.shiftsByRoom[assignment.roomId]++;
        }

        // By time slot
        stats.shiftsByTimeSlot[assignment.timeSlot]++;

        // By month
        if (!stats.shiftsByMonth[monthKey]) {
          stats.shiftsByMonth[monthKey] = 0;
        }
        stats.shiftsByMonth[monthKey]++;
      }
    }

    // Update distinct days
    for (const [doctorId, days] of allDaysWorked) {
      const stats = doctorStatsMap.get(doctorId);
      if (stats) {
        stats.distinctDays = days.size;
      }
    }

    return Array.from(doctorStatsMap.values());
  }, [doctors, rooms, activeVersionsForYear]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const getSortIndicator = (column: SortColumn) => {
    if (sortColumn !== column) return '';
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  };

  const sortedStats = useMemo(() => {
    return [...aggregatedStats].sort((a, b) => {
      let comparison = 0;
      
      switch (sortColumn) {
        case 'name':
          comparison = a.doctorName.localeCompare(b.doctorName);
          break;
        case 'shifts':
          comparison = a.totalShifts - b.totalShifts;
          break;
        case 'hours':
          comparison = a.totalHours - b.totalHours;
          break;
        case 'days':
          comparison = a.distinctDays - b.distinctDays;
          break;
        case 'weekend':
          comparison = a.weekendShifts - b.weekendShifts;
          break;
        case 'critical':
          comparison = a.criticalShifts - b.criticalShifts;
          break;
        case 'morning':
          comparison = a.shiftsByTimeSlot['08:00-14:00'] - b.shiftsByTimeSlot['08:00-14:00'];
          break;
        case 'afternoon':
          comparison = a.shiftsByTimeSlot['14:00-20:00'] - b.shiftsByTimeSlot['14:00-20:00'];
          break;
        case 'night':
          comparison = a.shiftsByTimeSlot['20:00-08:00'] - b.shiftsByTimeSlot['20:00-08:00'];
          break;
        default:
          // Room-specific sorting
          if (sortColumn.startsWith('room-')) {
            const roomId = sortColumn.replace('room-', '');
            comparison = (a.shiftsByRoom[roomId] || 0) - (b.shiftsByRoom[roomId] || 0);
          } else if (sortColumn.startsWith('month-')) {
            const monthKey = sortColumn.replace('month-', '');
            comparison = (a.shiftsByMonth[monthKey] || 0) - (b.shiftsByMonth[monthKey] || 0);
          }
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [aggregatedStats, sortColumn, sortDirection]);

  // Calculate totals and averages for summary
  const summary = useMemo(() => {
    const totalShifts = aggregatedStats.reduce((sum, s) => sum + s.totalShifts, 0);
    const totalHours = aggregatedStats.reduce((sum, s) => sum + s.totalHours, 0);
    const avgShifts = doctors.length > 0 ? totalShifts / doctors.length : 0;
    const avgHours = doctors.length > 0 ? totalHours / doctors.length : 0;
    
    const shiftVariance = doctors.length > 0
      ? Math.sqrt(aggregatedStats.reduce((sum, s) => sum + Math.pow(s.totalShifts - avgShifts, 2), 0) / doctors.length)
      : 0;

    return { totalShifts, totalHours, avgShifts, avgHours, shiftVariance };
  }, [aggregatedStats, doctors.length]);

  // Get months covered for the selected year
  const monthsCovered = useMemo(() => {
    return activeVersionsForYear.map(v => v.schedule.month).sort((a, b) => a - b);
  }, [activeVersionsForYear]);

  if (doctors.length === 0) {
    return (
      <div className="general-stats">
        <div className="empty-state">
          <div className="empty-icon">👨‍⚕️</div>
          <h2>Nessun dottore configurato</h2>
          <p>Aggiungi almeno un dottore nella sezione "Dottori" per visualizzare le statistiche.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="general-stats">
      <div className="stats-header">
        <div className="stats-title">
          <h2>📊 Statistiche Generali</h2>
          <p>Aggregazione delle statistiche basata sulle versioni attive di ciascun mese</p>
        </div>
        <div className="year-selector">
          <label>Anno</label>
          <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}>
            {availableYears.map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="months-coverage">
        <h3>📅 Mesi con versioni attive ({selectedYear})</h3>
        <div className="months-grid">
          {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
            const version = activeVersionsForYear.find(v => v.schedule.month === month);
            const isActive = !!version;
            return (
              <div 
                key={month} 
                className={`month-chip ${isActive ? 'active' : 'inactive'}`}
                title={version ? `${version.name} - Creato: ${new Date(version.createdAt).toLocaleDateString('it-IT')}` : 'Nessuna versione attiva'}
              >
                <span className="month-name">{monthNames[month - 1]}</span>
                {isActive && <span className="check-icon">✓</span>}
              </div>
            );
          })}
        </div>
        {monthsCovered.length === 0 && (
          <p className="no-months-warning">
            ⚠️ Nessuna versione attiva per {selectedYear}. Genera e salva calendari per vedere le statistiche.
          </p>
        )}
      </div>

      {monthsCovered.length > 0 && (
        <>
          <div className="summary-cards">
            <div className="summary-card">
              <span className="card-value">{summary.totalShifts}</span>
              <span className="card-label">Turni Totali</span>
            </div>
            <div className="summary-card">
              <span className="card-value">{summary.totalHours}</span>
              <span className="card-label">Ore Totali</span>
            </div>
            <div className="summary-card">
              <span className="card-value">{summary.avgShifts.toFixed(1)}</span>
              <span className="card-label">Media Turni/Dottore</span>
            </div>
            <div className="summary-card">
              <span className="card-value">{summary.avgHours.toFixed(1)}</span>
              <span className="card-label">Media Ore/Dottore</span>
            </div>
            <div className="summary-card">
              <span className="card-value">{summary.shiftVariance.toFixed(2)}</span>
              <span className="card-label">Deviazione Std Turni</span>
            </div>
            <div className="summary-card">
              <span className="card-value">{monthsCovered.length}</span>
              <span className="card-label">Mesi Attivi</span>
            </div>
          </div>

          <div className="stats-table-container">
            <table className="stats-table">
              <thead>
                <tr>
                  <th 
                    className="sortable sticky-col"
                    onClick={() => handleSort('name')}
                  >
                    Dottore{getSortIndicator('name')}
                  </th>
                  <th className="sortable" onClick={() => handleSort('shifts')}>
                    Turni{getSortIndicator('shifts')}
                  </th>
                  <th className="sortable" onClick={() => handleSort('hours')}>
                    Ore{getSortIndicator('hours')}
                  </th>
                  <th className="sortable" onClick={() => handleSort('days')}>
                    Giorni{getSortIndicator('days')}
                  </th>
                  <th className="sortable separator-left" onClick={() => handleSort('weekend')}>
                    🗓️ Weekend{getSortIndicator('weekend')}
                  </th>
                  <th className="sortable" onClick={() => handleSort('critical')}>
                    ⚡ Critici{getSortIndicator('critical')}
                  </th>
                  <th className="sortable separator-left timeslot-header" onClick={() => handleSort('morning')}>
                    🌅 Matt{getSortIndicator('morning')}
                  </th>
                  <th className="sortable timeslot-header" onClick={() => handleSort('afternoon')}>
                    🌇 Pom{getSortIndicator('afternoon')}
                  </th>
                  <th className="sortable timeslot-header" onClick={() => handleSort('night')}>
                    🌙 Notte{getSortIndicator('night')}
                  </th>
                  {rooms.map(room => (
                    <th 
                      key={room.id} 
                      className="sortable separator-left"
                      onClick={() => handleSort(`room-${room.id}`)}
                      style={{ borderTopColor: room.color }}
                    >
                      {room.name.substring(0, 6)}{getSortIndicator(`room-${room.id}`)}
                    </th>
                  ))}
                  {monthsCovered.map(month => (
                    <th
                      key={month}
                      className="sortable separator-left month-col"
                      onClick={() => handleSort(`month-${selectedYear}-${month}`)}
                    >
                      {monthNames[month - 1]}{getSortIndicator(`month-${selectedYear}-${month}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedStats.map(stat => (
                  <tr key={stat.doctorId}>
                    <td className="doctor-name-cell sticky-col">
                      <span 
                        className="doctor-color-dot" 
                        style={{ backgroundColor: stat.doctorColor }}
                      ></span>
                      {stat.doctorName}
                    </td>
                    <td className="numeric">{stat.totalShifts}</td>
                    <td className="numeric">{stat.totalHours}</td>
                    <td className="numeric">{stat.distinctDays}</td>
                    <td className="numeric separator-left">{stat.weekendShifts}</td>
                    <td className="numeric">{stat.criticalShifts}</td>
                    <td className="numeric separator-left">{stat.shiftsByTimeSlot['08:00-14:00']}</td>
                    <td className="numeric">{stat.shiftsByTimeSlot['14:00-20:00']}</td>
                    <td className="numeric">{stat.shiftsByTimeSlot['20:00-08:00']}</td>
                    {rooms.map(room => (
                      <td key={room.id} className="numeric separator-left">
                        {stat.shiftsByRoom[room.id] || 0}
                      </td>
                    ))}
                    {monthsCovered.map(month => {
                      const monthKey = `${selectedYear}-${month}`;
                      return (
                        <td key={month} className="numeric separator-left month-col">
                          {stat.shiftsByMonth[monthKey] || 0}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="balance-analysis">
            <div className="balance-header">
              <h3>📈 Analisi Bilanciamento</h3>
              <div className="balance-metric-selectors">
                <div className="metric-group">
                  <span className="metric-group-label">Fascia Oraria</span>
                  <div className="metric-buttons">
                    <button
                      className={`metric-btn ${balanceMetric === 'total' ? 'active' : ''}`}
                      onClick={() => setBalanceMetric('total')}
                    >
                      📊 Totale
                    </button>
                    <button
                      className={`metric-btn ${balanceMetric === 'morning' ? 'active' : ''}`}
                      onClick={() => setBalanceMetric('morning')}
                    >
                      🌅 Matt
                    </button>
                    <button
                      className={`metric-btn ${balanceMetric === 'afternoon' ? 'active' : ''}`}
                      onClick={() => setBalanceMetric('afternoon')}
                    >
                      🌇 Pom
                    </button>
                    <button
                      className={`metric-btn ${balanceMetric === 'night' ? 'active' : ''}`}
                      onClick={() => setBalanceMetric('night')}
                    >
                      🌙 Notte
                    </button>
                  </div>
                </div>
                
                <div className="metric-group">
                  <span className="metric-group-label">Weekend / Critici</span>
                  <div className="metric-buttons">
                    <button
                      className={`metric-btn ${balanceMetric === 'weekend' ? 'active' : ''}`}
                      onClick={() => setBalanceMetric('weekend')}
                    >
                      🗓️ Weekend
                    </button>
                    <button
                      className={`metric-btn ${balanceMetric === 'critical' ? 'active' : ''}`}
                      onClick={() => setBalanceMetric('critical')}
                    >
                      ⚡ Critici
                    </button>
                  </div>
                </div>
                
                <div className="metric-group">
                  <span className="metric-group-label">Sale Operative</span>
                  <div className="metric-buttons metric-buttons-wrap">
                    {rooms.map(room => (
                      <button
                        key={room.id}
                        className={`metric-btn ${balanceMetric === `room-${room.id}` ? 'active' : ''}`}
                        onClick={() => setBalanceMetric(`room-${room.id}`)}
                        style={{ 
                          borderColor: balanceMetric === `room-${room.id}` ? room.color : undefined,
                          backgroundColor: balanceMetric === `room-${room.id}` ? `${room.color}20` : undefined
                        }}
                      >
                        <span className="room-color-indicator" style={{ backgroundColor: room.color }}></span>
                        {room.name.substring(0, 8)}
                      </button>
                    ))}
                  </div>
                </div>
                
                {monthsCovered.length > 1 && (
                  <div className="metric-group">
                    <span className="metric-group-label">Mesi</span>
                    <div className="metric-buttons metric-buttons-wrap">
                      {monthsCovered.map(month => (
                        <button
                          key={month}
                          className={`metric-btn ${balanceMetric === `month-${selectedYear}-${month}` ? 'active' : ''}`}
                          onClick={() => setBalanceMetric(`month-${selectedYear}-${month}`)}
                        >
                          {monthNames[month - 1]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            <div className="balance-charts">
              {(() => {
                const getValue = (stat: AggregatedDoctorStats): number => {
                  if (balanceMetric === 'total') return stat.totalShifts;
                  if (balanceMetric === 'morning') return stat.shiftsByTimeSlot['08:00-14:00'];
                  if (balanceMetric === 'afternoon') return stat.shiftsByTimeSlot['14:00-20:00'];
                  if (balanceMetric === 'night') return stat.shiftsByTimeSlot['20:00-08:00'];
                  if (balanceMetric === 'weekend') return stat.weekendShifts;
                  if (balanceMetric === 'critical') return stat.criticalShifts;
                  if (balanceMetric.startsWith('room-')) {
                    const roomId = balanceMetric.replace('room-', '');
                    return stat.shiftsByRoom[roomId] || 0;
                  }
                  if (balanceMetric.startsWith('month-')) {
                    const monthKey = balanceMetric.replace('month-', '');
                    return stat.shiftsByMonth[monthKey] || 0;
                  }
                  return stat.totalShifts;
                };

                const values = aggregatedStats.map(getValue);
                const maxValue = Math.max(...values);
                const avgValue = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
                
                const getMetricLabel = (): string => {
                  if (balanceMetric === 'total') return 'Turni Totali';
                  if (balanceMetric === 'morning') return 'Turni Mattina';
                  if (balanceMetric === 'afternoon') return 'Turni Pomeriggio';
                  if (balanceMetric === 'night') return 'Turni Notte';
                  if (balanceMetric === 'weekend') return 'Turni Weekend';
                  if (balanceMetric === 'critical') return 'Turni Critici';
                  if (balanceMetric.startsWith('room-')) {
                    const roomId = balanceMetric.replace('room-', '');
                    const room = rooms.find(r => r.id === roomId);
                    return room ? `Turni ${room.name}` : 'Turni Sala';
                  }
                  if (balanceMetric.startsWith('month-')) {
                    const parts = balanceMetric.replace('month-', '').split('-');
                    const monthNum = parseInt(parts[1]);
                    return `Turni ${monthNamesFull[monthNum - 1]}`;
                  }
                  return 'Turni';
                };

                const sortedByMetric = [...sortedStats].sort((a, b) => getValue(b) - getValue(a));

                return (
                  <>
                    <div className="balance-metric-label">{getMetricLabel()} — Media: {avgValue.toFixed(1)}</div>
                    {sortedByMetric.map(stat => {
                      const value = getValue(stat);
                      const percentage = maxValue > 0 ? (value / maxValue) * 100 : 0;
                      const deviation = value - avgValue;
                      const deviationClass = Math.abs(deviation) <= 1 ? 'balanced' : deviation > 0 ? 'high' : 'low';
                      
                      return (
                        <div key={stat.doctorId} className="balance-bar-row">
                          <span 
                            className="bar-doctor-name"
                            style={{ color: stat.doctorColor }}
                          >
                            {stat.doctorName}
                          </span>
                          <div className="bar-container">
                            <div 
                              className={`bar-fill ${deviationClass}`}
                              style={{ 
                                width: `${percentage}%`,
                                backgroundColor: stat.doctorColor,
                              }}
                            ></div>
                            <span className="bar-value">{value}</span>
                          </div>
                          <span className={`deviation ${deviationClass}`}>
                            {deviation > 0 ? '+' : ''}{deviation.toFixed(1)}
                          </span>
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

