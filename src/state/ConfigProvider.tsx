import { useCallback, useEffect, useMemo, useState, ReactNode } from 'react';
import { Doctor, OperativeRoom, ShiftScheme, ShiftType } from '../models/types';
import { ShiftTypeIndex } from '../domain/shiftTypes';
import { buildBuiltInSchemes } from '../domain/schemes';
import { StorageService } from '../services/StorageService';
import { ConfigContext, ConfigValue } from './configContext';

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [rooms, setRooms] = useState<OperativeRoom[]>(() => StorageService.loadRooms());
  const [doctors, setDoctors] = useState<Doctor[]>(() => StorageService.loadDoctors());
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>(() => StorageService.loadShiftTypes());
  const [customSchemes, setCustomSchemes] = useState<ShiftScheme[]>(
    () => StorageService.loadCustomSchemes(),
  );

  useEffect(() => { StorageService.saveRooms(rooms); }, [rooms]);
  useEffect(() => { StorageService.saveDoctors(doctors); }, [doctors]);
  useEffect(() => { StorageService.saveShiftTypes(shiftTypes); }, [shiftTypes]);
  useEffect(() => { StorageService.saveCustomSchemes(customSchemes); }, [customSchemes]);

  const shiftTypeIndex = useMemo(() => new ShiftTypeIndex(shiftTypes), [shiftTypes]);

  const schemes = useMemo(
    () => [...buildBuiltInSchemes(shiftTypes), ...customSchemes],
    [shiftTypes, customSchemes],
  );

  const reset = useCallback(() => {
    StorageService.clearAll();
    setRooms([]);
    setDoctors([]);
    setShiftTypes(StorageService.loadShiftTypes());
    setCustomSchemes([]);
  }, []);

  const value = useMemo<ConfigValue>(() => ({
    rooms,
    setRooms,
    doctors,
    setDoctors,
    shiftTypes,
    setShiftTypes,
    shiftTypeIndex,
    schemes,
    customSchemes,
    setCustomSchemes,
    reset,
  }), [rooms, doctors, shiftTypes, shiftTypeIndex, schemes, customSchemes, reset]);

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}
