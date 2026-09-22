import { useCallback, useEffect, useMemo, useState, ReactNode } from 'react';
import {
  Doctor,
  HoursTarget,
  OperativeRoom,
  RotationRule,
  ShiftScheme,
  ShiftType,
} from '../models/types';
import { DoctorRules, buildShiftLengthScale } from '../domain/preferences';
import { ShiftTypeIndex } from '../domain/shiftTypes';
import { buildBuiltInSchemes, isSchemeUsable } from '../domain/schemes';
import { StorageService } from '../services/StorageService';
import { ConfigContext, ConfigValue } from './configContext';

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [rooms, setRooms] = useState<OperativeRoom[]>(() => StorageService.loadRooms());
  const [doctors, setDoctors] = useState<Doctor[]>(() => StorageService.loadDoctors());
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>(() => StorageService.loadShiftTypes());
  const [customSchemes, setCustomSchemes] = useState<ShiftScheme[]>(
    () => StorageService.loadCustomSchemes(),
  );
  const [rotationRule, setRotationRule] = useState<RotationRule>(
    () => StorageService.loadRotationRule(),
  );
  const [hoursTarget, setHoursTarget] = useState<HoursTarget>(
    () => StorageService.loadHoursTarget(),
  );

  useEffect(() => { StorageService.saveRooms(rooms); }, [rooms]);
  useEffect(() => { StorageService.saveDoctors(doctors); }, [doctors]);
  useEffect(() => { StorageService.saveShiftTypes(shiftTypes); }, [shiftTypes]);
  useEffect(() => { StorageService.saveCustomSchemes(customSchemes); }, [customSchemes]);
  useEffect(() => { StorageService.saveRotationRule(rotationRule); }, [rotationRule]);
  useEffect(() => { StorageService.saveHoursTarget(hoursTarget); }, [hoursTarget]);

  const shiftTypeIndex = useMemo(() => new ShiftTypeIndex(shiftTypes), [shiftTypes]);

  const schemes = useMemo(
    () => [...buildBuiltInSchemes(shiftTypes), ...customSchemes],
    [shiftTypes, customSchemes],
  );

  const rotationScheme = useMemo(() => {
    const found = schemes.find(scheme => scheme.id === rotationRule.schemeId);
    if (!found || found.steps.length === 0) return null;
    return isSchemeUsable(found, shiftTypeIndex) ? found : null;
  }, [schemes, rotationRule.schemeId, shiftTypeIndex]);

  const doctorRules = useMemo(() => new DoctorRules(doctors), [doctors]);
  const lengthScale = useMemo(() => buildShiftLengthScale(shiftTypes), [shiftTypes]);

  const reset = useCallback(() => {
    StorageService.clearAll();
    setRooms([]);
    setDoctors([]);
    setShiftTypes(StorageService.loadShiftTypes());
    setCustomSchemes([]);
    setRotationRule(StorageService.loadRotationRule());
    setHoursTarget(StorageService.loadHoursTarget());
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
    rotationRule,
    setRotationRule,
    rotationScheme,
    hoursTarget,
    setHoursTarget,
    doctorRules,
    lengthScale,
    reset,
  }), [
    rooms, doctors, shiftTypes, shiftTypeIndex, schemes, customSchemes,
    rotationRule, rotationScheme, hoursTarget, doctorRules, lengthScale, reset,
  ]);

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}
