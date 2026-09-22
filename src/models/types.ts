// ---------------------------------------------------------------------------
// Giorni della settimana
// ---------------------------------------------------------------------------

export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export const WEEKDAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
export const WORKING_WEEKDAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
export const WEEKEND_WEEKDAYS: Weekday[] = ['saturday', 'sunday'];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Lunedì',
  tuesday: 'Martedì',
  wednesday: 'Mercoledì',
  thursday: 'Giovedì',
  friday: 'Venerdì',
  saturday: 'Sabato',
  sunday: 'Domenica',
};

export const WEEKDAY_SHORT_LABELS: Record<Weekday, string> = {
  monday: 'Lun',
  tuesday: 'Mar',
  wednesday: 'Mer',
  thursday: 'Gio',
  friday: 'Ven',
  saturday: 'Sab',
  sunday: 'Dom',
};

// ---------------------------------------------------------------------------
// Fasce orarie (configurabili dall'utente)
//
// Gli id delle tre fasce predefinite coincidono con la loro rappresentazione
// testuale storica ("08:00-14:00", ...): così i calendari già salvati nel
// browser restano validi senza bisogno di rimappare gli id.
// ---------------------------------------------------------------------------

export interface ShiftType {
  id: string;
  name: string;
  /** Sigla di 1-2 caratteri usata nelle viste compatte e negli schemi. */
  code: string;
  /** Orario di inizio in formato HH:MM. */
  start: string;
  /** Orario di fine in formato HH:MM. Se <= start la fascia scavalca la mezzanotte. */
  end: string;
  color: string;
  order: number;
  /**
   * Fascia a rotazione, come il diurnismo: non si assegna giorno per giorno ma
   * a blocchi interi (tipicamente una settimana). Lo stesso medico copre tutto
   * il blocco, e il blocco vale una unità sola nel conteggio dell'equità,
   * distribuita fra i medici nelle settimane e nei mesi successivi.
   */
  rotational?: boolean;
  /** Durata del blocco in giorni. Usata solo se `rotational`. */
  blockLengthDays?: number;
  /** Giorno in cui inizia ogni blocco. Usato solo se `rotational`. */
  blockStartWeekday?: Weekday;
}

export const DEFAULT_BLOCK_LENGTH_DAYS = 7;
export const DEFAULT_BLOCK_START_WEEKDAY: Weekday = 'monday';

export const DEFAULT_SHIFT_TYPES: ShiftType[] = [
  { id: '08:00-14:00', name: 'Mattina', code: 'M', start: '08:00', end: '14:00', color: '#f59e0b', order: 0 },
  { id: '14:00-20:00', name: 'Pomeriggio', code: 'P', start: '14:00', end: '20:00', color: '#3b82f6', order: 1 },
  { id: '20:00-08:00', name: 'Notte', code: 'N', start: '20:00', end: '08:00', color: '#8b5cf6', order: 2 },
];

export const SHIFT_TYPE_COLORS = [
  '#f59e0b', '#3b82f6', '#8b5cf6', '#10b981', '#ec4899',
  '#06b6d4', '#ef4444', '#84cc16', '#a855f7', '#14b8a6',
];

// ---------------------------------------------------------------------------
// Sale operative e turni settimanali
// ---------------------------------------------------------------------------

export interface ScheduleSlot {
  id: string;
  weekday: Weekday;
  shiftTypeId: string;
  /** Turno pesante: il generatore lo distribuisce in modo equo fra i medici. */
  isCritical: boolean;
  /** Il giorno successivo il medico è smontante (non può lavorare). */
  requiresNextDayRest: boolean;
  /** Anche il secondo giorno successivo è di riposo. */
  requiresSecondDayRest: boolean;
  /** Il medico non può coprire nessun altro turno nella stessa giornata. */
  isFullDayExclusive: boolean;
}

export interface DayGroup {
  id: string;
  days: Weekday[];
}

export type RotationMode = 'none' | 'consecutive' | 'dayGroups';

export interface OperativeRoom {
  id: string;
  name: string;
  color: string;
  slots: ScheduleSlot[];
  dayGroups: DayGroup[];
  /** Numero di turni consecutivi assegnati allo stesso medico. */
  consecutiveShifts?: number;
  /** Giorno di inizio blocco quando i turni consecutivi coprono la settimana. */
  consecutiveStartDay?: Weekday;
}

export function getRotationMode(room: OperativeRoom): RotationMode {
  if (room.dayGroups.length > 0) return 'dayGroups';
  if (room.consecutiveShifts && room.consecutiveShifts > 0) return 'consecutive';
  return 'none';
}

// ---------------------------------------------------------------------------
// Schemi turni standardizzati (es. Pomeriggio → Lunga → Notte → Smonto → Riposo)
//
// Uno schema descrive la successione di giornate che un medico dovrebbe
// seguire. Non è legato a una sala né a un giorno della settimana: vale per
// tutto il servizio, e qualunque sala può fornire il turno che il passo
// richiede.
// ---------------------------------------------------------------------------

export type SchemeStep =
  | { kind: 'shift'; shiftTypeId: string }
  | { kind: 'smonto' }
  | { kind: 'riposo' };

export interface ShiftScheme {
  id: string;
  name: string;
  steps: SchemeStep[];
  /** Gli schemi predefiniti non sono modificabili né eliminabili. */
  builtIn?: boolean;
}

export const OFF_STEP_LABELS: Record<'smonto' | 'riposo', string> = {
  smonto: 'Smonto',
  riposo: 'Riposo',
};

/**
 * Ore che ogni medico dovrebbe svolgere nel periodo indicato.
 *
 * I contratti ospedalieri si esprimono di norma su base settimanale (36-42
 * ore), ma il periodo è configurabile perché alcuni servizi ragionano sul
 * mese.
 */
export type HoursPeriod = 'week' | 'month';

export interface HoursRange {
  min: number;
  max: number;
}

export interface HoursTarget extends HoursRange {
  enabled: boolean;
  period: HoursPeriod;
}

export const DEFAULT_HOURS_TARGET: HoursTarget = {
  enabled: false,
  period: 'week',
  min: 36,
  max: 42,
};

export const HOURS_PERIOD_LABELS: Record<HoursPeriod, string> = {
  week: 'settimana',
  month: 'mese',
};

/**
 * Regola di rotazione del servizio: lo schema che i medici cercano di
 * seguire, indipendentemente dalla sala che fornisce il turno.
 *
 * La posizione di un medico nello schema non deriva da una data fissa ma dal
 * turno che ha svolto più recentemente: se ieri ha fatto notte, oggi il passo
 * atteso è lo smonto. Così la rotazione si riallinea da sola e non serve
 * ancorarla a un giorno della settimana.
 */
export interface RotationRule {
  /** Schema da seguire. Stringa vuota = nessuna regola attiva. */
  schemeId: string;
  /** Medici a cui si applica. Elenco vuoto = tutti. */
  doctorIds: string[];
  /**
   * `preference`: il generatore segue la rotazione quando può, senza lasciare
   * turni scoperti per rispettarla.
   * `binding`: nei giorni di smonto e riposo previsti non assegna nulla.
   */
  strength: 'preference' | 'binding';
}

export const NO_ROTATION_RULE: RotationRule = {
  schemeId: '',
  doctorIds: [],
  strength: 'preference',
};

// ---------------------------------------------------------------------------
// Medici
// ---------------------------------------------------------------------------

export const DOCTOR_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e91e63', '#00bcd4', '#ff5722', '#607d8b',
  '#8bc34a', '#ff9800', '#795548', '#009688', '#673ab7',
  '#03a9f4', '#cddc39', '#ffc107', '#4caf50', '#2196f3',
];

/**
 * Quanto è stringente un vincolo su una giornata.
 *
 * `never` è un divieto e produce un errore; `avoid` è una preferenza e
 * produce un avviso. Lo stesso meccanismo copre entrambi i casi, così non
 * esistono due elenchi separati da tenere coerenti.
 */
export type RuleLevel = 'avoid' | 'never';

export interface WeekdayRule {
  weekday: Weekday;
  /** Fascia interessata, oppure `null` per la giornata intera. */
  shiftTypeId: string | null;
  level: RuleLevel;
}

/**
 * Preferenza sulla durata dei turni. La soglia fra lungo e breve dipende
 * dalle fasce configurate nel servizio, non da un numero fisso.
 */
export type ShiftLengthPreference = 'none' | 'long' | 'short';

export interface Doctor {
  id: string;
  name: string;
  color: string;
  excludedRooms: string[];
  /** Divieti e preferenze per giorno della settimana, anche per singola fascia. */
  weekdayRules: WeekdayRule[];
  shiftLengthPreference: ShiftLengthPreference;
  /** Ore proprie del medico, quando diverse da quelle del servizio. */
  hoursOverride?: HoursRange;
}

// ---------------------------------------------------------------------------
// Assegnazioni e calendario
// ---------------------------------------------------------------------------

export interface Assignment {
  id: string;
  /** Data in formato YYYY-MM-DD. */
  date: string;
  roomId: string;
  roomName: string;
  shiftTypeId: string;
  doctorId: string;
  doctorName: string;
  /** Turno pre-compilato: la generazione lo mantiene fisso. */
  locked?: boolean;
}

export interface HolidayConfig {
  date: string;
  disabledRooms: string[];
}

export type DoctorDateMode = 'exclusion' | 'availability';

export interface GenerationConfig {
  year: number;
  month: number;
  holidays: HolidayConfig[];
  /** Per medico: date o `data:fasciaId` in cui NON è disponibile. */
  doctorDateExclusions: Record<string, string[]>;
  /** Per medico: date o `data:fasciaId` in cui è disponibile (whitelist). */
  doctorDateAvailability: Record<string, string[]>;
  doctorAvailabilityMode: Record<string, DoctorDateMode>;
  prefilledAssignments: Assignment[];
}

export interface MonthlySchedule {
  year: number;
  month: number;
  holidays: string[];
  assignments: Assignment[];
}

export interface ScheduleVersion {
  id: string;
  name: string;
  schedule: MonthlySchedule;
  createdAt: string;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Statistiche
// ---------------------------------------------------------------------------

export interface DoctorStats {
  doctorId: string;
  doctorName: string;
  doctorColor: string;
  totalShifts: number;
  totalHours: number;
  distinctDays: number;
  weekendShifts: number;
  criticalShifts: number;
  shiftsByRoom: Record<string, number>;
  shiftsByShiftType: Record<string, number>;
  shiftsByMonth: Record<string, number>;
  /**
   * Blocchi completati per ciascuna fascia a rotazione: è l'unità con cui si
   * misura l'equità del diurnismo, dove conta quante settimane si fanno e non
   * quanti singoli turni.
   */
  blocksByShiftType: Record<string, number>;
}
