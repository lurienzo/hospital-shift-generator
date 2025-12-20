import { useState } from 'react';
import {
  OperativeRoom,
  ScheduleSlot,
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

        if (existingSlot) {
          return {
            ...room,
            slots: room.slots.map(slot =>
              slot.id === existingSlot.id
                ? { ...slot, requiredDoctors: slot.requiredDoctors + 1 }
                : slot
            ),
          };
        }

        const newSlot: ScheduleSlot = {
          id: generateId(),
          weekday,
          timeSlot,
          requiredDoctors: 1,
          isCritical: timeSlot === '20:00-08:00',
        };

        return { ...room, slots: [...room.slots, newSlot] };
      })
    );
  };

  const removeSlot = (roomId: string, slotId: string) => {
    onRoomsChange(
      rooms.map(room => {
        if (room.id !== roomId) return room;

        const slot = room.slots.find(s => s.id === slotId);
        if (!slot) return room;

        if (slot.requiredDoctors > 1) {
          return {
            ...room,
            slots: room.slots.map(s =>
              s.id === slotId ? { ...s, requiredDoctors: s.requiredDoctors - 1 } : s
            ),
          };
        }

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

  const addMultipleSlots = (roomId: string, weekdays: Weekday[], timeSlots: TimeSlot[]) => {
    onRoomsChange(
      rooms.map(room => {
        if (room.id !== roomId) return room;

        let updatedSlots = [...room.slots];

        for (const weekday of weekdays) {
          for (const timeSlot of timeSlots) {
            const existingSlotIndex = updatedSlots.findIndex(
              slot => slot.weekday === weekday && slot.timeSlot === timeSlot
            );

            if (existingSlotIndex >= 0) {
              updatedSlots[existingSlotIndex] = {
                ...updatedSlots[existingSlotIndex],
                requiredDoctors: updatedSlots[existingSlotIndex].requiredDoctors + 1,
              };
            } else {
              updatedSlots.push({
                id: generateId(),
                weekday,
                timeSlot,
                requiredDoctors: 1,
                isCritical: timeSlot === '20:00-08:00',
              });
            }
          }
        }

        return { ...room, slots: updatedSlots };
      })
    );
  };

  const addAllDaySlots = (roomId: string, weekday: Weekday) => {
    TIME_SLOTS.forEach(timeSlot => addSlot(roomId, weekday, timeSlot));
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
                              className={`schedule-cell ${slot ? 'active' : ''} ${isWeekend ? 'weekend-cell' : ''} ${slot?.isCritical ? 'critical' : ''}`}
                              style={slot ? { backgroundColor: room.color + '40' } : {}}
                            >
                              {slot ? (
                                <div className="slot-content">
                                  <span className="doctor-count">{slot.requiredDoctors}</span>
                                  <div className="slot-actions">
                                    <button onClick={() => addSlot(room.id, weekday, timeSlot)}>+</button>
                                    <button onClick={() => removeSlot(room.id, slot.id)}>−</button>
                                  </div>
                                  <button
                                    className={`btn-critical ${slot.isCritical ? 'active' : ''}`}
                                    onClick={() => toggleCritical(room.id, slot.id)}
                                    title={slot.isCritical ? 'Turno critico (bilanciato)' : 'Segna come critico'}
                                  >
                                    ⚠️
                                  </button>
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
                    <span className="legend-icon critical">⚠️</span>
                    Turno critico (bilanciato tra dottori)
                  </span>
                </div>
              </div>
            )}

            {expandedRoom !== room.id && room.slots.length > 0 && (
              <div className="room-summary">
                {room.slots.reduce((sum, slot) => sum + slot.requiredDoctors, 0)} turni/settimana
                {room.slots.some(s => s.isCritical) && (
                  <span className="critical-badge">⚠️ {room.slots.filter(s => s.isCritical).length} critici</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
