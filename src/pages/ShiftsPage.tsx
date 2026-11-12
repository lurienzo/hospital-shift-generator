import { useEffect, useRef, useState } from 'react';
import { WEEKDAY_LONG, shiftHours } from '../domain/dates';
import { makeArea, nextColor, SHIFT_PRESETS, uid, WEEKDAYS, WEEKEND_HOL } from '../domain/defaults';
import {
  addExistingFascia, addNewFascia, areasUsing, deleteArea, deleteShift, fasceOf, isReferenced, moveFascia, removeFascia, setCells, splitFascia,
} from '../domain/fasce';
import { DAY_KEYS, DAY_LABELS, type Area, type CoverageCell, type DayKey, type ServiceConfig, type ShiftType } from '../domain/types';
import { notify, updateConfig, useStore } from '../store/store';
import { IconCopy, IconPlus, IconTrash, IconX } from '../ui/icons';
import { ColorInput, Popover, TextInput } from '../ui/kit';
import { textOn } from '../ui/color';
import { useConfirm } from '../ui/useConfirm';
import { Topbar } from '../ui/Topbar';

type Confirm = ReturnType<typeof useConfirm>[1];

const patchShift = (id: string, patch: Partial<ShiftType>) =>
  updateConfig(c => ({ ...c, shiftTypes: c.shiftTypes.map(s => (s.id === id ? { ...s, ...patch } : s)) }));

export function ShiftsPage() {
  const config = useStore(s => s.config)!;
  const [confirmNode, confirm] = useConfirm();

  const moveArea = (id: string, delta: number) => updateConfig(c => {
    const i = c.areas.findIndex(a => a.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= c.areas.length) return c;
    const areas = [...c.areas];
    [areas[i], areas[j]] = [areas[j], areas[i]];
    return { ...c, areas };
  });
  const addArea = () => updateConfig(c => ({
    ...c,
    areas: [...c.areas, makeArea(`Area ${c.areas.length + 1}`, nextColor(c.areas.map(a => a.color)))],
  }));
  // Turni rimasti senza nessuna area (da configurazioni precedenti).
  const unused = config.shiftTypes.filter(s => areasUsing(config, s.id).length === 0);

  return (
    <>
      <Topbar title="Turni e copertura">
        <button className="btn primary" onClick={addArea}><IconPlus size={16} /> Aggiungi area</button>
      </Topbar>
      <div className="content narrow" style={{ maxWidth: 1180 }}>
        <p className="hint">
          Ogni <b>area</b> (sala, postazione, guardia) ha le sue <b>fasce</b>: nome, orario e quanti medici servono in ogni giorno. Tutto si cambia direttamente nella riga.
          {' '}<b>Clicca</b> una casella per accenderla o spegnerla e <b>trascina</b> per farlo su più giorni; con <b>+ −</b> cambi il numero di medici; <b>C</b> = critico, va coperto sempre.
          {' '}<b>Festivo</b> vale per i festivi infrasettimanali. Una fascia <b>Notte</b> impone lo smonto il giorno dopo e conta il riposo il secondo.
        </p>

        {config.areas.length === 0 && (
          <div className="card empty">
            <h2>Nessuna area</h2>
            <p>Aggiungi una sala, una postazione di terapia intensiva o una guardia: poi scegli le sue fasce.</p>
            <button className="btn primary" onClick={addArea}><IconPlus size={16} /> Aggiungi area</button>
          </div>
        )}
        {config.areas.map((area, i) => (
          <AreaCard key={area.id} config={config} area={area} confirm={confirm}
            onMove={delta => moveArea(area.id, delta)} first={i === 0} last={i === config.areas.length - 1} />
        ))}

        {unused.length > 0 && (
          <section className="card card-body col" style={{ gap: 8 }}>
            <span className="label">Turni non usati in nessuna area</span>
            <p className="hint">Li puoi aggiungere a un’area dalla riga “Aggiungi fascia”, oppure eliminarli.</p>
            <div className="row wrap" style={{ gap: 6 }}>
              {unused.map(s => (
                <span key={s.id} className="chip">
                  <span className="code-tag" style={{ background: s.color, color: textOn(s.color) }}>{s.code}</span>
                  {s.name} <span className="tiny muted num">{s.start}–{s.end}</span>
                  <button title="Elimina" aria-label={`Elimina ${s.name}`} onClick={() => confirm({
                    title: `Eliminare ${s.name}?`, message: 'Viene tolto anche dalle rotazioni e dalle regole dei medici.', confirmLabel: 'Elimina', danger: true,
                    onConfirm: () => updateConfig(c => deleteShift(c, s.id)),
                  })}>×</button>
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
      {confirmNode}
    </>
  );
}

interface Paint { shiftId: string; cell: CoverageCell }

function AreaCard({ config, area, confirm, onMove, first, last }: {
  config: ServiceConfig; area: Area; confirm: Confirm; onMove: (delta: number) => void; first: boolean; last: boolean;
}) {
  const rows = fasceOf(config, area);
  const [menu, setMenu] = useState<{ shiftId: string; anchor: DOMRect } | null>(null);
  const [focusName, setFocusName] = useState<string | null>(null);
  // Trascinando si applica alle caselle attraversate lo stesso valore della prima.
  const paint = useRef<Paint | null>(null);
  useEffect(() => {
    const stop = () => { paint.current = null; };
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, []);

  const patch = (p: Partial<Area>) => updateConfig(c => ({ ...c, areas: c.areas.map(a => (a.id === area.id ? { ...a, ...p } : a)) }));
  const cell = (k: DayKey, sid: string): CoverageCell => area.coverage[k]?.[sid] ?? { count: 0, critical: false };
  const set = (sid: string, keys: readonly DayKey[], next: (c: CoverageCell, k: DayKey) => CoverageCell) =>
    updateConfig(c => setCells(c, area.id, sid, keys, next));
  /** Valore "acceso" della riga: lo stesso numero e la stessa criticita che ha gia. */
  const rowOn = (sid: string): CoverageCell => ({
    count: Math.max(1, ...DAY_KEYS.map(k => cell(k, sid).count)),
    critical: DAY_KEYS.some(k => cell(k, sid).critical),
  });
  const fill = (sid: string, keys: readonly DayKey[]) => {
    const on = rowOn(sid);
    set(sid, DAY_KEYS, (_c, k) => (keys.includes(k) ? on : { count: 0, critical: false }));
  };
  const startPaint = (sid: string, k: DayKey) => {
    const value = cell(k, sid).count > 0 ? { count: 0, critical: false } : rowOn(sid);
    paint.current = { shiftId: sid, cell: value };
    set(sid, [k], () => value);
  };
  const paintOver = (sid: string, k: DayKey) => {
    const p = paint.current;
    if (p && p.shiftId === sid) set(sid, [k], () => p.cell);
  };
  const step = (sid: string, k: DayKey, delta: number) =>
    set(sid, [k], x => { const count = Math.min(9, Math.max(0, x.count + delta)); return { count, critical: count > 0 && x.critical }; });
  const toggleRowCritical = (sid: string) => {
    const active = DAY_KEYS.filter(k => cell(k, sid).count > 0);
    const all = active.every(k => cell(k, sid).critical);
    set(sid, active, x => ({ ...x, critical: !all }));
  };

  const remove = (s: ShiftType) => {
    const elsewhere = areasUsing(config, s.id).some(a => a.id !== area.id);
    const go = () => updateConfig(c => removeFascia(c, area.id, s.id));
    // Se e l'ultima area che la usa e una rotazione o un medico la citano, si chiede conferma.
    if (!elsewhere && isReferenced(config, s.id)) {
      confirm({
        title: `Eliminare ${s.name}?`,
        message: 'Non è usata in nessun’altra area: sparisce anche dallo schema di rotazione e dalle regole dei medici.',
        confirmLabel: 'Elimina', danger: true, onConfirm: go,
      });
    } else go();
  };

  const duplicate = () => updateConfig(c => ({
    ...c,
    areas: [...c.areas, { ...area, id: uid('a'), coverage: structuredClone(area.coverage), name: `${area.name} (copia)`, color: nextColor(c.areas.map(a => a.color)) }],
  }));

  const addCustom = () => {
    const name = 'Nuova fascia';
    updateConfig(c => addNewFascia(c, area.id, { name, code: 'T', start: '08:00', end: '14:00', color: nextColor(c.shiftTypes.map(s => s.color)), kind: 'day', block: null }));
    setFocusName(name);
  };

  const others = config.shiftTypes.filter(s => !rows.includes(s));
  const presets = SHIFT_PRESETS.filter(p => !config.shiftTypes.some(s => s.name.toLowerCase() === p.name.toLowerCase()));
  const total = DAY_KEYS.slice(0, 7).reduce((s, k) => s + Object.values(area.coverage[k] ?? {}).reduce((x, c) => x + c.count, 0), 0);
  const menuShift = menu ? rows.find(s => s.id === menu.shiftId) : undefined;
  const closeMenu = () => setMenu(null);

  return (
    <section className="card">
      <div className="card-head">
        <ColorInput value={area.color} onChange={color => patch({ color })} />
        <TextInput value={area.name} onCommit={name => name.trim() && patch({ name: name.trim() })} style={{ fontWeight: 650, width: 240 }} aria-label="Nome area" />
        <span className="badge">{total} turni/settimana</span>
        <div className="spacer" />
        <button className="btn sm ghost" onClick={duplicate} title="Crea un’altra area con le stesse fasce"><IconCopy size={16} /> Duplica</button>
        <button className="btn sm ghost danger" onClick={() => confirm({
          title: `Eliminare ${area.name}?`, message: 'L’area non verrà più coperta dai prossimi calendari. Le fasce usate solo qui vengono eliminate.', confirmLabel: 'Elimina', danger: true,
          onConfirm: () => updateConfig(c => deleteArea(c, area.id)),
        })}><IconTrash size={16} /> Elimina</button>
        <div className="row" style={{ gap: 2 }}>
          <button className="btn ghost sm icon" disabled={first} onClick={() => onMove(-1)} aria-label="Sposta l’area su" title="Sposta su: l’ordine delle aree è quello delle colonne del calendario">↑</button>
          <button className="btn ghost sm icon" disabled={last} onClick={() => onMove(1)} aria-label="Sposta l’area giù" title="Sposta giù">↓</button>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="card-body table-wrap">
          <table className="cov">
            <thead>
              <tr>
                <th className="lbl">Fascia</th>
                {DAY_KEYS.map(k => <th key={k} className={k === 'hol' ? 'hol' : ''}>{DAY_LABELS[k]}</th>)}
                <th className="sticky-actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map(s => {
                const shared = areasUsing(config, s.id).filter(a => a.id !== area.id);
                return (
                  <tr key={s.id}>
                    <td className="lbl">
                      <div className="fascia">
                        <div className="row" style={{ gap: 6 }}>
                          <ColorInput value={s.color} onChange={color => patchShift(s.id, { color })} />
                          <TextInput className="input sm code" value={s.code} onCommit={code => code.trim() && patchShift(s.id, { code: code.trim().toUpperCase().slice(0, 3) })} aria-label="Sigla" />
                          <NameInput value={s.name} autoSelect={focusName === s.name} onDone={() => setFocusName(null)} onCommit={name => patchShift(s.id, { name })} />
                        </div>
                        <div className="row" style={{ gap: 5 }}>
                          <input className="input sm time" type="time" value={s.start} onChange={e => e.target.value && patchShift(s.id, { start: e.target.value })} aria-label="Inizio" />
                          <span className="muted">–</span>
                          <input className="input sm time" type="time" value={s.end} onChange={e => e.target.value && patchShift(s.id, { end: e.target.value })} aria-label="Fine" />
                          <span className="tiny muted num">{shiftHours(s.start, s.end)}h</span>
                          <button type="button" className={`tag-toggle ${s.kind === 'night' ? 'on' : ''}`} aria-pressed={s.kind === 'night'}
                            title="Notte: il giorno dopo è smonto (non si lavora) e il secondo giorno è riposo" onClick={() => patchShift(s.id, { kind: s.kind === 'night' ? 'day' : 'night' })}>Notte</button>
                          {s.optional && <span className="badge" title="Può restare vuota senza avvisi">opzionale</span>}
                          {s.block && <span className="badge" title="Diurnismo: una settimana intera allo stesso medico">a settimane</span>}
                          {shared.length > 0 && (
                            <span className="badge primary" title={`Nome, orario e colore valgono anche per: ${shared.map(a => a.name).join(', ')}. Per cambiarli solo qui: ⋯ → Separa dalle altre aree.`}>
                              anche in {shared.length === 1 ? shared[0].name : `${shared.length} aree`}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    {DAY_KEYS.map(k => {
                      const c = cell(k, s.id);
                      return (
                        <td key={k}>
                          <div className={`cov-cell ${c.count > 0 ? (c.critical ? 'critical' : 'active') : ''}`}>
                            <div className="cov-count">
                              <button type="button" tabIndex={-1} className="cov-step" disabled={c.count === 0} onClick={() => step(s.id, k, -1)} aria-label="Un medico in meno">−</button>
                              <button type="button" className="cov-num" title={`${s.name} · ${DAY_LABELS[k]}: ${c.count} ${c.count === 1 ? 'medico' : 'medici'}. Clicca per accendere o spegnere, trascina per più giorni.`}
                                onMouseDown={e => { if (e.button === 0) { e.preventDefault(); startPaint(s.id, k); } }}
                                onMouseEnter={() => paintOver(s.id, k)}
                                onKeyDown={e => {
                                  if (/^\d$/.test(e.key)) set(s.id, [k], x => ({ count: Number(e.key), critical: Number(e.key) > 0 && x.critical }));
                                  else if (e.key === '+' || e.key === 'ArrowUp') { e.preventDefault(); step(s.id, k, 1); }
                                  else if (e.key === '-' || e.key === 'ArrowDown') { e.preventDefault(); step(s.id, k, -1); }
                                  else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); const v = c.count > 0 ? { count: 0, critical: false } : rowOn(s.id); set(s.id, [k], () => v); }
                                  else if (e.key.toLowerCase() === 'c' && c.count > 0) set(s.id, [k], x => ({ ...x, critical: !x.critical }));
                                }}>{c.count > 0 ? c.count : ''}</button>
                              <button type="button" tabIndex={-1} className="cov-step" disabled={c.count >= 9} onClick={() => step(s.id, k, 1)} aria-label="Un medico in più">+</button>
                            </div>
                            <button type="button" tabIndex={-1} className={`crit-toggle ${c.critical ? 'on' : ''}`} disabled={c.count === 0}
                              title={c.critical ? 'Critico: va coperto sempre' : 'Rendi critico'}
                              onClick={() => set(s.id, [k], x => ({ ...x, critical: !x.critical }))}>C</button>
                          </div>
                        </td>
                      );
                    })}
                    <td className="sticky-actions">
                      <div className="row" style={{ gap: 2 }}>
                        <button className="btn ghost sm icon" title="Altre opzioni: riempi i giorni, opzionale, diurnismo, sposta" aria-label={`Opzioni di ${s.name}`}
                          onClick={e => setMenu({ shiftId: s.id, anchor: e.currentTarget.getBoundingClientRect() })}>⋯</button>
                        <button className="btn ghost sm icon danger" title="Togli questa fascia dall’area" aria-label={`Togli ${s.name}`} onClick={() => remove(s)}><IconX size={16} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="fascia-add">
        <span className="label">{rows.length === 0 ? 'Scegli le fasce di quest’area' : 'Aggiungi fascia'}</span>
        {others.map(s => (
          <button key={s.id} className="add-chip" title={`Aggiungi ${s.name} (${s.start}–${s.end}), già usata in ${areasUsing(config, s.id).map(a => a.name).join(', ') || 'nessuna area'}`}
            onClick={() => updateConfig(c => addExistingFascia(c, area.id, s.id))}>
            <span className="code-tag" style={{ background: s.color, color: textOn(s.color) }}>{s.code}</span>{s.name}<span className="tiny muted num">{s.start}–{s.end}</span>
          </button>
        ))}
        {presets.map(p => (
          <button key={p.name} className="add-chip new" title={`Nuova fascia ${p.name} (${p.start}–${p.end})${p.kind === 'night' ? ', notte' : ''}${p.block ? ', a settimane' : ''}: poi la modifichi come vuoi`}
            onClick={() => updateConfig(c => addNewFascia(c, area.id, p))}>
            <IconPlus size={13} />{p.name}<span className="tiny muted num">{p.start}–{p.end}</span>
          </button>
        ))}
        <button className="add-chip new" onClick={addCustom} title="Una fascia con nome e orario tuoi"><IconPlus size={13} />Personalizzata</button>
      </div>

      {menu && menuShift && (
        <Popover anchor={menu.anchor} onClose={closeMenu}>
          <div className="pop-label">Giorni di {menuShift.name}</div>
          <button className="pop-item" onClick={() => { fill(menuShift.id, WEEKDAYS); closeMenu(); }}>Solo feriali <span className="why">lun–ven</span></button>
          <button className="pop-item" onClick={() => { fill(menuShift.id, WEEKEND_HOL); closeMenu(); }}>Solo weekend e festivi <span className="why">sab, dom, festivi</span></button>
          <button className="pop-item" onClick={() => { fill(menuShift.id, DAY_KEYS); closeMenu(); }}>Tutti i giorni</button>
          <button className="pop-item" onClick={() => { fill(menuShift.id, []); closeMenu(); }}>Nessun giorno</button>
          <button className="pop-item" onClick={() => { toggleRowCritical(menuShift.id); closeMenu(); }}>Critico sì / no su tutta la riga</button>
          <div className="pop-sep" />
          <label className="pop-item" title="Se resta vuota non dà avvisi; il generatore la assegna solo a chi è sotto carico">
            <input type="checkbox" checked={!!menuShift.optional} onChange={e => patchShift(menuShift.id, { optional: e.target.checked })} style={{ accentColor: 'var(--primary)' }} />
            Opzionale <span className="why">può restare vuota</span>
          </label>
          <label className="pop-item" title="Diurnismo: la fascia si assegna a settimane intere allo stesso medico">
            <input type="checkbox" checked={menuShift.block !== null} onChange={e => patchShift(menuShift.id, { block: e.target.checked ? { startWeekday: 0 } : null })} style={{ accentColor: 'var(--primary)' }} />
            A settimane <span className="why">diurnismo</span>
          </label>
          {menuShift.block && (
            <div className="pop-item" style={{ cursor: 'default' }}>
              <span className="muted">La settimana inizia</span>
              <select className="select sm" value={menuShift.block.startWeekday} onChange={e => patchShift(menuShift.id, { block: { startWeekday: Number(e.target.value) } })} aria-label="Inizio settimana">
                {WEEKDAY_LONG.map((w, i) => <option key={i} value={i}>{w.toLowerCase()}</option>)}
              </select>
            </div>
          )}
          <div className="pop-sep" />
          <button className="pop-item" disabled={rows[0]?.id === menuShift.id} onClick={() => { updateConfig(c => moveFascia(c, area.id, menuShift.id, -1)); closeMenu(); }}>Sposta su</button>
          <button className="pop-item" disabled={rows[rows.length - 1]?.id === menuShift.id} onClick={() => { updateConfig(c => moveFascia(c, area.id, menuShift.id, 1)); closeMenu(); }}>Sposta giù</button>
          {areasUsing(config, menuShift.id).length > 1 && (
            <button className="pop-item" title="Quest’area riceve una copia propria: nome e orario si cambiano senza toccare le altre aree. Per la rotazione diventa un turno diverso."
              onClick={() => { updateConfig(c => splitFascia(c, area.id, menuShift.id)); closeMenu(); notify('Fascia separata: ora vale solo per quest’area'); }}>
              Separa dalle altre aree <span className="why">orario solo qui</span>
            </button>
          )}
          <button className="pop-item danger" onClick={() => { closeMenu(); remove(menuShift); }}>Togli la fascia dall’area</button>
        </Popover>
      )}
    </section>
  );
}

/** Nome della fascia: una fascia appena creata arriva già selezionata, pronta da rinominare. */
function NameInput({ value, autoSelect, onDone, onCommit }: { value: string; autoSelect: boolean; onDone: () => void; onCommit: (name: string) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!autoSelect) return;
    const input = ref.current?.querySelector('input');
    input?.focus();
    input?.select();
    onDone();
  }, [autoSelect, onDone]);
  return (
    <span ref={ref}>
      <TextInput className="input sm" value={value} onCommit={name => name.trim() && onCommit(name.trim())} style={{ width: 170, fontWeight: 600 }} aria-label="Nome della fascia" />
    </span>
  );
}
