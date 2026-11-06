// File Excel: template delle richieste, import, esportazione del calendario.
// Le librerie si caricano solo quando servono, per non appesantire l'avvio.

import type { MonthContext } from '../domain/context';
import { monthDates, monthLabel, parseIso, WEEKDAY_SHORT, weekdayOf } from '../domain/dates';
import { REQUEST_CODES, REQUEST_INFO, type Assignment, type Doctor, type MonthData } from '../domain/types';
import type { ScheduleAnalysis } from '../domain/analysis';
import { parseDelimited, parseRequestGrid, type Cell, type GridImport } from './requestsGrid';

type XCell = { value?: string | number | null; [k: string]: unknown } | string | number | null;

const HEADER_BG = '#e2e8f0';
const WEEKEND_BG = '#f1f5f9';
const HOLIDAY_COLOR = '#b91c1c';

async function save(sheets: { data: XCell[][]; sheet: string; columns?: { width?: number }[]; stickyRowsCount?: number; stickyColumnsCount?: number }[], fileName: string) {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  // La libreria accetta piu fogli come array di oggetti.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (writeExcelFile as any)(sheets, { fontFamily: 'Calibri', fontSize: 11 }).toFile(fileName);
}

function dayHeader(ctx: Pick<MonthContext, 'holidays'>, dates: string[]): { days: XCell[]; weekdays: XCell[] } {
  const days: XCell[] = [];
  const weekdays: XCell[] = [];
  for (const d of dates) {
    const wd = weekdayOf(d);
    const hol = ctx.holidays.has(d);
    const bg = hol || wd >= 5 ? WEEKEND_BG : HEADER_BG;
    const color = hol ? HOLIDAY_COLOR : undefined;
    days.push({ value: parseIso(d).day, type: Number, align: 'center', fontWeight: 'bold', backgroundColor: bg, textColor: color });
    weekdays.push({ value: WEEKDAY_SHORT[wd], align: 'center', backgroundColor: bg, textColor: color, fontSize: 9 });
  }
  return { days, weekdays };
}

/** Verso della griglia richieste: medici in righe (giorni in colonne) o il contrario. */
export type RequestsLayout = 'doctor-rows' | 'doctor-cols';

export async function downloadRequestsTemplate(ctx: MonthContext, data: MonthData, serviceName: string, layout: RequestsLayout = 'doctor-rows') {
  const dates = ctx.dates;
  const dayBg = (d: string) => (ctx.holidays.has(d) || weekdayOf(d) >= 5 ? WEEKEND_BG : undefined);
  const code = (docId: string, d: string): XCell => ({ value: data.requests[docId]?.[d] ?? null, align: 'center', type: String, backgroundColor: dayBg(d) });
  let rows: XCell[][];
  let columns: { width: number }[];
  let sticky: { stickyRowsCount: number; stickyColumnsCount: number };
  const { days, weekdays } = dayHeader(ctx, dates);
  if (layout === 'doctor-rows') {
    rows = [
      [{ value: 'Medico', fontWeight: 'bold', backgroundColor: HEADER_BG }, ...days],
      [{ value: monthLabel(ctx.year, ctx.month), fontSize: 9, backgroundColor: HEADER_BG }, ...weekdays],
      ...ctx.doctors.map(doc => [{ value: doc.name, fontWeight: 'bold' }, ...dates.map(d => code(doc.id, d))] as XCell[]),
    ];
    columns = [{ width: 22 }, ...dates.map(() => ({ width: 4.5 }))];
    sticky = { stickyRowsCount: 2, stickyColumnsCount: 1 };
  } else {
    // Giorni in righe: prima colonna il numero del giorno, poi il giorno della
    // settimana, poi una colonna per medico.
    rows = [
      [{ value: 'Giorno', fontWeight: 'bold', backgroundColor: HEADER_BG }, { value: monthLabel(ctx.year, ctx.month), fontSize: 9, backgroundColor: HEADER_BG },
        ...ctx.doctors.map(doc => ({ value: doc.name, fontWeight: 'bold', align: 'center', wrap: true, backgroundColor: HEADER_BG }) as XCell)],
      ...dates.map((d, i) => [days[i], weekdays[i], ...ctx.doctors.map(doc => code(doc.id, d))]),
    ];
    columns = [{ width: 7 }, { width: 13 }, ...ctx.doctors.map(() => ({ width: 12 }))];
    sticky = { stickyRowsCount: 1, stickyColumnsCount: 2 };
  }
  const legend: XCell[][] = [
    [{ value: 'Sigla', fontWeight: 'bold', backgroundColor: HEADER_BG }, { value: 'Significato', fontWeight: 'bold', backgroundColor: HEADER_BG }, { value: 'Come la tratta il generatore', fontWeight: 'bold', backgroundColor: HEADER_BG }],
    ...REQUEST_CODES.map(c => [c, REQUEST_INFO[c].label, REQUEST_INFO[c].hint] as XCell[]),
    [],
    ['Compila una sigla per cella e lascia vuoti i giorni senza richieste.'],
    ['Non modificare i numeri dei giorni né i nomi dei medici.'],
    ['Il file si reimporta in entrambi i versi: medici in righe o in colonne.'],
    ['Sono accettate anche: FERIE, MAL, CONGRESSO (= A), X o LIBERO (= D), NN (= N).'],
    [`Servizio: ${serviceName} · ${monthLabel(ctx.year, ctx.month)}`],
  ];
  await save([
    { data: rows, sheet: `Richieste ${ctx.key}`, columns, ...sticky },
    { data: legend, sheet: 'Legenda', columns: [{ width: 8 }, { width: 16 }, { width: 60 }] },
  ], `richieste-${slug(serviceName)}-${ctx.key}${layout === 'doctor-cols' ? '-medici-in-colonne' : ''}.xlsx`);
}

export async function readRequestsFile(file: File, doctors: Doctor[], year: number, month: number): Promise<GridImport & { sheetMonth: string | null }> {
  let rows: Cell[][];
  let sheetMonth: string | null = null;
  if (/\.(csv|txt|tsv)$/i.test(file.name)) {
    rows = parseDelimited(await file.text());
  } else {
    const mod = await import('read-excel-file/browser');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sheets = await (mod as any).default(file) as { sheet: string; data: Cell[][] }[];
    const sheet = sheets.find(s => /richieste/i.test(s.sheet)) ?? sheets[0];
    rows = sheet?.data ?? [];
    sheetMonth = sheet?.sheet.match(/(\d{4}-\d{2})/)?.[1] ?? null;
  }
  return { ...parseRequestGrid(rows, doctors, year, month), sheetMonth };
}

export async function exportSchedule(ctx: MonthContext, assignments: Assignment[], analysis: ScheduleAnalysis | null, serviceName: string) {
  const dates = monthDates(ctx.year, ctx.month);
  const { days, weekdays } = dayHeader(ctx, dates);
  // L'area si scrive solo per i turni che esistono in piu aree.
  const areasByShift = new Map<string, Set<string>>();
  for (const k of ctx.demand.keys()) {
    const [, areaId, shiftId] = k.split('|');
    (areasByShift.get(shiftId) ?? areasByShift.set(shiftId, new Set()).get(shiftId)!).add(areaId);
  }
  const ambiguous = (shiftId: string) => (areasByShift.get(shiftId)?.size ?? 0) > 1;
  const multiArea = [...areasByShift.values()].some(s => s.size > 1);
  const byDocDate = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const k = `${a.doctorId}|${a.date}`;
    (byDocDate.get(k) ?? byDocDate.set(k, []).get(k)!).push(a);
  }
  const label = (a: Assignment) => {
    const s = ctx.shifts.get(a.shiftId)?.code ?? '?';
    const area = ctx.areas.get(a.areaId);
    return ambiguous(a.shiftId) && area ? `${s} ${shortName(area.name)}` : s;
  };

  const perDoctor: XCell[][] = [
    [{ value: 'Medico', fontWeight: 'bold', backgroundColor: HEADER_BG }, ...days, { value: 'Turni', fontWeight: 'bold', backgroundColor: HEADER_BG }, { value: 'Ore', fontWeight: 'bold', backgroundColor: HEADER_BG }, { value: 'Notti', fontWeight: 'bold', backgroundColor: HEADER_BG }, { value: 'Weekend', fontWeight: 'bold', backgroundColor: HEADER_BG }, { value: 'Festivi', fontWeight: 'bold', backgroundColor: HEADER_BG }],
    [{ value: '', backgroundColor: HEADER_BG }, ...weekdays],
  ];
  for (const doc of ctx.doctors) {
    const ev = analysis?.perDoctor.get(doc.id);
    perDoctor.push([
      { value: doc.name, fontWeight: 'bold' },
      ...dates.map(d => {
        const list = byDocDate.get(`${doc.id}|${d}`) ?? [];
        const shift = list[0] ? ctx.shifts.get(list[0].shiftId) : undefined;
        const req = ctx.requests[doc.id]?.[d];
        const value = list.length ? list.map(label).join('/') : (req === 'F' || req === 'A' ? req : null);
        return {
          value,
          align: 'center' as const,
          backgroundColor: shift ? lighten(shift.color) : (ctx.holidays.has(d) || weekdayOf(d) >= 5 ? WEEKEND_BG : undefined),
          fontWeight: shift?.night ? 'bold' : undefined,
        };
      }),
      ev?.tally.total ?? 0, ev?.tally.hours ?? 0, ev?.tally.nights ?? 0, ev?.tally.weekends ?? 0, ev?.tally.holidays ?? 0,
    ]);
  }

  const perArea: XCell[][] = [
    [{ value: 'Area · turno', fontWeight: 'bold', backgroundColor: HEADER_BG }, ...days],
    [{ value: '', backgroundColor: HEADER_BG }, ...weekdays],
  ];
  for (const area of ctx.config.areas) {
    for (const shift of ctx.config.shiftTypes) {
      const need = Math.max(0, ...dates.map(d => Math.max(ctx.demand.get(`${d}|${area.id}|${shift.id}`)?.count ?? 0, ctx.removed.get(`${d}|${area.id}|${shift.id}`) ?? 0)));
      for (let i = 0; i < need; i++) {
        perArea.push([
          { value: `${area.name} · ${shift.name}${need > 1 ? ` ${i + 1}` : ''}`, fontWeight: 'bold' },
          ...dates.map(d => {
            const list = assignments.filter(a => a.date === d && a.areaId === area.id && a.shiftId === shift.id);
            const doc = list[i] ? ctx.doctorById.get(list[i].doctorId) : null;
            const dem = ctx.demand.get(`${d}|${area.id}|${shift.id}`);
            const needed = (dem?.count ?? 0) > i && !dem?.optional;
            const removed = !doc && (dem?.count ?? 0) <= i && (ctx.removed.get(`${d}|${area.id}|${shift.id}`) ?? 0) > i;
            return { value: doc?.name ?? (removed ? 'rimosso' : needed ? '—' : null), align: 'center' as const, textColor: !doc && needed ? HOLIDAY_COLOR : removed ? '#888888' : undefined };
          }),
        ]);
      }
    }
  }

  const issues: XCell[][] = [[{ value: 'Tipo', fontWeight: 'bold', backgroundColor: HEADER_BG }, { value: 'Medico', fontWeight: 'bold', backgroundColor: HEADER_BG }, { value: 'Dettaglio', fontWeight: 'bold', backgroundColor: HEADER_BG }]];
  for (const i of analysis?.issues ?? []) {
    if (i.severity === 'info') continue;
    issues.push([i.severity === 'error' ? 'Errore' : 'Avviso', i.doctorId ? ctx.doctorById.get(i.doctorId)?.name ?? '' : '', i.message]);
  }

  await save([
    { data: perDoctor, sheet: 'Per medico', columns: [{ width: 20 }, ...dates.map(() => ({ width: multiArea ? 7 : 4.5 })), { width: 7 }, { width: 7 }, { width: 7 }, { width: 9 }, { width: 8 }], stickyRowsCount: 2, stickyColumnsCount: 1 },
    { data: perArea, sheet: 'Per area', columns: [{ width: 26 }, ...dates.map(() => ({ width: 10 }))], stickyRowsCount: 2, stickyColumnsCount: 1 },
    { data: issues, sheet: 'Segnalazioni', columns: [{ width: 10 }, { width: 18 }, { width: 80 }] },
  ], `turni-${slug(serviceName)}-${ctx.key}.xlsx`);
}

export function shortName(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return name.slice(0, 4);
  return words.map(w => (/^\d+$/.test(w) ? w : w[0].toUpperCase())).join('');
}

function slug(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'servizio';
}

/** Colore pastello per lo sfondo delle celle Excel. */
function lighten(hex: string): string {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m) return '#ffffff';
  return '#' + m.map(x => Math.round(parseInt(x, 16) * 0.25 + 255 * 0.75).toString(16).padStart(2, '0')).join('');
}

export function downloadJson(data: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
