import { useState } from 'react';
import { ISSUE_LABELS, issueKey, issueTone, type Issue } from '../../domain/analysis';
import { demandKey } from '../../domain/context';
import { formatDay } from '../../domain/dates';
import { REQUEST_INFO, type Assignment, type Doctor } from '../../domain/types';
import { setIssueIgnored, type MonthView } from '../../store/month';
import { IconAlert, IconLock, IconTrash } from '../../ui/icons';
import { CodeTag, Popover } from '../../ui/kit';
import { textOn } from '../../ui/color';
import { evaluateCandidate, rankCandidates } from './candidates';
import { addSlot, assign, removeAssignment, removeSlot, restoreSlot, setSlotOptional, toggleLock } from './ops';

const LEVEL_TEXT = { good: 'ok', warn: 'avviso', bad: 'errore' };

/**
 * Riquadro con il perche degli errori e degli avvisi della casella, con la
 * possibilita di ignorarli (gli errori chiedono conferma).
 */
function IssueBox({ issues, view }: { issues: Issue[]; view: MonthView }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const shown = issues.filter(i => i.severity !== 'info');
  if (shown.length === 0) return null;
  return (
    <div className="issue-box">
      {shown.map(i => {
        const key = issueKey(i);
        const isError = i.severity === 'error';
        return (
          <div key={key} className={`issue-line ${issueTone(i)}`}>
            <IconAlert size={14} />
            <span className="grow"><b>{ISSUE_LABELS[i.kind]}</b> — {i.message}</span>
            {confirming === key ? (
              <span className="ignore-confirm">
                <span>È un vincolo violato: ignorarlo?</span>
                <button className="btn sm danger solid" onClick={() => { setIssueIgnored(view, key, true); setConfirming(null); }}>Sì, ignora</button>
                <button className="btn sm ghost" onClick={() => setConfirming(null)}>No</button>
              </span>
            ) : (
              <button className="btn sm ghost ignore-btn" title={isError ? 'Ignora questo errore (chiede conferma)' : 'Ignora questo avviso'}
                onClick={() => (isError ? setConfirming(key) : setIssueIgnored(view, key, true))}>Ignora</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LockButton({ locked, onClick }: { locked?: boolean; onClick: () => void }) {
  return (
    <button className={`btn sm ${locked ? 'primary' : 'ghost'}`} onClick={onClick}
      title={locked ? 'Rigenerando, questo turno resta dov’è. Clicca per sbloccarlo.' : 'Fissa il turno: rigenerando non verrà cambiato'}>
      <IconLock size={14} /> {locked ? 'Fissato' : 'Fissa'}
    </button>
  );
}

/** Popover di una cella medico × giorno. */
export function DoctorDayPopover({ view, doctor, date, anchor, onClose }: {
  view: MonthView; doctor: Doctor; date: string; anchor: DOMRect; onClose: () => void;
}) {
  const ctx = view.ctx!;
  const assignments = view.version?.assignments ?? [];
  const mine = assignments.filter(a => a.doctorId === doctor.id && a.date === date);
  const request = ctx.requests[doctor.id]?.[date];
  const mineIds = new Set(mine.map(a => a.id));
  const cellIssues = (view.analysis?.issues ?? []).filter(i => (i.assignmentId && mineIds.has(i.assignmentId)) || (i.doctorId === doctor.id && i.date === date && !i.assignmentId));

  // Posti del giorno: per ogni area e turno, chi li copre.
  const options: { date: string; areaId: string; shiftId: string; holder: Assignment | null; free: boolean }[] = [];
  for (const area of ctx.config.areas) {
    for (const shift of ctx.config.shiftTypes) {
      const need = ctx.demand.get(demandKey(date, area.id, shift.id))?.count ?? 0;
      if (need === 0) continue;
      const covering = assignments.filter(a => a.date === date && a.areaId === area.id && a.shiftId === shift.id);
      if (covering.some(a => a.doctorId === doctor.id)) continue;
      if (covering.length < need) options.push({ date, areaId: area.id, shiftId: shift.id, holder: null, free: true });
      else for (const h of covering) options.push({ date, areaId: area.id, shiftId: shift.id, holder: h, free: false });
    }
  }
  const evaluated = options.map(o => ({ ...o, c: evaluateCandidate(ctx, assignments, doctor, o, undefined) }));
  evaluated.sort((a, b) => Number(b.free) - Number(a.free) || ({ good: 0, warn: 1, bad: 2 }[a.c.level] - { good: 0, warn: 1, bad: 2 }[b.c.level]));
  const multiArea = ctx.areas.size > 1;

  return (
    <Popover anchor={anchor} onClose={onClose}>
      <div className="pop-title"><span className="color-dot" style={{ background: doctor.color }} />{doctor.name}</div>
      <div className="pop-sub">
        {formatDay(date)}{ctx.holidays.get(date) ? ` · ${ctx.holidays.get(date)}` : ''}
        {request && <> · <b>{REQUEST_INFO[request].label}</b></>}
      </div>
      <IssueBox issues={cellIssues} view={view} />
      {mine.map(a => {
        const s = ctx.shifts.get(a.shiftId);
        return (
          <div key={a.id} className="row" style={{ padding: '4px 10px' }}>
            {s && <CodeTag color={s.color}><span style={{ color: textOn(s.color) }}>{s.code}</span></CodeTag>}
            <span className="grow">{s?.name ?? 'Turno sconosciuto'}{multiArea ? ` · ${ctx.areas.get(a.areaId)?.name ?? ''}` : ''}</span>
            <LockButton locked={a.locked} onClick={() => toggleLock(view, a.id)} />
            <button className="btn sm ghost icon danger" title="Togli turno" onClick={() => { removeAssignment(view, a.id); onClose(); }}><IconTrash size={15} /></button>
          </div>
        );
      })}
      {evaluated.length > 0 && <><div className="pop-sep" /><div className="pop-label">{mine.length ? 'Aggiungi o scambia' : 'Assegna'}</div></>}
      {evaluated.map(o => {
        const s = ctx.shifts.get(o.shiftId)!;
        const holder = o.holder ? ctx.doctorById.get(o.holder.doctorId) : null;
        return (
          <button key={`${o.areaId}|${o.shiftId}|${o.holder?.id ?? ''}`} className="pop-item"
            onClick={() => { assign(view, o, doctor.id, o.holder ?? undefined); onClose(); }}>
            <span className="code-tag" style={{ background: s.color, color: textOn(s.color) }}>{s.code}</span>
            <span>
              {s.name}{multiArea ? ` · ${ctx.areas.get(o.areaId)?.name}` : ''}
              <span className="tiny muted" style={{ display: 'block' }}>{o.free ? 'scoperto' : `al posto di ${holder?.name ?? '?'}`}</span>
            </span>
            <span className={`why ${o.c.level}`}>{o.c.reason || LEVEL_TEXT[o.c.level]}</span>
          </button>
        );
      })}
      {evaluated.length === 0 && mine.length === 0 && <div className="pop-sub">Nessun turno previsto in questo giorno.</div>}
    </Popover>
  );
}

/** Popover di un posto (area · turno · giorno): scegli il medico. */
export function SlotPopover({ view, slot, current, anchor, onClose, removed }: {
  view: MonthView; slot: Pick<Assignment, 'date' | 'areaId' | 'shiftId'>; current: Assignment | null; anchor: DOMRect; onClose: () => void;
  /** Il turno e stato rimosso per questo giorno. */
  removed?: boolean;
}) {
  const ctx = view.ctx!;
  if (removed) {
    const s = ctx.shifts.get(slot.shiftId);
    return (
      <Popover anchor={anchor} onClose={onClose}>
        <div className="pop-title">{s?.name} · {ctx.areas.get(slot.areaId)?.name}</div>
        <div className="pop-sub">{formatDay(slot.date)} · <b>turno rimosso</b> per questo giorno: non va coperto.</div>
        <button className="pop-item" onClick={() => { restoreSlot(view, slot); onClose(); }}>Ripristina il turno</button>
      </Popover>
    );
  }
  const assignments = view.version?.assignments ?? [];
  const shift = ctx.shifts.get(slot.shiftId);
  const area = ctx.areas.get(slot.areaId);
  const candidates = rankCandidates(ctx, assignments, slot, current ?? undefined)
    .filter(c => !assignments.some(a => a.doctorId === c.doctor.id && a.date === slot.date && a.areaId === slot.areaId && a.shiftId === slot.shiftId));
  const currentDoc = current ? ctx.doctorById.get(current.doctorId) : null;
  const best = candidates.find(c => c.level === 'good');
  const dem = ctx.demand.get(demandKey(slot.date, slot.areaId, slot.shiftId));
  const critical = dem?.critical ?? false;
  const optional = dem?.optional ?? false;
  const slotIssues = current ? (view.analysis?.issues ?? []).filter(i => i.assignmentId === current.id) : [];

  return (
    <Popover anchor={anchor} onClose={onClose}>
      <div className="pop-title">
        {shift && <span className="code-tag" style={{ background: shift.color, color: textOn(shift.color) }}>{shift.code}</span>}
        {shift?.name} · {area?.name}
      </div>
      <div className="pop-sub">{formatDay(slot.date)}{critical ? ' · critico' : ''}{optional ? ' · opzionale' : ''}</div>
      {!current && !optional && (
        <div className="issue-box">
          <div className={`issue-line ${critical ? 'error' : 'warning'}`}>
            <IconAlert size={14} />
            <span><b>{critical ? 'Turno critico scoperto' : 'Turno scoperto'}</b> — {critical ? 'va coperto: scegli un medico qui sotto.' : 'nessun medico disponibile senza violare un vincolo o una desiderata.'}</span>
          </div>
        </div>
      )}
      <IssueBox issues={slotIssues} view={view} />
      {current && (
        <div className="row" style={{ padding: '4px 10px' }}>
          <span className="color-dot" style={{ background: currentDoc?.color ?? '#999' }} />
          <span className="grow" style={{ fontWeight: 600 }}>{currentDoc?.name ?? 'Medico eliminato'}</span>
          <LockButton locked={current.locked} onClick={() => toggleLock(view, current.id)} />
          <button className="btn sm ghost icon danger" title="Togli" onClick={() => { removeAssignment(view, current.id); onClose(); }}><IconTrash size={15} /></button>
        </div>
      )}
      <div className="pop-sep" />
      <div className="pop-label">{current ? 'Sostituisci con' : 'Assegna a'}</div>
      {candidates.map(c => (
        <button key={c.doctor.id} className="pop-item" onClick={() => { assign(view, slot, c.doctor.id, current ?? undefined); onClose(); }}>
          <span className="color-dot" style={{ background: c.doctor.color }} />
          {c.doctor.name}
          <span className={`why ${c.level}`}>{c === best ? 'consigliato' : c.reason || LEVEL_TEXT[c.level]}</span>
        </button>
      ))}
      <div className="pop-sep" />
      <div className="pop-label">Solo per {formatDay(slot.date)}</div>
      <button className="pop-item" onClick={() => { setSlotOptional(view, slot, !optional); onClose(); }}>
        {optional ? 'Rendi da coprire (obbligatorio)' : 'Rendi opzionale / da non coprire'}
        <span className="why">{optional ? '' : 'se resta vuoto, nessun avviso'}</span>
      </button>
      <button className="pop-item" onClick={() => { addSlot(view, slot); onClose(); }}>Aggiungi un altro medico a questo turno</button>
      <button className="pop-item danger" onClick={() => { removeSlot(view, slot, current); onClose(); }}>
        {(dem?.count ?? 1) > 1 ? 'Togli questo posto' : 'Rimuovi il turno'}
        <span className="why">{current ? `anche ${ctx.doctorById.get(current.doctorId)?.name ?? ''}` : ''}</span>
      </button>
    </Popover>
  );
}
