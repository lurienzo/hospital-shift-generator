import { useState } from 'react';
import { formatDay, MONTH_NAMES } from '../domain/dates';
import { uid } from '../domain/defaults';
import { italianHolidays } from '../domain/holidays';
import type { Priority, Rules, Scheme, SchemeStep } from '../domain/types';
import { updateConfig, useStore } from '../store/store';
import { IconPlus, IconTrash } from '../ui/icons';
import { NumberInput, Seg, Switch, TextInput } from '../ui/kit';
import { textOn } from '../ui/color';
import { Topbar } from '../ui/Topbar';

function patchRules(fn: (r: Rules) => Partial<Rules>) {
  updateConfig(c => ({ ...c, rules: { ...c.rules, ...fn(c.rules) } }));
}

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 0, label: 'Ignora' }, { value: 1, label: 'Bassa' }, { value: 2, label: 'Media' }, { value: 3, label: 'Alta' },
];

const WEIGHT_LABELS: { key: keyof Rules['weights']; label: string; hint: string }[] = [
  { key: 'nights', label: 'Notti', hint: 'Stesso numero di notti per tutti.' },
  { key: 'weekends', label: 'Weekend', hint: 'Sabati, domeniche e festivi lavorati.' },
  { key: 'holidays', label: 'Festivi', hint: 'Festivi lavorati, contati anche a parte.' },
  { key: 'total', label: 'Turni e ore totali', hint: 'Carico complessivo.' },
  { key: 'critical', label: 'Turni critici', hint: 'Turni marcati come critici.' },
];

export function RulesPage() {
  const config = useStore(s => s.config)!;
  const year = useStore(s => s.ui.year);
  const rules = config.rules;
  const holidays = [...italianHolidays(year, rules.patronDay)].sort((a, b) => a[0].localeCompare(b[0]));
  const [pm, pd] = (rules.patronDay ?? '-').split('-');

  return (
    <>
      <Topbar title="Regole" />
      <div className="content narrow">
        <section className="card">
          <div className="card-head"><h2>Equità</h2><p className="hint">Il generatore bilancia i turni sommando i mesi già resi definitivi: chi ha fatto più notti nei mesi scorsi ne riceve meno. La quota di ciascuno tiene conto di ferie, assenze, part-time e data di ingresso.</p></div>
          <div className="card-body col" style={{ gap: 16 }}>
            <div className="row wrap">
              <span className="label" style={{ minWidth: 180 }}>Mesi considerati</span>
              <Seg value={rules.fairnessWindow} onChange={fairnessWindow => patchRules(() => ({ fairnessWindow }))}
                options={[{ value: 'year', label: 'Anno in corso' }, { value: '12m', label: 'Ultimi 12 mesi' }, { value: 'all', label: 'Tutto lo storico' }]} />
            </div>
            {WEIGHT_LABELS.map(w => (
              <div key={w.key} className="row wrap">
                <div className="col" style={{ gap: 0, minWidth: 180 }}>
                  <span className="label">{w.label}</span>
                  <span className="hint">{w.hint}</span>
                </div>
                <Seg value={rules.weights[w.key]} options={PRIORITY_OPTIONS}
                  onChange={v => patchRules(r => ({ weights: { ...r.weights, [w.key]: v } }))} />
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Vincoli e preferenze</h2></div>
          <div className="card-body col" style={{ gap: 16 }}>
            <Switch checked={rules.protectDesiderata} onChange={protectDesiderata => patchRules(() => ({ protectDesiderata }))}
              label="Proteggi le desiderate"
              hint="Un turno non critico resta scoperto piuttosto che violare una desiderata. I turni critici le violano comunque se non c’è alternativa, e lo segnalano." />
            <Switch checked={rules.allowMultiplePerDay} onChange={allowMultiplePerDay => patchRules(() => ({ allowMultiplePerDay }))}
              label="Lunghe: più turni nello stesso giorno"
              hint="Permette allo stesso medico turni attaccati nella stessa giornata, es. mattina + pomeriggio = lunga 08–20. Turni staccati (mattina + notte) non sono mai una lunga. Anche se spento, un turno critico può forzarlo." />
            {rules.allowMultiplePerDay && (
              <div className="row wrap">
                <div className="col" style={{ gap: 0, minWidth: 260 }}>
                  <span className="label">Massimo ore in una giornata</span>
                  <span className="hint">Una lunga non può superarle (es. 12 = mattina + pomeriggio, non pomeriggio + notte).</span>
                </div>
                <NumberInput value={rules.maxDayHours} min={1} max={24} onCommit={v => patchRules(() => ({ maxDayHours: v ?? 12 }))} />
              </div>
            )}
            <div className="row wrap">
              <div className="col" style={{ gap: 0, minWidth: 260, maxWidth: 520 }}>
                <span className="label">Lunga nella stessa area</span>
                <span className="hint">Chi fa mattina in una sala che prosegue il pomeriggio, se fa anche il pomeriggio lo fa in quella sala. Se fa solo la mattina torna a casa e il pomeriggio lo copre un altro; se la sala chiude, può spostarsi altrove.</span>
              </div>
              <Seg value={rules.longSameArea} onChange={longSameArea => patchRules(() => ({ longSameArea }))}
                options={[{ value: 'binding', label: 'Obbligatoria' }, { value: 'preference', label: 'Preferibile' }, { value: 'off', label: 'Libera' }]} />
            </div>
            <div className="row wrap">
              <div className="col" style={{ gap: 0, minWidth: 260, maxWidth: 520 }}>
                <span className="label">Distanza minima fra due notti (giorni)</span>
                <span className="hint">Es. 5: dopo la notte del 1 la successiva non prima del 6. Il generatore la rispetta finché ci sono medici disponibili; se non può, lo segnala.</span>
              </div>
              <NumberInput value={rules.minNightGap} min={3} max={14} onCommit={v => patchRules(() => ({ minNightGap: v ?? 5 }))} />
            </div>
            <div className="row wrap">
              <div className="col" style={{ gap: 0, minWidth: 260 }}>
                <span className="label">Massimo giorni lavorativi di fila</span>
                <span className="hint">Oltre questo numero compare un avviso. 0 = non controllare.</span>
              </div>
              <NumberInput value={rules.maxConsecutiveDays} min={0} max={30} onCommit={v => patchRules(() => ({ maxConsecutiveDays: v ?? 0 }))} />
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Ore settimanali</h2>
            <div className="spacer" />
            <Switch checked={rules.hours.enabled} onChange={enabled => patchRules(r => ({ hours: { ...r.hours, enabled } }))} />
            <p className="hint">Forbice contrattuale per settimana. Il minimo guida la distribuzione; i singoli medici possono avere ore proprie (part-time).</p>
          </div>
          {rules.hours.enabled && (
            <div className="card-body col" style={{ gap: 14 }}>
              <div className="row">
                <span className="label" style={{ minWidth: 180 }}>Ore per settimana</span>
                <NumberInput value={rules.hours.min} min={0} max={80} onCommit={v => patchRules(r => ({ hours: { ...r.hours, min: v ?? 0 } }))} />
                <span className="muted">–</span>
                <NumberInput value={rules.hours.max} min={0} max={80} onCommit={v => patchRules(r => ({ hours: { ...r.hours, max: v ?? 0 } }))} />
              </div>
              <div className="row wrap">
                <span className="label" style={{ minWidth: 180 }}>Il massimo</span>
                <Seg value={rules.hours.enforcement} onChange={enforcement => patchRules(r => ({ hours: { ...r.hours, enforcement } }))}
                  options={[{ value: 'balance', label: 'Si può superare e recuperare' }, { value: 'cap', label: 'Non si supera mai' }]} />
              </div>
              <p className="hint">“Si può superare”: conta il totale del mese; le settimane sopra il massimo sono solo segnalate. “Non si supera”: il generatore lascia scoperto piuttosto che sforare (tranne i turni critici).</p>
            </div>
          )}
        </section>

        <RotationCard />

        <section className="card">
          <div className="card-head"><h2>Festivi</h2><p className="hint">I festivi nazionali sono automatici e usano la colonna “Festivo” della copertura. Si possono aggiungere o togliere giorni mese per mese dalla pagina Ferie e desiderate.</p></div>
          <div className="card-body col" style={{ gap: 14 }}>
            <div className="row wrap">
              <span className="label" style={{ minWidth: 180 }}>Santo patrono</span>
              <select className="select" value={pd ?? ''} onChange={e => patchRules(() => ({ patronDay: e.target.value && pm ? `${pm || '01'}-${e.target.value}` : e.target.value ? `01-${e.target.value}` : null }))}>
                <option value="">—</option>
                {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map(d => <option key={d} value={d}>{Number(d)}</option>)}
              </select>
              <select className="select" value={pm ?? ''} onChange={e => patchRules(() => ({ patronDay: e.target.value ? `${e.target.value}-${pd || '01'}` : null }))}>
                <option value="">—</option>
                {MONTH_NAMES.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
              </select>
              {rules.patronDay && <button className="btn sm ghost" onClick={() => patchRules(() => ({ patronDay: null }))}>Togli</button>}
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {holidays.map(([date, name]) => <span key={date} className="badge" title={name}>{formatDay(date)} · {name}</span>)}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function RotationCard() {
  const config = useStore(s => s.config)!;
  const rules = config.rules;
  const [editing, setEditing] = useState<string | null>(null);
  const shifts = config.shiftTypes.filter(s => !s.block);

  const patchScheme = (id: string, patch: Partial<Scheme>) => patchRules(r => ({ schemes: r.schemes.map(s => (s.id === id ? { ...s, ...patch } : s)) }));
  const addScheme = () => {
    const id = uid('r');
    const byKind = (k: 'day' | 'night') => shifts.find(s => s.kind === k);
    const steps: SchemeStep[] = [];
    const day = byKind('day'), night = byKind('night');
    if (day) steps.push({ kind: 'shift', shiftId: day.id });
    if (night) steps.push({ kind: 'shift', shiftId: night.id }, { kind: 'smonto' }, { kind: 'riposo' });
    patchRules(r => ({ schemes: [...r.schemes, { id, name: `Schema ${r.schemes.length + 1}`, steps }], rotation: r.rotation.schemeId ? r.rotation : { ...r.rotation, schemeId: id } }));
    setEditing(id);
  };

  const stepLabel = (st: SchemeStep) => {
    if (st.kind === 'smonto') return { text: 'Smonto', color: null };
    if (st.kind === 'riposo') return { text: 'Riposo', color: null };
    const s = config.shiftTypes.find(x => x.id === st.shiftId);
    return { text: s?.name ?? '?', color: s?.color ?? '#999' };
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Rotazione</h2>
        <div className="spacer" />
        <button className="btn sm" onClick={addScheme}><IconPlus size={16} /> Nuovo schema</button>
        <p className="hint">Uno schema è la sequenza di giornate che i medici cercano di seguire (es. Pomeriggio → Lunga → Notte → Smonto → Riposo), valida su tutte le aree. La posizione di ciascuno deriva dall’ultimo turno svolto, quindi la rotazione si riallinea da sola.</p>
      </div>
      <div className="card-body col" style={{ gap: 14 }}>
        <div className="row wrap">
          <span className="label" style={{ minWidth: 180 }}>Schema attivo</span>
          <select className="select" value={rules.rotation.schemeId ?? ''} onChange={e => patchRules(r => ({ rotation: { ...r.rotation, schemeId: e.target.value || null } }))}>
            <option value="">Nessuna rotazione</option>
            {rules.schemes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {rules.rotation.schemeId && (
            <Seg value={rules.rotation.strength} onChange={strength => patchRules(r => ({ rotation: { ...r.rotation, strength } }))}
              options={[{ value: 'preference', label: 'Da seguire', title: 'Preferenza: non lascia buchi per rispettarla' }, { value: 'binding', label: 'Vincolante', title: 'Niente turni nei giorni di smonto e riposo dello schema' }]} />
          )}
        </div>
        {rules.schemes.map(s => (
          <div key={s.id} className="card" style={{ padding: 12, boxShadow: 'none' }}>
            <div className="row wrap">
              <TextInput value={s.name} onCommit={name => name.trim() && patchScheme(s.id, { name: name.trim() })} style={{ fontWeight: 600, width: 200 }} aria-label="Nome schema" />
              {rules.rotation.schemeId === s.id && <span className="badge primary">Attivo</span>}
              <div className="spacer" />
              <button className="btn sm ghost" onClick={() => setEditing(editing === s.id ? null : s.id)}>{editing === s.id ? 'Chiudi' : 'Modifica'}</button>
              <button className="btn sm ghost danger icon" aria-label="Elimina schema" onClick={() => patchRules(r => ({ schemes: r.schemes.filter(x => x.id !== s.id), rotation: r.rotation.schemeId === s.id ? { ...r.rotation, schemeId: null } : r.rotation }))}><IconTrash size={16} /></button>
            </div>
            <div className="steps-editor" style={{ marginTop: 10 }}>
              {s.steps.map((st, i) => {
                const l = stepLabel(st);
                return (
                  <span key={i} className="row" style={{ gap: 6 }}>
                    {i > 0 && <span className="arrow">→</span>}
                    <span className={`step-chip ${l.color ? '' : 'off'}`} style={l.color ? { background: l.color, color: textOn(l.color) } : undefined}>
                      {l.text}
                      {editing === s.id && <button aria-label="Togli passo" onClick={() => patchScheme(s.id, { steps: s.steps.filter((_, j) => j !== i) })}>×</button>}
                    </span>
                  </span>
                );
              })}
              {s.steps.length === 0 && <span className="hint">Nessun passo.</span>}
            </div>
            {editing === s.id && (
              <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
                <span className="hint">Aggiungi:</span>
                {shifts.map(sh => <button key={sh.id} className="btn sm" onClick={() => patchScheme(s.id, { steps: [...s.steps, { kind: 'shift', shiftId: sh.id }] })}>{sh.name}</button>)}
                <button className="btn sm" onClick={() => patchScheme(s.id, { steps: [...s.steps, { kind: 'smonto' }] })}>Smonto</button>
                <button className="btn sm" onClick={() => patchScheme(s.id, { steps: [...s.steps, { kind: 'riposo' }] })}>Riposo</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
