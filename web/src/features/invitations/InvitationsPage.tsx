import { useState } from 'react';
import { Button, MenuItem, TextField } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../../lib/api/client';
import { errorMessage, formatDateTime, fullName } from '../../lib/utils/format';
import { DataTable, ErrorAlert, FilterBar, PageHeader, StatusBadge, useToast, type Column } from '../../components/ui';
import { useEvents } from '../events/api';
import type { InvitationRow, Paged } from '../../types';

const TONE: Record<string, 'default' | 'success' | 'error' | 'info'> = { SENT: 'info', DELIVERED: 'info', OPENED: 'success', FAILED: 'error', PENDING: 'default' };

export function InvitationsPage() {
  const qc = useQueryClient();
  const events = useEvents();
  const [eventId, setEventId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const { toast, toastNode } = useToast();
  const q = useQuery({
    queryKey: ['invitations', eventId, page, pageSize],
    queryFn: () => api<Paged<InvitationRow>>(`/invitations${qs({ eventId, page, pageSize })}`),
    placeholderData: (p) => p,
  });
  const resend = useMutation({
    mutationFn: () => api<{ attempted: number; sent: number; failed: number }>(`/events/${eventId}/invitations`, { method: 'POST', body: { pendingOnly: true } }),
    onSuccess: (r) => {
      toast(r.attempted ? `${r.sent} sent${r.failed ? `, ${r.failed} failed` : ''}` : 'Nobody is waiting for an invitation', r.failed ? 'error' : 'success');
      void qc.invalidateQueries({ queryKey: ['invitations'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const columns: Column<InvitationRow>[] = [
    { key: 'guest', header: 'Guest', render: (r) => <><b>{fullName(r)}</b><br /><small>{r.email}</small></> },
    { key: 'event', header: 'Event', hideOnMobile: true, render: (r) => r.eventName },
    { key: 'ticket', header: 'Ticket', hideOnMobile: true, render: (r) => r.ticketNumber },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge label={r.deliveryStatus} tone={TONE[r.deliveryStatus] ?? 'default'} /> },
    { key: 'sent', header: 'Sent', hideOnMobile: true, render: (r) => formatDateTime(r.sentAt) },
    { key: 'opened', header: 'Opened', hideOnMobile: true, render: (r) => formatDateTime(r.openedAt) },
  ];
  return (
    <>
      <PageHeader title="Invitations" subtitle="Delivery and open tracking for emailed passes" actions={eventId && <Button variant="contained" disabled={resend.isPending} onClick={() => resend.mutate()}>Send pending invitations</Button>} />
      <FilterBar>
        <TextField select label="Event" value={eventId} onChange={(e) => { setEventId(e.target.value); setPage(1); }} sx={{ minWidth: 260, maxWidth: 360 }}>
          <MenuItem value="">All events</MenuItem>
          {(events.data ?? []).map((e) => <MenuItem key={e.id} value={e.id}>{e.name}</MenuItem>)}
        </TextField>
      </FilterBar>
      <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />
      <DataTable columns={columns} rows={q.data?.items ?? []} rowKey={(r) => r.id} loading={q.isLoading} total={q.data?.total ?? 0} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} emptyTitle="No invitations sent yet" emptyBody="Open an event, add guests and tick 'Email the invitation'." />
      {toastNode}
    </>
  );
}
