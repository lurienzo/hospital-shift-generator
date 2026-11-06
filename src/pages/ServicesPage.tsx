import { useRef, useState } from 'react';
import { EXAMPLE_DOCTORS, makeDoctor, nextColor, SERVICE_KIND_LABELS } from '../domain/defaults';
import { monthKey } from '../domain/dates';
import type { ServiceKind } from '../domain/types';
import { downloadJson } from '../io/excel';
import {
  createService, deleteService, exportBackup, importBackup, notify, renameService, switchService, updateConfig, useStore, type Backup,
} from '../store/store';
import { IconDownload, IconTrash, IconUpload } from '../ui/icons';
import { TextInput } from '../ui/kit';
import { useConfirm } from '../ui/useConfirm';
import { PasswordAccessSettings } from '../ui/PasswordGate';
import { Topbar } from '../ui/Topbar';

const KIND_HINT: Record<ServiceKind, string> = {
  sale: 'Sale con mattina e pomeriggio nei feriali, guardia notturna sempre coperta.',
  ti: 'Un’area con medici per fascia ogni giorno, weekend e festivi compresi, tutto critico.',
  custom: 'Parti da zero e definisci tu turni e aree.',
};

export function NewServiceForm({ onCreated }: { onCreated?: () => void }) {
  const services = useStore(s => s.services);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ServiceKind>('ti');
  const [copyFrom, setCopyFrom] = useState('');
  const [examples, setExamples] = useState(services.length === 0);

  const create = () => {
    const fallback = kind === 'ti' ? 'Terapia Intensiva' : kind === 'sale' ? 'Sale operatorie' : 'Nuovo servizio';
    createService(name || fallback, kind, copyFrom || undefined);
    if (examples && !copyFrom) {
      const now = new Date();
      const since = monthKey(now.getFullYear(), 1);
      updateConfig(c => {
        const doctors = [...c.doctors];
        for (const n of EXAMPLE_DOCTORS.slice(0, kind === 'ti' ? 9 : 8)) doctors.push(makeDoctor(`Dott. ${n}`, nextColor(doctors.map(d => d.color)), since));
        return { ...c, doctors };
      });
    }
    notify('Servizio creato');
    setName('');
    onCreated?.();
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        {(['ti', 'sale', 'custom'] as ServiceKind[]).map(k => (
          <button key={k} type="button" className={`step ${kind === k ? 'done' : ''}`} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4, borderColor: kind === k ? 'var(--primary)' : undefined, boxShadow: kind === k ? '0 0 0 3px var(--primary-soft)' : undefined }}
            onClick={() => setKind(k)}>
            <strong>{SERVICE_KIND_LABELS[k]}</strong>
            <span className="hint">{KIND_HINT[k]}</span>
          </button>
        ))}
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="svc-name">Nome</label>
          <input id="svc-name" className="input" value={name} placeholder={kind === 'ti' ? 'es. Terapia Intensiva 1' : 'es. Piastra Operatoria'} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} />
        </div>
        {services.length > 0 && (
          <div className="field">
            <label htmlFor="svc-copy">Copia configurazione da</label>
            <select id="svc-copy" className="select" value={copyFrom} onChange={e => setCopyFrom(e.target.value)}>
              <option value="">— nessuno (usa il modello) —</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
      </div>
      {!copyFrom && (
        <label className="check"><input type="checkbox" checked={examples} onChange={e => setExamples(e.target.checked)} /> Aggiungi medici di esempio (per provare subito; si rinominano o eliminano dopo)</label>
      )}
      <div className="row"><button className="btn primary lg" onClick={create}>Crea servizio</button></div>
    </div>
  );
}

export function ServicesPage() {
  const services = useStore(s => s.services);
  const activeId = useStore(s => s.activeId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmNode, confirm] = useConfirm();

  const onImport = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as Backup;
      const n = importBackup(data);
      notify(`Importati ${n} servizi dal backup`);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'File non valido', 'error');
    }
  };

  return (
    <>
      <Topbar title="Servizi e backup" />
      <div className="content narrow">
        <section className="card">
          <div className="card-head"><h2>Servizi</h2><p className="hint">Ogni servizio ha medici, turni e calendari propri: i dati non si mescolano.</p></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Nome</th><th>Tipo</th><th /></tr></thead>
              <tbody>
                {services.map(s => (
                  <tr key={s.id}>
                    <td><TextInput value={s.name} onCommit={v => v.trim() && renameService(s.id, v.trim())} aria-label="Nome servizio" /></td>
                    <td className="muted">{SERVICE_KIND_LABELS[s.kind]}</td>
                    <td className="r">
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        {s.id === activeId ? <span className="badge primary">In uso</span> : <button className="btn sm" onClick={() => switchService(s.id)}>Apri</button>}
                        <button className="btn sm ghost danger icon" aria-label="Elimina servizio" onClick={() => confirm({
                          title: `Eliminare ${s.name}?`,
                          message: 'Spariscono medici, turni e tutti i calendari di questo servizio. Esporta un backup prima, se servono.',
                          confirmLabel: 'Elimina', danger: true, onConfirm: () => deleteService(s.id),
                        })}><IconTrash /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Nuovo servizio</h2></div>
          <div className="card-body"><NewServiceForm /></div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Backup</h2>
            <p className="hint">I dati restano solo in questo browser. Esporta un backup per spostarli su un altro computer o per sicurezza; importarlo aggiunge i servizi senza toccare quelli presenti.</p>
          </div>
          <div className="card-body row wrap">
            <button className="btn" onClick={() => downloadJson(exportBackup(), `turni-backup-${new Date().toISOString().slice(0, 10)}.json`)}><IconDownload /> Esporta backup</button>
            <button className="btn" onClick={() => fileRef.current?.click()}><IconUpload /> Importa backup</button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} />
          </div>
        </section>

        <PasswordAccessSettings />
      </div>
      {confirmNode}
    </>
  );
}
