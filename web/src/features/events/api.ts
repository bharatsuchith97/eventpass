import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../../lib/api/client';
import type { EventItem, EventStats } from '../../types';

export const useEvents = (params: { status?: string; search?: string } = {}) =>
  useQuery({ queryKey: ['events', params], queryFn: async () => (await api<{ items: EventItem[] }>(`/events${qs(params)}`)).items });

export const useEvent = (id: string) => useQuery({ queryKey: ['event', id], queryFn: () => api<EventItem>(`/events/${id}`) });

export const useEventStats = (id: string, enabled = true) =>
  useQuery({ queryKey: ['event-stats', id], queryFn: () => api<EventStats>(`/events/${id}/stats`), enabled, refetchInterval: 10_000 });

export interface EventPayload {
  name: string;
  description: string;
  venueName: string;
  venueAddress: string;
  startDatetime: string;
  endDatetime: string;
  capacity: number | null;
  bannerUrl: string;
}

export function useSaveEvent(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EventPayload) => (id ? api<EventItem>(`/events/${id}`, { method: 'PATCH', body }) : api<EventItem>('/events', { method: 'POST', body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['events'] });
      if (id) void qc.invalidateQueries({ queryKey: ['event', id] });
    },
  });
}

export type EventAction = 'publish' | 'complete' | 'cancel' | 'archive';
export function useEventAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: EventAction) => api<EventItem>(`/events/${id}/status`, { method: 'POST', body: { action } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['events'] });
      void qc.invalidateQueries({ queryKey: ['event', id] });
    },
  });
}

export function useDuplicateEvent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<EventItem>(`/events/${id}/duplicate`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['events'] }),
  });
}
