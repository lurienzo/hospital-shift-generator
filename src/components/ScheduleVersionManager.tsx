import { useState, useMemo, useCallback } from 'react';
import { MonthlySchedule, ScheduleVersion } from '../models/types';
import { StorageService } from '../services/StorageService';
import './ScheduleVersionManager.css';

interface ScheduleVersionManagerProps {
  schedule: MonthlySchedule;
  onVersionChange: (schedule: MonthlySchedule) => void;
  isDraft: boolean;
  draftSchedule: MonthlySchedule | null;
  onSwitchToDraft: () => void;
  onDraftSaved: () => void;
}

const monthNames = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

export function ScheduleVersionManager({ schedule, onVersionChange, isDraft, draftSchedule, onSwitchToDraft, onDraftSaved }: ScheduleVersionManagerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [newVersionName, setNewVersionName] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [refreshCounter, setRefreshCounter] = useState(0);

  const refreshVersions = useCallback(() => {
    setRefreshCounter(c => c + 1);
  }, []);

  const versions = useMemo(() => {
    return StorageService.loadScheduleVersionsForMonth(schedule.year, schedule.month);
  }, [schedule.year, schedule.month, refreshCounter]);

  const activeVersion = versions.find(v => v.isActive);

  const hasDraftForThisMonth = draftSchedule && 
    draftSchedule.year === schedule.year && 
    draftSchedule.month === schedule.month;

  const handleSaveNewVersion = () => {
    if (!newVersionName.trim()) return;
    
    const savedVersion = StorageService.saveScheduleVersion(schedule, newVersionName.trim(), true);
    setNewVersionName('');
    setShowSaveModal(false);
    refreshVersions();
    
    // If saving a draft, notify parent to clear draft state and switch to the saved version
    if (isDraft) {
      onDraftSaved();
      onVersionChange(savedVersion.schedule);
    }
  };

  const handleActivateVersion = (version: ScheduleVersion) => {
    StorageService.setActiveVersion(schedule.year, schedule.month, version.id);
    onVersionChange(version.schedule);
    refreshVersions();
  };

  const handleDeleteVersion = (versionId: string) => {
    if (!window.confirm('Sei sicuro di voler eliminare questa versione?')) return;
    
    StorageService.deleteScheduleVersion(schedule.year, schedule.month, versionId);
    
    // If we deleted the current schedule, load the new active one or switch to draft
    const newActive = StorageService.getActiveVersion(schedule.year, schedule.month);
    if (newActive) {
      onVersionChange(newActive.schedule);
    } else if (hasDraftForThisMonth) {
      onSwitchToDraft();
    }
    refreshVersions();
  };

  const handleStartRename = (version: ScheduleVersion) => {
    setEditingVersionId(version.id);
    setEditingName(version.name);
  };

  const handleSaveRename = () => {
    if (!editingVersionId || !editingName.trim()) return;
    
    StorageService.renameScheduleVersion(schedule.year, schedule.month, editingVersionId, editingName.trim());
    setEditingVersionId(null);
    setEditingName('');
    refreshVersions();
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const generateDefaultName = () => {
    const date = new Date();
    return `${monthNames[schedule.month - 1]} ${schedule.year} - ${date.toLocaleDateString('it-IT')}`;
  };

  return (
    <div className="version-manager">
      <div className="version-manager-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="version-info">
          <span className="version-icon">{isDraft ? '📝' : '📁'}</span>
          <span className="version-label">
            {isDraft ? (
              <>
                <strong className="draft-label">Bozza</strong>
                <span className="version-meta draft-meta">(non salvata)</span>
              </>
            ) : activeVersion ? (
              <>
                <strong>{activeVersion.name}</strong>
                <span className="version-meta">
                  ({versions.length} version{versions.length !== 1 ? 'i' : 'e'})
                </span>
              </>
            ) : (
              <span className="no-version">Nessuna versione salvata</span>
            )}
          </span>
        </div>
        <div className="version-actions">
          <button
            className={`btn-save-version ${isDraft ? 'highlight' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setNewVersionName(generateDefaultName());
              setShowSaveModal(true);
            }}
            title={isDraft ? "Salva questa bozza come versione" : "Salva come nuova versione"}
          >
            💾 {isDraft ? 'Salva Bozza' : 'Salva Versione'}
          </button>
          <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>▼</span>
        </div>
      </div>

      {isExpanded && (
        <div className="versions-list">
          {/* Draft option */}
          {hasDraftForThisMonth && (
            <div
              className={`version-item draft-item ${isDraft ? 'active' : ''}`}
              onClick={() => !isDraft && onSwitchToDraft()}
            >
              <div className="version-item-info">
                <span className="version-name">📝 Bozza</span>
                <span className="version-date draft-hint">Appena generata, non salvata</span>
              </div>
              <div className="version-item-actions">
                {isDraft ? (
                  <span className="active-badge draft-badge">✓ Attuale</span>
                ) : (
                  <button
                    className="btn-activate"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSwitchToDraft();
                    }}
                    title="Visualizza bozza"
                  >
                    Visualizza
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Saved versions */}
          {versions.map(version => (
            <div
              key={version.id}
              className={`version-item ${!isDraft && version.isActive ? 'active' : ''}`}
            >
              <div className="version-item-info">
                {editingVersionId === version.id ? (
                  <input
                    type="text"
                    className="version-name-input"
                    value={editingName}
                    onChange={e => setEditingName(e.target.value)}
                    onBlur={handleSaveRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSaveRename();
                      if (e.key === 'Escape') setEditingVersionId(null);
                    }}
                    autoFocus
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <span className="version-name">{version.name}</span>
                    <span className="version-date">{formatDate(version.createdAt)}</span>
                  </>
                )}
              </div>
              <div className="version-item-actions">
                {!isDraft && version.isActive ? (
                  <span className="active-badge">✓ Attiva</span>
                ) : (
                  <button
                    className="btn-activate"
                    onClick={() => handleActivateVersion(version)}
                    title="Imposta come attiva"
                  >
                    Attiva
                  </button>
                )}
                <button
                  className="btn-rename"
                  onClick={() => handleStartRename(version)}
                  title="Rinomina"
                >
                  ✏️
                </button>
                <button
                  className="btn-delete-version"
                  onClick={() => handleDeleteVersion(version.id)}
                  title="Elimina"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}

          {versions.length === 0 && !hasDraftForThisMonth && (
            <div className="no-versions-message">
              Nessuna versione salvata per questo mese
            </div>
          )}
        </div>
      )}

      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal-content save-version-modal" onClick={e => e.stopPropagation()}>
            <h3>💾 {isDraft ? 'Salva Bozza' : 'Salva Versione'}</h3>
            <p>
              {isDraft 
                ? `Salva questa bozza come versione del calendario di ${monthNames[schedule.month - 1]} ${schedule.year}`
                : `Dai un nome a questa versione del calendario di ${monthNames[schedule.month - 1]} ${schedule.year}`
              }
            </p>
            <input
              type="text"
              className="version-name-input-large"
              value={newVersionName}
              onChange={e => setNewVersionName(e.target.value)}
              placeholder="Es. Versione definitiva, Bozza 1, ecc."
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveNewVersion();
                if (e.key === 'Escape') setShowSaveModal(false);
              }}
            />
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowSaveModal(false)}>
                Annulla
              </button>
              <button
                className="btn-confirm"
                onClick={handleSaveNewVersion}
                disabled={!newVersionName.trim()}
              >
                Salva
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
