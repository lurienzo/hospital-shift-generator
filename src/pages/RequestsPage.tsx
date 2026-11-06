import { useEffect, useRef, useState } from 'react';
import { addDays, formatDay, parseIso, toIso, WEEKDAY_LETTER, WEEKDAY_SHORT, weekdayOf } from '../domain/dates';
import { REQUEST_CODES, REQUEST_INFO, type Doctor, type MonthData, type RequestCode } from '../domain/types';
import { downloadRequestsTemplate, readRequestsFile, type RequestsLayout } from '../io/excel';
import { parseDelimited, parseRequestGrid, type GridImport } from '../io/requestsGrid';
import { useMonthView } from '../store/month';
import { notify, setUi, updateMonth, useStore } from '../store/store';
import { IconChevronDown, IconClipboard, IconDownload, IconEraser, IconUpload } from '../ui/icons';
import { Modal, Popover, Seg } from '../ui/kit';
import { useConfirm } from '../ui/useConfirm';
import { Topbar } from '../ui/Topbar';

type Brush = RequestCode | 'erase';

interface Drag { doctorId: string; from: string; to: string }

function paintRange(key: string, doctorId: string, from: string, to: string, b: Brush) {
  updateMonth(key, m => {
    const req = { ...(m.requests[doctorId] ?? {}) };
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (b === 'erase') delete req[d]; else req[d] = b;
    }
    return { ...m, requests: { ...m.requests, [doctorId]: req } };
  });
}

const holidayTitle = (hol?: string) => (hol ? `${hol} — clicca per togliere` : 'Clicca per segnare come festivo');

const BRUSH_KEYS: Record<string, Brush> = { f: 'F', a: 'A', d: 'D', n: 'N', e: 'erase', '0': 'erase' };

export function RequestsPage() {
  const view = useMonthView();
  const services = useStore(s => s.services);
  const activeId = useStore(s => s.activeId);
  const serviceName = services.find(s => s.id === activeId)?.name ?? 'servizio';
  const { ctx, data, key } = view;
  const layout = useStore(s => s.ui.requestsLayout);
  const [templateAnchor, setTemplateAnchor] = useState<DOMRect | null>(null);
  const [brush, setBrush] = useState<Brush>('F');
  const [drag, setDrag] = useState<Drag | null>(null);
  // Lo stato del trascinamento vive anche in un riferimento: il rilascio del
  // mouse lo legge sempre aggiornato, anche con movimenti molto rapidi.
  const dragRef = useRef<Drag | null>(null);
  const brushRef = useRef<Brush>(brush);
  const keyRef = useRef(key);
  useEffect(() => { brushRef.current = brush; keyRef.current = key; });
  const [importResult, setImportResult] = useState<(GridImport & { sheetMonth?: string | null; source: string }) | null>(null);
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const [paste, setPaste] = useState<string | null>(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmNode, confirm] = useConfirm();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      const b = BRUSH_KEYS[e.key.toLowerCase()];
      if (b) setBrush(b);
    };
    const onUp = () => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      setDrag(null);
      const [a, b] = [d.from, d.to].sort();
      paintRange(keyRef.current, d.doctorId, a, b, brushRef.current);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mouseup', onUp); };
  }, []);

  const startDrag = (doctorId: string, date: string) => {
    dragRef.current = { doctorId, from: date, to: date };
    setDrag(dragRef.current);
  };
  const extendDrag = (doctorId: string, date: string) => {
    const d = dragRef.current;
    if (!d || d.doctorId !== doctorId || d.to === date) return;
    dragRef.current = { ...d, to: date };
    setDrag(dragRef.current);
  };

  if (!ctx) return null;
  const dates = ctx.dates;
  const doctors = ctx.doctors;
  const paint = (doctorId: string, from: string, to: string, b: Brush) => paintRange(key, doctorId, from, to, b);

  const inDrag = (doctorId: string, date: string) => {
    if (!drag || drag.doctorId !== doctorId) return false;
    const [a, b] = [drag.from, drag.to].sort();
    return date >= a && date <= b;
  };

  const toggleHoliday = (date: string) => updateMonth(key, m => {
    if (ctx.holidays.has(date)) {
      if (m.extraHolidays.includes(date)) return { ...m, extraHolidays: m.extraHolidays.filter(d => d !== date) };
      return { ...m, removedHolidays: [...m.removedHolidays, date] };
    }
    if (m.removedHolidays.includes(date)) return { ...m, removedHolidays: m.removedHolidays.filter(d => d !== date) };
    return { ...m, extraHolidays: [...m.extraHolidays, date] };
  });

  const applyImport = () => {
    if (!importResult) return;
    updateMonth(key, m => {
      const requests = { ...m.requests };
      for (const [docId, codes] of Object.entries(importResult.requests)) {
        requests[docId] = mode === 'replace' ? { ...codes } : { ...(requests[docId] ?? {}), ...codes };
      }
      if (mode === 'replace') for (const x of importResult.matched) if (!importResult.requests[x.doctorId]) requests[x.doctorId] = {};
      return { ...m, requests };
    });
    const n = importResult.matched.reduce((s, x) => s + x.count, 0);
    notify(`Importate ${n} richieste per ${importResult.matched.length} medici`);
    setImportResult(null);
  };

  const onFile = async (file: File) => {
    try {
      const r = await readRequestsFile(file, doctors, view.year, view.month);
      if (r.days === 0) { notify('Non trovo i giorni del mese (1, 2, 3…) nel file, né in una riga né in una colonna.', 'error'); return; }
      setImportResult({ ...r, source: file.name });
    } catch (e) {
      console.error(e);
      notify('File non leggibile. Usa il template .xlsx oppure un CSV.', 'error');
    }
  };

  const totals = (docId: string) => {
    const req = data.requests[docId] ?? {};
    const out: Record<RequestCode, number> = { F: 0, A: 0, D: 0, N: 0 };
    for (const d of dates) { const c = req[d]; if (c) out[c]++; }
    return out;
  };
  const cell = (doc: Doctor, d: string) => {
    const code = data.requests[doc.id]?.[d];
    const preview = inDrag(doc.id, d);
    const shown = preview ? (brush === 'erase' ? null : brush) : code;
    return (
      <td key={`${doc.id}|${d}`} className={ctx.holidays.has(d) ? 'hol' : weekdayOf(d) >= 5 ? 'we' : ''}>
        <div className="req-cell" style={preview ? { opacity: 0.75 } : undefined}
          onMouseDown={e => { e.preventDefault(); startDrag(doc.id, d); }}
          onMouseEnter={() => extendDrag(doc.id, d)}
          title={`${doc.name} · ${formatDay(d)}${code ? ` · ${REQUEST_INFO[code].label}` : ''}`}>
          {shown && <span className={`req-tag ${shown}`}>{shown}</span>}
        </div>
      </td>
    );
  };
  const downloadTemplate = (l: RequestsLayout) => { setTemplateAnchor(null); downloadRequestsTemplate(ctx, data, serviceName, l); };
  const anyRequests = Object.values(data.requests).some(r => Object.keys(r).length > 0);

  return (
    <>
      <Topbar title="Ferie e desiderate" month>
        <button className="btn" onClick={e => setTemplateAnchor(e.currentTarget.getBoundingClientRect())}><IconDownload size={16} /> Template Excel <IconChevronDown size={14} /></button>
        <button className="btn" onClick={() => fileRef.current?.click()}><IconUpload size={16} /> Importa</button>
        <button className="btn" onClick={() => setPaste('')}><IconClipboard size={16} /> Incolla</button>
        <input ref={fileRef} type="file" accept=".xlsx,.csv,.tsv,.txt" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      </Topbar>
      <div className="content">
        <div className="card card-body col" style={{ gap: 12 }}>
          <div className="row wrap" style={{ gap: 14 }}>
            <div className="brushes" role="radiogroup" aria-label="Pennello">
              {REQUEST_CODES.map(c => (
                <button key={c} className={`brush ${brush === c ? 'on' : ''}`} onClick={() => setBrush(c)} title={REQUEST_INFO[c].hint} role="radio" aria-checked={brush === c}>
                  <span className={`req-tag ${c}`}>{c}</span>{REQUEST_INFO[c].label}<kbd>{c}</kbd>
                </button>
              ))}
              <button className={`brush ${brush === 'erase' ? 'on' : ''}`} onClick={() => setBrush('erase')} role="radio" aria-checked={brush === 'erase'}>
                <span className="req-tag" style={{ color: 'var(--muted)' }}><IconEraser size={16} /></span>Gomma<kbd>E</kbd>
              </button>
            </div>
            <div className="spacer" />
            <Seg value={layout} onChange={v => setUi({ requestsLayout: v })}
              options={[{ value: 'doctor-rows', label: 'Medici in righe' }, { value: 'doctor-cols', label: 'Medici in colonne' }]} />
            <button className="btn" onClick={() => setRangeOpen(true)}>Inserisci periodo…</button>
            {anyRequests && <button className="btn ghost danger" onClick={() => confirm({
              title: 'Svuotare le richieste del mese?', message: 'Tutte le ferie, assenze e desiderate di questo mese verranno tolte.', confirmLabel: 'Svuota', danger: true,
              onConfirm: () => updateMonth(key, m => ({ ...m, requests: {} })),
            })}>Svuota mese</button>}
          </div>
          <p className="hint">Scegli il pennello e <b>clicca o trascina</b> sulle caselle per riempire più giorni insieme. Clicca un giorno per segnarlo (o toglierlo) come <b>festivo</b>. <b>F</b> e <b>A</b> sono vincoli assoluti, <b>D</b> e <b>N</b> vengono rispettate se possibile.</p>
        </div>

        {doctors.length === 0 ? <div className="card empty"><p>Aggiungi prima i medici.</p></div> : (
          <div className="card">
            <div className="cal-wrap">
              {layout === 'doctor-rows' ? (
                <table className="cal">
                  <thead>
                    <tr>
                      <th className="name-col">Medico</th>
                      {dates.map(d => {
                        const wd = weekdayOf(d);
                        const hol = ctx.holidays.get(d);
                        return (
                          <th key={d} className={`${hol ? 'hol' : wd >= 5 ? 'we' : ''}`} style={{ cursor: 'pointer', minWidth: 32 }}
                            title={holidayTitle(hol)} onClick={() => toggleHoliday(d)}>
                            <span className="d">{parseIso(d).day}</span><span className="w">{WEEKDAY_LETTER[wd]}</span>
                          </th>
                        );
                      })}
                      {REQUEST_CODES.map((c, i) => <th key={c} className={`sum ${i === 0 ? 'sum-first' : ''}`} title={REQUEST_INFO[c].label}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {doctors.map(doc => {
                      const t = totals(doc.id);
                      return (
                        <tr key={doc.id}>
                          <td className="name-col"><div className="doc-name"><span className="color-dot" style={{ background: doc.color }} />{doc.name}</div></td>
                          {dates.map(d => cell(doc, d))}
                          {REQUEST_CODES.map((c, i) => <td key={c} className={`sum ${i === 0 ? 'sum-first' : ''}`}>{t[c] || ''}</td>)}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <table className="cal rows">
                  <thead>
                    <tr>
                      <th className="name-col day-col">Giorno</th>
                      {doctors.map(doc => (
                        <th key={doc.id} className="doc-head" style={{ borderTop: `3px solid ${doc.color}` }} title={doc.name}>{doc.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dates.map(d => {
                      const hol = ctx.holidays.get(d);
                      return (
                        <tr key={d}>
                          <td className={`name-col day-col ${hol ? 'hol' : weekdayOf(d) >= 5 ? 'we' : ''}`} style={{ cursor: 'pointer' }}
                            title={holidayTitle(hol)} onClick={() => toggleHoliday(d)}>
                            <div className="day-label">
                              <b className="num">{parseIso(d).day}</b><span>{WEEKDAY_SHORT[weekdayOf(d)]}</span>
                              {hol && <span className="hol-name">{hol}</span>}
                            </div>
                          </td>
                          {doctors.map(doc => cell(doc, d))}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    {REQUEST_CODES.map((c, i) => (
                      <tr key={c} className={i === 0 ? 'first-sum' : ''}>
                        <td className="name-col day-col" title={REQUEST_INFO[c].hint}><span className={`req-tag ${c}`}>{c}</span> {REQUEST_INFO[c].label}</td>
                        {doctors.map(doc => <td key={doc.id} className="sum">{totals(doc.id)[c] || ''}</td>)}
                      </tr>
                    ))}
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        )}

        <div className="legend">
          {REQUEST_CODES.map(c => <span key={c}><span className={`req-tag ${c}`}>{c}</span>{REQUEST_INFO[c].label}: {REQUEST_INFO[c].hint}</span>)}
        </div>
      </div>

      {templateAnchor && (
        <Popover anchor={templateAnchor} onClose={() => setTemplateAnchor(null)}>
          <div className="pop-label">Scarica il template</div>
          <button className="pop-item" onClick={() => downloadTemplate('doctor-rows')}>Medici in righe <span className="why">giorni in colonne</span></button>
          <button className="pop-item" onClick={() => downloadTemplate('doctor-cols')}>Medici in colonne <span className="why">giorni in righe</span></button>
          <div className="pop-sub">Si reimportano entrambi con “Importa”.</div>
        </Popover>
      )}

      {rangeOpen && <RangeDialog data={data} doctors={doctors} dates={dates} onClose={() => setRangeOpen(false)} onApply={(docId, from, to, code) => { paint(docId, from, to, code); setRangeOpen(false); notify('Periodo inserito'); }} />}

      {paste !== null && (
        <Modal wide title="Incolla da Excel" subtitle="Copia in Excel la tabella con i giorni (1, 2, 3…) e i nomi dei medici, in un verso o nell’altro: giorni nella prima riga e medici nella prima colonna, o il contrario. Poi incollala qui."
          onClose={() => setPaste(null)}
          footer={<>
            <button className="btn" onClick={() => setPaste(null)}>Annulla</button>
            <button className="btn primary" disabled={!paste.trim()} onClick={() => {
              const r = parseRequestGrid(parseDelimited(paste), doctors, view.year, view.month);
              if (r.days === 0) { notify('Non trovo i giorni (1, 2, 3…), né in una riga né in una colonna.', 'error'); return; }
              setPaste(null);
              setImportResult({ ...r, source: 'testo incollato' });
            }}>Continua</button>
          </>}>
          <textarea className="textarea" rows={12} value={paste} onChange={e => setPaste(e.target.value)} autoFocus placeholder={'Medico\t1\t2\t3\t…\nDott. Rossi\tF\tF\t\t…'} />
        </Modal>
      )}

      {importResult && (
        <Modal wide title="Controlla l’importazione" subtitle={`Da ${importResult.source}`} onClose={() => setImportResult(null)}
          footer={<>
            <Seg value={mode} onChange={setMode} options={[{ value: 'replace', label: 'Sostituisci', title: 'Per i medici nel file, le richieste del mese vengono rimpiazzate' }, { value: 'merge', label: 'Aggiungi', title: 'Si sommano a quelle già inserite' }]} />
            <div className="spacer" />
            <button className="btn" onClick={() => setImportResult(null)}>Annulla</button>
            <button className="btn primary" disabled={importResult.matched.length === 0} onClick={applyImport}>Importa</button>
          </>}>
          {importResult.sheetMonth && importResult.sheetMonth !== key && (
            <div className="badge warn" style={{ height: 'auto', padding: '6px 10px' }}>Il file è per {importResult.sheetMonth}, ma stai guardando {key}: le richieste verranno messe nei giorni di questo mese.</div>
          )}
          <div className="col">
            <span className="label">Medici riconosciuti ({importResult.matched.length})</span>
            <div className="row wrap" style={{ gap: 6 }}>
              {importResult.matched.map(m => <span key={m.doctorId} className="badge ok">{m.name}: {m.count}</span>)}
              {importResult.matched.length === 0 && <span className="hint">Nessuno: controlla che i nomi coincidano con quelli in “Medici”.</span>}
            </div>
          </div>
          {importResult.unknownNames.length > 0 && (
            <div className="col">
              <span className="label">Nomi non riconosciuti, saltati ({importResult.unknownNames.length})</span>
              <div className="row wrap" style={{ gap: 6 }}>{importResult.unknownNames.map(n => <span key={n} className="badge bad">{n}</span>)}</div>
            </div>
          )}
          {importResult.invalid.length > 0 && (
            <div className="col">
              <span className="label">Sigle non valide, saltate ({importResult.invalid.length})</span>
              <p className="hint">{importResult.invalid.slice(0, 12).map(i => `${i.name} giorno ${i.day}: “${i.value}”`).join(' · ')}{importResult.invalid.length > 12 ? ' …' : ''}</p>
            </div>
          )}
        </Modal>
      )}
      {confirmNode}
    </>
  );
}

function RangeDialog({ doctors, dates, onClose, onApply }: {
  data: MonthData; doctors: { id: string; name: string }[]; dates: string[];
  onClose: () => void; onApply: (docId: string, from: string, to: string, code: Brush) => void;
}) {
  const [docId, setDocId] = useState(doctors[0]?.id ?? '');
  const [from, setFrom] = useState(dates[0]);
  const [to, setTo] = useState(dates[dates.length - 1]);
  const [code, setCode] = useState<Brush>('F');
  const { year, month } = parseIso(dates[0]);
  return (
    <Modal title="Inserisci un periodo" subtitle="Per ferie o assenze lunghe. Puoi anche trascinare direttamente sulla griglia." onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Annulla</button>
        <button className="btn primary" disabled={!docId || from > to} onClick={() => onApply(docId, from, to, code)}>Inserisci</button>
      </>}>
      <div className="form-grid">
        <div className="field"><label>Medico</label>
          <select className="select" value={docId} onChange={e => setDocId(e.target.value)}>{doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        </div>
        <div className="field"><label>Tipo</label>
          <select className="select" value={code} onChange={e => setCode(e.target.value as Brush)}>
            {REQUEST_CODES.map(c => <option key={c} value={c}>{REQUEST_INFO[c].label}</option>)}
            <option value="erase">Cancella</option>
          </select>
        </div>
        <div className="field"><label>Dal</label>
          <input className="input" type="date" value={from} min={dates[0]} max={dates[dates.length - 1]} onChange={e => setFrom(e.target.value || toIso(year, month, 1))} />
        </div>
        <div className="field"><label>Al</label>
          <input className="input" type="date" value={to} min={dates[0]} max={dates[dates.length - 1]} onChange={e => setTo(e.target.value || dates[dates.length - 1])} />
        </div>
      </div>
    </Modal>
  );
}
