import { useState } from 'react';
import { useServices } from '../state/serviceContext';
import { Popover } from './ui/Popover';
import './ServiceSwitcher.css';

interface ServiceSwitcherProps {
  /** Richiesta di aprire la gestione completa dei servizi. */
  onManage: () => void;
  /** Vero se il servizio corrente ha modifiche non salvate. */
  hasUnsavedChanges: boolean;
}

/**
 * Selettore del servizio attivo, nell'intestazione. Cambiare servizio
 * sostituisce interamente i dati mostrati: sale, medici, calendari e
 * statistiche appartengono a un solo servizio per volta.
 */
export function ServiceSwitcher({ onManage, hasUnsavedChanges }: ServiceSwitcherProps) {
  const { services, activeId, active, switchTo } = useServices();
  // L'elemento di ancoraggio sta nello stato e non in un ref: il pannello
  // viene disegnato durante il render e leggere un ref in quel momento non
  // garantisce di avere il valore aggiornato.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const handleSwitch = (serviceId: string) => {
    if (serviceId === activeId) {
      setAnchor(null);
      return;
    }
    if (hasUnsavedChanges
      && !window.confirm('Ci sono modifiche non salvate nel calendario. Cambiare servizio e perderle?')) {
      return;
    }
    switchTo(serviceId);
    setAnchor(null);
  };

  return (
    <>
      <button
        type="button"
        className="service-switcher"
        onClick={event => setAnchor(anchor ? null : event.currentTarget)}
        aria-expanded={anchor !== null}
        title="Cambia servizio"
      >
        <span className="service-dot" style={{ background: active?.color ?? '#64748b' }} />
        <span className="service-current">
          <span className="service-label">Servizio</span>
          <span className="service-name">{active?.name ?? '—'}</span>
        </span>
        <span className="service-caret">▾</span>
      </button>

      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} minWidth={260}>
          <div className="popover-header">
            <span>Servizi</span>
          </div>
          <div className="popover-list">
            {services.map(service => (
              <button
                key={service.id}
                type="button"
                className={`popover-item ${service.id === activeId ? 'current' : ''}`}
                onClick={() => handleSwitch(service.id)}
              >
                <span className="dot" style={{ background: service.color }} />
                {service.name}
                {service.id === activeId && <span className="trailing">attivo</span>}
              </button>
            ))}
          </div>
          <div className="popover-footer">
            <button
              type="button"
              className="popover-item"
              onClick={() => { setAnchor(null); onManage(); }}
            >
              Gestisci servizi…
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}
