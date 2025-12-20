import { useState, useEffect } from 'react';
import { OperativeRoom, Doctor, MonthlySchedule } from './models/types';
import { StorageService } from './services/StorageService';
import { RoomManager } from './components/RoomManager';
import { DoctorManager } from './components/DoctorManager';
import { ScheduleGenerator } from './components/ScheduleGenerator';
import { MonthlyCalendar } from './components/MonthlyCalendar';
import './App.css';

type Tab = 'rooms' | 'doctors' | 'generate' | 'calendar';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('rooms');
  const [rooms, setRooms] = useState<OperativeRoom[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [schedule, setSchedule] = useState<MonthlySchedule | null>(null);

  useEffect(() => {
    setRooms(StorageService.loadRooms());
    setDoctors(StorageService.loadDoctors());
    setSchedule(StorageService.loadSchedule());
  }, []);

  useEffect(() => {
    StorageService.saveRooms(rooms);
  }, [rooms]);

  useEffect(() => {
    StorageService.saveDoctors(doctors);
  }, [doctors]);

  useEffect(() => {
    if (schedule) {
      StorageService.saveSchedule(schedule);
    }
  }, [schedule]);

  const handleScheduleGenerated = (newSchedule: MonthlySchedule) => {
    setSchedule(newSchedule);
    setActiveTab('calendar');
  };

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'rooms', label: 'Sale Operative', icon: '🏥' },
    { id: 'doctors', label: 'Dottori', icon: '👨‍⚕️' },
    { id: 'generate', label: 'Genera', icon: '⚡' },
    { id: 'calendar', label: 'Calendario', icon: '📅' },
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
        {activeTab === 'calendar' && schedule && (
          <MonthlyCalendar schedule={schedule} rooms={rooms} doctors={doctors} onScheduleChange={setSchedule} />
        )}
        {activeTab === 'calendar' && !schedule && (
          <div className="empty-calendar">
            <div className="empty-icon">📅</div>
            <h2>Nessun calendario generato</h2>
            <p>Vai alla sezione "Genera" per creare un nuovo calendario turni.</p>
            <button onClick={() => setActiveTab('generate')}>
              Genera Calendario
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;

