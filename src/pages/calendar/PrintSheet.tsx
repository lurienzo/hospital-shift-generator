// Foglio di stampa: una tabella schematica in solo testo, tutto il mese su
// una pagina A4 orizzontale. Non e la griglia interattiva: niente pillole,
// niente sigle ripetute, una riga per giorno.

import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { demandKey } from '../../domain/context';
import { addDays, monthLabel, parseIso, WEEKDAY_LETTER, WEEKDAY_SHORT, weekdayOf } from '../../domain/dates';
import type { Assignment, Doctor } from '../../domain/types';
import { shortName } from '../../io/excel';
import type { MonthView } from '../../store/month';
import { areaColumns, buildGroups, offDoctors, shiftsInManyAreas, viewColumns, type ColumnGroup, type LineLabel } from './layout';

type Mode = 'doctor' | 'area' | 'shift';

/** Tinta pastello del colore del medico, su fondo bianco (si stampa bene). */
function pastel(color: string, percent = 30) {
  return `color-mix(in srgb, ${color} ${percent}%, #fff)`;
}

/** Nome del medico con il suo colore. */
function DocName({ doc, prefix }: { doc: Doctor | undefined; prefix?: string }) {
  if (!doc) return <span>{prefix}?</span>;
  return (
    <span className="p-doc" style={{ background: pastel(doc.color), borderLeftColor: doc.color }}>
      {prefix && <span className="p-prefix">{prefix}</span>}{surname(doc.name)}
    </span>
  );
}

/**
 * Area stampabile di un A4 orizzontale con margini di 5 mm (287 x 200 mm).
 * In altezza si tengono 4 mm di sicurezza: la stampa vera puo impaginare un
 * filo diversamente dallo schermo e il foglio non deve mai passare a due pagine.
 */
const PAGE_W_MM = 287;
const PAGE_H_MM = 196;
const PX_PER_MM = 96 / 25.4;

function fitToPage(el: HTMLElement) {
  const maxH = PAGE_H_MM * PX_PER_MM;
  const apply = (scale: number) => {
    el.style.setProperty('zoom', String(scale));
    el.style.width = `${PAGE_W_MM / scale}mm`;
    return el.getBoundingClientRect().height;
  };
  el.style.minHeight = '0';
  let scale = 1;
  if (apply(1) > maxH + 0.5) {
    // Cerca la scala piu grande con cui tutto entra in una pagina. Rimpicciolendo
    // la tabella si allarga in proporzione e i nomi vanno meno a capo, quindi
    // l'altezza non cala in modo lineare: una ricerca binaria e la via sicura.
    let lo = 0.3, hi = 1;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      if (apply(mid) <= maxH) lo = mid; else hi = mid;
    }
    scale = lo;
    apply(scale);
  }
  // Lo spazio che avanza in fondo alla pagina va alle righe, che si allungano.
  el.style.minHeight = `${PAGE_H_MM / scale}mm`;
  el.dataset.scale = scale.toFixed(3);
}

function surname(name: string) {
  return name.replace(/^(dott\.?ssa|dott\.?|dr\.?)\s+/i, '').split(/\s+/)[0];
}

export function PrintSheet({ view, mode, layout, showOff, serviceName }: {
  view: MonthView; mode: Mode; layout: 'rows' | 'cols'; showOff: boolean; serviceName: string;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);

  // Adatta il foglio a una pagina A4 orizzontale: se avanza spazio le righe si
  // allungano, se non ci sta tutto si rimpicciolisce in proporzione. Si
  // ricalcola a ogni modifica e subito prima di stampare.
  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const fit = () => fitToPage(el);
    fit();
    window.addEventListener('beforeprint', fit);
    return () => window.removeEventListener('beforeprint', fit);
  });

  const ctx = view.ctx;
  if (!ctx || !view.version) return null;
  const assignments = view.version.assignments;

  const byDocDate = new Map<string, Assignment[]>();
  const byKey = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const k1 = `${a.doctorId}|${a.date}`;
    (byDocDate.get(k1) ?? byDocDate.set(k1, []).get(k1)!).push(a);
    const k2 = demandKey(a.date, a.areaId, a.shiftId);
    (byKey.get(k2) ?? byKey.set(k2, []).get(k2)!).push(a);
  }
  const nightOn = (docId: string, date: string) =>
    byDocDate.get(`${docId}|${date}`)?.some(a => ctx.shifts.get(a.shiftId)?.night)
    ?? ctx.tailByDoctor.get(docId)?.some(a => a.date === date && ctx.shifts.get(a.shiftId)?.night) ?? false;
  const ambiguous = shiftsInManyAreas(ctx);
  const rowClass = (d: string) => (ctx.holidays.has(d) ? 'p-hol' : weekdayOf(d) >= 5 ? 'p-we' : '');

  /** Codici della giornata di un medico: "MP S1", "N", "F", "s", "r". */
  const doctorDay = (doc: Doctor, d: string): { text: string; cls?: string } => {
    const items = (byDocDate.get(`${doc.id}|${d}`) ?? [])
      .slice().sort((x, y) => (ctx.shifts.get(x.shiftId)?.interval[0] ?? 0) - (ctx.shifts.get(y.shiftId)?.interval[0] ?? 0));
    if (items.length) {
      const codes = items.map(a => ctx.shifts.get(a.shiftId)?.code ?? '?').join('');
      const areas = [...new Set(items.filter(a => ambiguous.has(a.shiftId)).map(a => shortName(ctx.areas.get(a.areaId)?.name ?? '')))];
      return { text: areas.length ? `${codes} ${areas.join('/')}` : codes, cls: 'p-work' };
    }
    const req = ctx.requests[doc.id]?.[d];
    if (req === 'F' || req === 'A') return { text: req, cls: 'p-off' };
    if (nightOn(doc.id, addDays(d, -1))) return { text: 's', cls: 'p-rest' };
    if (nightOn(doc.id, addDays(d, -2))) return { text: 'r', cls: 'p-rest' };
    return { text: '' };
  };

  const labelText = (l: LineLabel | null) => {
    if (!l) return '';
    return [l.shift?.code, l.area ? shortName(l.area.name) : null, l.index !== null ? String(l.index) : null].filter(Boolean).join(' ') + ' ';
  };

  /** Testo di un gruppo (area o turno) in un giorno: "Rossi" o "M Rossi · P Bianchi". */
  const groupDay = (g: ColumnGroup, d: string) => {
    const parts: { text: string; cls?: string; doc?: Doctor; prefix?: string }[] = [];
    for (const c of g.cols) {
      const k = demandKey(d, c.area.id, c.shift.id);
      const a = byKey.get(k)?.[c.index];
      const dem = ctx.demand.get(k);
      if (!a && (dem?.count ?? 0) <= c.index) {
        if ((ctx.removed.get(k) ?? 0) > c.index) parts.push({ text: `${labelText(g.label(c))}rimosso`, cls: 'p-removed' });
        continue;
      }
      const prefix = labelText(g.label(c));
      if (a) parts.push({ text: '', doc: ctx.doctorById.get(a.doctorId), prefix });
      else if (dem?.optional) parts.push({ text: `${prefix}—`, cls: 'p-removed' });
      else parts.push({ text: prefix + (dem?.critical ? 'SCOPERTO' : 'scoperto'), cls: dem?.critical ? 'p-hole crit' : 'p-hole' });
    }
    return parts;
  };

  const dayOf = (docId: string, date: string) =>
    byDocDate.get(`${docId}|${date}`) ?? ctx.tailByDoctor.get(docId)?.filter(a => a.date === date) ?? [];
  const offDay = (d: string, which: 'smonto' | 'riposo', night: ColumnGroup) => offDoctors(ctx, night, d, which, dayOf)
    .map(doc => <span key={doc.id} className="p-doc p-doc-off" style={{ background: pastel(doc.color, 16), borderLeftColor: doc.color }}>{surname(doc.name)}</span>);

  const dayLabel = (d: string) => (
    <>
      <b>{parseIso(d).day}</b> {WEEKDAY_SHORT[weekdayOf(d)]}
      {ctx.holidays.get(d) && <span className="p-holname"> {ctx.holidays.get(d)}</span>}
    </>
  );

  let table: React.ReactNode;
  if (mode === 'doctor' && layout === 'cols') {
    table = (
      <table className="p-table p-dense">
        <thead>
          <tr>
            <th className="p-first p-title"><b>{serviceName}</b><span>{monthLabel(ctx.year, ctx.month)}</span></th>
            {ctx.dates.map(d => <th key={d} className={rowClass(d)}>{parseIso(d).day}<br /><span className="p-wd">{WEEKDAY_LETTER[weekdayOf(d)]}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {ctx.doctors.map(doc => (
            <tr key={doc.id}>
              <td className="p-first p-name" style={{ background: pastel(doc.color, 35), boxShadow: `inset 3pt 0 0 ${doc.color}` }}>{doc.name}</td>
              {ctx.dates.map(d => { const v = doctorDay(doc, d); return <td key={d} className={`${rowClass(d)} ${v.cls ?? ''}`} style={v.cls === 'p-work' ? { background: pastel(doc.color, 28) } : undefined}>{v.text}</td>; })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else if (mode === 'doctor') {
    table = (
      <table className="p-table">
        <thead>
          <tr>
            <th className="p-first p-title"><b>{serviceName}</b><span>{monthLabel(ctx.year, ctx.month)}</span></th>
            {ctx.doctors.map(doc => <th key={doc.id} style={{ background: pastel(doc.color, 35), borderTop: `3pt solid ${doc.color}` }}>{surname(doc.name)}</th>)}
          </tr>
        </thead>
        <tbody>
          {ctx.dates.map(d => (
            <tr key={d} className={rowClass(d)}>
              <td className="p-first">{dayLabel(d)}</td>
              {ctx.doctors.map(doc => { const v = doctorDay(doc, d); return <td key={doc.id} className={v.cls} style={v.cls === 'p-work' ? { background: pastel(doc.color, 28) } : undefined}>{v.text}</td>; })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else {
    const vcols = viewColumns(buildGroups(ctx, areaColumns(ctx, byKey), mode), showOff);
    table = (
      <table className="p-table">
        <thead>
          <tr>
            <th className="p-first p-title"><b>{serviceName}</b><span>{monthLabel(ctx.year, ctx.month)}</span></th>
            {vcols.map(v => v.kind === 'slots' ? <th key={v.id}>{v.group.name}</th> : <th key={v.id} className="p-offh">{v.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {ctx.dates.map(d => (
            <tr key={d} className={rowClass(d)}>
              <td className="p-first">{dayLabel(d)}</td>
              {vcols.map(v => v.kind === 'off' ? <td key={v.id} className="p-rest">{offDay(d, v.which, v.night)}</td> : (
                <td key={v.id}>
                  {groupDay(v.group, d).map((p, i) => (
                    <span key={i}>{i > 0 && <span className="p-sep"> </span>}{p.doc ? <DocName doc={p.doc} prefix={p.prefix} /> : <span className={p.cls}>{p.text}</span>}</span>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return createPortal(
    <div className="print-sheet" ref={sheetRef}>
      {table}
    </div>,
    document.body,
  );
}

