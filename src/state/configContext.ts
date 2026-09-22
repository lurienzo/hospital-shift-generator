import { createContext, useContext } from 'react';
import {
  Doctor,
  HoursTarget,
  OperativeRoom,
  RotationRule,
  ShiftScheme,
  ShiftType,
} from '../models/types';
import { DoctorRules, ShiftLengthScale } from '../domain/preferences';
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
  /** Schema che i medici del servizio cercano di seguire. */
  rotationRule: RotationRule;
  setRotationRule: (rule: RotationRule) => void;
  /** Schema della regola, se esiste ed è utilizzabile. */
  rotationScheme: ShiftScheme | null;
  /** Ore minime e massime per medico nel periodo impostato. */
  hoursTarget: HoursTarget;
  setHoursTarget: (target: HoursTarget) => void;
  /** Divieti e preferenze dei medici su giorni e fasce. */
  doctorRules: DoctorRules;
  /** Soglia fra turni lunghi e brevi, ricavata dalle fasce configurate. */
  lengthScale: ShiftLengthScale;
  reset: () => void;
}

export const ConfigContext = createContext<ConfigValue | null>(null);

export function useConfig(): ConfigValue {
  const value = useContext(ConfigContext);
  if (!value) throw new Error('useConfig richiede ConfigProvider');
  return value;
}
