import { useState, useEffect, useCallback, useMemo } from 'react';
import { OperativeRoom, Doctor, MonthlySchedule } from './models/types';
import { StorageService } from './services/StorageService';
import { RoomManager } from './components/RoomManager';
import { DoctorManager } from './components/DoctorManager';
import { ScheduleGenerator } from './components/ScheduleGenerator';
import { MonthlyCalendar } from './components/MonthlyCalendar';
import { GeneralStats } from './components/GeneralStats';
import './App.css';

type Tab = 'rooms' | 'doctors' | 'generate' | 'calendar' | 'stats';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('rooms');
  const [rooms, setRooms] = useState<OperativeRoom[]>(() => StorageService.loadRooms());
  const [doctors, setDoctors] = useState<Doctor[]>(() => StorageService.loadDoctors());
  const [schedule, setSchedule] = useState<MonthlySchedule | null>(() => StorageService.loadSchedule());
  
  // Track the original saved version (before any edits)
  const [savedVersionId, setSavedVersionId] = useState<string | null>(null);
  const [originalSchedule, setOriginalSchedule] = useState<MonthlySchedule | null>(null);
  
  // Track if this is a brand new generated schedule (never saved)
  const [isNewDraft, setIsNewDraft] = useState<boolean>(false);

  // Preselected month/year for generation (passed from calendar)
  const [preselectedYear, setPreselectedYear] = useState<number | null>(null);
  const [preselectedMonth, setPreselectedMonth] = useState<number | null>(null);

  // Check if we have unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (isNewDraft) return true;
    if (!schedule || !originalSchedule) return false;
    // Compare assignments to detect changes
    return JSON.stringify(schedule.assignments) !== JSON.stringify(originalSchedule.assignments);
  }, [schedule, originalSchedule, isNewDraft]);

  const handleReset = () => {
    if (window.confirm('Sei sicuro di voler cancellare tutti i dati? Questa azione non può essere annullata.')) {
      StorageService.clearAll();
      setRooms([]);
      setDoctors([]);
      setSchedule(null);
      setOriginalSchedule(null);
      setSavedVersionId(null);
      setIsNewDraft(false);
      setActiveTab('rooms');
    }
  };

  useEffect(() => {
    StorageService.saveRooms(rooms);
  }, [rooms]);

  useEffect(() => {
    StorageService.saveDoctors(doctors);
  }, [doctors]);

  // NO AUTO-SAVE: We removed the automatic persistence of schedule changes
  // All saves must now be explicit through the version manager

  const handleScheduleGenerated = useCallback((newSchedule: MonthlySchedule) => {
    setSchedule(newSchedule);
    setOriginalSchedule(null); // No original since it's new
    setSavedVersionId(null);
    setIsNewDraft(true);
    setActiveTab('calendar');
  }, []);

  const handleLoadVersion = useCallback((versionSchedule: MonthlySchedule, versionId: string) => {
    setSchedule(versionSchedule);
    setOriginalSchedule(JSON.parse(JSON.stringify(versionSchedule))); // Deep copy
    setSavedVersionId(versionId);
    setIsNewDraft(false);
  }, []);

  const handleDiscardChanges = useCallback(() => {
    if (originalSchedule) {
      setSchedule(JSON.parse(JSON.stringify(originalSchedule))); // Restore from deep copy
    }
  }, [originalSchedule]);

  const handleSaveVersion = useCallback((name: string, createNew: boolean) => {
    if (!schedule) return;
    
    if (createNew || isNewDraft || !savedVersionId) {
      // Create a new version
      const newVersion = StorageService.saveScheduleVersion(schedule, name, true);
      setSavedVersionId(newVersion.id);
      setOriginalSchedule(JSON.parse(JSON.stringify(schedule)));
      setIsNewDraft(false);
    } else {
      // Update existing version
      StorageService.updateScheduleVersion(schedule.year, schedule.month, savedVersionId, schedule);
      StorageService.renameScheduleVersion(schedule.year, schedule.month, savedVersionId, name);
      setOriginalSchedule(JSON.parse(JSON.stringify(schedule)));
    }
    
    // Also update the main schedule storage
    StorageService.saveSchedule(schedule);
  }, [schedule, savedVersionId, isNewDraft]);

  const handleDuplicateVersion = useCallback((sourceVersionId: string, newName: string) => {
    if (!schedule) return;
    
    const versions = StorageService.loadScheduleVersionsForMonth(schedule.year, schedule.month);
    const sourceVersion = versions.find(v => v.id === sourceVersionId);
    if (!sourceVersion) return;
    
    // Create a new version with the same schedule
    const duplicatedVersion = StorageService.saveScheduleVersion(
      sourceVersion.schedule, 
      newName, 
      false // Don't set as active
    );
    
    return duplicatedVersion;
  }, [schedule]);

  const handleScheduleChange = useCallback((newSchedule: MonthlySchedule | null) => {
    if (newSchedule) {
      setSchedule(newSchedule);
    } else {
      setSchedule(null);
      setOriginalSchedule(null);
      setSavedVersionId(null);
      setIsNewDraft(false);
    }
  }, []);

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'rooms', label: 'Sale Operative', icon: '🏥' },
    { id: 'doctors', label: 'Dottori', icon: '👨‍⚕️' },
    { id: 'generate', label: 'Genera', icon: '⚡' },
    { id: 'calendar', label: 'Calendario', icon: '📅' },
    { id: 'stats', label: 'Statistiche', icon: '📊' },
  ];

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo">
          <span className="logo-icon">🏥</span>
          <div className="logo-text">
            <h1>Turni Ospedale</h1>
            <span className="subtitle">Generatore Automatico</span>
          </div>
        </div>
        <button className="btn-reset" onClick={handleReset} title="Cancella tutti i dati">
          🗑️ Reset
        </button>
      </header>

      <nav className="app-nav">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
            {tab.id === 'rooms' && rooms.length > 0 && (
              <span className="tab-badge">{rooms.length}</span>
            )}
            {tab.id === 'doctors' && doctors.length > 0 && (
              <span className="tab-badge">{doctors.length}</span>
            )}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {activeTab === 'rooms' && (
          <RoomManager rooms={rooms} onRoomsChange={setRooms} />
        )}
        {activeTab === 'doctors' && (
          <DoctorManager doctors={doctors} rooms={rooms} onDoctorsChange={setDoctors} />
        )}
        {activeTab === 'generate' && (
          <ScheduleGenerator
            rooms={rooms}
            doctors={doctors}
            onScheduleGenerated={handleScheduleGenerated}
            preselectedYear={preselectedYear}
            preselectedMonth={preselectedMonth}
          />
        )}
        {activeTab === 'calendar' && (
          <MonthlyCalendar 
            schedule={schedule} 
            rooms={rooms} 
            doctors={doctors} 
            onScheduleChange={handleScheduleChange}
            onNavigateToGenerate={(year, month) => {
              setPreselectedYear(year);
              setPreselectedMonth(month);
              setActiveTab('generate');
            }}
            hasUnsavedChanges={hasUnsavedChanges}
            isNewDraft={isNewDraft}
            savedVersionId={savedVersionId}
            onLoadVersion={handleLoadVersion}
            onSaveVersion={handleSaveVersion}
            onDiscardChanges={handleDiscardChanges}
            onDuplicateVersion={handleDuplicateVersion}
          />
        )}
        {activeTab === 'stats' && (
          <GeneralStats doctors={doctors} rooms={rooms} />
        )}
      </main>
    </div>
  );
}

export default App;
