import { createContext, useContext } from 'react';
import { Doctor, OperativeRoom, ShiftScheme, ShiftType } from '../models/types';
import { ShiftTypeIndex } from '../domain/shiftTypes';

/**
 * Configurazione del servizio attivo: sale, medici, fasce orarie e schemi
 * turni. Sono dati letti da quasi tutte le schermate, con un ciclo di vita
 * diverso dal calendario in lavorazione.
 */
export interface ConfigValue {
  rooms: OperativeRoom[];
  setRooms: (rooms: OperativeRoom[]) => void;
  doctors: Doctor[];
  setDoctors: (doctors: Doctor[]) => void;
  shiftTypes: ShiftType[];
  setShiftTypes: (shiftTypes: ShiftType[]) => void;
  /** Indice pronto per le ricerche per id, ordinato cronologicamente. */
  shiftTypeIndex: ShiftTypeIndex;
  /** Schemi predefiniti più quelli creati dall'utente. */
  schemes: ShiftScheme[];
  customSchemes: ShiftScheme[];
  setCustomSchemes: (schemes: ShiftScheme[]) => void;
  reset: () => void;
}

export const ConfigContext = createContext<ConfigValue | null>(null);

export function useConfig(): ConfigValue {
  const value = useContext(ConfigContext);
  if (!value) throw new Error('useConfig richiede ConfigProvider');
  return value;
}
