import { useState } from 'react';
import { useServices } from '../state/serviceContext';
import { Modal } from './ui/Modal';
import { formatDateTime } from '../utils/date';
import './ServiceSwitcher.css';

interface ServiceManagerProps {
  hasUnsavedChanges: boolean;
}

/**
 * Anagrafica dei servizi. Ogni servizio è un ambito chiuso: creare un nuovo
 * servizio parte da zero, oppure copia la configurazione di uno esistente
 * senza portarsi dietro i calendari e le statistiche.
 */
export function ServiceManager({ hasUnsavedChanges }: ServiceManagerProps) {
  const { services, activeId, switchTo, create, rename, setColor, remove, countVersions } = useServices();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ name: string; copyFromId: string } | null>(null);

  const openCreate = (copyFromId = '') => setDialog({ name: '', copyFromId });

  const confirmCreate = () => {
    if (!dialog) return;
    const name = dialog.name.trim();
    if (!name) return;

    if (services.some(service => service.name.toLowerCase() === name.toLowerCase())) {
      window.alert(`Esiste già un servizio chiamato "${name}".`);
      return;
    }

    if (hasUnsavedChanges
      && !window.confirm('Ci sono modifiche non salvate nel calendario. Passare al nuovo servizio e perderle?')) {
      return;
    }

    create(name, { copyFromId: dialog.copyFromId || undefined });
    setDialog(null);
  };

  const handleSwitch = (serviceId: string) => {
    if (serviceId === activeId) return;
    if (hasUnsavedChanges
      && !window.confirm('Ci sono modifiche non salvate nel calendario. Cambiare servizio e perderle?')) {
      return;
    }
    switchTo(serviceId);
  };

  const handleRemove = (serviceId: string, name: string) => {
    const versions = countVersions(serviceId);
    const message = versions > 0
      ? `Eliminare il servizio "${name}"?\n\nVerranno cancellati anche ${versions} calendari salvati, `
        + 'insieme a sale, dottori e fasce orarie. L’operazione non può essere annullata.'
      : `Eliminare il servizio "${name}" e tutta la sua configurazione?`;

    if (!window.confirm(message)) return;

    if (!remove(serviceId)) {
      window.alert('Deve restare almeno un servizio.');
    }
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Servizi</h3>
          <p className="hint">
            Ogni servizio ha sale, dottori, fasce orarie, calendari e statistiche separati. I dati
            di un servizio non si mescolano mai con quelli degli altri.
          </p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => openCreate()}>
          Nuovo servizio
        </button>
      </div>

      <ul className="service-list">
        {services.map(service => {
          const isActive = service.id === activeId;
          const versions = countVersions(service.id);

          return (
            <li key={service.id} className={`service-row ${isActive ? 'active' : ''}`}>
              <input
                className="color-input"
                type="color"
                value={service.color}
                onChange={event => setColor(service.id, event.target.value)}
                title="Colore del servizio"
                aria-label={`Colore di ${service.name}`}
              />

              <div className="service-row-info">
                {renamingId === service.id ? (
                  <input
                    className="input"
                    defaultValue={service.name}
                    autoFocus
                    onBlur={event => { rename(service.id, event.target.value); setRenamingId(null); }}
                    onKeyDown={event => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') setRenamingId(null);
                    }}
                  />
                ) : (
                  <>
                    <span className="service-row-name">
                      {service.name}
                      {isActive && <span className="badge badge-primary">attivo</span>}
                    </span>
                    <span className="service-row-meta">
                      {versions === 0
                        ? 'Nessun calendario salvato'
                        : `${versions} calendar${versions === 1 ? 'io' : 'i'} salvat${versions === 1 ? 'o' : 'i'}`}
                      {' · creato il '}{formatDateTime(service.createdAt)}
                    </span>
                  </>
                )}
              </div>

              <div className="row">
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => handleSwitch(service.id)}
                  disabled={isActive}
                >
                  {isActive ? 'In uso' : 'Apri'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => setRenamingId(service.id)}
                >
                  Rinomina
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => openCreate(service.id)}
                  title="Crea un nuovo servizio con la stessa configurazione"
                >
                  Duplica
                </button>
                <button
                  type="button"
                  className="btn-icon danger"
                  onClick={() => handleRemove(service.id, service.name)}
                  disabled={services.length === 1}
                  title={services.length === 1 ? 'Deve restare almeno un servizio' : 'Elimina servizio'}
                  aria-label={`Elimina ${service.name}`}
                >✕</button>
              </div>
            </li>
          );
        })}
      </ul>

      {dialog && (
        <Modal
          title={dialog.copyFromId ? 'Duplica servizio' : 'Nuovo servizio'}
          size="sm"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDialog(null)}>Annulla</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!dialog.name.trim()}
                onClick={confirmCreate}
              >
                Crea e apri
              </button>
            </>
          }
        >
          <div className="stack-sm">
            <div className="field">
              <label htmlFor="new-service-name">Nome del servizio</label>
              <input
                id="new-service-name"
                className="input"
                value={dialog.name}
                autoFocus
                placeholder="es. Terapia Intensiva 2"
                onChange={event => setDialog({ ...dialog, name: event.target.value })}
                onKeyDown={event => { if (event.key === 'Enter') confirmCreate(); }}
              />
            </div>

            <p className="hint">
              {dialog.copyFromId
                ? `Sale, dottori, fasce orarie e schemi verranno copiati da "${services.find(s => s.id === dialog.copyFromId)?.name}". I calendari e le statistiche partono da zero.`
                : 'Il nuovo servizio parte vuoto, con le fasce orarie predefinite.'}
            </p>
          </div>
        </Modal>
      )}
    </section>
  );
}
