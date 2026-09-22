import { useMemo, useState } from 'react';
import { MonthlySchedule, ScheduleVersion } from '../models/types';
import { StorageService } from '../services/StorageService';
import { Modal } from './ui/Modal';
import { formatDateTime, formatMonthLabel } from '../utils/date';
import './ScheduleVersionManager.css';

interface ScheduleVersionManagerProps {
  schedule: MonthlySchedule;
  hasUnsavedChanges: boolean;
  isNewDraft: boolean;
  savedVersionId: string | null;
  /** Cambia quando le versioni su disco sono state modificate. */
  revision: number;
  onLoadVersion: (schedule: MonthlySchedule, versionId: string) => void;
  onSaveVersion: (name: string, createNew: boolean) => void;
  onDiscardChanges: () => void;
  onDuplicateVersion: (sourceVersionId: string, newName: string) => void;
  onVersionsChanged: () => void;
}

type SaveMode = 'update' | 'new' | 'duplicate';

export function ScheduleVersionManager({
  schedule,
  hasUnsavedChanges,
  isNewDraft,
  savedVersionId,
  revision,
  onLoadVersion,
  onSaveVersion,
  onDiscardChanges,
  onDuplicateVersion,
  onVersionsChanged,
}: ScheduleVersionManagerProps) {
  const [expanded, setExpanded] = useState(false);
  const [dialog, setDialog] = useState<{ mode: SaveMode; sourceId?: string; name: string } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const versions = useMemo(
    () => StorageService.loadVersionsForMonth(schedule.year, schedule.month),
    // `revision` non compare nel calcolo ma ne invalida il risultato: i dati
    // vivono in localStorage, che React non osserva.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schedule.year, schedule.month, revision],
  );

  const current = savedVersionId
    ? versions.find(version => version.id === savedVersionId)
    : undefined;
  const active = versions.find(version => version.isActive);

  const defaultName = () => {
    const stamp = new Date().toLocaleDateString('it-IT');
    return `${formatMonthLabel(schedule.year, schedule.month)} — ${stamp}`;
  };

  const openDialog = (mode: SaveMode, sourceId?: string) => {
    if (mode === 'duplicate' && sourceId) {
      const source = versions.find(version => version.id === sourceId);
      setDialog({ mode, sourceId, name: source ? `${source.name} (copia)` : defaultName() });
      return;
    }
    setDialog({
      mode,
      name: mode === 'update' && current ? current.name : defaultName(),
    });
  };

  const confirmDialog = () => {
    if (!dialog) return;
    const name = dialog.name.trim();
    if (!name) return;

    if (dialog.mode === 'duplicate' && dialog.sourceId) {
      onDuplicateVersion(dialog.sourceId, name);
    } else {
      onSaveVersion(name, dialog.mode === 'new');
    }
    setDialog(null);
  };

  const quickSave = () => {
    if (isNewDraft || !current) {
      openDialog('new');
      return;
    }
    onSaveVersion(current.name, false);
  };

  const loadVersion = (version: ScheduleVersion) => {
    if (hasUnsavedChanges
      && !window.confirm('Ci sono modifiche non salvate. Cambiare versione e perderle?')) {
      return;
    }
    onLoadVersion(version.schedule, version.id);
  };

  const setActiveForStats = (version: ScheduleVersion) => {
    StorageService.setActiveVersion(schedule.year, schedule.month, version.id);
    onVersionsChanged();
  };

  const deleteVersion = (version: ScheduleVersion) => {
    if (!window.confirm(`Eliminare la versione "${version.name}"?`)) return;

    StorageService.deleteVersion(schedule.year, schedule.month, version.id);

    if (savedVersionId === version.id) {
      const fallback = StorageService.getActiveVersion(schedule.year, schedule.month);
      if (fallback) onLoadVersion(fallback.schedule, fallback.id);
    }
    onVersionsChanged();
  };

  const rename = (version: ScheduleVersion, name: string) => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== version.name) {
      StorageService.updateVersion(schedule.year, schedule.month, version.id, { name: trimmed });
      onVersionsChanged();
    }
    setRenamingId(null);
  };

  return (
    <section className="version-manager">
      <div className="version-bar">
        <button
          type="button"
          className="version-summary"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <span className="version-caret">{expanded ? '▴' : '▾'}</span>
          {isNewDraft ? (
            <>
              <strong>Bozza non salvata</strong>
              <span className="hint">generata ora</span>
            </>
          ) : current ? (
            <>
              <strong>{current.name}</strong>
              {current.isActive && (
                <span className="badge badge-accent" title="Versione usata nelle statistiche generali">
                  attiva
                </span>
              )}
              {hasUnsavedChanges && <span className="badge badge-warning">modificata</span>}
            </>
          ) : active ? (
            <>
              <strong>{active.name}</strong>
              <span className="badge badge-accent">attiva</span>
            </>
          ) : (
            <span className="hint">Nessuna versione salvata</span>
          )}
          <span className="hint">
            {versions.length === 0
              ? ''
              : `${versions.length} version${versions.length === 1 ? 'e' : 'i'}`}
          </span>
        </button>

        <div className="row">
          {hasUnsavedChanges && !isNewDraft && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                if (window.confirm('Annullare tutte le modifiche non salvate?')) onDiscardChanges();
              }}
            >
              Annulla modifiche
            </button>
          )}
          <button
            type="button"
            className={`btn btn-sm ${hasUnsavedChanges ? 'btn-primary' : ''}`}
            onClick={quickSave}
            disabled={!hasUnsavedChanges && !isNewDraft}
            title={hasUnsavedChanges || isNewDraft ? 'Salva le modifiche' : 'Nessuna modifica da salvare'}
          >
            Salva
          </button>
          <button type="button" className="btn btn-sm" onClick={() => openDialog('new')}>
            Salva come nuova
          </button>
        </div>
      </div>

      {expanded && (
        <ul className="version-list">
          {versions.length === 0 && (
            <li className="version-empty hint">
              Nessuna versione salvata per {formatMonthLabel(schedule.year, schedule.month)}.
            </li>
          )}

          {versions.map(version => {
            const viewing = savedVersionId === version.id;
            return (
              <li
                key={version.id}
                className={`version-item ${viewing ? 'viewing' : ''} ${version.isActive ? 'active' : ''}`}
              >
                <div className="version-item-info">
                  {renamingId === version.id ? (
                    <input
                      className="input"
                      defaultValue={version.name}
                      autoFocus
                      onBlur={event => rename(version, event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') setRenamingId(null);
                      }}
                    />
                  ) : (
                    <>
                      <span className="version-name">
                        {version.name}
                        {version.isActive && <span className="badge badge-accent">attiva</span>}
                        {viewing && <span className="badge badge-primary">in visione</span>}
                      </span>
                      <span className="version-date">
                        {formatDateTime(version.createdAt)} · {version.schedule.assignments.length} turni
                      </span>
                    </>
                  )}
                </div>

                <div className="row">
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => loadVersion(version)}
                    disabled={viewing}
                  >
                    {viewing ? 'Visualizzata' : 'Visualizza'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => setActiveForStats(version)}
                    disabled={version.isActive}
                    title="Usa questa versione nelle statistiche generali e nel bilanciamento annuale"
                  >
                    {version.isActive ? 'Attiva' : 'Rendi attiva'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => openDialog('duplicate', version.id)}
                  >
                    Duplica
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => setRenamingId(version.id)}
                  >
                    Rinomina
                  </button>
                  <button
                    type="button"
                    className="btn-icon danger"
                    onClick={() => deleteVersion(version)}
                    aria-label={`Elimina ${version.name}`}
                  >✕</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {dialog && (
        <Modal
          title={dialog.mode === 'duplicate' ? 'Duplica versione' : 'Salva versione'}
          size="sm"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDialog(null)}>Annulla</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!dialog.name.trim()}
                onClick={confirmDialog}
              >
                {dialog.mode === 'duplicate' ? 'Duplica' : 'Salva'}
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="version-name">Nome della versione</label>
            <input
              id="version-name"
              className="input"
              value={dialog.name}
              autoFocus
              placeholder="es. Bozza 1, Definitivo"
              onChange={event => setDialog({ ...dialog, name: event.target.value })}
              onKeyDown={event => {
                if (event.key === 'Enter') confirmDialog();
              }}
            />
            <p className="hint">
              {dialog.mode === 'duplicate'
                ? 'La copia non diventa la versione attiva.'
                : `Verrà salvata come nuova versione di ${formatMonthLabel(schedule.year, schedule.month)} e diventerà quella attiva.`}
            </p>
          </div>
        </Modal>
      )}
    </section>
  );
}
