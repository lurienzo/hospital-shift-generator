import { useMemo, useState } from 'react';
import { analyzeSchedule, blockStart, countDays } from '../domain/analysis';
import { buildContext } from '../domain/context';
import { MONTH_NAMES, parseMonthKey } from '../domain/dates';
import { emptyTally, sumTally, type Tally } from '../domain/fairness';
import { activeAssignments } from '../domain/context';
import { useMonthView } from '../store/month';
import { setUi, useStore } from '../store/store';
import { Seg } from '../ui/kit';
import { Topbar } from '../ui/Topbar';

interface Row {
  doctorId: string;
  name: string;
  color: string;
  tally: Tally;
  expected: Tally | null;
  riposi: number;
  desOk: number;
  desTot: number;
  nnOk: number;
  nnTot: number;
  ferie: number;
  assenze: number;
  months: number;
  /** Diurnismo: per tipo di turno, settimane distinte (area|inizio settimana) e giorni. */
  blocks: Record<string, { weeks: Set<string>; days: number }>;
}

type Scope = 'month' | 'all';

const COLS: { key: keyof Omit<Tally, 'byShift' | 'byArea'>; label: string; title: string }[] = [
  { key: 'total', label: 'Turni', title: 'Turni totali' },
  { key: 'hours', label: 'Ore', title: 'Ore totali' },
  { key: 'nights', label: 'Notti', title: 'Notti' },
  { key: 'weekends', label: 'Weekend', title: 'Turni di sabato, domenica o festivo' },
  { key: 'holidays', label: 'Festivi', title: 'di cui festivi' },
  { key: 'critical', label: 'Critici', title: 'Turni critici' },
];

type SortDir = 'asc' | 'desc';
interface Sort { key: string; dir: SortDir }

/**
 * Ordinamento cliccando le intestazioni: il primo clic su un numero mette in
 * cima chi ne ha di piu, il secondo inverte; sul nome si parte dalla A.
 */
function useSort(initial: Sort | null = null) {
  const [sort, setSort] = useState<Sort | null>(initial);
  const toggle = (key: string, firstDir: SortDir = 'desc') =>
    setSort(s => (s?.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: firstDir }));
  const apply = <T,>(rows: T[], value: (row: T, key: string) => number | string): T[] => {
    if (!sort) return rows;
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = value(a, sort.key), y = value(b, sort.key);
      const c = typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y), 'it') : x - y;
      return c * sign;
    });
  };
  return { sort, toggle, apply };
}

function SortTh({ k, sort, onSort, className, title, firstDir, children }: {
  k: string; sort: Sort | null; onSort: (key: string, firstDir?: SortDir) => void;
  className?: string; title?: string; firstDir?: SortDir; children: React.ReactNode;
}) {
  const on = sort?.key === k;
  return (
    <th className={`${className ?? ''} sortable ${on ? 'sorted' : ''}`} title={title ? `${title} · clicca per ordinare` : 'Clicca per ordinare'}
      aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="th-sort" onClick={() => onSort(k, firstDir)}>
        <span className="th-label">{children}</span><span className="sort-arrow" aria-hidden>{on ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

/** Valore di una riga per una colonna ordinabile. */
function rowValue(r: Row, key: string): number | string {
  if (key === 'name') return r.name;
  if (key.startsWith('block:')) { const b = r.blocks[key.slice(6)]; return b ? b.weeks.size * 1000 + b.days : 0; }
  if (key.startsWith('shift:')) return r.tally.byShift[key.slice(6)] ?? 0;
  if (key.startsWith('area:')) return r.tally.byArea[key.slice(5)] ?? 0;
  switch (key) {
    case 'riposi': return r.riposi;
    case 'ferie': return r.ferie;
    case 'assenze': return r.assenze;
    // Desiderate e no notte: prima chi ne ha avute di piu non rispettate.
    case 'des': return (r.desTot - r.desOk) * 1000 + r.desTot;
    case 'nn': return (r.nnTot - r.nnOk) * 1000 + r.nnTot;
    default: return (r.tally as unknown as Record<string, number>)[key] ?? 0;
  }
}

export function StatsPage() {
  const view = useMonthView();
  const config = useStore(s => s.config)!;
  const months = useStore(s => s.months);
  const [scope, setScope] = useState<Scope>('month');
  const [showDelta, setShowDelta] = useState(true);
  const { sort, toggle, apply } = useSort();
  const allKeys = useMemo(() => {
    const set = new Set(Object.entries(months).filter(([, m]) => m.activeVersionId).map(([k]) => k));
    if (view.version) set.add(view.key);
    return [...set].sort();
  }, [months, view.version, view.key]);

  const rows = useMemo<Row[]>(() => {
    // "Tutti i calendari": ogni mese con una versione definitiva, piu il mese aperto.
    const keys = scope === 'month' ? [view.key] : allKeys;
    const map = new Map<string, Row>(config.doctors.filter(d => d.active).map(d => [d.id, {
      doctorId: d.id, name: d.name, color: d.color, tally: emptyTally(), expected: null, riposi: 0, desOk: 0, desTot: 0, nnOk: 0, nnTot: 0, ferie: 0, assenze: 0, months: 0, blocks: {},
    }]));
    for (const key of keys) {
      const [y, m] = key.split('-').map(Number);
      const isCurrent = key === view.key;
      const assignments = isCurrent ? view.version?.assignments ?? null : activeAssignments(months[key]);
      if (!assignments) continue;
      const ctx = isCurrent && view.ctx ? view.ctx : buildContext({ config, year: y, month: m, months });
      const an = isCurrent && view.rawAnalysis ? view.rawAnalysis : analyzeSchedule(ctx, assignments);
      // Diurnismo: una settimana a cavallo di due mesi resta una sola.
      for (const a of assignments) {
        const shift = config.shiftTypes.find(s => s.id === a.shiftId);
        const row = map.get(a.doctorId);
        if (!shift?.block || !row) continue;
        const b = row.blocks[shift.id] ??= { weeks: new Set(), days: 0 };
        b.weeks.add(`${a.areaId}|${blockStart(a.date, shift.block.startWeekday)}`);
        b.days++;
      }
      for (const [docId, ev] of an.perDoctor) {
        const row = map.get(docId);
        if (!row) continue;
        sumTally(row.tally, ev.tally);
        row.months++;
        row.riposi += countDays(an.issues, 'riposo', docId);
        const req = Object.values(ctx.requests[docId] ?? {});
        const des = req.filter(c => c === 'D').length;
        row.desTot += des;
        row.desOk += des - countDays(an.issues, 'desiderata', docId);
        const nn = req.filter(c => c === 'N').length;
        row.nnTot += nn;
        row.nnOk += nn - countDays(an.issues, 'no-night', docId);
        row.ferie += req.filter(c => c === 'F').length;
        row.assenze += req.filter(c => c === 'A').length;
      }
      if (scope === 'month' && isCurrent && view.ctx) {
        for (const row of map.values()) {
          const f = view.ctx.fair.get(row.doctorId);
          if (!f) continue;
          const e = emptyTally();
          sumTally(e, f.expected);
          sumTally(e, f.histActual, -1);
          row.expected = e;
        }
      }
    }
    if (scope === 'all' && keys.length > 0) {
      // Quota attesa su tutto lo storico: contesto dell'ultimo mese con equita
      // calcolata su tutti i mesi definitivi precedenti.
      const last = parseMonthKey(keys[keys.length - 1]);
      const allConfig = { ...config, rules: { ...config.rules, fairnessWindow: 'all' as const } };
      const ctxAll = buildContext({ config: allConfig, year: last.year, month: last.month, months });
      for (const row of map.values()) row.expected = ctxAll.fair.get(row.doctorId)?.expected ?? null;
    }
    return [...map.values()];
  }, [scope, view, config, months, allKeys]);

  const blockShifts = config.shiftTypes.filter(s => s.block);
  const max = (k: keyof Omit<Tally, 'byShift' | 'byArea'>) => Math.max(1, ...rows.map(r => r.tally[k]));
  const anyData = rows.some(r => r.tally.total > 0);
  const monthsLabel = allKeys.map(k => { const { year, month } = parseMonthKey(k); return `${MONTH_NAMES[month - 1].slice(0, 3)} ${String(year).slice(2)}`; }).join(', ');

  return (
    <>
      <Topbar title="Statistiche" month>
        <Seg value={scope} onChange={setScope} options={[{ value: 'month', label: 'Questo mese' }, { value: 'all', label: 'Tutti i calendari' }]} />
      </Topbar>
      <div className="content">
        <div className="row wrap">
          <p className="hint grow">
            {scope === 'month'
              ? `Versione “${view.version?.name ?? '—'}”. Lo scarto (+/−) confronta il fatto con la quota attesa, che tiene conto di ferie, part-time e del pregresso.`
              : `Tutti i calendari di questo servizio: la versione definitiva (★) di ogni mese, e per il mese aperto la versione che stai guardando. Mesi inclusi: ${monthsLabel || 'nessuno'}.`}
          </p>
          <label className="check small"><input type="checkbox" checked={showDelta} onChange={e => setShowDelta(e.target.checked)} /> Mostra scarto dall’atteso</label>
        </div>

        {!anyData ? (
          <div className="card empty">
            <h2>Nessun dato</h2>
            <p>{scope === 'month' ? 'Genera il calendario di questo mese.' : 'Rendi definitivo (★) almeno un mese dal Calendario.'}</p>
            <button className="btn" onClick={() => setUi({ page: 'calendar' })}>Vai al calendario</button>
          </div>
        ) : (
          <section className="card">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <SortTh k="name" sort={sort} onSort={toggle} firstDir="asc">Medico</SortTh>
                    {COLS.map(c => <SortTh key={c.key} k={c.key} sort={sort} onSort={toggle} className="r" title={c.title}>{c.label}</SortTh>)}
                    {blockShifts.map(s => <SortTh key={s.id} k={`block:${s.id}`} sort={sort} onSort={toggle} className="r" title={`${s.name}: settimane e giorni`}>{s.name}<span className="tiny muted" style={{ display: 'block', fontWeight: 500 }}>sett. · giorni</span></SortTh>)}
                    <SortTh k="riposi" sort={sort} onSort={toggle} className="r" title="Riposi post-notte saltati">Riposi saltati</SortTh>
                    <SortTh k="ferie" sort={sort} onSort={toggle} className="r" title="Giorni di ferie inseriti">Ferie</SortTh>
                    <SortTh k="assenze" sort={sort} onSort={toggle} className="r" title="Giorni di altre assenze inseriti">Assenze</SortTh>
                    <SortTh k="des" sort={sort} onSort={toggle} className="r" title="Desiderate rispettate / inserite (prima chi ne ha più non rispettate)">Desiderate</SortTh>
                    <SortTh k="nn" sort={sort} onSort={toggle} className="r" title="No notte rispettate / inserite (prima chi ne ha più non rispettate)">No notte</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {apply(rows, rowValue).map(r => (
                    <tr key={r.doctorId}>
                      <td><div className="row"><span className="color-dot" style={{ background: r.color }} /><b>{r.name}</b></div></td>
                      {COLS.map(c => {
                        const v = r.tally[c.key];
                        const exp = r.expected?.[c.key];
                        const d = exp === undefined ? null : v - exp;
                        const tol = c.key === 'hours' ? 6 : 0.75;
                        return (
                          <td key={c.key} className="r">
                            <div className="col" style={{ gap: 3, alignItems: 'flex-end' }}>
                              <span className="row" style={{ gap: 6 }}>
                                <span className="num" style={{ fontWeight: 600 }}>{Math.round(v * 10) / 10}</span>
                                {showDelta && d !== null && c.key !== 'critical' && (
                                  <span className={`delta ${Math.abs(d) < tol ? 'zero' : d > 0 ? 'pos' : 'neg'}`} title={`Atteso ${exp!.toFixed(1)}`}>
                                    {d > 0 ? '+' : d < 0 ? '−' : '±'}{Math.abs(d).toFixed(c.key === 'hours' ? 0 : 1)}
                                  </span>
                                )}
                              </span>
                              <span className="bar" style={{ width: 70 }}><div style={{ width: `${(v / max(c.key)) * 100}%` }} /></span>
                            </div>
                          </td>
                        );
                      })}
                      {blockShifts.map(s => {
                        const b = r.blocks[s.id];
                        return <td key={s.id} className="r num">{b ? <><b>{b.weeks.size}</b> <span className="muted">· {b.days} gg</span></> : <span className="faint">0</span>}</td>;
                      })}
                      <td className="r num" style={{ color: r.riposi ? 'var(--warn)' : undefined, fontWeight: 600 }}>{r.riposi}</td>
                      <td className="r num">{r.ferie || <span className="faint">0</span>}</td>
                      <td className="r num">{r.assenze || <span className="faint">0</span>}</td>
                      <td className="r num"><Ratio ok={r.desOk} tot={r.desTot} /></td>
                      <td className="r num"><Ratio ok={r.nnOk} tot={r.nnTot} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Totale</td>
                    {COLS.map(c => <td key={c.key} className="r num">{Math.round(rows.reduce((s, r) => s + r.tally[c.key], 0))}</td>)}
                    {blockShifts.map(s => (
                      <td key={s.id} className="r num">{rows.reduce((t, r) => t + (r.blocks[s.id]?.weeks.size ?? 0), 0)} · {rows.reduce((t, r) => t + (r.blocks[s.id]?.days ?? 0), 0)} gg</td>
                    ))}
                    <td className="r num">{rows.reduce((s, r) => s + r.riposi, 0)}</td>
                    <td className="r num">{rows.reduce((s, r) => s + r.ferie, 0)}</td>
                    <td className="r num">{rows.reduce((s, r) => s + r.assenze, 0)}</td>
                    <td className="r num">{rows.reduce((s, r) => s + r.desOk, 0)}/{rows.reduce((s, r) => s + r.desTot, 0)}</td>
                    <td className="r num">{rows.reduce((s, r) => s + r.nnOk, 0)}/{rows.reduce((s, r) => s + r.nnTot, 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        )}

        {anyData && <BreakdownCard rows={rows} />}
      </div>
    </>
  );
}

function BreakdownCard({ rows }: { rows: Row[] }) {
  const config = useStore(s => s.config)!;
  const [by, setBy] = useState<'shift' | 'area'>('shift');
  const { sort, toggle, apply } = useSort();
  const cols = by === 'shift' ? config.shiftTypes.map(s => ({ id: s.id, label: s.name, color: s.color })) : config.areas.map(a => ({ id: a.id, label: a.name, color: a.color }));
  return (
    <section className="card">
      <div className="card-head">
        <h2>Dettaglio</h2>
        <div className="spacer" />
        <Seg small value={by} onChange={setBy} options={[{ value: 'shift', label: 'Per turno' }, { value: 'area', label: 'Per area' }]} />
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <SortTh k="name" sort={sort} onSort={toggle} firstDir="asc">Medico</SortTh>
              {cols.map(c => (
                <SortTh key={c.id} k={`${by}:${c.id}`} sort={sort} onSort={toggle} className="r">
                  <span className="color-dot" style={{ background: c.color }} />{c.label}
                </SortTh>
              ))}
            </tr>
          </thead>
          <tbody>
            {apply(rows, rowValue).map(r => (
              <tr key={r.doctorId}>
                <td>{r.name}</td>
                {cols.map(c => {
                  const v = (by === 'shift' ? r.tally.byShift : r.tally.byArea)[c.id] ?? 0;
                  return <td key={c.id} className="r num">{v || <span className="faint">0</span>}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** "rispettate / inserite", in rosso se qualcuna non e stata rispettata. */
function Ratio({ ok, tot }: { ok: number; tot: number }) {
  if (tot === 0) return <span className="faint">—</span>;
  return <span style={{ color: ok < tot ? 'var(--info)' : 'var(--ok)', fontWeight: 600 }} title={`${ok} rispettate su ${tot} inserite`}>{ok}/{tot}</span>;
}
