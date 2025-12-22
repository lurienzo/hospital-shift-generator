import { useState, useEffect, useCallback } from 'react';
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
  const [isDraft, setIsDraft] = useState<boolean>(false);
  const [draftSchedule, setDraftSchedule] = useState<MonthlySchedule | null>(null);

  const handleReset = () => {
    if (window.confirm('Sei sicuro di voler cancellare tutti i dati? Questa azione non può essere annullata.')) {
      StorageService.clearAll();
      setRooms([]);
      setDoctors([]);
      setSchedule(null);
      setDraftSchedule(null);
      setIsDraft(false);
      setActiveTab('rooms');
    }
  };

  useEffect(() => {
    StorageService.saveRooms(rooms);
  }, [rooms]);

  useEffect(() => {
    StorageService.saveDoctors(doctors);
  }, [doctors]);

  // Only update saved versions when viewing a saved version (not draft)
  useEffect(() => {
    if (schedule && !isDraft) {
      StorageService.saveSchedule(schedule);
      const activeVersion = StorageService.getActiveVersion(schedule.year, schedule.month);
      if (activeVersion) {
        StorageService.updateScheduleVersion(schedule.year, schedule.month, activeVersion.id, schedule);
      }
    }
  }, [schedule, isDraft]);

  const handleScheduleGenerated = useCallback((newSchedule: MonthlySchedule) => {
    setDraftSchedule(newSchedule);
    setSchedule(newSchedule);
    setIsDraft(true);
    setActiveTab('calendar');
  }, []);

  const handleSwitchToVersion = useCallback((versionSchedule: MonthlySchedule) => {
    setSchedule(versionSchedule);
    setIsDraft(false);
  }, []);

  const handleSwitchToDraft = useCallback(() => {
    if (draftSchedule) {
      setSchedule(draftSchedule);
      setIsDraft(true);
    }
  }, [draftSchedule]);

  const handleDraftSaved = useCallback(() => {
    // After saving draft as a version, clear the draft state
    setDraftSchedule(null);
    setIsDraft(false);
  }, []);

  const handleScheduleChange = useCallback((newSchedule: MonthlySchedule | null) => {
    if (newSchedule) {
      setSchedule(newSchedule);
      if (isDraft && draftSchedule) {
        setDraftSchedule(newSchedule);
      }
    } else {
      setSchedule(null);
    }
  }, [isDraft, draftSchedule]);

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
          />
        )}
        {activeTab === 'calendar' && (
          <MonthlyCalendar 
            schedule={schedule} 
            rooms={rooms} 
            doctors={doctors} 
            onScheduleChange={handleScheduleChange}
            onNavigateToGenerate={() => setActiveTab('generate')}
            isDraft={isDraft}
            draftSchedule={draftSchedule}
            onSwitchToVersion={handleSwitchToVersion}
            onSwitchToDraft={handleSwitchToDraft}
            onDraftSaved={handleDraftSaved}
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
