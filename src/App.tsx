import { useCallback, useState } from 'react';
import { MonthlySchedule } from './models/types';
import { StorageService } from './services/StorageService';
import { useConfig } from './state/configContext';
import { RoomManager } from './components/RoomManager';
import { DoctorManager } from './components/DoctorManager';
import { ScheduleGenerator } from './components/ScheduleGenerator';
import { MonthlyCalendar } from './components/MonthlyCalendar';
import { GeneralStats } from './components/GeneralStats';
import { Settings } from './components/Settings';
import { ServiceSwitcher } from './components/ServiceSwitcher';
import './App.css';

type Tab = 'rooms' | 'doctors' | 'generate' | 'calendar' | 'stats' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'rooms', label: 'Sale operative' },
  { id: 'doctors', label: 'Dottori' },
  { id: 'generate', label: 'Genera' },
  { id: 'calendar', label: 'Calendario' },
  { id: 'stats', label: 'Statistiche' },
  { id: 'settings', label: 'Impostazioni' },
];

/**
 * Impronta insensibile all'ordine delle assegnazioni: serve a capire se il
 * calendario in lavorazione differisce da quello salvato. Un confronto su
 * JSON grezzo segnalerebbe modifiche anche solo riordinando la lista.
 */
function fingerprint(schedule: MonthlySchedule | null): string {
  if (!schedule) return '';
  return schedule.assignments
    .map(a => `${a.date}|${a.roomId}|${a.shiftTypeId}|${a.doctorId}|${a.locked ? 1 : 0}`)
    .sort()
    .join(';');
}

function loadInitialSchedule(): { schedule: MonthlySchedule | null; versionId: string | null } {
  const schedule = StorageService.loadSchedule();
  if (!schedule) return { schedule: null, versionId: null };

  const active = StorageService.getActiveVersion(schedule.year, schedule.month);
  return active
    ? { schedule: active.schedule, versionId: active.id }
    : { schedule, versionId: null };
}

function App() {
  const { rooms, doctors, reset } = useConfig();
  const [activeTab, setActiveTab] = useState<Tab>('calendar');

  // All'avvio si riprende il calendario salvato e, se esiste, la versione
  // attiva del suo mese: così le modifiche non salvate sono riconoscibili
  // anche dopo un ricaricamento della pagina. L'inizializzatore pigro di
  // useState garantisce che la lettura avvenga una volta sola per montaggio.
  const [initial] = useState(loadInitialSchedule);

  const [schedule, setSchedule] = useState<MonthlySchedule | null>(initial.schedule);
  const [savedVersionId, setSavedVersionId] = useState<string | null>(initial.versionId);
  const [savedFingerprint, setSavedFingerprint] = useState<string>(() => fingerprint(initial.schedule));
  const [isNewDraft, setIsNewDraft] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState<MonthlySchedule | null>(initial.schedule);

  const [preselected, setPreselected] = useState<{ year: number; month: number } | null>(null);
  const [versionsRevision, setVersionsRevision] = useState(0);

  const hasUnsavedChanges = isNewDraft || (
    schedule !== null && savedSnapshot !== null && fingerprint(schedule) !== savedFingerprint
  );

  const notifyVersionsChanged = useCallback(() => setVersionsRevision(value => value + 1), []);

  const handleScheduleGenerated = useCallback((generated: MonthlySchedule) => {
    setSchedule(generated);
    setSavedSnapshot(null);
    setSavedFingerprint('');
    setSavedVersionId(null);
    setIsNewDraft(true);
    setActiveTab('calendar');
  }, []);

  const handleLoadVersion = useCallback((loaded: MonthlySchedule, versionId: string) => {
    setSchedule(loaded);
    setSavedSnapshot(loaded);
    setSavedFingerprint(fingerprint(loaded));
    setSavedVersionId(versionId);
    setIsNewDraft(false);
  }, []);

  const handleScheduleChange = useCallback((next: MonthlySchedule | null) => {
    setSchedule(next);
    if (next === null) {
      setSavedSnapshot(null);
      setSavedFingerprint('');
      setSavedVersionId(null);
      setIsNewDraft(false);
    }
  }, []);

  const handleDiscardChanges = useCallback(() => {
    if (savedSnapshot) setSchedule(savedSnapshot);
  }, [savedSnapshot]);

  const handleSaveVersion = useCallback((name: string, createNew: boolean) => {
    if (!schedule) return;

    if (createNew || isNewDraft || !savedVersionId) {
      const version = StorageService.createVersion(schedule, name, true);
      setSavedVersionId(version.id);
    } else {
      StorageService.updateVersion(schedule.year, schedule.month, savedVersionId, { schedule, name });
      StorageService.saveSchedule(schedule);
    }

    setSavedSnapshot(schedule);
    setSavedFingerprint(fingerprint(schedule));
    setIsNewDraft(false);
    notifyVersionsChanged();
  }, [schedule, savedVersionId, isNewDraft, notifyVersionsChanged]);

  const handleDuplicateVersion = useCallback((sourceVersionId: string, newName: string) => {
    if (!schedule) return;
    const source = StorageService.loadVersionsForMonth(schedule.year, schedule.month)
      .find(version => version.id === sourceVersionId);
    if (!source) return;

    StorageService.createVersion(source.schedule, newName, false);
    notifyVersionsChanged();
  }, [schedule, notifyVersionsChanged]);

  const handleReset = () => {
    const confirmed = window.confirm(
      'Cancellare tutti i dati di questo servizio (sale, dottori, fasce orarie, schemi e '
      + 'calendari)?\nGli altri servizi non vengono toccati e l’operazione non può essere annullata.',
    );
    if (!confirmed) return;

    reset();
    setSchedule(null);
    setSavedSnapshot(null);
    setSavedFingerprint('');
    setSavedVersionId(null);
    setIsNewDraft(false);
    setPreselected(null);
    notifyVersionsChanged();
    setActiveTab('rooms');
  };

  const counts: Partial<Record<Tab, number>> = {
    rooms: rooms.length,
    doctors: doctors.length,
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-brand">
          <h1>Turni ospedale</h1>
          <span className="subtitle">Pianificazione e generazione dei turni</span>
        </div>

        <div className="row">
          <ServiceSwitcher
            hasUnsavedChanges={hasUnsavedChanges}
            onManage={() => setActiveTab('settings')}
          />
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={handleReset}
            title="Cancella i dati del servizio attivo"
          >
            Azzera servizio
          </button>
        </div>
      </header>

      <nav className="app-nav" aria-label="Sezioni">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
            aria-current={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {counts[tab.id] ? <span className="badge">{counts[tab.id]}</span> : null}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {activeTab === 'rooms' && <RoomManager />}

        {activeTab === 'doctors' && <DoctorManager />}

        {activeTab === 'generate' && (
          <ScheduleGenerator
            onScheduleGenerated={handleScheduleGenerated}
            preselected={preselected}
          />
        )}

        {activeTab === 'calendar' && (
          <MonthlyCalendar
            schedule={schedule}
            onScheduleChange={handleScheduleChange}
            onNavigateToGenerate={(year, month) => {
              setPreselected({ year, month });
              setActiveTab('generate');
            }}
            hasUnsavedChanges={hasUnsavedChanges}
            isNewDraft={isNewDraft}
            savedVersionId={savedVersionId}
            versionsRevision={versionsRevision}
            onLoadVersion={handleLoadVersion}
            onSaveVersion={handleSaveVersion}
            onDiscardChanges={handleDiscardChanges}
            onDuplicateVersion={handleDuplicateVersion}
            onVersionsChanged={notifyVersionsChanged}
          />
        )}

        {activeTab === 'stats' && <GeneralStats revision={versionsRevision} />}

        {activeTab === 'settings' && <Settings hasUnsavedChanges={hasUnsavedChanges} />}
      </main>
    </div>
  );
}

export default App;
