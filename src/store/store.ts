// Stato dell'applicazione, salvato nel localStorage del browser.
//
// Chiavi:
//   turni2:services            elenco servizi + servizio attivo
//   turni2:svc:<id>:config     tipi di turno, aree, medici, regole
//   turni2:svc:<id>:m:<YYYY-MM> richieste, festivi e versioni del mese
//   turni2:ui                  mese selezionato e preferenze di vista

import { useSyncExternalStore } from 'react';
import { monthKey } from '../domain/dates';
import { templateConfig, uid } from '../domain/defaults';
import { emptyMonth, type MonthData, type ServiceConfig, type ServiceKind, type ServiceMeta } from '../domain/types';

const PREFIX = 'turni2:';
const SERVICES_KEY = `${PREFIX}services`;
const UI_KEY = `${PREFIX}ui`;
const configKey = (id: string) => `${PREFIX}svc:${id}:config`;
const monthPrefix = (id: string) => `${PREFIX}svc:${id}:m:`;

export type Page = 'calendar' | 'requests' | 'doctors' | 'shifts' | 'rules' | 'stats' | 'services';

export interface UiState {
  page: Page;
  year: number;
  month: number;
  /** Versione aperta per mese. */
  openVersion: Record<string, string>;
  calendarView: 'doctor' | 'area' | 'shift';
  /** Giorni in righe (predefinito) o in colonne. */
  calendarLayout: 'rows' | 'cols';
  /** Larghezze delle colonne del calendario, per vista. */
  colWidths: Record<string, number>;
  /** Vista per area: colonne Smonto e Riposo. */
  showOffCols: boolean;
  /** Ferie e desiderate: medici in righe (giorni in colonne) o in colonne. */
  requestsLayout: 'doctor-rows' | 'doctor-cols';
  theme: 'auto' | 'light' | 'dark';
}

export interface AppState {
  services: ServiceMeta[];
  activeId: string | null;
  config: ServiceConfig | null;
  months: Record<string, MonthData>;
  ui: UiState;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error('Salvataggio non riuscito', error);
    notifyError('Salvataggio non riuscito: lo spazio del browser potrebbe essere esaurito. Esporta un backup.');
  }
}

function remove(key: string) {
  try { localStorage.removeItem(key); } catch { /* niente */ }
}

function storageKeys(): string[] {
  try {
    return Object.keys(localStorage);
  } catch {
    return [];
  }
}

function loadMonths(serviceId: string): Record<string, MonthData> {
  const prefix = monthPrefix(serviceId);
  const months: Record<string, MonthData> = {};
  for (const k of storageKeys()) {
    if (!k.startsWith(prefix)) continue;
    const data = read<MonthData>(k);
    if (data) months[k.slice(prefix.length)] = { ...emptyMonth(), ...data };
  }
  return months;
}

/** Completa una configurazione salvata con i campi aggiunti in seguito. */
function normalizeConfig(config: ServiceConfig): ServiceConfig {
  const base = templateConfig('custom');
  return {
    ...base,
    ...config,
    rules: { ...base.rules, ...config.rules, weights: { ...base.rules.weights, ...config.rules?.weights }, hours: { ...base.rules.hours, ...config.rules?.hours }, rotation: { ...base.rules.rotation, ...config.rules?.rotation } },
  };
}

function initialUi(): UiState {
  const now = new Date();
  const saved = read<Partial<UiState>>(UI_KEY) ?? {};
  return {
    page: 'calendar',
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    openVersion: {},
    calendarView: 'doctor',
    calendarLayout: 'rows',
    colWidths: {},
    showOffCols: true,
    requestsLayout: 'doctor-rows',
    theme: 'auto',
    ...saved,
  };
}

function load(): AppState {
  const saved = read<{ services: ServiceMeta[]; activeId: string | null }>(SERVICES_KEY);
  const services = saved?.services ?? [];
  const activeId = saved?.activeId && services.some(s => s.id === saved.activeId) ? saved.activeId : services[0]?.id ?? null;
  const rawConfig = activeId ? read<ServiceConfig>(configKey(activeId)) : null;
  return {
    services,
    activeId,
    config: rawConfig ? normalizeConfig(rawConfig) : null,
    months: activeId ? loadMonths(activeId) : {},
    ui: initialUi(),
  };
}

let state: AppState = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function set(next: AppState) {
  state = next;
  emit();
}

export function getState(): AppState {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}

// --- Notifiche --------------------------------------------------------------

export interface Toast { id: number; text: string; tone: 'info' | 'error' | 'success' }
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
let toastSeq = 0;

export function notify(text: string, tone: Toast['tone'] = 'success') {
  const id = ++toastSeq;
  toasts = [...toasts, { id, text, tone }];
  toastListeners.forEach(l => l());
  setTimeout(() => {
    toasts = toasts.filter(t => t.id !== id);
    toastListeners.forEach(l => l());
  }, tone === 'error' ? 6000 : 3200);
}
function notifyError(text: string) { notify(text, 'error'); }

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    l => { toastListeners.add(l); return () => toastListeners.delete(l); },
    () => toasts,
    () => toasts,
  );
}

// --- UI ---------------------------------------------------------------------

export function setUi(patch: Partial<UiState>) {
  const ui = { ...state.ui, ...patch };
  write(UI_KEY, { ...ui, page: ui.page });
  set({ ...state, ui });
}

export function setOpenVersion(key: string, versionId: string) {
  setUi({ openVersion: { ...state.ui.openVersion, [key]: versionId } });
}

// --- Servizi ----------------------------------------------------------------

function saveServices(services: ServiceMeta[], activeId: string | null) {
  write(SERVICES_KEY, { services, activeId });
}

export function createService(name: string, kind: ServiceKind, copyFrom?: string): string {
  const id = uid('s');
  let config: ServiceConfig = templateConfig(kind);
  if (copyFrom) {
    const source = copyFrom === state.activeId ? state.config : read<ServiceConfig>(configKey(copyFrom));
    if (source) config = normalizeConfig(structuredClone(source));
  }
  const meta: ServiceMeta = { id, name: name.trim() || 'Nuovo servizio', kind, createdAt: new Date().toISOString() };
  const services = [...state.services, meta];
  write(configKey(id), config);
  saveServices(services, id);
  set({ ...state, services, activeId: id, config, months: {} });
  return id;
}

export function switchService(id: string) {
  if (id === state.activeId) return;
  const config = read<ServiceConfig>(configKey(id));
  saveServices(state.services, id);
  set({ ...state, activeId: id, config: config ? normalizeConfig(config) : templateConfig('custom'), months: loadMonths(id) });
}

export function renameService(id: string, name: string) {
  const services = state.services.map(s => (s.id === id ? { ...s, name } : s));
  saveServices(services, state.activeId);
  set({ ...state, services });
}

export function deleteService(id: string) {
  for (const k of storageKeys()) if (k === configKey(id) || k.startsWith(monthPrefix(id))) remove(k);
  const services = state.services.filter(s => s.id !== id);
  if (state.activeId === id) {
    const next = services[0]?.id ?? null;
    saveServices(services, next);
    set({
      ...state,
      services,
      activeId: next,
      config: next ? normalizeConfig(read<ServiceConfig>(configKey(next)) ?? templateConfig('custom')) : null,
      months: next ? loadMonths(next) : {},
    });
  } else {
    saveServices(services, state.activeId);
    set({ ...state, services });
  }
}

// --- Configurazione e mesi del servizio attivo -------------------------------

export function updateConfig(fn: (c: ServiceConfig) => ServiceConfig) {
  if (!state.activeId || !state.config) return;
  const config = fn(state.config);
  write(configKey(state.activeId), config);
  set({ ...state, config });
}

export function updateMonth(key: string, fn: (m: MonthData) => MonthData) {
  if (!state.activeId) return;
  const data = fn(state.months[key] ?? emptyMonth());
  write(monthPrefix(state.activeId) + key, data);
  set({ ...state, months: { ...state.months, [key]: data } });
}

export function currentMonthKey(): string {
  return monthKey(state.ui.year, state.ui.month);
}

// --- Backup -----------------------------------------------------------------

export interface Backup {
  app: 'turni-ospedale';
  version: 2;
  exportedAt: string;
  services: { meta: ServiceMeta; config: ServiceConfig; months: Record<string, MonthData> }[];
}

export function exportBackup(): Backup {
  return {
    app: 'turni-ospedale',
    version: 2,
    exportedAt: new Date().toISOString(),
    services: state.services.map(meta => ({
      meta,
      config: meta.id === state.activeId && state.config ? state.config : read<ServiceConfig>(configKey(meta.id)) ?? templateConfig('custom'),
      months: meta.id === state.activeId ? state.months : loadMonths(meta.id),
    })),
  };
}

/** Importa un backup aggiungendo i servizi (con nuovi id, per non sovrascrivere nulla). */
export function importBackup(backup: Backup): number {
  if (backup?.app !== 'turni-ospedale' || !Array.isArray(backup.services)) throw new Error('File di backup non riconosciuto');
  const services = [...state.services];
  for (const s of backup.services) {
    const id = uid('s');
    const names = new Set(services.map(x => x.name));
    const name = names.has(s.meta.name) ? `${s.meta.name} (importato)` : s.meta.name;
    services.push({ ...s.meta, id, name });
    write(configKey(id), s.config);
    for (const [k, m] of Object.entries(s.months ?? {})) write(monthPrefix(id) + k, m);
  }
  const activeId = state.activeId ?? services[0]?.id ?? null;
  saveServices(services, activeId);
  set({
    ...state,
    services,
    activeId,
    config: activeId ? normalizeConfig(read<ServiceConfig>(configKey(activeId)) ?? templateConfig('custom')) : null,
    months: activeId ? loadMonths(activeId) : {},
  });
  return backup.services.length;
}

/** Solo per i test. */
export function resetStoreForTests() {
  state = load();
  emit();
}
