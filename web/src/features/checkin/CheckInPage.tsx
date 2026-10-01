import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, MenuItem, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, qs } from '../../lib/api/client';
import { fullName, formatTime, tokenFromScan } from '../../lib/utils/format';
import {
  CategoryChip, CheckInResult, DataTable, EmptyState, ErrorAlert, GuestAvatar, Scanner, SearchField, StatusBadge, type Column, type ScanOutcome,
} from '../../components/ui';
import { useEvents } from '../events/api';
import type { CheckInRow, CheckInSuccess, EventItem, Guestish, Paged, SearchHit } from '../../types';
import { useCheckInStore } from './store';

interface ErrBody { code: string; message: string; details?: { guest?: Guestish; checkedInAt?: string; gate?: string | null } }

function toOutcome(e: unknown): ScanOutcome {
  if (e instanceof ApiError) {
    const d = e.details as ErrBody['details'];
    return { kind: 'error', code: e.code, message: e.message, guest: d?.guest, checkedInAt: d?.checkedInAt, gate: d?.gate };
  }
  return { kind: 'error', code: 'NETWORK', message: 'Could not reach the server. Try again.' };
}

/** Shared check-in mutation: scan by token or manual by ticket. */
function useCheckIn(eventId: string) {
  const qc = useQueryClient();
  const { gate, deviceId } = useCheckInStore();
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['checkins', eventId] });
    void qc.invalidateQueries({ queryKey: ['checkin-count', eventId] });
    void qc.invalidateQueries({ queryKey: ['checkin-search'] });
    void qc.invalidateQueries({ queryKey: ['event-stats', eventId] });
  };
  const m = useMutation({
    mutationFn: (v: { token: string } | { ticketId: string }) =>
      'token' in v
        ? api<CheckInSuccess>('/checkin', { method: 'POST', body: { token: v.token, eventId: eventId || undefined, gate: gate || undefined, deviceId } })
        : api<CheckInSuccess>('/checkin/manual', { method: 'POST', body: { ticketId: v.ticketId, gate: gate || undefined, deviceId } }),
    onSuccess: (data) => { setOutcome({ kind: 'success', data }); refresh(); },
    onError: (e) => { setOutcome(toOutcome(e)); refresh(); },
  });
  return { outcome, dismiss: useCallback(() => setOutcome(null), []), submit: m.mutate, pending: m.isPending };
}

function SearchTab({ eventId, checkIn }: { eventId: string; checkIn: ReturnType<typeof useCheckIn> }) {
  const [term, setTerm] = useState('');
  const q = useQuery({
    queryKey: ['checkin-search', eventId, term],
    queryFn: async () => (await api<{ items: SearchHit[] }>(`/checkin/search${qs({ eventId, q: term })}`)).items,
    enabled: term.length >= 2,
  });
  return (
    <Stack gap={2}>
      <SearchField autoFocus placeholder="Search name, email or ticket number" onChange={setTerm} />
      <ErrorAlert error={q.error} />
      {term.length < 2 ? (
        <Typography color="text.secondary">Type at least 2 characters.</Typography>
      ) : q.data?.length === 0 ? (
        <EmptyState title="No matching guests" body="Check the spelling, or ask the guest for their ticket number." />
      ) : (
        <Stack gap={1}>
          {q.data?.map((h) => (
            <Card key={h.ticketId} variant="outlined">
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <GuestAvatar guest={h} />
                <Box flexGrow={1} minWidth={0}>
                  <Typography fontWeight={700} noWrap>{fullName(h)}</Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>{h.email}{h.companyName ? ` - ${h.companyName}` : ''}</Typography>
                  <Stack direction="row" gap={1} mt={0.5}><CategoryChip category={h.category} /><Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{h.ticketNumber}</Typography></Stack>
                </Box>
                {h.checkedInAt || h.status === 'USED' ? (
                  <StatusBadge label={`In ${formatTime(h.checkedInAt)}`} tone="success" />
                ) : (
                  <Button variant="contained" disabled={checkIn.pending} onClick={() => checkIn.submit({ ticketId: h.ticketId })}>Check in</Button>
                )}
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function RecentTab({ eventId }: { eventId: string }) {
  const q = useQuery({
    queryKey: ['checkins', eventId, 1, 25],
    queryFn: () => api<Paged<CheckInRow>>(`/events/${eventId}/checkins${qs({ page: 1, pageSize: 25 })}`),
    refetchInterval: 5_000,
  });
  const columns: Column<CheckInRow>[] = [
    { key: 't', header: 'Time', render: (r) => formatTime(r.checkedInAt) },
    { key: 'g', header: 'Guest', render: (r) => <b>{fullName(r)}</b> },
    { key: 'c', header: 'Category', render: (r) => <CategoryChip category={r.category} /> },
    { key: 'gate', header: 'Gate', hideOnMobile: true, render: (r) => r.gate ?? '-' },
  ];
  return <DataTable columns={columns} rows={q.data?.items ?? []} rowKey={(r) => r.id} loading={q.isLoading} emptyTitle="No check-ins yet" />;
}

export function CheckInPage() {
  const [params, setParams] = useSearchParams();
  const { eventId, gate, setEventId, setGate } = useCheckInStore();
  const events = useEvents();
  const open = (events.data ?? []).filter((e: EventItem) => ['PUBLISHED', 'ONGOING'].includes(e.status));
  const fromUrl = params.get('eventId');
  useEffect(() => {
    if (fromUrl && open.some((e) => e.id === fromUrl) && fromUrl !== eventId) setEventId(fromUrl);
  }, [fromUrl, open, eventId, setEventId]);
  const current = open.find((e) => e.id === eventId) ?? (open.length === 1 ? open[0] : undefined);
  const id = current?.id ?? '';
  const checkIn = useCheckIn(id);
  const tab = params.get('tab') ?? 'scan';
  const count = useQuery({
    queryKey: ['checkin-count', id],
    queryFn: () => api<Paged<CheckInRow>>(`/events/${id}/checkins${qs({ page: 1, pageSize: 1 })}`),
    enabled: !!id,
    refetchInterval: 5_000,
  });
  const [code, setCode] = useState('');

  const onScan = useCallback(
    (text: string) => {
      const token = tokenFromScan(text);
      if (!token) return checkIn.submit({ token: text.slice(0, 500) });
      checkIn.submit({ token });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, gate],
  );

  return (
    <Box maxWidth={720} mx="auto">
      <Typography variant="h4" component="h1" fontWeight={700} mb={2}>Check-in</Typography>
      <ErrorAlert error={events.error} onRetry={() => void events.refetch()} />
      {!events.isLoading && open.length === 0 ? (
        <EmptyState title="No events are open for check-in" body="An event must be published before guests can be checked in." />
      ) : (
        <Stack gap={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5}>
            <TextField select label="Event" value={id} onChange={(e) => setEventId(e.target.value)}>
              {open.map((e) => <MenuItem key={e.id} value={e.id}>{e.name}</MenuItem>)}
            </TextField>
            <TextField label="Gate (optional)" value={gate} onChange={(e) => setGate(e.target.value.slice(0, 60))} sx={{ maxWidth: { sm: 200 } }} />
          </Stack>
          {current && (
            <Alert severity="info" icon={false} sx={{ fontWeight: 600 }}>
              {count.data?.total ?? current.checkedInCount} of {current.guestCount} guests checked in
            </Alert>
          )}
          {id && (
            <>
              <Tabs value={['scan', 'search', 'recent'].includes(tab) ? tab : 'scan'} onChange={(_, v: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', v); return n; }, { replace: true })} variant="fullWidth">
                <Tab value="scan" label="Scan QR" />
                <Tab value="search" label="Search" />
                <Tab value="recent" label="Recent" />
              </Tabs>
              {tab === 'scan' && (
                <Stack gap={2}>
                  <Scanner onScan={onScan} paused={!!checkIn.outcome || checkIn.pending} />
                  <Stack component="form" direction="row" gap={1} onSubmit={(e) => { e.preventDefault(); if (code.trim()) { onScan(code.trim()); setCode(''); } }}>
                    <TextField placeholder="Or paste / type a pass code" value={code} onChange={(e) => setCode(e.target.value)} inputProps={{ 'aria-label': 'Pass code' }} />
                    <Button type="submit" variant="outlined" disabled={!code.trim() || checkIn.pending}>Check</Button>
                  </Stack>
                </Stack>
              )}
              {tab === 'search' && <SearchTab eventId={id} checkIn={checkIn} />}
              {tab === 'recent' && <RecentTab eventId={id} />}
            </>
          )}
        </Stack>
      )}
      {checkIn.outcome && <CheckInResult outcome={checkIn.outcome} onDismiss={checkIn.dismiss} />}
    </Box>
  );
}

/** Deep link target for a QR scanned with a phone's own camera: /checkin/<token>. Requires login; asks before admitting. */
export function CheckInLinkPage() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const valid = /^[0-9a-f]{64}$/i.test(token);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const { deviceId, gate } = useCheckInStore();
  const m = useMutation({
    mutationFn: () => api<CheckInSuccess>('/checkin', { method: 'POST', body: { token, gate: gate || undefined, deviceId } }),
    onSuccess: (data) => setOutcome({ kind: 'success', data }),
    onError: (e) => setOutcome(toOutcome(e)),
  });
  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Card variant="outlined" sx={{ maxWidth: 420, width: '100%' }}>
        <CardContent>
          <Stack gap={2}>
            <Typography variant="h5" fontWeight={700}>Check in this pass?</Typography>
            {valid ? <Typography color="text.secondary">This will admit the guest holding this QR code. Each pass works once.</Typography> : <Alert severity="error">This is not a valid pass link.</Alert>}
            <Button variant="contained" size="large" disabled={!valid || m.isPending} onClick={() => m.mutate()}>Check in</Button>
            <Button onClick={() => nav('/checkin')}>Open scanner</Button>
          </Stack>
        </CardContent>
      </Card>
      {outcome && <CheckInResult outcome={outcome} onDismiss={() => { setOutcome(null); if (outcome.kind === 'success') nav('/checkin'); }} />}
    </Box>
  );
}
