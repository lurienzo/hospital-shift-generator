// Controllo di capacita: le notti del mese bastano per i medici che possono farle?
// Serve a spiegare in anticipo perche qualcuno si ritrova notti ravvicinate.

import type { MonthContext } from './context';

export interface NightCapacity {
  nights: number;
  /** Medici che possono fare notti, con i giorni disponibili nel mese. */
  eligible: { id: string; name: string; days: number }[];
  /** Medici attivi che non fanno notti. */
  excluded: string[];
  /** Notti che i medici disponibili coprono rispettando la distanza minima. */
  capacity: number;
  perDoctor: number;
  short: boolean;
}

export function nightCapacity(ctx: MonthContext): NightCapacity | null {
  const nightIds = new Set([...ctx.shifts.values()].filter(s => s.night).map(s => s.id));
  if (nightIds.size === 0) return null;
  const nights = ctx.slots.filter(s => nightIds.has(s.shiftId)).length;
  if (nights === 0) return null;
  const gap = Math.max(3, ctx.config.rules.minNightGap);
  const eligible: NightCapacity['eligible'] = [];
  const excluded: string[] = [];
  for (const d of ctx.doctors) {
    const can = d.maxNights !== 0 && [...nightIds].some(id => !d.excludedShiftIds.includes(id));
    if (!can) { excluded.push(d.name); continue; }
    const req = ctx.requests[d.id] ?? {};
    const days = ctx.dates.filter(x => req[x] !== 'F' && req[x] !== 'A').length;
    eligible.push({ id: d.id, name: d.name, days });
  }
  const capacity = eligible.reduce((s, e) => {
    const d = ctx.doctorById.get(e.id)!;
    const byGap = Math.ceil(e.days / gap);
    return s + (d.maxNights !== null ? Math.min(byGap, d.maxNights) : byGap);
  }, 0);
  return {
    nights,
    eligible,
    excluded,
    capacity,
    perDoctor: eligible.length ? nights / eligible.length : Infinity,
    short: nights > capacity,
  };
}
