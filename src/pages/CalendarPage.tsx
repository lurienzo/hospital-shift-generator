import { useEffect, useMemo, useState } from 'react';
import { countDays, ISSUE_LABELS, issueKey, issueTone, type Issue, type IssueKind } from '../domain/analysis';
import { nightCapacity } from '../domain/capacity';
import { exportSchedule } from '../io/excel';
import { runGenerator } from '../io/runGenerator';
import {
  addVersion, deleteVersion, duplicateVersion, renameVersion, restoreAllIssues, setActiveVersion, setIssueIgnored, updateVersion, useMonthView, type MonthView,
} from '../store/month';
import { notify, setOpenVersion, setUi, useStore, type Page } from '../store/store';
import { IconCheck, IconChevronDown, IconCopy, IconDownload, IconPrinter, IconRefresh, IconSparkle, IconStar, IconTrash } from '../ui/icons';
import { Modal, Popover, Seg } from '../ui/kit';
import { useConfirm } from '../ui/useConfirm';
import { Topbar } from '../ui/Topbar';
import { AreaGrid, DoctorGrid } from './calendar/Grids';
import { hasCustomWidths, resetColWidths } from './calendar/colWidths';
import { clearUnlocked, unlockAll } from './calendar/ops';
import { PrintSheet } from './calendar/PrintSheet';

export function CalendarPage() {
  const view = useMonthView();
  const config = useStore(s => s.config)!;
  const calendarView = useStore(s => s.ui.calendarView);
  const layout = useStore(s => s.ui.calendarLayout);
  const showOff = useStore(s => s.ui.showOffCols);
  useStore(s => s.ui.colWidths); // ridisegna quando cambiano le larghezze
  const widthScope = `${calendarView}-${layout}`;
  const services = useStore(s => s.services);
  const activeId = useStore(s => s.activeId);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [gen, setGen] = useState<{ progress: number; start: number; timeMs: number; mode: string } | null>(null);
  const [genAnchor, setGenAnchor] = useState<DOMRect | null>(null);

  const ready = config.shiftTypes.length > 0 && config.areas.length > 0 && config.doctors.some(d => d.active);

  const generateNow = async (target: 'new' | 'replace', timeMs: number = ACCURATE_MS) => {
    if (!view.ctx || gen) return;
    setGenAnchor(null);
    const locked = target === 'replace' ? (view.version?.assignments.filter(a => a.locked) ?? []) : [];
    const start = performance.now();
    const mode = timeMs >= ACCURATE_MS ? 'accurata' : timeMs <= QUICK_MS ? 'rapida' : 'standard';
    setGen({ progress: 0, start, timeMs, mode });
    try {
      const result = await runGenerator(view.ctx, timeMs, locked, p => setGen(g => (g ? { ...g, progress: Math.max(g.progress, p) } : g)));
      if (target === 'replace' && view.version) {
        updateVersion(view.key, view.version.id, () => result.assignments);
      } else {
        addVersion(view.key, result.assignments);
      }
      notify('Calendario generato');
    } catch (e) {
      console.error(e);
      notify('Generazione non riuscita', 'error');
    } finally {
      setGen(null);
    }
  };

  const focusIssue = (i: Issue) => {
    if (!i.date) return;
    if (!i.doctorId) {
      // Turni scoperti e problemi di un giorno: vista per area, riga del giorno.
      if (calendarView !== 'area') setUi({ calendarView: 'area' });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-day="${i.date}"]`);
        if (!el) return;
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        const row = el.closest('tr') ?? el;
        row.classList.add('flash-row');
        setTimeout(() => row.classList.remove('flash-row'), 2400);
      }));
      return;
    }
    if (calendarView !== 'doctor') setUi({ calendarView: 'doctor' });
    const key = `${i.doctorId}|${i.date}`;
    setHighlight(key);
    requestAnimationFrame(() => document.querySelector(`[data-cell="${key}"]`)?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }));
    setTimeout(() => setHighlight(h => (h === key ? null : h)), 2600);
  };

  const serviceName = services.find(s => s.id === activeId)?.name ?? 'servizio';

  return (
    <>
      <Topbar title="Calendario" month>
        {ready && view.version && (
          <>
            <button className="btn" onClick={() => view.ctx && exportSchedule(view.ctx, view.version!.assignments, view.analysis, serviceName)}><IconDownload size={16} /> Excel</button>
            <button className="btn" onClick={() => window.print()}><IconPrinter size={16} /> Stampa</button>
          </>
        )}
        {ready && (
          <div className="btn-group">
            <button className="btn primary" disabled={!!gen} onClick={() => generateNow('new')} title="Generazione accurata (circa 10 secondi)">
              <IconSparkle size={16} /> {gen ? 'Genero…' : view.version ? 'Nuova proposta' : 'Genera turni'}
            </button>
            <button className="btn primary icon" disabled={!!gen} aria-label="Opzioni di generazione" onClick={e => setGenAnchor(e.currentTarget.getBoundingClientRect())}><IconChevronDown size={16} /></button>
          </div>
        )}
      </Topbar>
      <div className="content">
        {ready && <CapacityNotice view={view} />}
        {!ready ? <Onboarding /> : !view.version ? (
          <div className="card empty">
            <IconSparkle size={30} />
            <h2>Nessun calendario per questo mese</h2>
            <p>Controlla prima ferie e desiderate, poi genera i turni. Potrai modificarli a mano, confrontare più proposte e scegliere quella definitiva.</p>
            <div className="row">
              <button className="btn" onClick={() => setUi({ page: 'requests' })}>Ferie e desiderate</button>
              <button className="btn primary lg" disabled={!!gen} onClick={() => generateNow('new')}><IconSparkle size={16} /> {gen ? 'Genero…' : 'Genera turni'}</button>
            </div>
            <button className="btn ghost sm" onClick={() => addVersion(view.key, [], 'Versione 1')}>oppure inizia vuoto e compila a mano</button>
          </div>
        ) : (
          <>
            <PrintSheet view={view} mode={calendarView} layout={layout} showOff={showOff} serviceName={serviceName} />
            <VersionBar view={view} />
            <CriticalBanner view={view} />
            <Summary view={view} />
            <div className="row wrap no-print">
              <Seg value={calendarView} onChange={v => setUi({ calendarView: v })}
                options={[{ value: 'doctor', label: 'Per medico' }, { value: 'area', label: 'Per area' }, { value: 'shift', label: 'Per turno' }]} />
              <Seg value={layout} onChange={v => setUi({ calendarLayout: v })}
                options={[{ value: 'rows', label: 'Giorni in righe' }, { value: 'cols', label: 'Giorni in colonne' }]} />
              {calendarView !== 'doctor' && (
                <label className="check small"><input type="checkbox" checked={showOff} onChange={e => setUi({ showOffCols: e.target.checked })} /> Colonne smonto e riposo</label>
              )}
              {hasCustomWidths(widthScope)
                ? <button className="btn sm ghost" onClick={() => resetColWidths(widthScope)}>Adatta allo schermo</button>
                : <span className="kbd-hint">Trascina il bordo di un’intestazione per allargare o stringere tutte le colonne insieme</span>}
              <div className="spacer" />
              <Legend view={view} />
            </div>
            <div className="card">
              {calendarView === 'doctor' ? <DoctorGrid view={view} highlight={highlight} layout={layout} /> : <AreaGrid view={view} layout={layout} mode={calendarView} />}
            </div>
            <IssuesPanel key={view.version?.id} view={view} onFocus={focusIssue} />
          </>
        )}
      </div>

      {gen && <GenerationProgress gen={gen} />}
      {genAnchor && (
        <Popover anchor={genAnchor} onClose={() => setGenAnchor(null)}>
          <div className="pop-label">Nuova proposta</div>
          <button className="pop-item" onClick={() => generateNow('new', ACCURATE_MS)}><IconSparkle size={16} /> Accurata <span className="why">~10 s, consigliata</span></button>
          <button className="pop-item" onClick={() => generateNow('new', QUICK_MS)}><IconSparkle size={16} /> Rapida <span className="why">~3 s, per una prova veloce</span></button>
          {view.version && (
            <>
              <div className="pop-sep" />
              <div className="pop-label">Rigenera “{view.version.name}”</div>
              <button className="pop-item" onClick={() => generateNow('replace', ACCURATE_MS)}>
                <IconRefresh size={16} /> Rigenera tenendo i turni fissati
                <span className="why">{view.version.assignments.filter(a => a.locked).length} fissati</span>
              </button>
            </>
          )}
        </Popover>
      )}
    </>
  );
}

const ACCURATE_MS = 10_000;
const QUICK_MS = 3_000;

/** Barra di caricamento durante la generazione, con tempo rimanente. */
function GenerationProgress({ gen }: { gen: { progress: number; start: number; timeMs: number; mode: string } }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), 150);
    return () => clearInterval(t);
  }, []);
  const elapsed = now - gen.start;
  // La barra avanza col tempo, e col progresso reale del generatore se e piu avanti.
  const p = Math.min(0.99, Math.max(gen.progress, elapsed / gen.timeMs));
  const left = Math.max(0, Math.ceil((gen.timeMs - elapsed) / 1000));
  const phase = p < 0.45 ? 'Costruisco e confronto molte soluzioni diverse…' : 'Rifinisco la migliore: scambi e spostamenti fra medici…';
  return (
    <div className="modal-scrim gen-scrim" role="alertdialog" aria-live="polite" aria-label="Generazione in corso">
      <div className="modal gen-card">
        <div className="modal-body" style={{ gap: 12, padding: 22 }}>
          <div className="row">
            <IconSparkle size={18} />
            <h2>Genero i turni · modalità {gen.mode}</h2>
          </div>
          <div className="gen-bar"><div style={{ width: `${Math.round(p * 100)}%` }} /></div>
          <div className="row small">
            <span className="muted">{phase}</span>
            <span className="spacer" />
            <b className="num">{Math.round(p * 100)}%</b>
            <span className="muted num">{left > 0 ? `· ~${left} s` : '· quasi fatto'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Onboarding() {
  const config = useStore(s => s.config)!;
  const steps: { done: boolean; title: string; hint: string; page: Page }[] = [
    { done: config.areas.length > 0, title: 'Aggiungi le aree da coprire', hint: 'Sale, postazioni di terapia intensiva, guardie.', page: 'shifts' },
    { done: config.shiftTypes.length > 0, title: 'Scegli le fasce di ogni area', hint: 'Mattina, pomeriggio, notte, lunga… con orari tuoi e quanti medici servono ogni giorno.', page: 'shifts' },
    { done: config.doctors.some(d => d.active), title: 'Aggiungi i medici', hint: 'Con esclusioni, giorni da evitare, ore e limiti di notti.', page: 'doctors' },
  ];
  return (
    <div className="card empty">
      <h2>Prepariamo il servizio</h2>
      <p>Tre passi e puoi generare il primo calendario.</p>
      <div className="steps">
        {steps.map((s, i) => (
          <button key={s.title} className={`step ${s.done ? 'done' : ''}`} onClick={() => setUi({ page: s.page })}>
            <span className="n">{s.done ? <IconCheck size={15} /> : i + 1}</span>
            <span className="col" style={{ gap: 0 }}><strong>{s.title}</strong><span className="hint">{s.hint}</span></span>
          </button>
        ))}
      </div>
    </div>
  );
}

function VersionBar({ view }: { view: MonthView }) {
  const [menu, setMenu] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  const [confirmNode, confirm] = useConfirm();
  const { data, key } = view;
  const target = menu ? data.versions.find(v => v.id === menu.id) : null;

  return (
    <div className="version-bar no-print">
      {data.versions.map(v => (
        <button key={v.id} className={`version-tab ${v.id === view.version?.id ? 'on' : ''}`}
          onClick={e => (v.id === view.version?.id ? setMenu({ id: v.id, anchor: e.currentTarget.getBoundingClientRect() }) : setOpenVersion(key, v.id))}
          title={v.id === data.activeVersionId ? 'Versione definitiva: conta per statistiche ed equità dei mesi successivi' : 'Clicca di nuovo per le opzioni'}>
          {v.id === data.activeVersionId && <span className="star"><IconStar size={14} /></span>}
          {v.name}
          {v.id === view.version?.id && <IconChevronDown size={14} />}
        </button>
      ))}
      {data.activeVersionId === view.version?.id
        ? <span className="hint" style={{ marginLeft: 6 }}>★ definitiva: conta per l’equità dei mesi successivi</span>
        : <button className="btn sm" onClick={() => { setActiveVersion(key, view.version!.id); notify('Versione resa definitiva'); }}><IconStar size={14} /> Rendi definitiva</button>}

      {menu && target && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)}>
          {target.id !== data.activeVersionId && <button className="pop-item" onClick={() => { setActiveVersion(key, target.id); setMenu(null); }}><IconStar size={16} /> Rendi definitiva</button>}
          <button className="pop-item" onClick={() => { setRename({ id: target.id, name: target.name }); setMenu(null); }}>Rinomina</button>
          <button className="pop-item" onClick={() => { duplicateVersion(key, target.id); setMenu(null); }}><IconCopy size={16} /> Duplica</button>
          <div className="pop-sep" />
          <button className="pop-item" onClick={() => { unlockAll(view); setMenu(null); }}>Sblocca tutti i turni fissati</button>
          <button className="pop-item" onClick={() => { clearUnlocked(view); setMenu(null); }}>Togli i turni non fissati</button>
          <div className="pop-sep" />
          <button className="pop-item danger" onClick={() => { setMenu(null); confirm({ title: `Eliminare “${target.name}”?`, message: 'La versione viene cancellata.', confirmLabel: 'Elimina', danger: true, onConfirm: () => deleteVersion(key, target.id) }); }}><IconTrash size={16} /> Elimina versione</button>
        </Popover>
      )}
      {rename && (
        <Modal title="Rinomina versione" onClose={() => setRename(null)} footer={<>
          <button className="btn" onClick={() => setRename(null)}>Annulla</button>
          <button className="btn primary" onClick={() => { renameVersion(key, rename.id, rename.name.trim() || 'Versione'); setRename(null); }}>Salva</button>
        </>}>
          <input className="input" autoFocus value={rename.name} onChange={e => setRename({ ...rename, name: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') { renameVersion(key, rename.id, rename.name.trim() || 'Versione'); setRename(null); } }} />
        </Modal>
      )}
      {confirmNode}
    </div>
  );
}

function Summary({ view }: { view: MonthView }) {
  const a = view.analysis;
  if (!a || !view.ctx) return null;
  const total = a.counts.slots;
  const missing = a.counts.uncovered + a.counts.uncoveredCritical;
  const desReq = Object.values(view.ctx.requests).reduce((s, r) => s + Object.values(r).filter(c => c === 'D').length, 0);
  const desViol = countDays(a.issues, 'desiderata');
  const errors = a.issues.filter(i => i.severity === 'error' && i.kind !== 'uncovered-critical').length;
  const scroll = () => document.getElementById('issues')?.scrollIntoView({ behavior: 'smooth' });
  return (
    <div className="stat-row">
      <div className={`stat ${missing === 0 ? 'good' : a.counts.uncoveredCritical ? 'bad' : 'warn'}`}>
        <span className="stat-value">{total - missing}/{total}</span>
        <span className="stat-label">turni coperti{a.counts.uncoveredCritical ? ` · ${a.counts.uncoveredCritical} critici scoperti` : ''}</span>
      </div>
      <button className={`stat ${errors ? 'bad' : 'good'}`} onClick={scroll}>
        <span className="stat-value">{errors}</span><span className="stat-label">errori (vincoli violati)</span>
      </button>
      <button className={`stat ${a.counts.warnings - a.counts.uncovered ? 'warn' : 'good'}`} onClick={scroll}>
        <span className="stat-value">{a.counts.warnings - a.counts.uncovered}</span><span className="stat-label">avvisi</span>
      </button>
      <div className={`stat ${countDays(a.issues, 'riposo') ? 'warn' : 'good'}`}>
        <span className="stat-value">{countDays(a.issues, 'riposo')}</span><span className="stat-label">riposi post-notte saltati</span>
      </div>
      <div className={`stat ${desViol ? 'desire' : 'good'}`}>
        <span className="stat-value">{desReq - desViol}/{desReq}</span><span className="stat-label">desiderate rispettate</span>
      </div>
    </div>
  );
}

function Legend({ view }: { view: MonthView }) {
  const ctx = view.ctx!;
  return (
    <div className="legend">
      {ctx.config.shiftTypes.map(s => <span key={s.id}><span className="code-tag" style={{ background: s.color }}>{s.code}</span>{s.name}</span>)}
      <span><span className="mark">s</span>smonto</span>
      <span><span className="mark">r</span>riposo</span>
      <span><span className="tone-dot warning" />riposo saltato / altri avvisi</span>
      <span><span className="tone-dot desire" />desiderata non rispettata</span>
      <span><span className="tone-dot error" />vincolo violato</span>
      <span className="kbd-hint">Clicca una casella per vedere e modificare · trascina un turno su un altro per scambiarli · 🔒 = fissato (rigenerando non cambia)</span>
    </div>
  );
}

const GROUPS: { title: string; kinds: IssueKind[] }[] = [
  { title: 'Turni scoperti', kinds: ['uncovered-critical', 'uncovered'] },
  { title: 'Vincoli violati', kinds: ['absence', 'smonto', 'overlap', 'multiple', 'long-split', 'excluded-area', 'excluded-shift', 'weekday-never', 'hours-cap', 'rotation-binding', 'inactive'] },
  { title: 'Desiderate e preferenze', kinds: ['desiderata', 'no-night', 'weekday-avoid', 'max-nights'] },
  { title: 'Riposi e carichi', kinds: ['riposo', 'night-gap', 'consecutive', 'hours-month', 'hours-week'] },
  { title: 'Rotazione e altro', kinds: ['long-split-pref', 'rotation', 'block-split', 'extra'] },
];

function IssuesPanel({ view, onFocus }: { view: MonthView; onFocus: (i: Issue) => void }) {
  const issues = useMemo(() => view.analysis?.issues ?? [], [view.analysis]);
  const [open, setOpen] = useState<Partial<Record<IssueKind, boolean>>>({ 'uncovered-critical': true });
  const [showIgnored, setShowIgnored] = useState(false);
  const [confirmNode, confirm] = useConfirm();
  const ignore = (i: Issue) => {
    const key = issueKey(i);
    if (i.severity !== 'error') { setIssueIgnored(view, key, true); return; }
    confirm({
      title: 'Ignorare questo errore?',
      message: <>È un vincolo violato: <b>{ISSUE_LABELS[i.kind]}</b> — {i.message}. Ignorandolo sparisce dal calendario e dai conteggi di questa versione; puoi ripristinarlo dal gruppo “Ignorate”.</>,
      confirmLabel: 'Ignora errore', danger: true,
      onConfirm: () => setIssueIgnored(view, key, true),
    });
  };
  const ctx = view.ctx!;
  const groups = GROUPS
    .map(g => ({ ...g, kinds: g.kinds.map(k => ({ kind: k, items: issues.filter(i => i.kind === k) })).filter(k => k.items.length > 0) }))
    .filter(g => g.kinds.length > 0);
  const allKinds = groups.flatMap(g => g.kinds.map(k => k.kind));
  const allOpen = allKinds.every(k => open[k]);

  return (
    <section className="card no-print" id="issues">
      <div className="card-head">
        <h2>Segnalazioni</h2>
        <span className="hint" style={{ flexBasis: 'auto' }}>Apri un tipo per vederne l’elenco; clicca una riga per trovarla nel calendario.</span>
        <div className="spacer" />
        {allKinds.length > 0 && (
          <button className="btn sm ghost" onClick={() => setOpen(allOpen ? {} : Object.fromEntries(allKinds.map(k => [k, true])))}>{allOpen ? 'Chiudi tutto' : 'Apri tutto'}</button>
        )}
      </div>
      {groups.length === 0 ? (
        <div className="empty" style={{ padding: 24 }}><IconCheck size={24} /><p>{view.ignored.length ? 'Nessuna segnalazione da guardare (alcune sono state ignorate, vedi sotto).' : 'Nessuna segnalazione: tutti i vincoli e le preferenze sono rispettati.'}</p></div>
      ) : (
        <div className="issue-list">
          {groups.map(g => (
            <div key={g.title}>
              <div className="issue-group-head">{g.title}</div>
              {g.kinds.map(({ kind, items }) => {
                const tones = items.map(issueTone);
                const sev = tones.includes('error') ? 'error' : tones.includes('desire') ? 'desire' : tones.includes('warning') ? 'warning' : 'info';
                const isOpen = !!open[kind];
                return (
                  <div key={kind}>
                    <button className={`issue-kind ${sev}`} aria-expanded={isOpen} onClick={() => setOpen({ ...open, [kind]: !isOpen })}>
                      <span className={`chev ${isOpen ? 'open' : ''}`}><IconChevronDown size={15} /></span>
                      <span className={`dot ${sev}`} />
                      <span className="grow">{ISSUE_LABELS[kind]}</span>
                      <span className={`badge ${sev === 'error' ? 'bad' : sev === 'warning' ? 'warn' : sev === 'desire' ? 'info' : ''}`}>{items.length}</span>
                    </button>
                    {isOpen && items.map((i, n) => (
                      <div key={n} className="issue" onClick={() => onFocus(i)}>
                        <span className={`dot ${issueTone(i)}`} />
                        <span className="grow">
                          {i.doctorId && <b>{ctx.doctorById.get(i.doctorId)?.name ?? 'Medico'} · </b>}
                          {i.message}
                        </span>
                        {i.severity !== 'info' && (
                          <button className="btn sm ghost ignore-btn" onClick={e => { e.stopPropagation(); ignore(i); }}
                            title={i.severity === 'error' ? 'Ignora questo errore (chiede conferma)' : 'Ignora questo avviso'}>Ignora</button>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {view.ignored.length > 0 && (
        <div className="issue-list">
          <button className="issue-kind info" aria-expanded={showIgnored} onClick={() => setShowIgnored(!showIgnored)}>
            <span className={`chev ${showIgnored ? 'open' : ''}`}><IconChevronDown size={15} /></span>
            <span className="dot info" />
            <span className="grow">Ignorate</span>
            <span className="badge">{view.ignored.length}</span>
          </button>
          {showIgnored && (
            <>
              {view.ignored.map(i => (
                <div key={issueKey(i)} className="issue ignored">
                  <span className={`dot ${issueTone(i)}`} />
                  <span className="grow">
                    <span className="tiny muted">{ISSUE_LABELS[i.kind]} · </span>
                    {i.doctorId && <b>{ctx.doctorById.get(i.doctorId)?.name ?? 'Medico'} · </b>}
                    {i.message}
                  </span>
                  <button className="btn sm ghost" onClick={() => setIssueIgnored(view, issueKey(i), false)}>Ripristina</button>
                </div>
              ))}
              <button className="btn ghost sm" style={{ margin: '6px 12px' }} onClick={() => restoreAllIssues(view)}>Ripristina tutte</button>
            </>
          )}
        </div>
      )}
      {confirmNode}
    </section>
  );
}

/** Avviso rosso in alto quando mancano turni critici. */
function CriticalBanner({ view }: { view: MonthView }) {
  const a = view.analysis;
  if (!a) return null;
  const crit = a.counts.uncoveredCritical;
  const normal = a.counts.uncovered;
  if (crit === 0 && normal === 0) return null;
  const go = () => document.getElementById('issues')?.scrollIntoView({ behavior: 'smooth' });
  return (
    <button className={`alert-banner no-print ${crit ? 'crit' : ''}`} onClick={go}>
      <span className="big">{crit ? '‼' : '!'}</span>
      <span>
        {crit > 0 && <b>{crit} {crit === 1 ? 'turno critico scoperto' : 'turni critici scoperti'}</b>}
        {crit > 0 && normal > 0 && ' · '}
        {normal > 0 && <span>{normal} {normal === 1 ? 'turno normale scoperto' : 'turni normali scoperti'}</span>}
        <span className="hint" style={{ display: 'block' }}>Clicca per vedere quali; nel calendario sono segnati con ‼ (critici) e ! (normali).</span>
      </span>
    </button>
  );
}

/** Avviso quando le notti del mese sono troppe per i medici che possono farle. */
function CapacityNotice({ view }: { view: MonthView }) {
  const cap = useMemo(() => (view.ctx ? nightCapacity(view.ctx) : null), [view.ctx]);
  if (!cap || !cap.short || !view.ctx) return null;
  const gap = view.ctx.config.rules.minNightGap;
  return (
    <div className="alert-banner no-print" style={{ cursor: 'default' }}>
      <span className="big">!</span>
      <span>
        <b>Notti difficili da distribuire: {cap.nights} notti questo mese, ma solo {cap.eligible.length} medici possono farle (circa {cap.perDoctor.toFixed(1)} a testa).</b>
        <span className="hint" style={{ display: 'block' }}>
          Rispettando la distanza minima di {gap} giorni ne coprono al massimo {cap.capacity}: per forza qualcuno avrà notti ravvicinate.
          {cap.excluded.length > 0 && <> Non fanno notti: {cap.excluded.join(', ')}.</>}
          {' '}Si risolve abilitando altri medici alle notti, riducendo le notti richieste o abbassando la distanza minima in Regole.
        </span>
        <span className="row" style={{ marginTop: 6 }}>
          <button className="btn sm" onClick={() => setUi({ page: 'doctors' })}>Medici</button>
          <button className="btn sm" onClick={() => setUi({ page: 'rules' })}>Regole</button>
        </span>
      </span>
    </div>
  );
}

