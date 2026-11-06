import { useState } from 'react';
import { WEEKDAY_SHORT, monthKey } from '../domain/dates';
import { makeDoctor, nextColor } from '../domain/defaults';
import type { Doctor, RuleLevel, ServiceConfig, WeekdayRule } from '../domain/types';
import { notify, updateConfig, useStore } from '../store/store';
import { IconPlus, IconTrash } from '../ui/icons';
import { ColorInput, Modal, NumberInput, Switch, TextInput } from '../ui/kit';
import { textOn } from '../ui/color';
import { useConfirm } from '../ui/useConfirm';
import { Topbar } from '../ui/Topbar';

function patchDoctor(id: string, patch: Partial<Doctor>) {
  updateConfig(c => ({ ...c, doctors: c.doctors.map(d => (d.id === id ? { ...d, ...patch } : d)) }));
}

function addDoctors(names: string[]) {
  const now = new Date();
  updateConfig(c => {
    const doctors = [...c.doctors];
    for (const raw of names) {
      const name = raw.trim();
      if (!name || doctors.some(d => d.name.toLowerCase() === name.toLowerCase())) continue;
      doctors.push(makeDoctor(name, nextColor(doctors.map(d => d.color)), monthKey(now.getFullYear(), now.getMonth() + 1)));
    }
    return { ...c, doctors };
  });
}

function doctorBadges(d: Doctor, config: ServiceConfig): { text: string; tone?: string }[] {
  const out: { text: string; tone?: string }[] = [];
  if (!d.active) out.push({ text: 'Non attivo', tone: 'bad' });
  const nights = config.shiftTypes.filter(s => s.kind === 'night');
  const noNights = nights.length > 0 && nights.every(s => d.excludedShiftIds.includes(s.id));
  if (noNights || d.maxNights === 0) out.push({ text: 'Niente notti', tone: 'warn' });
  else if (d.maxNights !== null) out.push({ text: `Max ${d.maxNights} notti` });
  const otherShifts = d.excludedShiftIds.filter(id => !nights.some(n => n.id === id));
  if (otherShifts.length) out.push({ text: `Non fa: ${otherShifts.map(id => config.shiftTypes.find(s => s.id === id)?.code).join(', ')}` });
  if (d.excludedAreaIds.length) out.push({ text: `Esclude: ${d.excludedAreaIds.map(id => config.areas.find(a => a.id === id)?.name).filter(Boolean).join(', ')}` });
  const never = d.weekdayRules.filter(r => r.level === 'never').length;
  const avoid = d.weekdayRules.filter(r => r.level === 'avoid').length;
  if (never) out.push({ text: `${never} divieti`, tone: 'bad' });
  if (avoid) out.push({ text: `${avoid} preferenze` });
  if (d.hours) out.push({ text: `${d.hours.min}–${d.hours.max}h/sett`, tone: 'info' });
  if (!d.inRotation && config.rules.rotation.schemeId) out.push({ text: 'Fuori rotazione' });
  return out;
}

export function DoctorsPage() {
  const config = useStore(s => s.config)!;
  const [name, setName] = useState('');
  const [bulk, setBulk] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const editingDoc = config.doctors.find(d => d.id === editing);
  const active = config.doctors.filter(d => d.active);
  const inactive = config.doctors.filter(d => !d.active);

  return (
    <>
      <Topbar title="Medici">
        <button className="btn" onClick={() => setBulk('')}>Incolla elenco</button>
      </Topbar>
      <div className="content narrow">
        <div className="card card-body row wrap">
          <input className="input grow" style={{ minWidth: 220 }} placeholder="Nome del medico (es. Dott. Rossi)" value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) { addDoctors([name]); setName(''); } }} />
          <button className="btn primary" disabled={!name.trim()} onClick={() => { addDoctors([name]); setName(''); }}><IconPlus size={16} /> Aggiungi</button>
        </div>

        {config.doctors.length === 0 ? (
          <div className="card empty"><h2>Nessun medico</h2><p>Aggiungili uno per uno o incolla un elenco di nomi da Excel.</p></div>
        ) : (
          <section className="card">
            <div className="card-head"><h2>{active.length} medici attivi</h2><p className="hint">Clicca un medico per impostare esclusioni, giorni da evitare, ore e notti.</p></div>
            <DoctorTable doctors={[...active, ...inactive]} config={config} onEdit={setEditing} />
          </section>
        )}
      </div>

      {editingDoc && <DoctorEditor doctor={editingDoc} config={config} onClose={() => setEditing(null)} />}
      {bulk !== null && (
        <Modal title="Incolla elenco di medici" subtitle="Un nome per riga, anche copiato da una colonna di Excel. I nomi già presenti vengono saltati." onClose={() => setBulk(null)}
          footer={<>
            <button className="btn" onClick={() => setBulk(null)}>Annulla</button>
            <button className="btn primary" onClick={() => { const names = bulk.split(/\n|\t|;/).map(s => s.trim()).filter(Boolean); addDoctors(names); notify(`${names.length} nomi elaborati`); setBulk(null); }}>Aggiungi</button>
          </>}>
          <textarea className="textarea" rows={10} value={bulk} onChange={e => setBulk(e.target.value)} placeholder={'Dott. Rossi\nDott.ssa Bianchi\n...'} autoFocus />
        </Modal>
      )}
    </>
  );
}

function DoctorTable({ doctors, config, onEdit }: { doctors: Doctor[]; config: ServiceConfig; onEdit: (id: string) => void }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <tbody>
          {doctors.map(d => (
            <tr key={d.id} className="clickable" onClick={() => onEdit(d.id)} style={{ opacity: d.active ? 1 : 0.55 }}>
              <td style={{ width: 36 }}><span className="color-dot" style={{ background: d.color, width: 14, height: 14 }} /></td>
              <td style={{ fontWeight: 600 }}>{d.name}</td>
              <td>
                <div className="row wrap" style={{ gap: 4 }}>
                  {doctorBadges(d, config).map((b, i) => <span key={i} className={`badge ${b.tone ?? ''}`}>{b.text}</span>)}
                </div>
              </td>
              <td className="r muted small">{d.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const NEXT_LEVEL: Record<string, RuleLevel | null> = { none: 'avoid', avoid: 'never', never: null };

function DoctorEditor({ doctor: d, config, onClose }: { doctor: Doctor; config: ServiceConfig; onClose: () => void }) {
  const [confirmNode, confirm] = useConfirm();
  const patch = (p: Partial<Doctor>) => patchDoctor(d.id, p);
  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

  const ruleOf = (weekday: number, shiftId: string | null) => d.weekdayRules.find(r => r.weekday === weekday && r.shiftId === shiftId);
  const cycleRule = (weekday: number, shiftId: string | null) => {
    const cur = ruleOf(weekday, shiftId);
    const next = NEXT_LEVEL[cur?.level ?? 'none'];
    const rest = d.weekdayRules.filter(r => !(r.weekday === weekday && r.shiftId === shiftId));
    patch({ weekdayRules: next ? [...rest, { weekday, shiftId, level: next } as WeekdayRule] : rest });
  };

  return (
    <Modal wide title={<div className="row"><ColorInput value={d.color} onChange={color => patch({ color })} /><TextInput value={d.name} onCommit={name => name.trim() && patch({ name: name.trim() })} style={{ fontWeight: 650, fontSize: 16, width: 280 }} aria-label="Nome" /></div>}
      onClose={onClose}
      footer={<>
        <button className="btn danger" onClick={() => confirm({
          title: `Eliminare ${d.name}?`,
          message: 'I calendari già salvati lo segnaleranno come medico eliminato. Se ha solo smesso di lavorare nel servizio, meglio renderlo non attivo: resta nello storico.',
          confirmLabel: 'Elimina', danger: true,
          onConfirm: () => { updateConfig(c => ({ ...c, doctors: c.doctors.filter(x => x.id !== d.id) })); onClose(); },
        })}><IconTrash size={16} /> Elimina</button>
        <div className="spacer" />
        <button className="btn primary" onClick={onClose}>Fatto</button>
      </>}>
      <div className="row wrap" style={{ gap: 24 }}>
        <Switch checked={d.active} onChange={active => patch({ active })} label="Attivo" hint="Se spento non riceve turni ma resta nello storico." />
        {config.rules.rotation.schemeId && <Switch checked={d.inRotation} onChange={inRotation => patch({ inRotation })} label="Segue la rotazione" />}
        <div className="field">
          <label>In servizio dal</label>
          <input className="input" type="month" value={d.since} onChange={e => patch({ since: e.target.value })} style={{ width: 170 }} />
        </div>
      </div>

      <div className="grid-2">
        <div className="col">
          <span className="label">Aree in cui lavora</span>
          {config.areas.map(a => (
            <label key={a.id} className="check"><input type="checkbox" checked={!d.excludedAreaIds.includes(a.id)} onChange={() => patch({ excludedAreaIds: toggleIn(d.excludedAreaIds, a.id) })} /> {a.name}</label>
          ))}
        </div>
        <div className="col">
          <span className="label">Turni che fa</span>
          {config.shiftTypes.map(s => (
            <label key={s.id} className="check">
              <input type="checkbox" checked={!d.excludedShiftIds.includes(s.id)} onChange={() => patch({ excludedShiftIds: toggleIn(d.excludedShiftIds, s.id) })} />
              <span className="code-tag" style={{ background: s.color, color: textOn(s.color) }}>{s.code}</span> {s.name}
              {s.areaId && <span className="tiny muted">(solo {config.areas.find(x => x.id === s.areaId)?.name})</span>}
            </label>
          ))}
        </div>
      </div>

      <div className="col">
        <span className="label">Giorni della settimana</span>
        <p className="hint">Clicca per passare da libero → <b style={{ color: 'var(--warn)' }}>preferisce evitare</b> → <b style={{ color: 'var(--danger)' }}>mai</b>. Per assenze di date precise usa “Ferie e desiderate”.</p>
        <div className="table-wrap">
          <table className="cov">
            <thead><tr><th /><th>Tutto il giorno</th>{config.shiftTypes.map(s => <th key={s.id}>{s.name}</th>)}</tr></thead>
            <tbody>
              {WEEKDAY_SHORT.map((w, wd) => (
                <tr key={wd}>
                  <td className="lbl" style={{ fontWeight: 600 }}>{w}</td>
                  {[null, ...config.shiftTypes.map(s => s.id)].map(sid => {
                    const r = ruleOf(wd, sid);
                    return (
                      <td key={sid ?? 'all'}>
                        <button type="button" className="btn sm" style={{
                          width: 86,
                          background: r?.level === 'never' ? 'var(--danger-soft)' : r?.level === 'avoid' ? 'var(--warn-soft)' : undefined,
                          color: r?.level === 'never' ? 'var(--danger)' : r?.level === 'avoid' ? 'var(--warn)' : 'var(--faint)',
                        }} onClick={() => cycleRule(wd, sid)}>{r?.level === 'never' ? 'Mai' : r?.level === 'avoid' ? 'Evitare' : '—'}</button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="form-grid">
        <div className="field">
          <label>Massimo notti al mese</label>
          <NumberInput className="input" value={d.maxNights} min={0} max={31} placeholder="nessun limite" onCommit={maxNights => patch({ maxNights })} />
          <span className="hint">Non vincolante: se superato compare un avviso.</span>
        </div>
        <div className="field">
          <label>Ore settimanali proprie</label>
          <div className="row">
            <NumberInput value={d.hours?.min ?? null} min={0} max={80} placeholder="min" onCommit={min => patch({ hours: min === null ? null : { min, max: Math.max(min, d.hours?.max ?? config.rules.hours.max) } })} />
            <span className="muted">–</span>
            <NumberInput value={d.hours?.max ?? null} min={0} max={80} placeholder="max" onCommit={max => patch({ hours: max === null ? null : { min: Math.min(max, d.hours?.min ?? config.rules.hours.min), max } })} />
          </div>
          <span className="hint">Vuoto = come il servizio ({config.rules.hours.min}–{config.rules.hours.max}h). Il part-time riduce in proporzione anche la quota di notti e weekend.</span>
        </div>
        <div className="field" style={{ gridColumn: 'span 2' }}>
          <label>Note</label>
          <TextInput value={d.note} onCommit={note => patch({ note })} placeholder="es. specializzando, reperibile solo il martedì…" />
        </div>
      </div>
      {confirmNode}
    </Modal>
  );
}
