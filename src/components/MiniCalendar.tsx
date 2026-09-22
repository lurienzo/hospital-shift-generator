import { ReactNode, useMemo } from 'react';
import { Weekday, WEEKDAY_LABELS, WEEKDAY_SHORT_LABELS, WEEKDAYS } from '../models/types';
import { buildMonthDays, mondayFirstIndex } from '../utils/date';
import './MiniCalendar.css';

export type DaySelection = 'none' | 'partial' | 'full';

export interface MiniCalendarDayState {
  selection: DaySelection;
  /** Colore di riempimento quando la giornata è selezionata. */
  color?: string;
  disabled?: boolean;
  title?: string;
  /** Marcatore aggiuntivo, es. il numero di sale disabilitate. */
  marker?: ReactNode;
  highlighted?: boolean;
}

interface MiniCalendarProps {
  year: number;
  month: number;
  getDayState: (date: string) => MiniCalendarDayState;
  onDayClick: (date: string) => void;
  /** Contenuto sotto il numero del giorno, es. le sigle delle fasce. */
  renderDayDetail?: (date: string) => ReactNode;
  /**
   * Se indicato, le intestazioni diventano pulsanti che agiscono su tutta la
   * colonna: evita di affiancare al calendario una seconda fila di giorni.
   */
  onWeekdayClick?: (weekday: Weekday) => void;
}

/**
 * Calendarietto del mese con settimane che iniziano dal lunedì, usato per
 * selezionare festivi e disponibilità.
 */
export function MiniCalendar({
  year,
  month,
  getDayState,
  onDayClick,
  renderDayDetail,
  onWeekdayClick,
}: MiniCalendarProps) {
  const days = useMemo(() => buildMonthDays(year, month), [year, month]);
  const leadingBlanks = days.length > 0 ? mondayFirstIndex(days[0].date) : 0;

  return (
    <div className="mini-calendar">
      <div className="mini-calendar-head">
        {WEEKDAYS.map(weekday => (onWeekdayClick ? (
          <button
            key={weekday}
            type="button"
            className="mini-head-cell selectable"
            title={`Tutti i ${WEEKDAY_LABELS[weekday].toLowerCase()} del mese`}
            onClick={() => onWeekdayClick(weekday)}
          >
            {WEEKDAY_SHORT_LABELS[weekday]}
          </button>
        ) : (
          <span key={weekday} className="mini-head-cell">
            {WEEKDAY_SHORT_LABELS[weekday]}
          </span>
        )))}
      </div>

      <div className="mini-calendar-grid">
        {Array.from({ length: leadingBlanks }, (_, index) => (
          <span key={`blank-${index}`} className="mini-day blank" />
        ))}

        {days.map(day => {
          const state = getDayState(day.date);
          const selected = state.selection !== 'none';

          return (
            <button
              key={day.date}
              type="button"
              className={[
                'mini-day',
                day.isWeekend ? 'weekend' : '',
                selected ? 'selected' : '',
                state.selection === 'partial' ? 'partial' : '',
                state.highlighted ? 'highlighted' : '',
              ].filter(Boolean).join(' ')}
              style={selected && state.color
                ? {
                    background: state.selection === 'full' ? state.color : `${state.color}59`,
                    borderColor: state.color,
                  }
                : undefined}
              disabled={state.disabled}
              title={state.title}
              onClick={() => onDayClick(day.date)}
            >
              <span className="mini-day-number">
                {day.day}
                {state.marker}
              </span>
              {renderDayDetail?.(day.date)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
