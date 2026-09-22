import { useState } from 'react';
import { OperativeRoom, ScheduleSlot, WEEKDAY_LABELS, getRotationMode } from '../models/types';
import { blockLabel } from '../domain/shiftTypes';
import { useConfig } from '../state/configContext';
import { RoomSlotGrid } from './RoomSlotGrid';
import { RoomRotation } from './RoomRotation';
import { ApplySchemeDialog } from './ApplySchemeDialog';
import { generateId } from '../utils/id';
import './RoomManager.css';

const ROOM_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e91e63', '#00bcd4', '#ff5722', '#607d8b',
];

export function RoomManager() {
  const { rooms, setRooms, shiftTypes, shiftTypeIndex, schemes } = useConfig();

  const [newRoomName, setNewRoomName] = useState('');
  const [expandedRoomId, setExpandedRoomId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [schemeTargetId, setSchemeTargetId] = useState<string | null>(null);

  const addRoom = () => {
    const name = newRoomName.trim();
    if (!name) return;

    if (rooms.some(room => room.name.toLowerCase() === name.toLowerCase())) {
      window.alert(`Esiste già una sala chiamata "${name}".`);
      return;
    }

    const room: OperativeRoom = {
      id: generateId(),
      name,
      color: ROOM_COLORS[rooms.length % ROOM_COLORS.length],
      slots: [],
      dayGroups: [],
    };

    setRooms([...rooms, room]);
    setNewRoomName('');
    setExpandedRoomId(room.id);
  };

  const updateRoom = (roomId: string, changes: Partial<OperativeRoom>) => {
    setRooms(rooms.map(room => (room.id === roomId ? { ...room, ...changes } : room)));
  };

  const removeRoom = (room: OperativeRoom) => {
    const message = room.slots.length > 0
      ? `Eliminare la sala "${room.name}" e i suoi ${room.slots.length} turni settimanali?`
      : `Eliminare la sala "${room.name}"?`;
    if (!window.confirm(message)) return;

    setRooms(rooms.filter(other => other.id !== room.id));
    if (expandedRoomId === room.id) setExpandedRoomId(null);
  };

  const schemeTarget = rooms.find(room => room.id === schemeTargetId);

  return (
    <div className="room-manager stack">
      <form
        className="add-row"
        onSubmit={event => { event.preventDefault(); addRoom(); }}
      >
        <input
          className="input"
          value={newRoomName}
          placeholder="Nome della sala (es. Sala Rossa, Pronto Soccorso)"
          onChange={event => setNewRoomName(event.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={!newRoomName.trim()}>
          Aggiungi sala
        </button>
      </form>

      {rooms.length === 0 && (
        <div className="empty-state">
          <h2>Nessuna sala configurata</h2>
          <p>
            Aggiungi le sale o i reparti da coprire, poi definisci per ciascuno quali turni
            servono nei vari giorni della settimana.
          </p>
        </div>
      )}

      <div className="stack-sm">
        {rooms.map(room => {
          const expanded = expandedRoomId === room.id;
          const rotation = getRotationMode(room);
          const rotationalSlots = room.slots.filter(
            slot => shiftTypeIndex.isRotational(slot.shiftTypeId));

          return (
            <article key={room.id} className={`room-card ${expanded ? 'expanded' : ''}`}>
              <header className="room-header">
                <input
                  className="color-input"
                  type="color"
                  value={room.color}
                  onChange={event => updateRoom(room.id, { color: event.target.value })}
                  title="Colore della sala"
                  aria-label={`Colore di ${room.name}`}
                />

                {renamingId === room.id ? (
                  <input
                    className="input room-name-input"
                    defaultValue={room.name}
                    autoFocus
                    onBlur={event => {
                      const name = event.target.value.trim();
                      if (name) updateRoom(room.id, { name });
                      setRenamingId(null);
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') setRenamingId(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="room-name"
                    style={{ color: room.color }}
                    onClick={() => setExpandedRoomId(expanded ? null : room.id)}
                    aria-expanded={expanded}
                  >
                    {room.name}
                  </button>
                )}

                <div className="room-summary">
                  {room.slots.length > 0 && (
                    <span className="badge">
                      {room.slots.length} turni/settimana
                    </span>
                  )}
                  {rotationalSlots.length > 0 && (
                    <span className="badge badge-accent" title="La sala usa fasce a rotazione">
                      rotazione
                    </span>
                  )}
                  {rotation === 'consecutive' && (
                    <span className="badge badge-primary">
                      {room.consecutiveShifts} consecutivi
                      {room.consecutiveStartDay && ` da ${WEEKDAY_LABELS[room.consecutiveStartDay].slice(0, 3)}`}
                    </span>
                  )}
                  {rotation === 'dayGroups' && (
                    <span className="badge badge-primary">
                      {room.dayGroups.length} grupp{room.dayGroups.length === 1 ? 'o' : 'i'}
                    </span>
                  )}
                  {rotation === 'cycle' && (
                    <span className="badge badge-primary">
                      ciclo · {room.cycle?.doctorIds.length} dottori
                    </span>
                  )}
                </div>

                <div className="row">
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => setRenamingId(room.id)}
                  >
                    Rinomina
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setExpandedRoomId(expanded ? null : room.id)}
                  >
                    {expanded ? 'Chiudi' : 'Configura'}
                  </button>
                  <button
                    type="button"
                    className="btn-icon danger"
                    onClick={() => removeRoom(room)}
                    aria-label={`Elimina ${room.name}`}
                  >✕</button>
                </div>
              </header>

              {expanded && (
                <div className="room-body">
                  <div className="panel-header">
                    <h4>Turni della settimana</h4>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setSchemeTargetId(room.id)}
                      disabled={schemes.length === 0}
                      title={schemes.length === 0
                        ? 'Crea prima uno schema in Impostazioni'
                        : 'Riempi la settimana con uno schema standard'}
                    >
                      Applica schema
                    </button>
                  </div>

                  <RoomSlotGrid
                    room={room}
                    shiftTypes={shiftTypes}
                    onChange={(slots: ScheduleSlot[]) => updateRoom(room.id, { slots })}
                  />

                  {rotationalSlots.length > 0 && (
                    <p className="hint rotation-note">
                      Questa sala usa {describeRotational(room, shiftTypeIndex)}. I turni di
                      quelle fasce vengono assegnati a blocchi interi allo stesso dottore, e ogni
                      blocco conta come una unità nel bilanciamento — anche fra mesi diversi.
                    </p>
                  )}

                  <RoomRotation
                    room={room}
                    onChange={changes => updateRoom(room.id, changes)}
                  />
                </div>
              )}
            </article>
          );
        })}
      </div>

      {schemeTarget && (
        <ApplySchemeDialog
          room={schemeTarget}
          schemes={schemes}
          shiftTypes={shiftTypeIndex}
          onApply={slots => updateRoom(schemeTarget.id, { slots })}
          onClose={() => setSchemeTargetId(null)}
        />
      )}
    </div>
  );
}

function describeRotational(
  room: OperativeRoom,
  shiftTypeIndex: ReturnType<typeof useConfig>['shiftTypeIndex'],
): string {
  const used = shiftTypeIndex.rotational.filter(shiftType =>
    room.slots.some(slot => slot.shiftTypeId === shiftType.id));

  return used
    .map(shiftType => `${shiftType.name} (blocchi di 1 ${blockLabel(shiftType)})`)
    .join(', ') || 'fasce a rotazione';
}
