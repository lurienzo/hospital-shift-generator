import { createContext, useContext } from 'react';
import { Service } from '../services/ServiceRegistry';

export interface ServiceValue {
  services: Service[];
  activeId: string;
  active: Service | undefined;
  switchTo: (serviceId: string) => void;
  create: (name: string, options?: { copyFromId?: string; activate?: boolean }) => Service;
  rename: (serviceId: string, name: string) => void;
  setColor: (serviceId: string, color: string) => void;
  remove: (serviceId: string) => boolean;
  countVersions: (serviceId: string) => number;
}

export const ServiceContext = createContext<ServiceValue | null>(null);

export function useServices(): ServiceValue {
  const value = useContext(ServiceContext);
  if (!value) throw new Error('useServices richiede ServiceProvider');
  return value;
}
