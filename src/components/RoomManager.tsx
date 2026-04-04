import { useState } from 'react';
import {
  OperativeRoom,
  ScheduleSlot,
  DayGroup,
  Weekday,
  TimeSlot,
  WEEKDAYS,
  WEEKDAYS_ONLY,
  WEEKEND_ONLY,
  TIME_SLOTS,
  WEEKDAY_LABELS,
  TIME_SLOT_LABELS,
  TIME_SLOT_SHORT_LABELS,
} from '../models/types';
import { generateId } from '../utils/idGenerator';
import './RoomManager.css';

interface RoomManagerProps {
  rooms: OperativeRoom[];
  onRoomsChange: (rooms: OperativeRoom[]) => void;
}

const ROOM_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e91e63', '#00bcd4', '#ff5722', '#607d8b',
];

export function RoomManager({ rooms, onRoomsChange }: RoomManagerProps) {
  const [newRoomName, setNewRoomName] = useState('');
  const [expandedRoom, setExpandedRoom] = useState<string | null>(null);

  const addRoom = () => {
    if (!newRoomName.trim()) return;

    const newRoom: OperativeRoom = {
      id: generateId(),
      name: newRoomName.trim(),
      color: ROOM_COLORS[rooms.length % ROOM_COLORS.length],
      slots: [],
      dayGroups: [],
    };

    onRoomsChange([...rooms, newRoom]);
    setNewRoomName('');
  };

  const removeRoom = (roomId: string) => {
    onRoomsChange(rooms.filter(room => room.id !== roomId));
  };

  const updateRoomColor = (roomId: string, color: string) => {
    onRoomsChange(
      rooms.map(room => (room.id === roomId ? { ...room, color } : room))
    );
  };

  const addSlot = (roomId: string, weekday: Weekday, timeSlot: TimeSlot) => {
    onRoomsChange(
      rooms.map(room => {
        if (room.id !== roomId) return room;

        const existingSlot = room.slots.find(
          slot => slot.weekday === weekday && slot.timeSlot === timeSlot
        );
        if (existingSlot) return room;

        const isNightShift = timeSlot === '20:00-08:00';
        const newSlot: ScheduleSlot = {
          id: generateId(),
          weekday,
          timeSlot,
          isCritical: isNightShift,
          requiresNextDayRest: isNightShift,
          isFullDayExclusive: isNightShift,
        };

        return { ...room, slots: [...room.slots, newSlot] };
      })
    );
  };

  const removeSlot = (roomId: string, slotId: string) => {
    onRoomsChange(
      rooms.map(room => {
        if (room.id !== roomId) return room;
        return { ...room, slots: room.slots.filter(s => s.id !== slotId) };
      })
    );
  };

  const toggleCritical = (roomId: string, slotId: string) => {
    onRoomsChange(
      rooms.map(room => {
        if (room.id !== roomId) return room;
        return {
          ...room,
          slots: room.slots.map(slot =>
            slot.id === slotId ? { ...slot, isCritical: !slot.isCritical } : slot
          ),
        };
      })
    );
  };

  const toggleNextDayRest = (roomId: string, slotId: string) => {
    onRoomsChange(
      rooms.map(room => {
        if (room.id !== roomId) return room;
        return {
          ...room,
          slots: room.slots.map(slot =>
            slot.id === slotId ? { ...slot, requiresNextDayRest: !slot.requiresNextDayRest } : slot
          ),
        };
      })
    );
  };

  const toggleFullDayExclusive = (roomId: string, slotId: string) => {
    onRoomsChange(
      rooms.map(room => {
        if (room.id !== roomId) return room;
        return {
          ...room,
          slots: room.slots.map(slot =>
            slot.id === slotId ? { ...slot, isFullDayExclusive: !slot.isFullDayExclusive } : slot
          ),
        };
      })
    );
  };

  const toggleSecondDayRest = (roomId: string, slotId: string) => {
    onRoomsChange(
      rooms.map(room => {
        if (room.id !== roomId) return room;
        return {
          ...room,
          slots: room.slots.map(slot =>
            slot.id === slotId ? { ...slot, requiresSecondDayRest: !slot.requiresSecondDayRest } : slot
          ),
        };
      })
    );
  };

  const addDayGroup = (roomId: string) => {
    onRoomsChange(
      rooms.map(room => {
        if (room.id !== roomId) return room;
        const newGroup: DayGroup = {
          id: generateId(),
          days: [],
        };
        return { ...room, dayGroups: [...(room.dayGroups || []), newGroup] };
      })
    );
  };

  const removeDayGroup = (roomId: string, groupId: string) => {
    onRoomsChange(
      rooms.map(room => {
        if (room.id !== roomId) return room;
        return { ...room, dayGroups: (room.dayGroups || []).filter(g => g.id !== groupId) };
      })
    );
  };

  const toggleDayInGroup = (roomId: string, groupId: string, weekday: Weekday) => {
    onRoomsChange(
      rooms.map(room => {
        if (room.id !== roomId) return room;
        return {
          ...room,
          dayGroups: (room.dayGroups || []).map(group => {
            if (group.id !== groupId) return group;
            const hasDayAlready = group.days.includes(weekday);
            return {
              ...group,
              days: hasDayAlready
                ? group.days.filter(d => d !== weekday)
                : [...group.days, weekday],
            };
          }),
        };
      })
    );
  };

  const updateConsecutiveShifts = (roomId: string, value: number | undefined) => {
    onRoomsChange(
      rooms.map(room => {
        if (room.id !== roomId) return room;
        return { ...room, consecutiveShifts: value };
      })
    );
  };

  const updateConsecutiveStartDay = (roomId: string, value: Weekday | undefined) => {
    onRoomsChange(
      rooms.map(room => {
        if (room.id !== roomId) return room;
        return { ...room, consecutiveStartDay: value };
      })
    );
  };

  const addMultipleSlots = (roomId: string, weekdays: Weekday[], timeSlots: TimeSlot[]) => {
    onRoomsChange(
      rooms.map(room => {
        if (room.id !== roomId) return room;

        let updatedSlots = [...room.slots];

        for (const weekday of weekdays) {
          for (const timeSlot of timeSlots) {
            const exists = updatedSlots.some(
              slot => slot.weekday === weekday && slot.timeSlot === timeSlot
            );
            if (!exists) {
              const isNightShift = timeSlot === '20:00-08:00';
              updatedSlots.push({
                id: generateId(),
                weekday,
                timeSlot,
                isCritical: isNightShift,
                requiresNextDayRest: isNightShift,
                isFullDayExclusive: isNightShift,
              });
            }
          }
        }

        return { ...room, slots: updatedSlots };
      })
    );
  };

  const addAllDaySlots = (roomId: string, weekday: Weekday) => {
    addMultipleSlots(roomId, [weekday], TIME_SLOTS);
  };

  const getSlotForCell = (room: OperativeRoom, weekday: Weekday, timeSlot: TimeSlot): ScheduleSlot | undefined => {
    return room.slots.find(slot => slot.weekday === weekday && slot.timeSlot === timeSlot);
  };

  return (
    <div className="room-manager">
      <div className="add-room-form">
        <input
          type="text"
          value={newRoomName}
          onChange={event => setNewRoomName(event.target.value)}
          placeholder="Nome sala operativa (es. Dermatologia)"
          onKeyDown={event => event.key === 'Enter' && addRoom()}
        />
        <button onClick={addRoom} className="btn-add">
          + Aggiungi Sala
        </button>
      </div>

      <div className="rooms-list">
        {rooms.map(room => (
          <div key={room.id} className="room-card">
            <div className="room-header">
              <div className="room-color-picker">
                <input
                  type="color"
                  value={room.color}
                  onChange={event => updateRoomColor(room.id, event.target.value)}
                />
              </div>
              <h3 style={{ color: room.color }}>{room.name}</h3>
              <div className="room-actions">
                <button
                  className="btn-expand"
                  onClick={() => setExpandedRoom(expandedRoom === room.id ? null : room.id)}
                >
                  {expandedRoom === room.id ? '▼' : '▶'}
                </button>
                <button className="btn-remove" onClick={() => removeRoom(room.id)}>
                  ✕
                </button>
              </div>
            </div>

            {expandedRoom === room.id && (
              <div className="room-schedule-grid">
                <div className="quick-actions-container">
                  <div className="quick-actions-group">
                    <span className="group-label">Tutti i giorni:</span>
                    {TIME_SLOTS.map(timeSlot => (
                      <button key={timeSlot} onClick={() => addMultipleSlots(room.id, WEEKDAYS, [timeSlot])}>
                        {TIME_SLOT_SHORT_LABELS[timeSlot]}
                      </button>
                    ))}
                  </div>
                  <div className="quick-actions-group">
                    <span className="group-label">Lun-Ven:</span>
                    {TIME_SLOTS.map(timeSlot => (
                      <button key={timeSlot} onClick={() => addMultipleSlots(room.id, WEEKDAYS_ONLY, [timeSlot])}>
                        {TIME_SLOT_SHORT_LABELS[timeSlot]}
                      </button>
                    ))}
                  </div>
                  <div className="quick-actions-group weekend">
                    <span className="group-label">Weekend:</span>
                    {TIME_SLOTS.map(timeSlot => (
                      <button key={timeSlot} onClick={() => addMultipleSlots(room.id, WEEKEND_ONLY, [timeSlot])}>
                        {TIME_SLOT_SHORT_LABELS[timeSlot]}
                      </button>
                    ))}
                  </div>
                </div>

                <table className="schedule-table">
                  <thead>
                    <tr>
                      <th></th>
                      {WEEKDAYS.map(weekday => (
                        <th key={weekday} className={WEEKEND_ONLY.includes(weekday) ? 'weekend-header' : ''}>
                          {WEEKDAY_LABELS[weekday]}
                          <button
                            className="btn-small"
                            onClick={() => addAllDaySlots(room.id, weekday)}
                            title="Aggiungi tutto il giorno"
                          >
                            +24h
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {TIME_SLOTS.map(timeSlot => (
                      <tr key={timeSlot}>
                        <td className="time-label">{TIME_SLOT_LABELS[timeSlot]}</td>
                        {WEEKDAYS.map(weekday => {
                          const slot = getSlotForCell(room, weekday, timeSlot);
                          const isWeekend = WEEKEND_ONLY.includes(weekday);
                          return (
                            <td
                              key={`${weekday}-${timeSlot}`}
                              className={`schedule-cell ${slot ? 'active' : ''} ${isWeekend ? 'weekend-cell' : ''} ${slot?.isCritical ? 'critical' : ''} ${slot?.requiresNextDayRest ? 'rest-required' : ''} ${slot?.isFullDayExclusive ? 'full-day-exclusive' : ''}`}
                              style={slot ? { backgroundColor: room.color + '40' } : {}}
                            >
                              {slot ? (
                                <div className="slot-content">
                                  <div className="slot-flags-inline">
                                    <button
                                      className={`btn-flag-sm ${slot.isCritical ? 'active' : ''}`}
                                      onClick={(e) => { e.stopPropagation(); toggleCritical(room.id, slot.id); }}
                                      title={slot.isCritical ? 'Critico' : 'Segna critico'}
                                    >⚠️</button>
                                    <button
                                      className={`btn-flag-sm ${slot.requiresNextDayRest ? 'active' : ''}`}
                                      onClick={(e) => { e.stopPropagation(); toggleNextDayRest(room.id, slot.id); }}
                                      title={slot.requiresNextDayRest ? 'Smontante (1g riposo)' : 'Segna smontante'}
                                    >😴</button>
                                    <button
                                      className={`btn-flag-sm ${slot.requiresSecondDayRest ? 'active' : ''}`}
                                      onClick={(e) => { e.stopPropagation(); toggleSecondDayRest(room.id, slot.id); }}
                                      title={slot.requiresSecondDayRest ? 'Smontante + Riposo (2g)' : 'Segna smontante + riposo (2g)'}
                                    >💤</button>
                                    <button
                                      className={`btn-flag-sm ${slot.isFullDayExclusive ? 'active' : ''}`}
                                      onClick={(e) => { e.stopPropagation(); toggleFullDayExclusive(room.id, slot.id); }}
                                      title={slot.isFullDayExclusive ? 'Esclusivo' : 'Segna esclusivo'}
                                    >🚫</button>
                                  </div>
                                  <button className="btn-remove-sm" onClick={() => removeSlot(room.id, slot.id)} title="Rimuovi">✕</button>
                                </div>
                              ) : (
                                <button
                                  className="btn-add-slot"
                                  onClick={() => addSlot(room.id, weekday, timeSlot)}
                                >
                                  +
                                </button>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="schedule-legend">
                  <span className="legend-item">
                    <span className="legend-icon">⚠️</span>
                    Critico
                  </span>
                  <span className="legend-item">
                    <span className="legend-icon">😴</span>
                    Smontante (1g)
                  </span>
                  <span className="legend-item">
                    <span className="legend-icon">💤</span>
                    Smontante + Riposo (2g)
                  </span>
                  <span className="legend-item">
                    <span className="legend-icon">🚫</span>
                    Esclusivo
                  </span>
                </div>

                <div className="rotation-constraints-section">
                  <h4>🔄 Vincoli di Rotazione</h4>
                  <p className="section-description">
                    Scegli UNA delle due modalità per gestire la continuità dei medici in questa sala.
                  </p>

                  {/* Consecutive Shifts */}
                  <div className={`constraint-option ${room.consecutiveShifts ? 'active' : ''} ${(room.dayGroups || []).length > 0 ? 'disabled' : ''}`}>
                    <div className="constraint-header">
                      <span className="constraint-icon">📊</span>
                      <div className="constraint-info">
                        <h5>Turni Consecutivi</h5>
                        <p>Ogni medico lavora N turni consecutivi (in ordine cronologico sulla timetable) prima di passare al successivo.</p>
                      </div>
                    </div>
                    <div className="constraint-input">
                      <input
                        type="number"
                        min="0"
                        max="20"
                        value={room.consecutiveShifts || ''}
                        placeholder="N turni"
                        onChange={(event) => {
                          const value = event.target.value ? parseInt(event.target.value, 10) : undefined;
                          updateConsecutiveShifts(room.id, value && value > 0 ? value : undefined);
                        }}
                        disabled={(room.dayGroups || []).length > 0}
                      />
                      <select
                        value={room.consecutiveStartDay || ''}
                        onChange={(event) => {
                          updateConsecutiveStartDay(room.id, event.target.value ? event.target.value as Weekday : undefined);
                        }}
                        disabled={!room.consecutiveShifts || (room.dayGroups || []).length > 0}
                        title="Giorno di inizio rotazione"
                      >
                        <option value="">Inizio auto</option>
                        {WEEKDAYS.map(wd => (
                          <option key={wd} value={wd}>{WEEKDAY_LABELS[wd]}</option>
                        ))}
                      </select>
                      {room.consecutiveShifts && (
                        <button
                          className="btn-clear"
                          onClick={() => { updateConsecutiveShifts(room.id, undefined); updateConsecutiveStartDay(room.id, undefined); }}
                          title="Rimuovi vincolo"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Day Groups */}
                  <div className={`constraint-option ${(room.dayGroups || []).length > 0 ? 'active' : ''} ${room.consecutiveShifts ? 'disabled' : ''}`}>
                    <div className="constraint-header">
                      <span className="constraint-icon">🔗</span>
                      <div className="constraint-info">
                        <h5>Gruppi Giorni Consecutivi</h5>
                        <p>I medici assegnati a un giorno del gruppo lavoreranno tutti i giorni del gruppo (es. Mar-Mer-Gio).</p>
                      </div>
                      <button
                        className="btn-add-group"
                        onClick={() => addDayGroup(room.id)}
                        disabled={!!room.consecutiveShifts}
                      >
                        + Nuovo Gruppo
                      </button>
                    </div>
                    {(room.dayGroups || []).length > 0 && (
                      <div className="day-groups-list">
                        {(room.dayGroups || []).map((group, index) => (
                          <div key={group.id} className="day-group-row">
                            <span className="group-index">Gruppo {index + 1}:</span>
                            <div className="group-days">
                              {WEEKDAYS.map(weekday => (
                                <button
                                  key={weekday}
                                  className={`day-toggle ${group.days.includes(weekday) ? 'active' : ''}`}
                                  onClick={() => toggleDayInGroup(room.id, group.id, weekday)}
                                >
                                  {WEEKDAY_LABELS[weekday].slice(0, 3)}
                                </button>
                              ))}
                            </div>
                            <button
                              className="btn-remove-group"
                              onClick={() => removeDayGroup(room.id, group.id)}
                              title="Rimuovi gruppo"
                            >
                              🗑️
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {expandedRoom !== room.id && room.slots.length > 0 && (
              <div className="room-summary">
                {room.slots.length} turni/settimana
                {room.slots.some(s => s.isCritical) && (
                  <span className="summary-badge">⚠️ {room.slots.filter(s => s.isCritical).length}</span>
                )}
                {room.slots.some(s => s.requiresNextDayRest) && (
                  <span className="summary-badge">😴 {room.slots.filter(s => s.requiresNextDayRest).length}</span>
                )}
                {room.slots.some(s => s.isFullDayExclusive) && (
                  <span className="summary-badge">🚫 {room.slots.filter(s => s.isFullDayExclusive).length}</span>
                )}
                {room.consecutiveShifts && (
                  <span className="summary-badge">📊 {room.consecutiveShifts} turni cons.</span>
                )}
                {(room.dayGroups || []).length > 0 && (
                  <span className="summary-badge">🔗 {(room.dayGroups || []).length} gruppi</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
