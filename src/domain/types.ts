// Modello dati dell'applicazione.
//
// Un servizio (Sale operatorie, Terapia intensiva, ...) e un mondo chiuso: ha
// i propri tipi di turno, le proprie aree da coprire, i propri medici e i
// propri mesi. Nulla viene condiviso fra servizi.

/** Chiave di colonna della griglia di copertura: giorni della settimana + festivo. */
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' | 'hol';

export const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'hol'];
export const WEEK_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Lun', tue: 'Mar', wed: 'Mer', thu: 'Gio', fri: 'Ven', sat: 'Sab', sun: 'Dom', hol: 'Festivo',
};

/**
 * `night` impone lo smonto il giorno dopo (vincolante) e il riposo il secondo
 * giorno (non vincolante, ma contato se saltato).
 */
export type ShiftKind = 'day' | 'night';

export interface ShiftType {
  id: string;
  name: string;
  /** Sigla breve mostrata nel calendario (1-3 caratteri). */
  code: string;
  /** HH:MM */
  start: string;
  /** HH:MM; se <= start il turno scavalca la mezzanotte. */
  end: string;
  color: string;
  kind: ShiftKind;
  /**
   * Diurnismo: il turno si assegna a blocchi (una settimana allo stesso
   * medico). `startWeekday` 0 = lunedi ... 6 = domenica.
   */
  block: { startWeekday: number } | null;
  /**
   * Turno proprio di un'area (es. una sala che lavora 09-17): compare solo
   * nella copertura di quell'area. Assente o null = vale per tutte.
   */
  areaId?: string | null;
  /**
   * Turno opzionale: se resta vuoto non e un problema. Il generatore lo copre
   * solo se a qualcuno conviene (es. chi e sotto carico), e non entra nelle
   * quote di equita.
   */
  optional?: boolean;
}

export interface CoverageCell {
  /** Quanti medici servono. */
  count: number;
  /** Turno critico: va coperto sempre, anche a costo di violare le preferenze. */
  critical: boolean;
}

/** Copertura: per colonna (giorno/festivo) e per tipo di turno. */
export type Coverage = Record<DayKey, Record<string, CoverageCell>>;

export interface Area {
  id: string;
  name: string;
  color: string;
  coverage: Coverage;
}

export type RuleLevel = 'avoid' | 'never';

export interface WeekdayRule {
  /** 0 = lunedi ... 6 = domenica */
  weekday: number;
  /** null = tutta la giornata */
  shiftId: string | null;
  level: RuleLevel;
}

export interface Doctor {
  id: string;
  name: string;
  color: string;
  active: boolean;
  /** Mese (YYYY-MM) da cui il medico fa parte del servizio: serve all'equita cumulata. */
  since: string;
  excludedAreaIds: string[];
  /** Turni che non fa mai (es. niente notti). */
  excludedShiftIds: string[];
  weekdayRules: WeekdayRule[];
  /** Ore settimanali proprie, se diverse da quelle del servizio. */
  hours: { min: number; max: number } | null;
  /** Massimo di notti al mese (non vincolante). null = nessun limite. */
  maxNights: number | null;
  /** Partecipa alla rotazione del servizio. */
  inRotation: boolean;
  note: string;
}

export type SchemeStep =
  | { kind: 'shift'; shiftId: string }
  | { kind: 'smonto' }
  | { kind: 'riposo' };

export interface Scheme {
  id: string;
  name: string;
  steps: SchemeStep[];
}

export type Priority = 0 | 1 | 2 | 3;

export interface Rules {
  hours: { enabled: boolean; min: number; max: number; enforcement: 'balance' | 'cap' };
  schemes: Scheme[];
  rotation: { schemeId: string | null; strength: 'preference' | 'binding' };
  /** Giorni lavorativi consecutivi oltre i quali segnalare. 0 = disattivato. */
  maxConsecutiveDays: number;
  /**
   * Distanza minima in giorni fra l'inizio di due notti dello stesso medico
   * (es. 5: dopo la notte del 1 la successiva non prima del 6). Non vincolante.
   */
  minNightGap: number;
  /** Consente piu turni non sovrapposti nello stesso giorno (es. M + P = lunga). */
  allowMultiplePerDay: boolean;
  /**
   * Lunga nella stessa area: chi fa due turni di fila nello stesso giorno
   * (es. mattina + pomeriggio) resta nell'area del primo, se quell'area
   * prosegue con il secondo turno. Se l'area chiude, puo spostarsi.
   */
  longSameArea: 'off' | 'preference' | 'binding';
  /** Massimo di ore lavorabili in una giornata con la lunga (default 12). */
  maxDayHours: number;
  /**
   * Per i turni NON critici: meglio lasciarli scoperti che violare una
   * desiderata. I critici violano comunque le desiderate se serve.
   */
  protectDesiderata: boolean;
  /** Mesi salvati considerati nell'equita cumulata. */
  fairnessWindow: 'year' | '12m' | 'all';
  /** Peso relativo di ogni categoria nel bilanciamento (0 = ignora, 3 = massimo). */
  weights: { total: Priority; nights: Priority; weekends: Priority; holidays: Priority; critical: Priority };
  /** Santo patrono, MM-DD. */
  patronDay: string | null;
}

export type ServiceKind = 'sale' | 'ti' | 'custom';

export interface ServiceMeta {
  id: string;
  name: string;
  kind: ServiceKind;
  createdAt: string;
}

export interface ServiceConfig {
  shiftTypes: ShiftType[];
  areas: Area[];
  doctors: Doctor[];
  rules: Rules;
}

/** F = ferie, A = altra assenza, D = desiderata (giorno libero), N = niente notte quel giorno. */
export type RequestCode = 'F' | 'A' | 'D' | 'N';

export const REQUEST_CODES: RequestCode[] = ['F', 'A', 'D', 'N'];

export const REQUEST_INFO: Record<RequestCode, { label: string; hint: string; hard: boolean }> = {
  F: { label: 'Ferie', hint: 'Non lavora: vincolo assoluto.', hard: true },
  A: { label: 'Assenza', hint: 'Malattia, congresso, aggiornamento: vincolo assoluto.', hard: true },
  D: { label: 'Desiderata', hint: 'Giorno libero richiesto: rispettato se possibile.', hard: false },
  N: { label: 'No notte', hint: 'Non vuole la notte quel giorno: rispettato se possibile.', hard: false },
};

export interface Assignment {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  areaId: string;
  shiftId: string;
  doctorId: string;
  /** Fissato a mano: la rigenerazione lo mantiene. */
  locked?: boolean;
}

export interface Version {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  assignments: Assignment[];
  /** Segnalazioni ignorate a mano in questa versione (chiavi di `issueKey`). */
  ignoredIssues?: string[];
}

/** Variazione di un turno in un giorno preciso (chiave: data|area|turno). */
export interface SlotOverride {
  /** Medici richiesti quel giorno; 0 = turno rimosso. */
  count?: number;
  /** Opzionale (o obbligatorio) solo per quel giorno. */
  optional?: boolean;
}

export interface MonthData {
  /** doctorId -> data -> codice */
  requests: Record<string, Record<string, RequestCode>>;
  /** Festivi aggiunti a mano in questo mese (oltre a quelli automatici). */
  extraHolidays: string[];
  /** Festivi automatici tolti a mano. */
  removedHolidays: string[];
  /** Turni aggiunti, rimossi o resi opzionali per singolo giorno. */
  overrides?: Record<string, SlotOverride>;
  versions: Version[];
  /** Versione definitiva: alimenta statistiche ed equita dei mesi seguenti. */
  activeVersionId: string | null;
}

export const emptyMonth = (): MonthData => ({
  requests: {},
  extraHolidays: [],
  removedHolidays: [],
  versions: [],
  activeVersionId: null,
});
