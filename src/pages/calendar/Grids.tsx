// Griglie del calendario: per medico e per area, con i giorni in righe
// (predefinito) o in colonne. Le caselle si cliccano per modificare e i turni
// si trascinano per scambiarli o spostarli.

import { memo, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { countDays, issueTone, type Issue, type Tone } from '../../domain/analysis';
import { demandKey, type MonthContext } from '../../domain/context';
import { addDays, formatDay, parseIso, toIso, WEEKDAY_LETTER, WEEKDAY_SHORT, weekdayOf } from '../../domain/dates';
import type { Assignment, Doctor } from '../../domain/types';
import { shortName } from '../../io/excel';
import type { MonthView } from '../../store/month';
import { textOn } from '../../ui/color';
import { Popover } from '../../ui/kit';
import { UNIFORM, useColWidths, type ColWidths } from './colWidths';
import { useStore } from '../../store/store';
import { judge, setDragging, useDragging, type Verdict } from './dragCheck';
import { addSlot, dropOnDoctorDay, dropOnSlot, planDoctorDay, planSlot } from './ops';
import { areaColumns, buildGroups, shiftsInManyAreas, type AreaColumn, type GroupMode, type LineLabel } from './layout';
import { DoctorDayPopover, SlotPopover } from './Popovers';

export type Layout = 'rows' | 'cols';
type SlotRef = Pick<Assignment, 'date' | 'areaId' | 'shiftId'>;

const DRAG_TYPE = 'application/x-turni';

// --- Dati condivisi -------------------------------------------------------

function useGridData(view: MonthView) {
  const ctx = view.ctx!;
  const analysis = view.analysis;
  return useMemo(() => {
    const assignments = view.version?.assignments ?? [];
    const byDocDate = new Map<string, Assignment[]>();
    const byKey = new Map<string, Assignment[]>();
    for (const a of assignments) {
      const k1 = `${a.doctorId}|${a.date}`;
      (byDocDate.get(k1) ?? byDocDate.set(k1, []).get(k1)!).push(a);
      const k2 = demandKey(a.date, a.areaId, a.shiftId);
      (byKey.get(k2) ?? byKey.set(k2, []).get(k2)!).push(a);
    }
    const sevByAssignment = new Map<string, Set<Tone>>();
    const issuesByCell = new Map<string, Issue[]>();
    for (const i of analysis?.issues ?? []) {
      if (i.severity === 'info') continue;
      if (i.assignmentId) (sevByAssignment.get(i.assignmentId) ?? sevByAssignment.set(i.assignmentId, new Set()).get(i.assignmentId)!).add(issueTone(i));
      if (i.doctorId && i.date) {
        const k = `${i.doctorId}|${i.date}`;
        (issuesByCell.get(k) ?? issuesByCell.set(k, []).get(k)!).push(i);
      }
    }
    const missingByDate = new Map<string, { n: number; critical: number }>();
    for (const u of analysis?.uncovered ?? []) {
      const e = missingByDate.get(u.date) ?? { n: 0, critical: 0 };
      e.n += u.missing;
      if (u.critical) e.critical += u.missing;
      missingByDate.set(u.date, e);
    }
    const nightOn = (docId: string, date: string) =>
      byDocDate.get(`${docId}|${date}`)?.some(a => ctx.shifts.get(a.shiftId)?.night)
      ?? ctx.tailByDoctor.get(docId)?.some(a => a.date === date && ctx.shifts.get(a.shiftId)?.night) ?? false;
    return { assignments, byDocDate, byKey, sevByAssignment, issuesByCell, missingByDate, nightOn };
  }, [view.version, analysis, ctx]);
}

/** Classi dei segnali: bordo rosso per gli errori, pallino arancio (avvisi) e blu (desiderate). */
function toneClasses(sets: (Set<Tone> | undefined)[]): string {
  const all = new Set<Tone>();
  for (const s of sets) s?.forEach(t => all.add(t));
  return [all.has('error') && 'err', all.has('warning') && 'warn', all.has('desire') && 'des'].filter(Boolean).join(' ');
}

const dayClass = (d: string, holidays: Map<string, string>) => (holidays.has(d) ? 'hol' : weekdayOf(d) >= 5 ? 'we' : '');
const todayIso = () => { const d = new Date(); return toIso(d.getFullYear(), d.getMonth() + 1, d.getDate()); };

/** Gestori di trascinamento: evidenziano la casella senza ridisegnare la griglia. */
function dropHandlers(onDrop: (payload: string[]) => void) {
  return {
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } },
    onDragEnter: (e: DragEvent<HTMLElement>) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) e.currentTarget.classList.add('drop-over'); },
    onDragLeave: (e: DragEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) e.currentTarget.classList.remove('drop-over'); },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.currentTarget.classList.remove('drop-over');
      const raw = e.dataTransfer.getData(DRAG_TYPE);
      if (!raw) return;
      e.preventDefault();
      setDragging(null);
      onDrop(JSON.parse(raw) as string[]);
    },
  };
}

function dragSource(ids: string[]) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'move';
      // Dopo l'avvio del trascinamento, non durante: ridisegnare subito lo annullerebbe.
      setTimeout(() => setDragging(ids));
    },
    onDragEnd: () => setDragging(null),
  };
}

/** Velo sulla casella durante il trascinamento, con il motivo. */
function VerdictMark({ v }: { v?: Verdict | null }) {
  if (!v) return null;
  return <span className={`verdict ${v.level}`}>{v.short}</span>;
}

/** Bollino rosso di pericolo sui turni con un errore. */
const ErrMark = () => <span className="err-mark" title="Errore: clicca per vedere il motivo">!</span>;

const LockMark = () => (
  <span className="lock" title="Fissato: rigenerando non cambia">
    <svg width="7" height="7" viewBox="0 0 10 10"><rect x="1.5" y="4.5" width="7" height="5" rx="1" fill="currentColor" /><path d="M3 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" fill="none" strokeWidth="1.4" /></svg>
  </span>
);

/** Contenuto della casella medico × giorno. */
function DoctorDayContent({ ctx, items, req, smonto, riposo, sev }: {
  ctx: MonthContext; items: Assignment[]; req?: string; smonto: boolean; riposo: boolean; sev: Map<string, Set<Tone>>;
}) {
  const ambiguous = shiftsInManyAreas(ctx);
  if (items.length === 0) {
    if (req) return <span className={`mark req ${req}`}>{req}</span>;
    if (smonto) return <span className="mark smonto" title="Smonto">s</span>;
    if (riposo) return <span className="mark riposo" title="Riposo post-notte">r</span>;
    return null;
  }
  const sorted = [...items].sort((x, y) => (ctx.shifts.get(x.shiftId)?.interval[0] ?? 0) - (ctx.shifts.get(y.shiftId)?.interval[0] ?? 0));
  const sevOf = (list: Assignment[]) => toneClasses(list.map(a => sev.get(a.id)));
  const sameArea = sorted.every(a => a.areaId === sorted[0].areaId);
  const ids = sorted.map(a => a.id);
  if (sorted.length > 1 && sameArea) {
    // Lunga nella stessa area: un solo riquadro bicolore.
    const colors = sorted.map(a => ctx.shifts.get(a.shiftId)?.color ?? '#888');
    const stops = colors.map((c, i) => `${c} ${(i * 100) / colors.length}% ${((i + 1) * 100) / colors.length}%`).join(', ');
    return (
      <span {...dragSource(ids)} className={`shift-chip ${sevOf(sorted)}`} style={{ background: `linear-gradient(90deg, ${stops})` }}>
        {sorted.map(a => ctx.shifts.get(a.shiftId)?.code ?? '?').join('')}
        {sorted.some(a => ambiguous.has(a.shiftId)) && <span className="area">{shortName(ctx.areas.get(sorted[0].areaId)?.name ?? '')}</span>}
        {sorted.some(a => a.locked) && <LockMark />}
        {sevOf(sorted).includes('err') && <ErrMark />}
      </span>
    );
  }
  return (
    <>
      {sorted.map(a => {
        const sh = ctx.shifts.get(a.shiftId);
        return (
          <span key={a.id} {...dragSource(ids)} className={`shift-chip ${sorted.length > 1 ? 'half' : ''} ${sevOf([a])}`} style={{ background: sh?.color ?? '#888', color: textOn(sh?.color ?? '#888') }}>
            {sh?.code ?? '?'}
            {ambiguous.has(a.shiftId) && <span className="area">{shortName(ctx.areas.get(a.areaId)?.name ?? '')}</span>}
            {a.locked && <LockMark />}
            {sevOf([a]).includes('err') && <ErrMark />}
          </span>
        );
      })}
    </>
  );
}

function UncoveredBadge({ m, compact, onClick }: { m?: { n: number; critical: number }; compact?: boolean; onClick: (e: React.MouseEvent<HTMLElement>) => void }) {
  if (!m) return <span className="cover-ok" title="Tutto coperto">✓</span>;
  if (m.critical > 0) {
    return <button className="unc crit" onClick={onClick} title={`${m.critical} turni critici scoperti`}>‼ {m.n}{compact ? '' : m.n === 1 ? ' scoperto' : ' scoperti'}</button>;
  }
  return <button className="unc" onClick={onClick} title={`${m.n} turni scoperti`}>! {m.n}{compact ? '' : m.n === 1 ? ' scoperto' : ' scoperti'}</button>;
}

function DayLabel({ date, holidays }: { date: string; holidays: Map<string, string> }) {
  const wd = weekdayOf(date);
  const hol = holidays.get(date);
  return (
    <div className="day-label" title={hol}>
      <b className="num">{parseIso(date).day}</b>
      <span>{WEEKDAY_SHORT[wd]}</span>
      {hol && <span className="hol-name">{hol}</span>}
    </div>
  );
}

function DayHeaderCells({ dates, holidays, cw }: { dates: string[]; holidays: Map<string, string>; cw: ColWidths }) {
  const today = todayIso();
  return (
    <>
      {dates.map(d => {
        const wd = weekdayOf(d);
        const hol = holidays.get(d);
        return (
          <th key={d} data-day={d} className={`${hol ? 'hol' : wd >= 5 ? 'we' : ''} ${d === today ? 'today' : ''}`} title={hol}>
            <span className="d">{parseIso(d).day}</span><span className="w">{WEEKDAY_LETTER[wd]}</span>
            {cw.handle(UNIFORM)}
          </th>
        );
      })}
    </>
  );
}

// --- Vista per medico ---------------------------------------------------

export const DoctorGrid = memo(function DoctorGrid({ view, highlight, layout }: { view: MonthView; highlight: string | null; layout: Layout }) {
  const ctx = view.ctx!;
  const data = useGridData(view);
  const [pop, setPop] = useState<{ doctor: Doctor; date: string; anchor: DOMRect } | null>(null);
  const [dayPop, setDayPop] = useState<{ date: string; anchor: DOMRect } | null>(null);
  const today = todayIso();
  const dragIds = useDragging();
  const verdicts = useMemo(() => {
    const m = new Map<string, Verdict | null>();
    if (!dragIds || !view.version) return m;
    const list = view.version.assignments;
    for (const doc of ctx.doctors) {
      for (const date of ctx.dates) {
        m.set(`${doc.id}|${date}`, judge(ctx, list, planDoctorDay(ctx, list, dragIds, doc.id, date)));
      }
    }
    return m;
  }, [dragIds, view.version, ctx]);
  const cw = useColWidths(`doctor-${layout}`, layout === 'rows' ? { first: 88, unc: 104, minCol: 56 } : { first: 130, sum: 34, minCol: 26 });

  const cell = (doc: Doctor, date: string) => {
    const key = `${doc.id}|${date}`;
    const items = data.byDocDate.get(key) ?? [];
    const issues = data.issuesByCell.get(key);
    const v = verdicts.get(key);
    return (
      <td key={key} className={dayClass(date, ctx.holidays)}>
        <div className={`cal-cell ${highlight === key ? 'sel flash' : ''} ${issues?.some(i => i.severity === 'error') ? 'has-err' : ''}`}
          data-cell={key} title={v ? v.reason : issues?.map(i => i.message).join('\n')}
          onClick={e => setPop({ doctor: doc, date, anchor: e.currentTarget.getBoundingClientRect() })}
          {...dropHandlers(ids => dropOnDoctorDay(view, ids, doc.id, date))}>
          <DoctorDayContent ctx={ctx} items={items} req={ctx.requests[doc.id]?.[date]} sev={data.sevByAssignment}
            smonto={data.nightOn(doc.id, addDays(date, -1))} riposo={data.nightOn(doc.id, addDays(date, -2))} />
          <VerdictMark v={v} />
        </div>
      </td>
    );
  };

  const sums = (doc: Doctor) => {
    const ev = view.analysis?.perDoctor.get(doc.id);
    const fair = ctx.fair.get(doc.id);
    const nightsExp = fair ? fair.expected.nights - fair.histActual.nights : 0;
    const rs = view.analysis ? countDays(view.analysis.issues, 'riposo', doc.id) : 0;
    return [
      { label: 'Turni', short: 'T', value: ev?.tally.total ?? 0 },
      { label: 'Ore', short: 'Ore', value: Math.round(ev?.tally.hours ?? 0) },
      { label: 'Notti', short: 'N', value: ev?.tally.nights ?? 0, cls: ev && Math.abs(ev.tally.nights - nightsExp) >= 1.5 ? 'over' : '', title: `Atteso circa ${nightsExp.toFixed(1)}` },
      { label: 'Weekend', short: 'WE', value: ev?.tally.weekends ?? 0 },
      { label: 'Festivi', short: 'Fest', value: ev?.tally.holidays ?? 0 },
      { label: 'Riposi saltati', short: 'Rip✗', value: rs || '', cls: rs ? 'bad' : '' },
    ];
  };
  const sumLabels = sums(ctx.doctors[0] ?? ({ id: '' } as Doctor));

  const popovers = (
    <>
      {pop && <DoctorDayPopover view={view} doctor={pop.doctor} date={pop.date} anchor={pop.anchor} onClose={() => setPop(null)} />}
      {dayPop && <UncoveredDayPopover view={view} date={dayPop.date} anchor={dayPop.anchor} onClose={() => setDayPop(null)} />}
    </>
  );

  if (layout === 'rows') {
    return (
      <>
        <div className="cal-wrap">
          <table className="cal rows fixed" style={cw.tableStyle(ctx.doctors.length, ['first', 'unc'])}>
            <colgroup>
              <col style={{ width: cw.fixed('first') }} />
              {ctx.doctors.map(d => <col key={d.id} style={cw.colStyle} />)}
              <col style={{ width: cw.fixed('unc') }} />
            </colgroup>
            <thead>
              <tr>
                <th className="name-col day-col">Giorno{cw.handle('first')}</th>
                {ctx.doctors.map(d => (
                  <th key={d.id} className="doc-head" title={d.name} style={{ background: tint(d.color, 18), boxShadow: `inset 0 3px 0 ${d.color}` }}>
                    {surname(d.name)}
                    {cw.handle(UNIFORM)}
                  </th>
                ))}
                <th className="sum sum-first">Scoperti{cw.handle('unc')}</th>
              </tr>
            </thead>
            <tbody>
              {ctx.dates.map(date => (
                <tr key={date} className={date === today ? 'today-row' : ''}>
                  <td data-day={date} className={`name-col day-col ${dayClass(date, ctx.holidays)}`}><DayLabel date={date} holidays={ctx.holidays} /></td>
                  {ctx.doctors.map(doc => cell(doc, date))}
                  <td className={`sum sum-first ${dayClass(date, ctx.holidays)}`}>
                    {ctx.slots.some(s => s.date === date) && <UncoveredBadge m={data.missingByDate.get(date)} onClick={e => setDayPop({ date, anchor: e.currentTarget.getBoundingClientRect() })} />}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {sumLabels.map((s, row) => (
                <tr key={s.label} className={row === 0 ? 'first-sum' : ''}>
                  <td className="name-col day-col">{s.label}</td>
                  {ctx.doctors.map(doc => {
                    const v = sums(doc)[row];
                    return <td key={doc.id} className={`sum ${v.cls ?? ''}`} title={v.title}>{v.value}</td>;
                  })}
                  <td className="sum sum-first" />
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
        {popovers}
      </>
    );
  }

  return (
    <>
      <div className="cal-wrap">
        <table className="cal fixed" style={cw.tableStyle(ctx.dates.length, ['first', ...sumLabels.map(() => 'sum')])}>
          <colgroup>
            <col style={{ width: cw.fixed('first') }} />
            {ctx.dates.map(d => <col key={d} style={cw.colStyle} />)}
            {sumLabels.map(s => <col key={s.label} style={{ width: cw.fixed('sum') }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="name-col">Medico{cw.handle('first')}</th>
              <DayHeaderCells dates={ctx.dates} holidays={ctx.holidays} cw={cw} />
              {sumLabels.map((s, i) => <th key={s.label} className={`sum ${i === 0 ? 'sum-first' : ''}`} title={s.label}>{s.short}{cw.handle('sum')}</th>)}
            </tr>
          </thead>
          <tbody>
            {ctx.doctors.map(doc => (
              <tr key={doc.id}>
                <td className="name-col" style={{ background: tint(doc.color, 16), boxShadow: `inset 3px 0 0 ${doc.color}` }}>
                  <div className="doc-name"><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.name}</span></div>
                </td>
                {ctx.dates.map(date => cell(doc, date))}
                {sums(doc).map((v, i) => <td key={v.label} className={`sum ${i === 0 ? 'sum-first' : ''} ${v.cls ?? ''}`} title={v.title}>{v.value}</td>)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="name-col">Scoperti</td>
              {ctx.dates.map(d => (
                <td key={d} className={dayClass(d, ctx.holidays)}>
                  {ctx.slots.some(s => s.date === d) && <UncoveredBadge compact m={data.missingByDate.get(d)} onClick={e => setDayPop({ date: d, anchor: e.currentTarget.getBoundingClientRect() })} />}
                </td>
              ))}
              <td colSpan={6} className="sum sum-first" />
            </tr>
          </tfoot>
        </table>
      </div>
      {popovers}
    </>
  );
});

/** Dai turni scoperti di un giorno, scegli quale coprire. */
function UncoveredDayPopover({ view, date, anchor, onClose }: { view: MonthView; date: string; anchor: DOMRect; onClose: () => void }) {
  const ctx = view.ctx!;
  const holes = (view.analysis?.uncovered ?? []).filter(u => u.date === date).sort((a, b) => Number(b.critical) - Number(a.critical));
  const [chosen, setChosen] = useState<typeof holes[number] | null>(holes.length === 1 ? holes[0] : null);
  if (chosen) return <SlotPopover view={view} slot={chosen} current={null} anchor={anchor} onClose={onClose} />;
  return (
    <Popover anchor={anchor} onClose={onClose}>
      <div className="pop-label">Turni scoperti · scegli quale coprire</div>
      {holes.map(h => (
        <button key={`${h.areaId}|${h.shiftId}`} className="pop-item" onClick={() => setChosen(h)}>
          <span className={h.critical ? 'unc crit' : 'unc'}>{h.critical ? '‼' : '!'}</span>
          {ctx.shifts.get(h.shiftId)?.name} · {ctx.areas.get(h.areaId)?.name}
          <span className={`why ${h.critical ? 'bad' : 'warn'}`}>{h.critical ? 'critico' : 'normale'}{h.missing > 1 ? ` ×${h.missing}` : ''}</span>
        </button>
      ))}
    </Popover>
  );
}

// --- Vista per area -----------------------------------------------------

export const AreaGrid = memo(function AreaGrid({ view, layout, mode = 'area' }: { view: MonthView; layout: Layout; mode?: GroupMode }) {
  const ctx = view.ctx!;
  const data = useGridData(view);
  const [pop, setPop] = useState<{ slot: SlotRef; current: Assignment | null; anchor: DOMRect; removed?: boolean } | null>(null);
  const [addPop, setAddPop] = useState<{ date: string; groupId: string; anchor: DOMRect } | null>(null);
  const columns = useMemo(() => areaColumns(ctx, data.byKey), [ctx, data.byKey]);
  const today = todayIso();
  const dragIds = useDragging();
  const verdicts = useMemo(() => {
    const m = new Map<string, Verdict | null>();
    if (!dragIds || !view.version) return m;
    const list = view.version.assignments;
    for (const c of columns) {
      for (const d of ctx.dates) {
        const k = demandKey(d, c.area.id, c.shift.id);
        const a = data.byKey.get(k)?.[c.index] ?? null;
        if (!a && (ctx.demand.get(k)?.count ?? 0) <= c.index) continue;
        const slot = { date: d, areaId: c.area.id, shiftId: c.shift.id };
        m.set(`${k}|${c.index}`, judge(ctx, list, planSlot(list, dragIds[0], slot, a?.id ?? null)));
      }
    }
    return m;
  }, [dragIds, view.version, ctx, columns, data.byKey]);
  const cw = useColWidths(`${mode}-${layout}`, layout === 'rows' ? { first: 88, minCol: 90 } : { first: 130, minCol: 30 });
  const showOff = useStore(s => s.ui.showOffCols);
  // Smonto e riposo del giorno: chi ha fatto la notte ieri / l'altro ieri.
  const offOf = (d: string) => {
    const smonto: { doc: Doctor; skipped: boolean }[] = [], riposo: { doc: Doctor; skipped: boolean }[] = [];
    for (const doc of ctx.doctors) {
      const works = (data.byDocDate.get(`${doc.id}|${d}`)?.length ?? 0) > 0;
      if (data.nightOn(doc.id, addDays(d, -1))) smonto.push({ doc, skipped: works });
      else if (data.nightOn(doc.id, addDays(d, -2))) riposo.push({ doc, skipped: works });
    }
    return { smonto, riposo };
  };
  const offPills = (d: string, which: 'smonto' | 'riposo') => {
    const o = offOf(d);
    const list = which === 'smonto' ? o.smonto : o.riposo;
    return (
      <div className="off-stack">
        {list.map(({ doc, skipped }) => (
          <span key={doc.id} className={`off-pill ${skipped ? (which === 'smonto' ? 'violated' : 'skipped') : ''}`} style={skipped ? undefined : { background: tint(doc.color, 22), color: 'var(--text-2)', boxShadow: `inset 3px 0 0 ${doc.color}` }}
            title={skipped ? `${doc.name}: lavora nel giorno di ${which}` : doc.name}>{skipped && which === 'smonto' ? '! ' : ''}{surname(doc.name)}</span>
        ))}
      </div>
    );
  };

  /** Il posto (area, turno, indice) di un giorno: medico, buco o niente. */
  const slotBox = (col: AreaColumn, d: string) => {
    const k = demandKey(d, col.area.id, col.shift.id);
    const a = data.byKey.get(k)?.[col.index] ?? null;
    const dem = ctx.demand.get(k);
    const needed = (dem?.count ?? 0) > col.index;
    const doc = a ? ctx.doctorById.get(a.doctorId) : null;
    const tones = a ? toneClasses([data.sevByAssignment.get(a.id)]) : '';
    const slot = { date: d, areaId: col.area.id, shiftId: col.shift.id };
    if (!a && !needed) {
      // Turno rimosso per questo giorno: grigio, si ripristina dal clic.
      if ((ctx.removed.get(k) ?? 0) > col.index) {
        return (
          <div className="area-cell" onClick={e => setPop({ slot, current: null, anchor: e.currentTarget.getBoundingClientRect(), removed: true })}>
            <span className="slot-removed" title="Turno rimosso per questo giorno: clicca per ripristinarlo">Rimosso</span>
          </div>
        );
      }
      return null;
    }
    const v = verdicts.get(`${k}|${col.index}`);
    return (
          <div className="area-cell" title={v?.reason} onClick={e => setPop({ slot, current: a, anchor: e.currentTarget.getBoundingClientRect() })}
            {...dropHandlers(ids => dropOnSlot(view, ids[0], slot, a?.id ?? null))}>
            {a ? (
              <span {...dragSource([a.id])} className={`doc-pill ${tones}`} style={{ background: tint(doc?.color ?? '#999', 30), color: 'var(--text)', boxShadow: `inset 4px 0 0 ${doc?.color ?? '#999'}` }} title={doc?.name}>
                {tones.includes('err') && <span className="mk err" title="Errore: clicca per vedere il motivo">!</span>}
                {tones.includes('warn') && <span className="mk warn" title="Avviso (es. riposo saltato)" />}
                {tones.includes('des') && <span className="mk des" title="Desiderata non rispettata" />}
                <span className="pill-text">{doc ? surname(doc.name) : '?'}{a.locked ? ' 🔒' : ''}</span>
              </span>
            ) : dem?.optional
              ? <span className="hole opt" title="Turno opzionale: può restare vuoto">opzionale</span>
              : dem?.critical
                ? <span className="hole crit" title="Turno critico scoperto">‼ SCOPERTO</span>
                : <span className="hole" title="Turno scoperto">! scoperto</span>}
            <VerdictMark v={v} />
          </div>
    );
  };
  const cell = (col: AreaColumn, d: string) => (
    <td key={`${col.area.id}|${col.shift.id}|${col.index}|${d}`} className={dayClass(d, ctx.holidays)}>{slotBox(col, d)}</td>
  );

  const popover = (
    <>
      {pop && <SlotPopover view={view} slot={pop.slot} current={pop.current} anchor={pop.anchor} removed={pop.removed} onClose={() => setPop(null)} />}
      {addPop && (
        <Popover anchor={addPop.anchor} onClose={() => setAddPop(null)}>
          <div className="pop-label">Aggiungi un turno · {formatDay(addPop.date)}</div>
          {(mode === 'area'
            ? ctx.config.shiftTypes.filter(s => !s.areaId || s.areaId === addPop.groupId).map(s => ({ areaId: addPop.groupId, shiftId: s.id, label: s.name, color: s.color, code: s.code }))
            : ctx.config.areas.map(a => ({ areaId: a.id, shiftId: addPop.groupId, label: a.name, color: a.color, code: shortName(a.name) }))
          ).map(o => {
            const count = ctx.demand.get(demandKey(addPop.date, o.areaId, o.shiftId))?.count ?? 0;
            return (
              <button key={`${o.areaId}|${o.shiftId}`} className="pop-item" onClick={() => { addSlot(view, { date: addPop.date, areaId: o.areaId, shiftId: o.shiftId }); setAddPop(null); }}>
                <span className="code-tag" style={{ background: o.color, color: textOn(o.color) }}>{o.code}</span>
                {o.label}
                <span className="why">{count ? `già ${count}, diventa ${count + 1}` : 'nuovo per questo giorno'}</span>
              </button>
            );
          })}
        </Popover>
      )}
    </>
  );
  const groups = buildGroups(ctx, columns, mode);
  const renderLabel = (l: LineLabel | null): ReactNode => {
    if (!l) return null;
    return (
      <>
        {l.shift && <span className="code-tag" style={{ background: l.shift.color, color: textOn(l.shift.color) }}>{l.shift.code}</span>}
        {l.area && <span className="area-tag" style={{ boxShadow: `inset 3px 0 0 ${l.area.color}` }} title={l.area.name}>{shortName(l.area.name)}</span>}
        {l.index !== null && <span className="tiny muted">{l.index}</span>}
      </>
    );
  };
  const rowName = (c: AreaColumn) => (mode === 'area' ? c.shift.name : c.area.name);

  if (layout === 'rows') {
    // Una colonna per gruppo; nella casella i posti del giorno uno sopra l'altro.
    // Le etichette compaiono solo se servono a distinguere qualcosa.
    return (
      <>
        <div className="cal-wrap">
          <table className="cal rows fixed" style={cw.tableStyle(groups.length + (showOff ? 2 : 0), ['first'])}>
            <colgroup>
              <col style={{ width: cw.fixed('first') }} />
              {groups.map(g => <col key={g.id} style={cw.colStyle} />)}
              {showOff && <><col style={cw.colStyle} /><col style={cw.colStyle} /></>}
            </colgroup>
            <thead>
              <tr>
                <th className="name-col day-col">Giorno{cw.handle('first')}</th>
                {groups.map(g => (
                  <th key={g.id} className="area-group" style={{ borderTop: `3px solid ${g.color}` }} title={g.name}>
                    {g.name}{cw.handle(UNIFORM)}
                  </th>
                ))}
                {showOff && <>
                  <th className="area-group off-head" title="Chi ha fatto la notte il giorno prima">Smonto{cw.handle(UNIFORM)}</th>
                  <th className="area-group off-head" title="Chi ha fatto la notte due giorni prima">Riposo{cw.handle(UNIFORM)}</th>
                </>}
              </tr>
            </thead>
            <tbody>
              {ctx.dates.map(d => (
                <tr key={d} className={d === today ? 'today-row' : ''}>
                  <td data-day={d} className={`name-col day-col ${dayClass(d, ctx.holidays)}`}><DayLabel date={d} holidays={ctx.holidays} /></td>
                  {groups.map(g => {
                    const lines = g.cols.map(c => ({ c, box: slotBox(c, d) })).filter(x => x.box);
                    return (
                      <td key={g.id} className={dayClass(d, ctx.holidays)}>
                        <div className="slot-stack">
                          {lines.map(({ c, box }) => (
                            <div key={`${c.area.id}|${c.shift.id}|${c.index}`} className="slot-line" title={`${c.shift.name} · ${c.area.name}`}>
                              {renderLabel(g.label(c))}
                              {box}
                            </div>
                          ))}
                          <button className="add-slot" title="Aggiungi un turno in questo giorno"
                            onClick={e => setAddPop({ date: d, groupId: g.id, anchor: e.currentTarget.getBoundingClientRect() })}>+</button>
                        </div>
                      </td>
                    );
                  })}
                  {showOff && <>
                    <td className={`off-col ${dayClass(d, ctx.holidays)}`}>{offPills(d, 'smonto')}</td>
                    <td className={`off-col ${dayClass(d, ctx.holidays)}`}>{offPills(d, 'riposo')}</td>
                  </>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {popover}
      </>
    );
  }

  return (
    <>
      <div className="cal-wrap">
        <table className="cal fixed" style={cw.tableStyle(ctx.dates.length, ['first'])}>
          <colgroup>
            <col style={{ width: cw.fixed('first') }} />
            {ctx.dates.map(d => <col key={d} style={cw.colStyle} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="name-col">{mode === 'area' ? 'Area · turno' : 'Turno · area'}{cw.handle('first')}</th>
              <DayHeaderCells dates={ctx.dates} holidays={ctx.holidays} cw={cw} />
            </tr>
          </thead>
          <tbody>
            {groups.map(g => [
              <tr key={g.id} className="area-head">
                <td className="name-col"><div className="row"><span className="color-dot" style={{ background: g.color }} />{g.name}</div></td>
                <td colSpan={ctx.dates.length} />
              </tr>,
              ...(g.cols.length === 1 && !g.label(g.cols[0])
                ? [<tr key={`${g.id}-only`}>
                    <td className="name-col"><div className="area-row-label muted small">{rowName(g.cols[0])}</div></td>
                    {ctx.dates.map(d => cell(g.cols[0], d))}
                  </tr>]
                : g.cols.map(c => (
                  <tr key={`${c.area.id}|${c.shift.id}|${c.index}`}>
                    <td className="name-col"><div className="area-row-label">{renderLabel(g.label(c))} {rowName(c)}</div></td>
                    {ctx.dates.map(d => cell(c, d))}
                  </tr>
                ))),
            ])}
            {showOff && (['smonto', 'riposo'] as const).map(which => (
              <tr key={which} className="off-row">
                <td className="name-col"><div className="area-row-label">{which === 'smonto' ? 'Smonto' : 'Riposo'}</div></td>
                {ctx.dates.map(d => <td key={d} className={`off-col ${dayClass(d, ctx.holidays)}`}>{offPills(d, which)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {popover}
    </>
  );
});

/** Tinta del colore del medico, mescolata con lo sfondo (in %). */
function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, var(--surface))`;
}

function surname(name: string) {
  const parts = name.replace(/^(dott\.?ssa|dott\.?|dr\.?)\s+/i, '').split(/\s+/);
  return parts[0].length > 10 ? parts[0].slice(0, 9) + '.' : parts[0];
}
