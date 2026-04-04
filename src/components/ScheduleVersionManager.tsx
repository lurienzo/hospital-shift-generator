import { useState, useMemo, useCallback } from 'react';
import { MonthlySchedule, ScheduleVersion } from '../models/types';
import { StorageService } from '../services/StorageService';
import { MONTH_NAMES_FULL } from '../utils/constants';
import './ScheduleVersionManager.css';

interface ScheduleVersionManagerProps {
  schedule: MonthlySchedule;
  hasUnsavedChanges: boolean;
  isNewDraft: boolean;
  savedVersionId: string | null;
  onLoadVersion: (schedule: MonthlySchedule, versionId: string) => void;
  onSaveVersion: (name: string, createNew: boolean) => void;
  onDiscardChanges: () => void;
  onDuplicateVersion: (sourceVersionId: string, newName: string) => void;
}

const monthNames = MONTH_NAMES_FULL;

type SaveMode = 'save' | 'save-as' | 'duplicate';

export function ScheduleVersionManager({ 
  schedule, 
  hasUnsavedChanges,
  isNewDraft,
  savedVersionId,
  onLoadVersion,
  onSaveVersion,
  onDiscardChanges,
  onDuplicateVersion
}: ScheduleVersionManagerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [newVersionName, setNewVersionName] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveMode, setSaveMode] = useState<SaveMode>('save');
  const [duplicateSourceId, setDuplicateSourceId] = useState<string | null>(null);
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
  const currentVersion = savedVersionId ? versions.find(v => v.id === savedVersionId) : null;

  const handleSave = () => {
    if (!newVersionName.trim()) return;
    
    if (saveMode === 'duplicate' && duplicateSourceId) {
      onDuplicateVersion(duplicateSourceId, newVersionName.trim());
    } else {
      onSaveVersion(newVersionName.trim(), saveMode === 'save-as' || isNewDraft);
    }
    
    setNewVersionName('');
    setShowSaveModal(false);
    setDuplicateSourceId(null);
    refreshVersions();
  };

  const handleQuickSave = () => {
    if (isNewDraft || !currentVersion) {
      // Must save as new - open modal
      openSaveModal('save');
    } else {
      // Quick save to current version
      onSaveVersion(currentVersion.name, false);
      refreshVersions();
    }
  };

  const openSaveModal = (mode: SaveMode, sourceId?: string) => {
    setSaveMode(mode);
    setDuplicateSourceId(sourceId || null);
    
    if (mode === 'duplicate' && sourceId) {
      const sourceVersion = versions.find(v => v.id === sourceId);
      setNewVersionName(sourceVersion ? `${sourceVersion.name} (copia)` : generateDefaultName());
    } else if (mode === 'save' && currentVersion && !isNewDraft) {
      setNewVersionName(currentVersion.name);
    } else {
      setNewVersionName(generateDefaultName());
    }
    
    setShowSaveModal(true);
  };

  const handleLoadVersion = (version: ScheduleVersion) => {
    if (hasUnsavedChanges) {
      if (!window.confirm('Hai modifiche non salvate. Vuoi davvero cambiare versione?')) {
        return;
      }
    }
    
    // Just load the version for viewing, don't change active status
    onLoadVersion(version.schedule, version.id);
    refreshVersions();
  };

  const handleSetActiveForStats = (version: ScheduleVersion) => {
    StorageService.setActiveVersion(schedule.year, schedule.month, version.id);
    refreshVersions();
  };

  const handleDeleteVersion = (versionId: string) => {
    if (!window.confirm('Sei sicuro di voler eliminare questa versione?')) return;
    
    StorageService.deleteScheduleVersion(schedule.year, schedule.month, versionId);
    
    // If we deleted the current version, load another one
    if (savedVersionId === versionId) {
      const newActive = StorageService.getActiveVersion(schedule.year, schedule.month);
      if (newActive) {
        onLoadVersion(newActive.schedule, newActive.id);
      }
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

  const getSaveModalTitle = () => {
    switch (saveMode) {
      case 'save': return isNewDraft ? '💾 Salva Nuova Versione' : '💾 Salva Versione';
      case 'save-as': return '📄 Salva Come...';
      case 'duplicate': return '📋 Duplica Versione';
    }
  };

  const getSaveModalDescription = () => {
    const monthYear = `${monthNames[schedule.month - 1]} ${schedule.year}`;
    switch (saveMode) {
      case 'save': return isNewDraft 
        ? `Salva questa bozza come nuova versione del calendario di ${monthYear}` 
        : `Aggiorna la versione corrente del calendario di ${monthYear}`;
      case 'save-as': return `Salva le modifiche come nuova versione del calendario di ${monthYear}`;
      case 'duplicate': return `Crea una copia della versione selezionata`;
    }
  };

  return (
    <div className="version-manager">
      <div className="version-manager-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="version-info">
          <span className="version-icon">{hasUnsavedChanges ? '📝' : '📁'}</span>
          <span className="version-label">
            {isNewDraft ? (
              <>
                <strong className="draft-label">Nuova Bozza</strong>
                <span className="version-meta draft-meta">(non salvata)</span>
              </>
            ) : currentVersion ? (
              <>
                <strong>{currentVersion.name}</strong>
                {currentVersion.isActive && (
                  <span className="header-badge-active" title="Versione attiva per statistiche">⭐</span>
                )}
                {hasUnsavedChanges && (
                  <span className="version-meta draft-meta">• modificato</span>
                )}
                <span className="version-meta">
                  ({versions.length} version{versions.length !== 1 ? 'i' : 'e'})
                </span>
              </>
            ) : activeVersion ? (
              <>
                <strong>{activeVersion.name}</strong>
                <span className="header-badge-active" title="Versione attiva per statistiche">⭐</span>
                <span className="version-meta">
                  ({versions.length} version{versions.length !== 1 ? 'i' : 'e'})
                </span>
              </>
            ) : (
              <span className="no-version">Nessuna versione salvata</span>
            )}
          </span>
        </div>
        <div className="version-actions-header">
          {hasUnsavedChanges && !isNewDraft && (
            <button
              className="btn-discard"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm('Annullare tutte le modifiche non salvate?')) {
                  onDiscardChanges();
                }
              }}
              title="Annulla modifiche"
            >
              ↩️ Annulla
            </button>
          )}
          <button
            className={`btn-save-version ${hasUnsavedChanges ? 'highlight' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              handleQuickSave();
            }}
            disabled={!hasUnsavedChanges && !isNewDraft}
            title={hasUnsavedChanges ? "Salva le modifiche" : "Nessuna modifica da salvare"}
          >
            💾 Salva
          </button>
          <button
            className="btn-save-as"
            onClick={(e) => {
              e.stopPropagation();
              openSaveModal('save-as');
            }}
            title="Salva come nuova versione"
          >
            📄 Salva come...
          </button>
          <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>▼</span>
        </div>
      </div>

      {isExpanded && (
        <div className="versions-list">
          {/* Saved versions */}
          {versions.map(version => {
            const isCurrentlyViewing = savedVersionId === version.id;
            const isActiveForStats = version.isActive;
            return (
              <div
                key={version.id}
                className={`version-item ${isCurrentlyViewing ? 'viewing' : ''} ${isActiveForStats ? 'active-stats' : ''}`}
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
                  <button
                    className={`btn-load ${isCurrentlyViewing ? 'is-active' : ''}`}
                    onClick={() => !isCurrentlyViewing && handleLoadVersion(version)}
                    disabled={isCurrentlyViewing}
                    title={isCurrentlyViewing ? "Stai visualizzando questa versione" : "Visualizza questa versione"}
                  >
                    👁️ {isCurrentlyViewing ? 'Visualizzato' : 'Visualizza'}
                  </button>
                  <button
                    className={`btn-set-active ${isActiveForStats ? 'is-active' : ''}`}
                    onClick={() => !isActiveForStats && handleSetActiveForStats(version)}
                    disabled={isActiveForStats}
                    title={isActiveForStats ? "Questa è la versione attiva per le statistiche" : "Usa per le statistiche generali"}
                  >
                    ⭐ {isActiveForStats ? 'Attivo' : 'Attiva'}
                  </button>
                  <button
                    className="btn-duplicate"
                    onClick={(e) => {
                      e.stopPropagation();
                      openSaveModal('duplicate', version.id);
                    }}
                    title="Duplica versione"
                  >
                    📋
                  </button>
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
            );
          })}

          {versions.length === 0 && (
            <div className="no-versions-message">
              Nessuna versione salvata per questo mese
            </div>
          )}
        </div>
      )}

      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal-content save-version-modal" onClick={e => e.stopPropagation()}>
            <h3>{getSaveModalTitle()}</h3>
            <p>{getSaveModalDescription()}</p>
            <input
              type="text"
              className="version-name-input-large"
              value={newVersionName}
              onChange={e => setNewVersionName(e.target.value)}
              placeholder="Es. Versione definitiva, Bozza 1, ecc."
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') setShowSaveModal(false);
              }}
            />
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowSaveModal(false)}>
                Annulla
              </button>
              <button
                className="btn-confirm"
                onClick={handleSave}
                disabled={!newVersionName.trim()}
              >
                {saveMode === 'duplicate' ? 'Duplica' : 'Salva'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
