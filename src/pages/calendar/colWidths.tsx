// Larghezza delle colonne del calendario.
//
// Di default le colonne dei dati (medici, sale, giorni) si dividono in parti
// uguali tutta la larghezza disponibile. Trascinando il bordo di una qualunque
// di esse si allargano o stringono tutte insieme; "Adatta allo schermo" torna
// alla larghezza automatica. La prima colonna e le colonne di riepilogo hanno
// una larghezza propria, regolabile allo stesso modo.

import { useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { getState, setUi, useStore } from '../../store/store';

/** Chiave della larghezza comune a tutte le colonne dei dati. */
export const UNIFORM = 'col';

export interface ColWidths {
  /** Larghezza di una colonna fissa (prima colonna, riepiloghi). */
  fixed: (key: string) => number;
  /** Stile del <col> di una colonna dei dati. */
  colStyle: CSSProperties;
  /** Stile della tabella, dati il numero di colonne dei dati e le chiavi delle fisse. */
  tableStyle: (dataCols: number, fixedKeys: string[]) => CSSProperties;
  /** Maniglia da mettere dentro il <th>. */
  handle: (key: string) => ReactNode;
}

export function useColWidths(scope: string, defaults: Record<string, number>): ColWidths {
  const saved = useStore(s => s.ui.colWidths);
  const [live, setLive] = useState<{ key: string; w: number } | null>(null);

  const get = (key: string): number | null =>
    live?.key === key ? live.w : saved[`${scope}:${key}`] ?? (key === UNIFORM ? null : defaults[key] ?? 80);
  const uniform = get(UNIFORM);

  const start = (key: string, e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.parentElement;
    const startX = e.clientX;
    // In modalita automatica si parte dalla larghezza che la colonna ha adesso.
    const startW = get(key) ?? Math.round(th?.getBoundingClientRect().width ?? 80);
    let current = startW;
    const move = (ev: globalThis.MouseEvent) => {
      current = Math.max(key === UNIFORM ? 28 : 24, Math.min(600, Math.round(startW + ev.clientX - startX)));
      setLive({ key, w: current });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing');
      setUi({ colWidths: { ...getState().ui.colWidths, [`${scope}:${key}`]: current } });
      setLive(null);
    };
    document.body.classList.add('resizing');
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const reset = (key: string) => {
    const next = { ...getState().ui.colWidths };
    delete next[`${scope}:${key}`];
    setUi({ colWidths: next });
  };

  const fixed = (key: string) => get(key) ?? defaults[key] ?? 80;

  return {
    fixed,
    colStyle: uniform === null ? {} : { width: uniform },
    tableStyle: (n, keys) => {
      const fixedSum = keys.reduce((s, k) => s + fixed(k), 0);
      return uniform === null
        ? { width: '100%', minWidth: fixedSum + n * (defaults.minCol ?? 44) }
        : { width: fixedSum + n * uniform };
    },
    handle: key => (
      <span className="col-resize"
        title={key === UNIFORM ? 'Trascina per allargare o stringere tutte le colonne insieme · doppio clic per adattarle allo schermo' : 'Trascina per allargare o stringere · doppio clic per la larghezza predefinita'}
        onMouseDown={e => start(key, e)} onClick={e => e.stopPropagation()} onDoubleClick={() => reset(key)} />
    ),
  };
}

export function hasCustomWidths(scope: string): boolean {
  return Object.keys(getState().ui.colWidths).some(k => k.startsWith(`${scope}:`));
}

export function resetColWidths(scope: string) {
  const next = Object.fromEntries(Object.entries(getState().ui.colWidths).filter(([k]) => !k.startsWith(`${scope}:`)));
  setUi({ colWidths: next });
}
