let counter = 0;

/**
 * Identificatore univoco per le entità locali. Il contatore garantisce che
 * più id generati nello stesso millisecondo restino distinti: vengono usati
 * anche come `key` di React, dove i duplicati causano perdite di stato.
 */
export function generateId(): string {
  counter = (counter + 1) % 0xffff;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
