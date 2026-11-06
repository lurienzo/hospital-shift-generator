import type { ReactNode } from 'react';
import { monthLabel, shiftMonth } from '../domain/dates';
import { setUi, useStore } from '../store/store';
import { IconChevronLeft, IconChevronRight } from './icons';

/** Barra in alto di ogni pagina, con il navigatore del mese per le pagine mensili. */
export function Topbar({ title, month, children }: { title: ReactNode; month?: boolean; children?: ReactNode }) {
  const year = useStore(s => s.ui.year);
  const m = useStore(s => s.ui.month);
  const move = (delta: number) => setUi(shiftMonth(year, m, delta));
  return (
    <header className="topbar">
      <span className="mobile-bar" style={{ width: 34 }} />
      <h1>{title}</h1>
      {month && (
        <div className="month-nav">
          <button className="btn ghost icon sm" onClick={() => move(-1)} aria-label="Mese precedente"><IconChevronLeft /></button>
          <span className="label">{monthLabel(year, m)}</span>
          <button className="btn ghost icon sm" onClick={() => move(1)} aria-label="Mese successivo"><IconChevronRight /></button>
        </div>
      )}
      <div className="spacer" />
      <div className="row wrap no-print">{children}</div>
    </header>
  );
}
