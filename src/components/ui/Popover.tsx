import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface PopoverProps {
  /** Elemento a cui ancorare il pannello. */
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Larghezza minima del pannello in pixel. */
  minWidth?: number;
}

const MARGIN = 8;

/**
 * Pannello ancorato a un elemento, disegnato in un portale.
 *
 * I menù dei turni vivono dentro la tabella del calendario, che ha
 * `overflow: auto`: un pannello in posizione assoluta viene tagliato ai bordi
 * dell'area scrollabile. Portandolo fuori dall'albero e posizionandolo a
 * schermo il problema non si presenta, e il pannello può anche ribaltarsi
 * verso l'alto quando in basso non c'è spazio.
 */
export function Popover({ anchor, onClose, children, className = '', minWidth = 240 }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  // Chi apre il pannello passa quasi sempre una funzione anonima: tenerla in
  // un riferimento, aggiornato in un effetto, evita di riagganciare gli
  // ascoltatori a ogni render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!anchor) return;

    const place = () => {
      const panel = panelRef.current;
      if (!panel) return;

      const anchorRect = anchor.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const spaceBelow = viewportHeight - anchorRect.bottom - MARGIN;
      const spaceAbove = anchorRect.top - MARGIN;
      const openUpwards = spaceBelow < Math.min(panelRect.height, 260) && spaceAbove > spaceBelow;

      const maxHeight = Math.max(160, openUpwards ? spaceAbove : spaceBelow);
      const height = Math.min(panelRect.height, maxHeight);
      const width = Math.max(panelRect.width, minWidth);

      setStyle({
        top: openUpwards ? anchorRect.top - height - MARGIN : anchorRect.bottom + MARGIN,
        left: clamp(anchorRect.left, MARGIN, Math.max(MARGIN, viewportWidth - width - MARGIN)),
        maxHeight,
      });
    };

    place();

    // Durante lo scroll l'ancora si muove: il pannello la segue, e si chiude
    // quando esce dall'area visibile.
    const onScrollOrResize = () => {
      if (!anchor.isConnected) {
        onCloseRef.current();
        return;
      }
      place();
    };

    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [anchor, minWidth]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onCloseRef.current();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchor]);

  if (!anchor) return null;

  return createPortal(
    <div
      ref={panelRef}
      className={`popover ${className}`}
      role="dialog"
      style={{
        top: style?.top ?? -9999,
        left: style?.left ?? -9999,
        maxHeight: style?.maxHeight,
        minWidth,
        visibility: style ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
