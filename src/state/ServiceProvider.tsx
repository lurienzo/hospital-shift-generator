import { useCallback, useMemo, useState, ReactNode } from 'react';
import { Service, ServiceRegistry } from '../services/ServiceRegistry';
import { ServiceContext, ServiceValue } from './serviceContext';

/**
 * Servizio attivo e anagrafica dei servizi. Il resto dell'applicazione viene
 * rimontato quando il servizio cambia, così nessuno stato di un servizio
 * sopravvive al passaggio a un altro.
 */
export function ServiceProvider({ children }: { children: ReactNode }) {
  const [services, setServices] = useState<Service[]>(() => ServiceRegistry.list());
  const [activeId, setActiveId] = useState<string>(() => ServiceRegistry.getActiveId());

  const refresh = useCallback(() => {
    setServices(ServiceRegistry.list());
    setActiveId(ServiceRegistry.getActiveId());
  }, []);

  const switchTo = useCallback((serviceId: string) => {
    if (serviceId === ServiceRegistry.getActiveId()) return;
    ServiceRegistry.setActive(serviceId);
    refresh();
  }, [refresh]);

  const create = useCallback((
    name: string,
    options: { copyFromId?: string; activate?: boolean } = {},
  ) => {
    const service = options.copyFromId
      ? ServiceRegistry.duplicateConfiguration(options.copyFromId, name)
      : ServiceRegistry.create(name);

    if (options.activate !== false) ServiceRegistry.setActive(service.id);
    refresh();
    return service;
  }, [refresh]);

  const rename = useCallback((serviceId: string, name: string) => {
    ServiceRegistry.rename(serviceId, name);
    refresh();
  }, [refresh]);

  const setColor = useCallback((serviceId: string, color: string) => {
    ServiceRegistry.setColor(serviceId, color);
    refresh();
  }, [refresh]);

  const remove = useCallback((serviceId: string) => {
    const removed = ServiceRegistry.remove(serviceId);
    if (removed) refresh();
    return removed;
  }, [refresh]);

  const countVersions = useCallback(
    (serviceId: string) => ServiceRegistry.countVersions(serviceId),
    [],
  );

  const value = useMemo<ServiceValue>(() => ({
    services,
    activeId,
    active: services.find(service => service.id === activeId),
    switchTo,
    create,
    rename,
    setColor,
    remove,
    countVersions,
  }), [services, activeId, switchTo, create, rename, setColor, remove, countVersions]);

  return <ServiceContext.Provider value={value}>{children}</ServiceContext.Provider>;
}
