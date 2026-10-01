import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../../lib/api/client';
import type { Guest, Paged, TicketRow } from '../../types';

export interface TicketFilters {
  search: string;
  rsvp: string;
  checkedIn: string;
  page: number;
  pageSize: number;
}

export const useEventTickets = (eventId: string, f: TicketFilters) =>
  useQuery({
    queryKey: ['tickets', eventId, f],
    queryFn: () => api<Paged<TicketRow>>(`/events/${eventId}/tickets${qs({ ...f })}`),
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
  });

export const useGuestSearch = (search: string) =>
  useQuery({
    queryKey: ['guest-search', search],
    queryFn: async () => (await api<Paged<Guest>>(`/guests${qs({ search, pageSize: 20 })}`)).items,
    placeholderData: (prev) => prev,
  });

function useInvalidate(eventId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['tickets', eventId] });
    void qc.invalidateQueries({ queryKey: ['event-stats', eventId] });
    void qc.invalidateQueries({ queryKey: ['event', eventId] });
    void qc.invalidateQueries({ queryKey: ['invitations'] });
  };
}

export function useIssueTickets(eventId: string) {
  const inv = useInvalidate(eventId);
  return useMutation({
    mutationFn: (body: { guestIds?: string[]; allGuests?: boolean; send: boolean }) =>
      api<{ issued: number; invited: number; failed: number }>(`/events/${eventId}/tickets`, { method: 'POST', body }),
    onSuccess: inv,
  });
}

export function useSendInvitations(eventId: string) {
  const inv = useInvalidate(eventId);
  return useMutation({
    mutationFn: (body: { ticketIds?: string[]; pendingOnly?: boolean }) =>
      api<{ attempted: number; sent: number; failed: number }>(`/events/${eventId}/invitations`, { method: 'POST', body }),
    onSuccess: inv,
  });
}

export function useCancelTicket(eventId: string) {
  const inv = useInvalidate(eventId);
  return useMutation({ mutationFn: (id: string) => api(`/tickets/${id}/cancel`, { method: 'POST' }), onSuccess: inv });
}

export interface ReissuedPass {
  ticketId: string;
  ticketNumber: string;
  token: string;
  qrValue: string;
  passUrl: string;
}
/** The guest's current pass: the same QR as in their invitation email. */
export function usePass(ticketId: string | null) {
  return useQuery({
    queryKey: ['pass', ticketId],
    queryFn: () => api<ReissuedPass>(`/tickets/${ticketId}/pass`),
    enabled: !!ticketId,
    staleTime: Infinity,
    gcTime: 0, // don't keep pass tokens around after the dialog closes
  });
}

/** Issue a new QR on purpose (lost or leaked pass); the previous one stops working. */
export function useReissue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<ReissuedPass>(`/tickets/${id}/reissue`, { method: 'POST' }),
    onSuccess: (pass) => qc.setQueryData(['pass', pass.ticketId], pass),
  });
}
