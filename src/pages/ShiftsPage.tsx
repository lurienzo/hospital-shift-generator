import { useState } from 'react';
import { WEEKDAY_LONG, shiftHours } from '../domain/dates';
import { makeArea, makeShift, nextColor, SHIFT_PRESETS, uid, WEEKDAYS, WEEKEND_HOL } from '../domain/defaults';
import { DAY_KEYS, DAY_LABELS, type Area, type CoverageCell, type DayKey, type ShiftType } from '../domain/types';
import { updateConfig, useStore } from '../store/store';
import { IconChevronDown, IconCopy, IconPlus, IconTrash } from '../ui/icons';
import { ColorInput, Popover, Seg, Stepper, TextInput } from '../ui/kit';
import { textOn } from '../ui/color';
import { shortName } from '../io/excel';
import { useConfirm } from '../ui/useConfirm';
import { Topbar } from '../ui/Topbar';

export function ShiftsPage() {
  const config = useStore(s => s.config)!;
  const [confirmNode, confirm] = useConfirm();
  const [presetAnchor, setPresetAnchor] = useState<DOMRect | null>(null);

  const patchShift = (id: string, patch: Partial<ShiftType>) =>
    updateConfig(c => ({ ...c, shiftTypes: c.shiftTypes.map(s => (s.id === id ? { ...s, ...patch } : s)) }));

  const addShift = (preset: Omit<ShiftType, 'id'>) => updateConfig(c => {
    const used = new Set(c.shiftTypes.map(s => s.code));
    let code = preset.code;
    for (let i = 2; used.has(code); i++) code = `${preset.code}${i}`;
    return { ...c, shiftTypes: [...c.shiftTypes, makeShift({ ...preset, code })] };
  });

  const removeShift = (s: ShiftType) => confirm({
    title: `Eliminare il turno ${s.name}?`,
    message: 'Viene tolto dalla copertura delle aree, dalle esclusioni dei medici e dagli schemi di rotazione. I calendari già fatti lo mostreranno come turno sconosciuto.',
    confirmLabel: 'Elimina', danger: true,
    onConfirm: () => updateConfig(c => ({
      ...c,
      shiftTypes: c.shiftTypes.filter(x => x.id !== s.id),
      areas: c.areas.map(a => ({ ...a, coverage: dropShift(a.coverage, s.id) })),
      doctors: c.doctors.map(d => ({ ...d, excludedShiftIds: d.excludedShiftIds.filter(x => x !== s.id), weekdayRules: d.weekdayRules.filter(r => r.shiftId !== s.id) })),
      rules: { ...c.rules, schemes: c.rules.schemes.map(sc => ({ ...sc, steps: sc.steps.filter(st => st.kind !== 'shift' || st.shiftId !== s.id) })) },
    })),
  });

  const move = (id: string, delta: number) => updateConfig(c => {
    const list = [...c.shiftTypes];
    const i = list.findIndex(s => s.id === id);
    const j = i + delta;
    if (j < 0 || j >= list.length) return c;
    [list[i], list[j]] = [list[j], list[i]];
    return { ...c, shiftTypes: list };
  });

  /** Restringe un turno a un'area: dalle altre aree sparisce dalla copertura. */
  const setShiftArea = (id: string, areaId: string | null) => updateConfig(c => ({
    ...c,
    shiftTypes: c.shiftTypes.map(s => (s.id === id ? { ...s, areaId } : s)),
    areas: areaId === null ? c.areas : c.areas.map(a => (a.id === areaId ? a : { ...a, coverage: dropShift(a.coverage, id) })),
  }));

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

  return (
    <>
      <Topbar title="Turni e copertura" />
      <div className="content narrow" style={{ maxWidth: 1180 }}>
        <section className="card">
          <div className="card-head">
            <h2>Tipi di turno</h2>
            <div className="spacer" />
            <button className="btn primary sm" onClick={e => setPresetAnchor(e.currentTarget.getBoundingClientRect())}><IconPlus size={16} /> Aggiungi turno</button>
            <p className="hint">
              Le <b>notti</b> impongono lo smonto il giorno dopo e contano un riposo il secondo giorno. Un turno <b>opzionale</b> può restare vuoto senza avvisi. Il <b>diurnismo</b> si assegna a settimane intere allo stesso medico.
              Se la fine è prima dell’inizio, il turno scavalca la mezzanotte.
            </p>
          </div>
          {config.shiftTypes.length === 0 ? (
            <div className="empty"><p>Nessun turno. Aggiungine uno dai modelli, poi modificalo come vuoi.</p></div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th /><th>Nome</th><th>Sigla</th><th>Inizio</th><th>Fine</th><th className="r">Ore</th><th>Tipo</th><th title="Se resta vuoto non è un problema">Opzionale</th><th>Diurnismo</th><th>Vale per</th><th className="sticky-actions" /></tr>
                </thead>
                <tbody>
                  {config.shiftTypes.map((s, i) => (
                    <tr key={s.id}>
                      <td><ColorInput value={s.color} onChange={color => patchShift(s.id, { color })} /></td>
                      <td><TextInput value={s.name} onCommit={name => name.trim() && patchShift(s.id, { name: name.trim() })} style={{ width: 150 }} aria-label="Nome turno" /></td>
                      <td><TextInput className="input code" value={s.code} onCommit={code => code.trim() && patchShift(s.id, { code: code.trim().toUpperCase().slice(0, 3) })} aria-label="Sigla" /></td>
                      <td><input className="input time" type="time" value={s.start} onChange={e => e.target.value && patchShift(s.id, { start: e.target.value })} aria-label="Inizio" /></td>
                      <td><input className="input time" type="time" value={s.end} onChange={e => e.target.value && patchShift(s.id, { end: e.target.value })} aria-label="Fine" /></td>
                      <td className="r num">{shiftHours(s.start, s.end)}h</td>
                      <td>
                        <Seg small value={s.kind} onChange={kind => patchShift(s.id, { kind })}
                          options={[{ value: 'day', label: 'Diurno' }, { value: 'night', label: 'Notte', title: 'Smonto il giorno dopo, riposo il secondo' }]} />
                      </td>
                      <td className="c">
                        <input type="checkbox" checked={!!s.optional} aria-label="Turno opzionale" style={{ accentColor: 'var(--primary)', width: 16, height: 16 }}
                          title="Opzionale / da non coprire: se resta vuoto non dà avvisi; il generatore lo assegna solo a chi è sotto carico"
                          onChange={e => patchShift(s.id, { optional: e.target.checked })} />
                      </td>
                      <td>
                        <div className="row">
                          <input type="checkbox" className="check" checked={s.block !== null} aria-label="Diurnismo a settimane"
                            onChange={e => patchShift(s.id, { block: e.target.checked ? { startWeekday: 0 } : null })} style={{ accentColor: 'var(--primary)' }} />
                          {s.block && (
                            <select className="select sm" value={s.block.startWeekday} onChange={e => patchShift(s.id, { block: { startWeekday: Number(e.target.value) } })} aria-label="Inizio settimana">
                              {WEEKDAY_LONG.map((w, k) => <option key={k} value={k}>da {w.toLowerCase()}</option>)}
                            </select>
                          )}
                        </div>
                      </td>
                      <td>
                        <select className="select sm" value={s.areaId ?? ''} aria-label="Aree in cui vale"
                          onChange={e => setShiftArea(s.id, e.target.value || null)}>
                          <option value="">Tutte le aree</option>
                          {config.areas.map(a => <option key={a.id} value={a.id}>Solo {a.name}</option>)}
                        </select>
                      </td>
                      <td className="r sticky-actions">
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 2 }}>
                          <button className="btn ghost sm icon" disabled={i === 0} onClick={() => move(s.id, -1)} aria-label="Sposta su">↑</button>
                          <button className="btn ghost sm icon" disabled={i === config.shiftTypes.length - 1} onClick={() => move(s.id, 1)} aria-label="Sposta giù">↓</button>
                          <button className="btn ghost sm icon danger" onClick={() => removeShift(s)} aria-label="Elimina turno"><IconTrash size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="row">
          <div className="col" style={{ gap: 2 }}>
            <h2>Aree e copertura</h2>
            <p className="hint">Per ogni area, quanti medici servono per turno e giorno. La colonna <b>Festivo</b> vale per i festivi infrasettimanali (in automatico). <b>C</b> = critico: va coperto sempre. Con <b>↑ ↓</b> scegli l’ordine delle aree: è l’ordine delle colonne nel calendario e nella stampa.</p>
          </div>
          <div className="spacer" />
          <button className="btn primary" onClick={addArea}><IconPlus size={16} /> Aggiungi area</button>
        </div>

        {config.areas.length === 0 && <div className="card empty"><p>Nessuna area da coprire. Aggiungi una sala, una postazione di terapia intensiva o una guardia.</p></div>}
        {config.areas.map((area, i) => <AreaCard key={area.id} area={area} shifts={config.shiftTypes}
          onMove={delta => moveArea(area.id, delta)} first={i === 0} last={i === config.areas.length - 1} onDelete={() => confirm({
          title: `Eliminare ${area.name}?`, message: 'L’area non verrà più coperta dai prossimi calendari.', confirmLabel: 'Elimina', danger: true,
          onConfirm: () => updateConfig(c => {
            const own = new Set(c.shiftTypes.filter(s => s.areaId === area.id).map(s => s.id));
            return {
              ...c,
              areas: c.areas.filter(a => a.id !== area.id),
              shiftTypes: c.shiftTypes.filter(s => !own.has(s.id)),
              doctors: c.doctors.map(d => ({ ...d, excludedAreaIds: d.excludedAreaIds.filter(x => x !== area.id), excludedShiftIds: d.excludedShiftIds.filter(x => !own.has(x)) })),
            };
          }),
        })} />)}
      </div>

      {presetAnchor && (
        <Popover anchor={presetAnchor} onClose={() => setPresetAnchor(null)}>
          <div className="pop-label">Modelli</div>
          {SHIFT_PRESETS.map(p => (
            <button key={p.name} className="pop-item" onClick={() => { addShift(p); setPresetAnchor(null); }}>
              <span className="code-tag" style={{ background: p.color, color: textOn(p.color) }}>{p.code}</span>
              {p.name}
              <span className="why">{p.start}–{p.end}{p.kind === 'night' ? ' · notte' : ''}{p.block ? ' · a settimane' : ''}</span>
            </button>
          ))}
          <div className="pop-sep" />
          <button className="pop-item" onClick={() => { addShift({ name: 'Nuovo turno', code: 'T', start: '08:00', end: '14:00', color: nextColor(config.shiftTypes.map(s => s.color)), kind: 'day', block: null }); setPresetAnchor(null); }}>
            Turno personalizzato
          </button>
        </Popover>
      )}
      {confirmNode}
    </>
  );
}

function dropShift(coverage: Area['coverage'], shiftId: string): Area['coverage'] {
  return Object.fromEntries(DAY_KEYS.map(k => {
    const { [shiftId]: _drop, ...rest } = coverage[k] ?? {};
    void _drop;
    return [k, rest];
  })) as Area['coverage'];
}

function AreaCard({ area, shifts: allShifts, onDelete, onMove, first, last }: {
  area: Area; shifts: ShiftType[]; onDelete: () => void; onMove: (delta: number) => void; first: boolean; last: boolean;
}) {
  const shifts = allShifts.filter(s => !s.areaId || s.areaId === area.id);
  const patchShift = (id: string, p: Partial<ShiftType>) => updateConfig(c => ({ ...c, shiftTypes: c.shiftTypes.map(s => (s.id === id ? { ...s, ...p } : s)) }));
  /** Nuovo orario solo per quest'area, gia attivo dal lunedi al venerdi. */
  const addOwnShift = () => updateConfig(c => {
    const used = new Set(c.shiftTypes.map(s => s.code));
    const base = shortName(area.name).toUpperCase().slice(0, 3) || 'A';
    let code = base;
    for (let i = 2; used.has(code); i++) code = `${base.slice(0, 2)}${i}`;
    const shift: ShiftType = { ...makeShift({ name: `${area.name} 9–17`, code, start: '09:00', end: '17:00', color: area.color, kind: 'day', block: null }), areaId: area.id };
    const coverage = { ...area.coverage };
    for (const k of WEEKDAYS) coverage[k] = { ...coverage[k], [shift.id]: { count: 1, critical: false } };
    return { ...c, shiftTypes: [...c.shiftTypes, shift], areas: c.areas.map(a => (a.id === area.id ? { ...a, coverage } : a)) };
  });
  const removeOwnShift = (id: string) => updateConfig(c => ({
    ...c,
    shiftTypes: c.shiftTypes.filter(s => s.id !== id),
    areas: c.areas.map(a => ({ ...a, coverage: dropShift(a.coverage, id) })),
    doctors: c.doctors.map(d => ({ ...d, excludedShiftIds: d.excludedShiftIds.filter(x => x !== id), weekdayRules: d.weekdayRules.filter(r => r.shiftId !== id) })),
  }));
  const patch = (p: Partial<Area>) => updateConfig(c => ({ ...c, areas: c.areas.map(a => (a.id === area.id ? { ...a, ...p } : a)) }));
  const cell = (k: DayKey, sid: string): CoverageCell => area.coverage[k]?.[sid] ?? { count: 0, critical: false };
  const setCell = (keys: DayKey[], sid: string, next: (c: CoverageCell) => CoverageCell) => {
    const coverage = { ...area.coverage };
    for (const k of keys) coverage[k] = { ...coverage[k], [sid]: next(cell(k, sid)) };
    patch({ coverage });
  };
  const rowFill = (sid: string, keys: DayKey[]) => {
    const count = Math.max(1, ...DAY_KEYS.map(k => cell(k, sid).count));
    const critical = DAY_KEYS.some(k => cell(k, sid).critical);
    const coverage = { ...area.coverage };
    for (const k of DAY_KEYS) coverage[k] = { ...coverage[k], [sid]: keys.includes(k) ? { count, critical } : { count: 0, critical: false } };
    patch({ coverage });
  };
  const duplicate = () => updateConfig(c => {
    // Copia anche gli orari propri dell'area, con nuovi identificativi.
    const id = uid('a');
    const own = c.shiftTypes.filter(s => s.areaId === area.id);
    const remap = new Map(own.map(s => [s.id, uid('t')]));
    const coverage = Object.fromEntries(DAY_KEYS.map(k => [k, Object.fromEntries(Object.entries(area.coverage[k] ?? {}).map(([sid, v]) => [remap.get(sid) ?? sid, v]))])) as Area['coverage'];
    return {
      ...c,
      shiftTypes: [...c.shiftTypes, ...own.map(s => ({ ...s, id: remap.get(s.id)!, areaId: id }))],
      areas: [...c.areas, { ...area, id, coverage, name: `${area.name} (copia)`, color: nextColor(c.areas.map(a => a.color)) }],
    };
  });
  const [fillMenu, setFillMenu] = useState<{ shiftId: string; anchor: DOMRect } | null>(null);
  const toggleRowCritical = (sid: string) => {
    const active = DAY_KEYS.filter(k => cell(k, sid).count > 0);
    const all = active.every(k => cell(k, sid).critical);
    setCell(active, sid, x => ({ ...x, critical: !all }));
  };
  const total = DAY_KEYS.slice(0, 7).reduce((s, k) => s + Object.values(area.coverage[k] ?? {}).reduce((x, c) => x + c.count, 0), 0);

  return (
    <section className="card">
      <div className="card-head">
        <ColorInput value={area.color} onChange={color => patch({ color })} />
        <TextInput value={area.name} onCommit={name => name.trim() && patch({ name: name.trim() })} style={{ fontWeight: 650, width: 240 }} aria-label="Nome area" />
        <span className="badge">{total} turni/settimana</span>
        <div className="spacer" />
        <button className="btn sm" onClick={addOwnShift} title="Un turno con orario proprio che vale solo per quest'area (es. sala 9–17)"><IconPlus size={16} /> Orario di quest’area</button>
        <button className="btn sm ghost" onClick={duplicate}><IconCopy size={16} /> Duplica</button>
        <button className="btn sm ghost danger" onClick={onDelete}><IconTrash size={16} /> Elimina</button>
        <div className="row" style={{ gap: 2 }}>
          <button className="btn ghost sm icon" disabled={first} onClick={() => onMove(-1)} aria-label="Sposta l’area su" title="Sposta su">↑</button>
          <button className="btn ghost sm icon" disabled={last} onClick={() => onMove(1)} aria-label="Sposta l’area giù" title="Sposta giù">↓</button>
        </div>
      </div>
      <div className="card-body table-wrap">
        {shifts.length === 0 ? <p className="hint">Definisci prima i tipi di turno.</p> : (
          <table className="cov">
            <thead>
              <tr>
                <th />
                {DAY_KEYS.map(k => <th key={k} className={k === 'hol' ? 'hol' : ''}>{DAY_LABELS[k]}</th>)}
                <th className="sticky-actions" />
              </tr>
            </thead>
            <tbody>
              {shifts.map(s => (
                <tr key={s.id}>
                  <td className="lbl">
                    {s.areaId ? (
                      <div className="col" style={{ gap: 4 }}>
                        <div className="row" style={{ gap: 6 }}>
                          <TextInput className="input code" value={s.code} onCommit={code => code.trim() && patchShift(s.id, { code: code.trim().toUpperCase().slice(0, 3) })} aria-label="Sigla" />
                          <TextInput className="input sm" value={s.name} onCommit={name => name.trim() && patchShift(s.id, { name: name.trim() })} style={{ width: 130 }} aria-label="Nome orario" />
                          <button className="btn ghost sm icon danger" title="Elimina questo orario" onClick={() => removeOwnShift(s.id)}><IconTrash size={15} /></button>
                        </div>
                        <div className="row" style={{ gap: 4 }}>
                          <input className="input sm time" type="time" value={s.start} onChange={e => e.target.value && patchShift(s.id, { start: e.target.value })} aria-label="Inizio" />
                          <span className="muted">–</span>
                          <input className="input sm time" type="time" value={s.end} onChange={e => e.target.value && patchShift(s.id, { end: e.target.value })} aria-label="Fine" />
                          <span className="badge primary" title="Vale solo per quest’area">solo qui</span>
                        </div>
                      </div>
                    ) : (
                      <div className="row" title="Orario comune a tutte le aree: si modifica in Tipi di turno">
                        <span className="code-tag" style={{ background: s.color, color: textOn(s.color) }}>{s.code}</span>
                        <span style={{ fontWeight: 560 }}>{s.name}</span>
                        <span className="tiny muted num">{s.start}–{s.end}</span>
                      </div>
                    )}
                  </td>
                  {DAY_KEYS.map(k => {
                    const c = cell(k, s.id);
                    return (
                      <td key={k}>
                        <div className={`cov-cell ${c.count > 0 ? (c.critical ? 'critical' : 'active') : ''}`}>
                          <Stepper value={c.count} onChange={count => setCell([k], s.id, x => ({ count, critical: count > 0 && x.critical }))} max={9} />
                          <button type="button" className={`crit-toggle ${c.critical ? 'on' : ''}`} disabled={c.count === 0}
                            title={c.critical ? 'Critico: va coperto sempre' : 'Rendi critico'}
                            onClick={() => setCell([k], s.id, x => ({ ...x, critical: !x.critical }))}>C</button>
                        </div>
                      </td>
                    );
                  })}
                  <td className="sticky-actions">
                    <button className="btn sm" title="Riempi o svuota la riga" onClick={e => setFillMenu({ shiftId: s.id, anchor: e.currentTarget.getBoundingClientRect() })}>
                      Riempi <IconChevronDown size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {fillMenu && (
        <Popover anchor={fillMenu.anchor} onClose={() => setFillMenu(null)}>
          <div className="pop-label">Riempi la riga</div>
          <button className="pop-item" onClick={() => { rowFill(fillMenu.shiftId, WEEKDAYS); setFillMenu(null); }}>Feriali <span className="why">lun–ven</span></button>
          <button className="pop-item" onClick={() => { rowFill(fillMenu.shiftId, WEEKEND_HOL); setFillMenu(null); }}>Weekend e festivi <span className="why">sab, dom, festivi</span></button>
          <button className="pop-item" onClick={() => { rowFill(fillMenu.shiftId, DAY_KEYS); setFillMenu(null); }}>Tutti i giorni</button>
          <div className="pop-sep" />
          <button className="pop-item" onClick={() => { toggleRowCritical(fillMenu.shiftId); setFillMenu(null); }}>Critico sì / no su tutta la riga</button>
          <button className="pop-item danger" onClick={() => { rowFill(fillMenu.shiftId, []); setFillMenu(null); }}>Svuota la riga</button>
        </Popover>
      )}
    </section>
  );
}

