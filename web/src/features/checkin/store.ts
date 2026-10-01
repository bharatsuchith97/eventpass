import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CheckInState {
  eventId: string;
  gate: string;
  deviceId: string;
  setEventId: (id: string) => void;
  setGate: (gate: string) => void;
}

const newDeviceId = () => {
  try {
    return `dev-${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    return `dev-${Math.random().toString(36).slice(2, 10)}`;
  }
};

/** Per-device scanner preferences (client state only). Nothing sensitive is stored. */
export const useCheckInStore = create<CheckInState>()(
  persist(
    (set) => ({
      eventId: '',
      gate: '',
      deviceId: newDeviceId(),
      setEventId: (eventId) => set({ eventId }),
      setGate: (gate) => set({ gate }),
    }),
    { name: 'eventpass-checkin' },
  ),
);
