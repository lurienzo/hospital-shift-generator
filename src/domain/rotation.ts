import { Assignment, RotationRule, SchemeStep, ShiftScheme } from '../models/types';
import { ShiftTypeIndex } from './shiftTypes';
import { daysBetween } from '../utils/date';

/**
 * Come un turno si rapporta alla rotazione attesa per quel medico.
 *
 * `unknown` non è un giudizio: significa che il medico non ha ancora un
 * riferimento nello schema, quindi la regola non ha nulla da dire.
 */
export type RotationFit = 'inPattern' | 'offPattern' | 'shouldRest' | 'unknown';

interface Anchor {
  date: string;
  stepIndex: number;
}

/**
 * Segue la posizione di ciascun medico dentro lo schema di rotazione del
 * servizio.
 *
 * La posizione non deriva da una data di partenza fissa ma dall'ultimo turno
 * svolto dal medico: chi ha fatto la notte è atteso in smonto il giorno dopo,
 * qualunque sala gliela avesse assegnata. Il riferimento si aggiorna a ogni
 * turno riconosciuto nello schema, così la rotazione si riallinea da sola
 * invece di accumulare scarti rispetto a un calendario teorico.
 *
 * Lo stesso oggetto serve al generatore, che lo usa come preferenza nella
 * scelta del medico, e all'interfaccia, che ne ricava le segnalazioni: le due
 * cose non possono quindi discordare.
 */
export class RotationTracker {
  private readonly steps: SchemeStep[];
  private readonly participants: Set<string> | null;
  private readonly anchors = new Map<string, Anchor>();
  /** Per ogni fascia, i passi dello schema che la richiedono. */
  private readonly stepsByShiftType = new Map<string, number[]>();

  constructor(
    scheme: ShiftScheme | null,
    rule: RotationRule,
    private readonly shiftTypes: ShiftTypeIndex,
  ) {
    // I passi che citano una fascia a rotazione non hanno senso in un giro
    // giornaliero e verrebbero comunque ignorati: si scartano subito, così la
    // lunghezza del giro riflette i giorni davvero governati dallo schema.
    this.steps = (scheme?.steps ?? []).filter(
      step => step.kind !== 'shift' || !shiftTypes.isRotational(step.shiftTypeId),
    );
    this.participants = rule.doctorIds.length > 0 ? new Set(rule.doctorIds) : null;

    this.steps.forEach((step, index) => {
      if (step.kind !== 'shift') return;
      const existing = this.stepsByShiftType.get(step.shiftTypeId);
      if (existing) existing.push(index);
      else this.stepsByShiftType.set(step.shiftTypeId, [index]);
    });
  }

  get isActive(): boolean {
    return this.steps.length > 0;
  }

  /** Numero di giornate che compongono un giro completo dello schema. */
  get length(): number {
    return this.steps.length;
  }

  appliesTo(doctorId: string): boolean {
    if (!this.isActive) return false;
    return this.participants === null || this.participants.has(doctorId);
  }

  /** Passo previsto per un medico in una data, o `null` se manca un riferimento. */
  expectedStep(doctorId: string, date: string): SchemeStep | null {
    const index = this.expectedStepIndex(doctorId, date);
    return index === null ? null : this.steps[index];
  }

  expectedStepIndex(doctorId: string, date: string): number | null {
    if (!this.appliesTo(doctorId)) return null;

    const anchor = this.anchors.get(doctorId);
    if (!anchor) return null;

    const offset = daysBetween(anchor.date, date);
    return (((anchor.stepIndex + offset) % this.length) + this.length) % this.length;
  }

  /**
   * Classifica un turno rispetto al passo atteso per quel medico.
   *
   * Le fasce a rotazione sono fuori dal giro giornaliero: impegnano un medico
   * per un blocco intero, quindi giudicarle giorno per giorno le segnalerebbe
   * come scostamenti a ogni giornata del blocco. Durante un blocco la
   * rotazione resta sospesa.
   */
  fit(doctorId: string, date: string, shiftTypeId: string): RotationFit {
    if (this.shiftTypes.isRotational(shiftTypeId)) return 'unknown';

    const step = this.expectedStep(doctorId, date);
    if (!step) return 'unknown';
    if (step.kind !== 'shift') return 'shouldRest';
    return step.shiftTypeId === shiftTypeId ? 'inPattern' : 'offPattern';
  }

  /**
   * Registra un turno svolto, spostando il riferimento del medico.
   *
   * Se la fascia compare in più passi si scelgono quello atteso, se combacia,
   * altrimenti il primo: senza questa preferenza uno schema con due turni
   * uguali farebbe saltare indietro la rotazione.
   */
  record(doctorId: string, date: string, shiftTypeId: string): void {
    if (!this.appliesTo(doctorId)) return;
    // Un blocco non sposta il riferimento: alla fine del blocco il medico
    // riprende il giro dal punto in cui si trovava.
    if (this.shiftTypes.isRotational(shiftTypeId)) return;

    const candidates = this.stepsByShiftType.get(shiftTypeId);
    if (!candidates || candidates.length === 0) return;

    const expected = this.expectedStepIndex(doctorId, date);
    const stepIndex = expected !== null && candidates.includes(expected)
      ? expected
      : candidates[0];

    this.anchors.set(doctorId, { date, stepIndex });
  }

  /**
   * Costruisce i riferimenti a partire da turni già assegnati, in ordine
   * cronologico. Serve a riprendere la rotazione dal mese precedente.
   */
  seed(assignments: Assignment[]): void {
    if (!this.isActive) return;

    const ordered = [...assignments].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return this.shiftTypes.compare(a.shiftTypeId, b.shiftTypeId);
    });

    for (const assignment of ordered) {
      this.record(assignment.doctorId, assignment.date, assignment.shiftTypeId);
    }
  }

  /** Copia indipendente, per non contaminare i riferimenti fra tentativi. */
  clone(): RotationTracker {
    const copy = Object.create(RotationTracker.prototype) as RotationTracker;
    Object.assign(copy, this, { anchors: new Map(this.anchors) });
    return copy;
  }
}

/**
 * Quanti turni di un calendario seguono la rotazione e quanti se ne
 * discostano. Il conteggio ignora i medici senza riferimento, che non hanno
 * ancora una posizione nello schema.
 */
export interface RotationAdherence {
  inPattern: number;
  offPattern: number;
  shouldRest: number;
  /** Quota dei turni classificabili che rispettano la rotazione. */
  ratio: number;
}

export function measureAdherence(
  assignments: Assignment[],
  scheme: ShiftScheme | null,
  rule: RotationRule,
  shiftTypes: ShiftTypeIndex,
  priorAssignments: Assignment[] = [],
): Map<string, RotationAdherence> {
  const result = new Map<string, RotationAdherence>();
  if (!scheme || scheme.steps.length === 0) return result;

  const tracker = new RotationTracker(scheme, rule, shiftTypes);
  tracker.seed(priorAssignments);

  const ordered = [...assignments].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return shiftTypes.compare(a.shiftTypeId, b.shiftTypeId);
  });

  for (const assignment of ordered) {
    if (!tracker.appliesTo(assignment.doctorId)) continue;

    const fit = tracker.fit(assignment.doctorId, assignment.date, assignment.shiftTypeId);
    const entry = result.get(assignment.doctorId)
      ?? { inPattern: 0, offPattern: 0, shouldRest: 0, ratio: 0 };

    if (fit === 'inPattern') entry.inPattern++;
    else if (fit === 'offPattern') entry.offPattern++;
    else if (fit === 'shouldRest') entry.shouldRest++;

    result.set(assignment.doctorId, entry);
    tracker.record(assignment.doctorId, assignment.date, assignment.shiftTypeId);
  }

  for (const entry of result.values()) {
    const classified = entry.inPattern + entry.offPattern + entry.shouldRest;
    entry.ratio = classified > 0 ? entry.inPattern / classified : 0;
  }

  return result;
}
