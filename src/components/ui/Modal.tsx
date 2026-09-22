import { ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Larghezza massima del pannello. */
  size?: 'sm' | 'md' | 'lg';
}

export function Modal({ title, onClose, children, footer, size = 'md' }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // `onClose` è spesso una funzione anonima, quindi cambia identità a ogni
  // render del componente che apre la finestra. Tenerla in un riferimento,
  // aggiornato in un effetto, permette agli altri effetti di dipendere solo
  // dal montaggio: prima si rifacevano a ogni render, e quello del fuoco
  // strappava il cursore al campo in cui si stava scrivendo.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);

    // Blocca lo scorrimento della pagina sotto la finestra, compensando la
    // larghezza della barra di scorrimento per evitare lo scatto del layout.
    const { overflow, paddingRight } = document.body.style;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
    };
  }, []);

  useEffect(() => {
    // Il fuoco va al pannello una volta sola, all'apertura: rifarlo a ogni
    // render lo strapperebbe al campo in cui si sta scrivendo. Se il
    // contenuto ha un campo con `autoFocus`, quello ha la precedenza.
    if (panelRef.current?.contains(document.activeElement)) return;
    panelRef.current?.focus();
  }, []);

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={event => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Chiudi">✕</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
