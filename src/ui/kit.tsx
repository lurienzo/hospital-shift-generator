// Componenti di base dell'interfaccia.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useToasts } from '../store/store';
import { IconX } from './icons';

export function Modal({ title, subtitle, children, footer, onClose, wide }: {
  title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="grow">
            <h2>{title}</h2>
            {subtitle && <p className="hint" style={{ marginTop: 4 }}>{subtitle}</p>}
          </div>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Chiudi"><IconX /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Popover ancorato a un elemento o a un punto; si chiude cliccando fuori o con Esc. */
export function Popover({ anchor, onClose, children }: { anchor: DOMRect; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // La posizione si corregge sul DOM dopo la misura, per restare nella finestra.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let left = anchor.left;
    let top = anchor.bottom + 4;
    if (left + width > window.innerWidth - 8) left = Math.max(8, anchor.right - width);
    if (top + height > window.innerHeight - 8) top = Math.max(8, anchor.top - height - 4);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const t = setTimeout(() => window.addEventListener('mousedown', onDown));
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="popover" style={{ left: anchor.left, top: anchor.bottom + 4 }}>{children}</div>,
    document.body,
  );
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; hint?: ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="track" />
      {(label || hint) && (
        <span className="col" style={{ gap: 1 }}>
          {label && <span style={{ fontWeight: 560 }}>{label}</span>}
          {hint && <span className="hint">{hint}</span>}
        </span>
      )}
    </label>
  );
}

export function Seg<T extends string | number>({ value, options, onChange, small }: {
  value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; small?: boolean;
}) {
  return (
    <div className={`seg ${small ? 'sm' : ''}`} role="radiogroup">
      {options.map(o => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} title={o.title}
          className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Stepper({ value, onChange, min = 0, max = 20 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <span className="stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label="Meno">−</button>
      <span>{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} aria-label="Più">+</button>
    </span>
  );
}

export function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="color-swatch" style={{ background: value }} title="Cambia colore">
      <input type="color" value={value} onChange={e => onChange(e.target.value)} />
    </label>
  );
}

/** Input testuale che salva quando perde il focus o con Invio. */
export function TextInput({ value, onCommit, className = 'input', placeholder, ...rest }: {
  value: string; onCommit: (v: string) => void; className?: string; placeholder?: string; style?: React.CSSProperties; type?: string; 'aria-label'?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) { setPrev(value); setDraft(value); }
  return (
    <input {...rest} className={className} value={draft} placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft); }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setDraft(value); }} />
  );
}

export function NumberInput({ value, onCommit, min, max, step = 1, className = 'input num', placeholder }: {
  value: number | null; onCommit: (v: number | null) => void; min?: number; max?: number; step?: number; className?: string; placeholder?: string;
}) {
  return (
    <TextInput className={className} type="number" placeholder={placeholder} value={value === null ? '' : String(value)}
      onCommit={v => {
        if (v.trim() === '') return onCommit(null);
        let n = Number(v);
        if (Number.isNaN(n)) return;
        if (min !== undefined) n = Math.max(min, n);
        if (max !== undefined) n = Math.min(max, n);
        onCommit(Math.round(n / step) * step);
      }} />
  );
}

export function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map(t => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}
    </div>
  );
}

export function Confirm({ title, message, confirmLabel = 'Conferma', danger, onConfirm, onClose }: {
  title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annulla</button>
      <button className={`btn ${danger ? 'danger solid' : 'primary'}`} onClick={() => { onConfirm(); onClose(); }} autoFocus>{confirmLabel}</button>
    </>}>
      <div className="muted">{message}</div>
    </Modal>
  );
}

export function CodeTag({ color, children }: { color: string; children: ReactNode }) {
  return <span className="code-tag" style={{ background: color }}>{children}</span>;
}
