import { useMemo, useState } from 'react';
import { DoctorStats } from '../models/types';
import { StatColumn, statsComparator, summarizeColumns } from '../domain/stats';
import './StatsTable.css';

interface StatsTableProps {
  stats: DoctorStats[];
  columns: StatColumn[];
  /** Colonna su cui ordinare all'apertura. */
  defaultSort?: string;
  /** Righe di totale, media e deviazione standard in fondo. */
  showSummary?: boolean;
}

type SortDirection = 'asc' | 'desc';

/**
 * Tabella delle statistiche per dottore, usata sia nel calendario mensile sia
 * nelle statistiche generali. Le colonne arrivano da `buildStatColumns`, così
 * sale, fasce orarie e mesi configurabili non richiedono modifiche qui.
 */
export function StatsTable({
  stats,
  columns,
  defaultSort = 'shifts',
  showSummary = true,
}: StatsTableProps) {
  const [sortKey, setSortKey] = useState<string>(defaultSort);
  const [direction, setDirection] = useState<SortDirection>('desc');

  const summary = useMemo(() => summarizeColumns(stats, columns), [stats, columns]);

  const sorted = useMemo(() => {
    if (sortKey === 'name') {
      return [...stats].sort((a, b) =>
        (direction === 'asc' ? 1 : -1) * a.doctorName.localeCompare(b.doctorName, 'it'));
    }
    const column = columns.find(candidate => candidate.key === sortKey);
    return [...stats].sort(statsComparator(column, direction));
  }, [stats, columns, sortKey, direction]);

  const toggleSort = (key: string) => {
    if (key === sortKey) {
      setDirection(current => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setDirection(key === 'name' ? 'asc' : 'desc');
  };

  const indicator = (key: string) => (sortKey === key ? (direction === 'asc' ? ' ↑' : ' ↓') : '');

  const format = (column: StatColumn, value: number) =>
    column.format ? column.format(value) : String(value);

  if (stats.length === 0) {
    return <p className="hint">Nessun dottore configurato.</p>;
  }

  return (
    <div className="table-scroll stats-table-scroll">
      <table className="table stats-table">
        <thead>
          <tr>
            <th
              className="sortable sticky-left name-col"
              onClick={() => toggleSort('name')}
              aria-sort={sortKey === 'name' ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
            >
              Dottore{indicator('name')}
            </th>
            {columns.map(column => (
              <th
                key={column.key}
                className={`sortable num ${column.startsGroup ? 'group-start' : ''}`}
                title={column.title}
                style={column.color ? { boxShadow: `inset 0 -2px 0 ${column.color}` } : undefined}
                onClick={() => toggleSort(column.key)}
                aria-sort={
                  sortKey === column.key
                    ? (direction === 'asc' ? 'ascending' : 'descending')
                    : 'none'
                }
              >
                <span className="col-label">{column.label}{indicator(column.key)}</span>
                {column.subLabel && <span className="col-sublabel">{column.subLabel}</span>}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {sorted.map(stat => (
            <tr key={stat.doctorId}>
              <td className="sticky-left name-col">
                <span className="row-name">
                  <span className="dot" style={{ background: stat.doctorColor }} />
                  {stat.doctorName}
                </span>
              </td>
              {columns.map(column => {
                const value = column.value(stat);
                return (
                  <td
                    key={column.key}
                    className={`num ${column.startsGroup ? 'group-start' : ''} ${value === 0 ? 'zero' : ''}`}
                  >
                    {format(column, value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>

        {showSummary && (
          <tfoot>
            <tr className="totals">
              <td className="sticky-left name-col row-label">Totale</td>
              {columns.map(column => (
                <td key={column.key} className={`num ${column.startsGroup ? 'group-start' : ''}`}>
                  {format(column, summary[column.key].total)}
                </td>
              ))}
            </tr>
            <tr className="averages">
              <td className="sticky-left name-col row-label">Media</td>
              {columns.map(column => (
                <td key={column.key} className={`num ${column.startsGroup ? 'group-start' : ''}`}>
                  {summary[column.key].average.toFixed(1)}
                </td>
              ))}
            </tr>
            <tr className="stddev">
              <td className="sticky-left name-col row-label" title="Deviazione standard: più bassa, più equa la distribuzione">
                Dev. std
              </td>
              {columns.map(column => (
                <td key={column.key} className={`num ${column.startsGroup ? 'group-start' : ''}`}>
                  {summary[column.key].stdDev.toFixed(2)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
