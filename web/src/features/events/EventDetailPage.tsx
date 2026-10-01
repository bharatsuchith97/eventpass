import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, ListItemIcon, Menu, MenuItem, Skeleton, Stack, Tab, Tabs, Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import EditIcon from '@mui/icons-material/Edit';
import PublishIcon from '@mui/icons-material/Publish';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import BlockIcon from '@mui/icons-material/Block';
import ArchiveIcon from '@mui/icons-material/Archive';
import CopyIcon from '@mui/icons-material/ContentCopy';
import GroupIcon from '@mui/icons-material/ManageAccounts';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import { api, qs } from '../../lib/api/client';
import { useMe } from '../../lib/auth/session';
import { errorMessage, formatDateTime, formatTime, fullName } from '../../lib/utils/format';
import { CategoryChip, ConfirmDialog, DataTable, ErrorAlert, EventStatusBadge, PageHeader, StatusBadge, useToast, type Column } from '../../components/ui';
import { TicketsPanel } from '../tickets/TicketsPanel';
import type { CheckInRow, EventItem, Paged, TeamUser } from '../../types';
import { EventFormDialog } from './EventFormDialog';
import { EventOverview } from './EventOverview';
import { useDuplicateEvent, useEvent, useEventAction, type EventAction } from './api';

function CheckinsPanel({ eventId }: { eventId: string }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const q = useQuery({
    queryKey: ['checkins', eventId, page, pageSize],
    queryFn: () => api<Paged<CheckInRow>>(`/events/${eventId}/checkins${qs({ page, pageSize })}`),
    refetchInterval: 10_000,
    placeholderData: (p) => p,
  });
  const columns: Column<CheckInRow>[] = [
    { key: 'time', header: 'Time', render: (r) => formatTime(r.checkedInAt) },
    { key: 'guest', header: 'Guest', render: (r) => <b>{fullName(r)}</b> },
    { key: 'cat', header: 'Category', hideOnMobile: true, render: (r) => <CategoryChip category={r.category} /> },
    { key: 'ticket', header: 'Ticket', hideOnMobile: true, render: (r) => r.ticketNumber },
    { key: 'gate', header: 'Gate', render: (r) => r.gate ?? '-' },
    { key: 'method', header: 'Method', hideOnMobile: true, render: (r) => <StatusBadge label={r.method} tone={r.method === 'QR' ? 'info' : 'default'} /> },
    { key: 'by', header: 'By', hideOnMobile: true, render: (r) => r.checkedInBy },
  ];
  return (
    <>
      <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />
      <DataTable columns={columns} rows={q.data?.items ?? []} rowKey={(r) => r.id} loading={q.isLoading} total={q.data?.total ?? 0} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} emptyTitle="No check-ins yet" emptyBody="Check-ins appear here live as guests arrive." />
    </>
  );
}

function ManagersDialog({ event, open, onClose }: { event: EventItem; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: async () => (await api<{ items: TeamUser[] }>('/users')).items, enabled: open });
  const current = useQuery({ queryKey: ['managers', event.id], queryFn: async () => (await api<{ items: { id: string }[] }>(`/events/${event.id}/managers`)).items.map((m) => m.id), enabled: open });
  const [sel, setSel] = useState<string[] | null>(null);
  const save = useMutation({
    mutationFn: (userIds: string[]) => api(`/events/${event.id}/managers`, { method: 'PUT', body: { userIds } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['managers', event.id] });
      setSel(null);
      onClose();
    },
  });
  const value = sel ?? current.data ?? [];
  const eligible = (users.data ?? []).filter((u) => u.status === 'ACTIVE' && u.role !== 'CHECKIN_STAFF');
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Who can manage this event?</DialogTitle>
      <DialogContent>
        {save.error && <Alert severity="error" sx={{ mb: 1 }}>{save.error.message}</Alert>}
        <Typography variant="body2" color="text.secondary" mb={1}>Event managers can edit this event, its guests, passes and reports. Admins always can.</Typography>
        <Stack>
          {eligible.map((u) => (
            <FormControlLabel key={u.id} label={`${u.fullName || u.email} (${u.role === 'COMPANY_ADMIN' ? 'admin' : 'manager'})`}
              control={<Checkbox checked={value.includes(u.id)} onChange={(e) => setSel(e.target.checked ? [...value, u.id] : value.filter((x) => x !== u.id))} />} />
          ))}
          {eligible.length === 0 && !users.isLoading && <Typography color="text.secondary">Add event managers on the Team page first.</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={save.isPending} onClick={() => save.mutate(value)}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

function DetailsPanel({ event }: { event: EventItem }) {
  const rows: [string, string][] = [
    ['Event code', event.eventCode],
    ['Starts', formatDateTime(event.startDatetime)],
    ['Ends', formatDateTime(event.endDatetime)],
    ['Venue', [event.venueName, event.venueAddress].filter(Boolean).join(', ') || '-'],
    ['Capacity', event.capacity ? String(event.capacity) : 'Not set'],
    ['Guests with passes', String(event.guestCount)],
  ];
  return (
    <Grid container spacing={2}>
      <Grid item xs={12} md={7}>
        <Stack gap={1.5}>
          {event.description && <Typography whiteSpace="pre-wrap">{event.description}</Typography>}
          {rows.map(([k, v]) => (
            <Stack key={k} direction="row" gap={2}><Typography color="text.secondary" width={150} flexShrink={0}>{k}</Typography><Typography>{v}</Typography></Stack>
          ))}
        </Stack>
      </Grid>
    </Grid>
  );
}

const ACTIONS: { action: EventAction; label: string; icon: JSX.Element; from: string[]; destructive?: boolean; body: string }[] = [
  { action: 'publish', label: 'Publish', icon: <PublishIcon fontSize="small" />, from: ['DRAFT'], body: 'Publishing opens check-in and lets guests RSVP from their passes.' },
  { action: 'complete', label: 'Mark completed', icon: <DoneAllIcon fontSize="small" />, from: ['PUBLISHED', 'ONGOING'], body: 'Check-in will close for this event.' },
  { action: 'cancel', label: 'Cancel event', icon: <BlockIcon fontSize="small" />, from: ['DRAFT', 'PUBLISHED', 'ONGOING'], destructive: true, body: 'Check-in will be blocked for every pass. This cannot be undone.' },
  { action: 'archive', label: 'Archive', icon: <ArchiveIcon fontSize="small" />, from: ['COMPLETED', 'CANCELLED'], body: 'Archived events are hidden from active lists.' },
];

export function EventDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: me } = useMe();
  const q = useEvent(id);
  const act = useEventAction(id);
  const dup = useDuplicateEvent(id);
  const { toast, toastNode } = useToast();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [managers, setManagers] = useState(false);
  const [confirm, setConfirm] = useState<(typeof ACTIONS)[number] | null>(null);

  if (q.isLoading) return <Skeleton variant="rounded" height={200} />;
  if (q.error || !q.data) return <><ErrorAlert error={q.error ?? new Error('Event not found')} /><Button onClick={() => nav('/events')}>Back to events</Button></>;
  const e = q.data;
  const isStaff = me?.role === 'CHECKIN_STAFF';
  const isAdmin = me?.role === 'COMPANY_ADMIN';
  const canManage = !isStaff && !['COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(e.status);
  const tabs = isStaff ? ['checkins', 'details'] : ['overview', 'guests', 'checkins', 'details'];
  const tab = tabs.includes(params.get('tab') ?? '') ? params.get('tab')! : tabs[0]!;

  return (
    <>
      <PageHeader
        title={e.name}
        subtitle={<Stack direction="row" gap={1} alignItems="center" flexWrap="wrap"><EventStatusBadge status={e.status} /><span>{formatDateTime(e.startDatetime)}{e.venueName ? ` - ${e.venueName}` : ''}</span></Stack>}
        actions={
          <>
            {['PUBLISHED', 'ONGOING'].includes(e.status) && <Button variant="contained" startIcon={<QrCodeScannerIcon />} onClick={() => nav(`/checkin?eventId=${e.id}`)}>Open scanner</Button>}
            {!isStaff && (
              <>
                {canManage && <Button startIcon={<EditIcon />} onClick={() => setEditing(true)}>Edit</Button>}
                <Button aria-label="More actions" onClick={(ev) => setMenu(ev.currentTarget)}><MoreVertIcon /></Button>
                <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
                  {ACTIONS.filter((a) => a.from.includes(e.status)).map((a) => (
                    <MenuItem key={a.action} onClick={() => { setMenu(null); setConfirm(a); }}><ListItemIcon>{a.icon}</ListItemIcon>{a.label}</MenuItem>
                  ))}
                  <MenuItem onClick={() => { setMenu(null); dup.mutate(undefined, { onSuccess: (c) => { toast('Event duplicated as a draft'); nav(`/events/${c.id}`); }, onError: (er) => toast(errorMessage(er), 'error') }); }}>
                    <ListItemIcon><CopyIcon fontSize="small" /></ListItemIcon>Duplicate
                  </MenuItem>
                  {isAdmin && <MenuItem onClick={() => { setMenu(null); setManagers(true); }}><ListItemIcon><GroupIcon fontSize="small" /></ListItemIcon>Assign managers</MenuItem>}
                </Menu>
              </>
            )}
          </>
        }
      />
      <Tabs value={tab} onChange={(_, v: string) => setParams({ tab: v }, { replace: true })} variant="scrollable" scrollButtons="auto" sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        {tabs.map((t) => <Tab key={t} value={t} label={{ overview: 'Overview', guests: 'Guests & passes', checkins: 'Check-ins', details: 'Details' }[t]} />)}
      </Tabs>
      {tab === 'overview' && <EventOverview eventId={e.id} />}
      {tab === 'guests' && <TicketsPanel event={e} canWrite={!isStaff} />}
      {tab === 'checkins' && <CheckinsPanel eventId={e.id} />}
      {tab === 'details' && <DetailsPanel event={e} />}

      <EventFormDialog open={editing} event={e} onClose={() => setEditing(false)} />
      {isAdmin && <ManagersDialog event={e} open={managers} onClose={() => setManagers(false)} />}
      <ConfirmDialog
        open={!!confirm}
        title={`${confirm?.label ?? ''}?`}
        body={confirm?.body}
        confirmLabel={confirm?.label}
        destructive={confirm?.destructive}
        loading={act.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && act.mutate(confirm.action, { onSuccess: () => { setConfirm(null); toast('Event updated'); }, onError: (er) => { setConfirm(null); toast(errorMessage(er), 'error'); } })}
      />
      {toastNode}
    </>
  );
}
