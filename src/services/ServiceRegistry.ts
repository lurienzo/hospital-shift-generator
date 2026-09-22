import { generateId } from '../utils/id';

/**
 * Un servizio è un ambito di lavoro indipendente: Terapia Intensiva 1,
 * Piastra Operatoria e così via. Ogni servizio ha i propri medici, le proprie
 * sale, le proprie fasce orarie e i propri calendari, e i dati non si
 * mescolano mai fra servizi.
 */
export interface Service {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

/** Ambiti di dati salvati separatamente per ciascun servizio. */
export const DATA_SCOPES = [
  'rooms',
  'doctors',
  'shiftTypes',
  'schemes',
  'rotationRule',
  'hoursTarget',
  'schedule',
  'versions',
  'generationConfig',
] as const;

export type DataScope = (typeof DATA_SCOPES)[number];

const REGISTRY_KEY = 'hsg_services';
const ACTIVE_KEY = 'hsg_active_service';

/** Chiavi usate prima dell'introduzione dei servizi, da ricondurre al primo servizio. */
const LEGACY_KEYS: Record<DataScope, string> = {
  rooms: 'hospital_shift_rooms',
  doctors: 'hospital_shift_doctors',
  shiftTypes: 'hospital_shift_shift_types',
  schemes: 'hospital_shift_schemes',
  rotationRule: 'hospital_shift_rotation_rule',
  hoursTarget: 'hospital_shift_hours_target',
  schedule: 'hospital_shift_schedule',
  versions: 'hospital_shift_schedule_versions',
  generationConfig: 'hospital_shift_generation_config',
};

export const SERVICE_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#ef4444', '#84cc16',
];

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export class ServiceRegistry {
  /** Chiave di storage di un ambito, riferita al servizio indicato. */
  static scopedKey(scope: DataScope, serviceId: string): string {
    return `hsg:${serviceId}:${scope}`;
  }

  static list(): Service[] {
    this.ensureInitialized();
    return readJSON<Service[]>(REGISTRY_KEY, []);
  }

  static getActiveId(): string {
    this.ensureInitialized();
    const stored = localStorage.getItem(ACTIVE_KEY);
    const services = readJSON<Service[]>(REGISTRY_KEY, []);

    // Se il servizio memorizzato non esiste più si torna al primo disponibile,
    // per non lasciare l'applicazione senza un ambito valido.
    if (stored && services.some(service => service.id === stored)) return stored;

    const fallback = services[0]?.id ?? '';
    if (fallback) localStorage.setItem(ACTIVE_KEY, fallback);
    return fallback;
  }

  static getActive(): Service | undefined {
    const id = this.getActiveId();
    return this.list().find(service => service.id === id);
  }

  static setActive(serviceId: string): void {
    if (!this.list().some(service => service.id === serviceId)) return;
    localStorage.setItem(ACTIVE_KEY, serviceId);
  }

  static create(name: string): Service {
    const services = this.list();
    const service: Service = {
      id: generateId(),
      name: name.trim() || `Servizio ${services.length + 1}`,
      color: SERVICE_COLORS[services.length % SERVICE_COLORS.length],
      createdAt: new Date().toISOString(),
    };

    localStorage.setItem(REGISTRY_KEY, JSON.stringify([...services, service]));
    return service;
  }

  static rename(serviceId: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;

    const services = this.list().map(service =>
      service.id === serviceId ? { ...service, name: trimmed } : service);
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(services));
  }

  static setColor(serviceId: string, color: string): void {
    const services = this.list().map(service =>
      service.id === serviceId ? { ...service, color } : service);
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(services));
  }

  /** Elimina un servizio e tutti i suoi dati. L'ultimo servizio non è eliminabile. */
  static remove(serviceId: string): boolean {
    const services = this.list();
    if (services.length <= 1) return false;

    for (const scope of DATA_SCOPES) {
      localStorage.removeItem(this.scopedKey(scope, serviceId));
    }

    const remaining = services.filter(service => service.id !== serviceId);
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(remaining));

    if (this.getActiveId() === serviceId) {
      localStorage.setItem(ACTIVE_KEY, remaining[0].id);
    }

    return true;
  }

  /**
   * Crea un servizio copiando la configurazione di un altro (sale, medici,
   * fasce e schemi) ma non i calendari: le statistiche restano separate.
   */
  static duplicateConfiguration(sourceId: string, name: string): Service {
    const service = this.create(name);
    const copied: DataScope[] = [
      'rooms', 'doctors', 'shiftTypes', 'schemes', 'rotationRule', 'hoursTarget',
    ];

    for (const scope of copied) {
      const value = localStorage.getItem(this.scopedKey(scope, sourceId));
      if (value !== null) {
        localStorage.setItem(this.scopedKey(scope, service.id), value);
      }
    }

    return service;
  }

  /** Numero di calendari salvati in un servizio, per le schermate di riepilogo. */
  static countVersions(serviceId: string): number {
    const versions = readJSON<Record<string, unknown[]>>(
      this.scopedKey('versions', serviceId), {},
    );
    return Object.values(versions).reduce((total, list) => total + (list?.length ?? 0), 0);
  }

  /**
   * Garantisce l'esistenza di almeno un servizio. Al primo avvio dopo
   * l'aggiornamento i dati salvati senza servizio vengono ricondotti a un
   * servizio iniziale, così nessun calendario va perso.
   */
  private static ensureInitialized(): void {
    const services = readJSON<Service[]>(REGISTRY_KEY, []);
    if (services.length > 0) return;

    const hasLegacyData = Object.values(LEGACY_KEYS)
      .some(key => localStorage.getItem(key) !== null);

    const service: Service = {
      id: generateId(),
      name: hasLegacyData ? 'Servizio principale' : 'Servizio 1',
      color: SERVICE_COLORS[0],
      createdAt: new Date().toISOString(),
    };

    localStorage.setItem(REGISTRY_KEY, JSON.stringify([service]));
    localStorage.setItem(ACTIVE_KEY, service.id);

    if (!hasLegacyData) return;

    for (const scope of DATA_SCOPES) {
      const legacyValue = localStorage.getItem(LEGACY_KEYS[scope]);
      if (legacyValue === null) continue;
      localStorage.setItem(this.scopedKey(scope, service.id), legacyValue);
      localStorage.removeItem(LEGACY_KEYS[scope]);
    }
  }
}
