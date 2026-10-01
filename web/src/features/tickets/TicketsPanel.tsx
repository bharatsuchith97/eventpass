import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Autocomplete, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import UploadIcon from '@mui/icons-material/UploadFile';
import SendIcon from '@mui/icons-material/Send';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import CancelIcon from '@mui/icons-material/Cancel';
import { download } from '../../lib/api/client';
import { errorMessage, formatTime, fullName } from '../../lib/utils/format';
import {
  CategoryChip, ConfirmDialog, DataTable, ErrorAlert, FilterBar, GuestAvatar, PassPreview, SearchField, StatusBadge, TicketStatusBadge, useToast, type Column,
} from '../../components/ui';
import { useSettings } from '../../lib/auth/session';
import type { EventItem, Guest, TicketRow } from '../../types';
import { useCancelTicket, useEventTickets, useGuestSearch, useIssueTickets, useReissue, useSendInvitations, type ReissuedPass } from './api';

const RSVP_TONE = { CONFIRMED: 'success', DECLINED: 'error', PENDING: 'default' } as const;

function AddGuestsDialog({ event, open, onClose }: { event: EventItem; open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Guest[]>([]);
  const [send, setSend] = useState(true);
  const opts = useGuestSearch(text);
  const issue = useIssueTickets(event.id);
  const { toast, toastNode } = useToast();
  const done = (r: { issued: number; invited: number }) => {
    toast(r.issued ? `${r.issued} pass${r.issued === 1 ? '' : 'es'} created${r.invited ? `, ${r.invited} invitation${r.invited === 1 ? '' : 's'} sent` : ''}` : 'Those guests already have passes');
    setPicked([]);
    onClose();
  };
  return (
    <>
      <Dialog open={open} onClose={issue.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
        <DialogTitle>Add guests and generate passes</DialogTitle>
        <DialogContent>
          <Stack gap={2} pt={1}>
            {issue.error && <Alert severity="error">{issue.error.message}</Alert>}
            <Autocomplete
              multiple
              options={opts.data ?? []}
              value={picked}
              loading={opts.isFetching}
              filterOptions={(o) => o}
              onChange={(_, v) => setPicked(v)}
              onInputChange={(_, v) => setText(v)}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              getOptionLabel={(g) => `${fullName(g)} (${g.email})`}
              renderInput={(p) => <TextField {...p} label="Search guests by name or email" />}
            />
            <FormControlLabel control={<Checkbox checked={send} onChange={(e) => setSend(e.target.checked)} />} label="Email the invitation with QR pass now" />
            <Typography variant="body2" color="text.secondary">
              Need to bring in a new list? Use <b>Import CSV</b> to validate and add many guests at once.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap' }}>
          <Button onClick={() => issue.mutate({ allGuests: true, send }, { onSuccess: done })} disabled={issue.isPending}>All guests without a pass</Button>
          <Box flexGrow={1} />
          <Button onClick={onClose} disabled={issue.isPending}>Cancel</Button>
          <Button variant="contained" disabled={picked.length === 0 || issue.isPending} onClick={() => issue.mutate({ guestIds: picked.map((g) => g.id), send }, { onSuccess: done })}>
            Generate {picked.length || ''} pass{picked.length === 1 ? '' : 'es'}
          </Button>
        </DialogActions>
      </Dialog>
      {toastNode}
    </>
  );
}

function PassDialog({ row, event, onClose }: { row: TicketRow | null; event: EventItem; onClose: () => void }) {
  const reissue = useReissue();
  const settings = useSettings();
  const [pass, setPass] = useState<ReissuedPass | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { toast, toastNode } = useToast();
  // Only the hash is stored, so viewing a pass issues a fresh QR (any earlier QR stops working).
  const generate = () => {
    if (!row) return;
    reissue.mutate(row.id, { onSuccess: setPass });
  };
  const close = () => {
    setPass(null);
    setErr(null);
    reissue.reset();
    onClose();
  };
  return (
    <>
      <Dialog open={!!row} onClose={close} maxWidth="xs" fullWidth>
        <DialogTitle>Digital pass</DialogTitle>
        <DialogContent>
          {!pass ? (
            <Stack gap={2}>
              <Alert severity="info">For security only a fingerprint of each QR is stored. Showing the pass issues a <b>fresh QR</b> and invalidates any previously sent one.</Alert>
              {reissue.error && <Alert severity="error">{reissue.error.message}</Alert>}
              <Button variant="contained" onClick={generate} disabled={reissue.isPending}>Show pass for {row ? fullName(row) : ''}</Button>
            </Stack>
          ) : (
            <Stack gap={2}>
              {err && <Alert severity="error">{err}</Alert>}
              <PassPreview
                pass={{
                  companyName: settings.data?.companyName ?? '',
                  eventName: event.name,
                  startDatetime: event.startDatetime,
                  venue: event.venueName,
                  guestName: row ? fullName(row) : '',
                  category: row?.category ?? 'ATTENDEE',
                  ticketNumber: pass.ticketNumber,
                  qrValue: pass.qrValue,
                  brandColor: settings.data?.primaryBrandColor,
                }}
              />
              <Stack direction="row" gap={1} flexWrap="wrap" justifyContent="center">
                <Button size="small" onClick={() => window.print()}>Print</Button>
                <Button size="small" onClick={() => void navigator.clipboard.writeText(pass.passUrl).then(() => toast('Guest pass link copied'))}>Copy guest link</Button>
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    setErr(null);
                    download(`/tickets/${pass.ticketId}/pass-pdf`, `pass-${pass.ticketNumber}.pdf`, { method: 'POST' })
                      .then(() => {
                        toast('PDF downloaded (contains a new QR; the one on screen is now retired)');
                        setPass(null);
                      })
                      .catch((e: unknown) => setErr(errorMessage(e)))
                      .finally(() => setBusy(false));
                  }}
                >
                  Download PDF
                </Button>
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions><Button onClick={close}>Close</Button></DialogActions>
      </Dialog>
      {toastNode}
    </>
  );
}

export function TicketsPanel({ event, canWrite }: { event: EventItem; canWrite: boolean }) {
  const nav = useNavigate();
  const [f, setF] = useState({ search: '', rsvp: '', checkedIn: '', page: 1, pageSize: 50 });
  const q = useEventTickets(event.id, f);
  const cancel = useCancelTicket(event.id);
  const invite = useSendInvitations(event.id);
  const [adding, setAdding] = useState(false);
  const [passRow, setPassRow] = useState<TicketRow | null>(null);
  const [cancelRow, setCancelRow] = useState<TicketRow | null>(null);
  const { toast, toastNode } = useToast();
  const closed = ['COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(event.status);

  const sendTo = (ids: string[] | undefined) =>
    invite.mutate(ids ? { ticketIds: ids } : { pendingOnly: true }, {
      onSuccess: (r) => toast(r.attempted === 0 ? 'Nobody is waiting for an invitation' : `${r.sent} invitation${r.sent === 1 ? '' : 's'} sent${r.failed ? `, ${r.failed} failed` : ''}`, r.failed ? 'error' : 'success'),
      onError: (e) => toast(errorMessage(e), 'error'),
    });

  const columns: Column<TicketRow>[] = [
    { key: 'guest', header: 'Guest', render: (r) => (
      <Stack direction="row" gap={1.5} alignItems="center">
        <GuestAvatar guest={r} size={32} />
        <Box minWidth={0}>
          <Typography variant="body2" fontWeight={600} noWrap>{fullName(r)}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap>{r.email}</Typography>
        </Box>
      </Stack>
    ) },
    { key: 'category', header: 'Category', hideOnMobile: true, render: (r) => <CategoryChip category={r.category} /> },
    { key: 'ticket', header: 'Ticket', hideOnMobile: true, render: (r) => <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{r.ticketNumber}</Typography> },
    { key: 'status', header: 'Status', render: (r) => <TicketStatusBadge status={r.status} /> },
    { key: 'rsvp', header: 'RSVP', hideOnMobile: true, render: (r) => <StatusBadge label={r.rsvpStatus} tone={RSVP_TONE[r.rsvpStatus]} /> },
    { key: 'invite', header: 'Invitation', hideOnMobile: true, render: (r) => <Typography variant="body2" color="text.secondary">{r.invitationStatus ? r.invitationStatus.toLowerCase() : 'not sent'}</Typography> },
    { key: 'checkin', header: 'Checked in', hideOnMobile: true, render: (r) => (r.checkedInAt ? `${formatTime(r.checkedInAt)}${r.gate ? ` (${r.gate})` : ''}` : '-') },
    { key: 'actions', header: '', align: 'right', render: (r) => canWrite && r.status === 'ACTIVE' && (
      <Stack direction="row" justifyContent="flex-end">
        <Tooltip title="Show pass"><IconButton size="small" onClick={() => setPassRow(r)} aria-label="Show pass"><QrCode2Icon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Email invitation"><span><IconButton size="small" disabled={invite.isPending || closed} onClick={() => sendTo([r.id])} aria-label="Send invitation"><SendIcon fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Cancel ticket"><IconButton size="small" onClick={() => setCancelRow(r)} aria-label="Cancel ticket"><CancelIcon fontSize="small" /></IconButton></Tooltip>
      </Stack>
    ) },
  ];

  return (
    <>
      <Stack direction={{ xs: 'column', xl: 'row' }} justifyContent="space-between" gap={1.5} mb={2}>
        <FilterBar>
          <SearchField placeholder="Search guests or ticket #" onChange={(search) => setF((p) => ({ ...p, search, page: 1 }))} />
          <TextField select label="RSVP" value={f.rsvp} onChange={(e) => setF((p) => ({ ...p, rsvp: e.target.value, page: 1 }))} sx={{ minWidth: 130 }}>
            <MenuItem value="">All</MenuItem><MenuItem value="PENDING">Pending</MenuItem><MenuItem value="CONFIRMED">Confirmed</MenuItem><MenuItem value="DECLINED">Declined</MenuItem>
          </TextField>
          <TextField select label="Check-in" value={f.checkedIn} onChange={(e) => setF((p) => ({ ...p, checkedIn: e.target.value, page: 1 }))} sx={{ minWidth: 140 }}>
            <MenuItem value="">All</MenuItem><MenuItem value="yes">Checked in</MenuItem><MenuItem value="no">Not checked in</MenuItem>
          </TextField>
        </FilterBar>
        {canWrite && !closed && (
          <Stack direction="row" gap={1} flexWrap="wrap" alignItems="flex-start">
            <Button startIcon={<UploadIcon />} onClick={() => nav(`/guests/import?eventId=${event.id}`)}>Import CSV</Button>
            <Button startIcon={<SendIcon />} disabled={invite.isPending} onClick={() => sendTo(undefined)}>Send pending invitations</Button>
            <Button variant="contained" startIcon={<PersonAddIcon />} onClick={() => setAdding(true)}>Add guests</Button>
          </Stack>
        )}
      </Stack>
      <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />
      <DataTable
        columns={columns}
        rows={q.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={q.isLoading}
        total={q.data?.total ?? 0}
        page={f.page}
        pageSize={f.pageSize}
        onPageChange={(page) => setF((p) => ({ ...p, page }))}
        onPageSizeChange={(pageSize) => setF((p) => ({ ...p, pageSize, page: 1 }))}
        emptyTitle={f.search || f.rsvp || f.checkedIn ? 'No guests match' : 'No guests have passes yet'}
        emptyBody={f.search || f.rsvp || f.checkedIn ? undefined : 'Add guests or import a CSV, then generate QR passes.'}
      />
      <AddGuestsDialog event={event} open={adding} onClose={() => setAdding(false)} />
      <PassDialog row={passRow} event={event} onClose={() => setPassRow(null)} />
      <ConfirmDialog
        open={!!cancelRow}
        title="Cancel this ticket?"
        body={cancelRow ? <>The QR pass for <b>{fullName(cancelRow)}</b> will stop working immediately.</> : null}
        confirmLabel="Cancel ticket"
        destructive
        loading={cancel.isPending}
        onClose={() => setCancelRow(null)}
        onConfirm={() => cancelRow && cancel.mutate(cancelRow.id, { onSuccess: () => { setCancelRow(null); toast('Ticket cancelled'); }, onError: (e) => toast(errorMessage(e), 'error') })}
      />
      {toastNode}
    </>
  );
}
