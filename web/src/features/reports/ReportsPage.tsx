import { useState } from 'react';
import { Button, Chip, MenuItem, Stack, Tab, Tabs, TextField } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { useQuery } from '@tanstack/react-query';
import { api, download } from '../../lib/api/client';
import { errorMessage, formatDateTime } from '../../lib/utils/format';
import { DataTable, EmptyState, ErrorAlert, FilterBar, PageHeader, StatusBadge, useToast, type Column } from '../../components/ui';
import { useEvents } from '../events/api';
import type { Report } from '../../types';

type Row = Report['rows'][number];
const KINDS = [
  ['attendance', 'Attendance'],
  ['noshow', 'No-shows'],
  ['rsvp', 'RSVP'],
] as const;

export function ReportsPage() {
  const events = useEvents();
  const [eventId, setEventId] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>('attendance');
  const { toast, toastNode } = useToast();
  const q = useQuery({ queryKey: ['report', eventId, kind], queryFn: () => api<Report>(`/events/${eventId}/reports/${kind}`), enabled: !!eventId });
  const r = q.data;
  const columns: Column<Row>[] = (r?.columns ?? []).map((c) => ({
    key: c.key,
    header: c.label,
    render: (row) => {
      const v = row[c.key];
      if (c.key === 'checkedInAt' || c.key === 'rsvpAt') return formatDateTime(v as string | null);
      if (c.key === 'status') return <StatusBadge label={String(v)} tone={v === 'Checked in' ? 'success' : 'default'} />;
      if (c.key === 'rsvp') return <StatusBadge label={String(v)} tone={v === 'CONFIRMED' ? 'success' : v === 'DECLINED' ? 'error' : 'default'} />;
      return v ?? '-';
    },
  }));
  const chosen = events.data?.find((e) => e.id === eventId);
  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Attendance, no-shows and RSVPs"
        actions={eventId && <Button variant="contained" startIcon={<DownloadIcon />} onClick={() => download(`/events/${eventId}/reports/${kind}?format=csv`, `${kind}-report.csv`).catch((e: unknown) => toast(errorMessage(e), 'error'))}>Export CSV</Button>}
      />
      <FilterBar>
        <TextField select label="Event" value={eventId} onChange={(e) => setEventId(e.target.value)} sx={{ minWidth: 280, maxWidth: 400 }}>
          {(events.data ?? []).map((e) => <MenuItem key={e.id} value={e.id}>{e.name}</MenuItem>)}
        </TextField>
      </FilterBar>
      {!eventId ? (
        <EmptyState title="Choose an event" body="Pick an event above to see its reports." />
      ) : (
        <>
          <Tabs value={kind} onChange={(_, v: typeof kind) => setKind(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
            {KINDS.map(([k, l]) => <Tab key={k} value={k} label={l} />)}
          </Tabs>
          {r?.summary && (
            <Stack direction="row" gap={1} mb={2} flexWrap="wrap">
              {Object.entries(r.summary).map(([k, v]) => <Chip key={k} label={`${k.replace(/([A-Z])/g, ' $1')}: ${v}`} sx={{ textTransform: 'capitalize' }} />)}
            </Stack>
          )}
          <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />
          <DataTable columns={columns} rows={r?.rows ?? []} rowKey={(row) => String(row.ticket ?? row.guest) + String(row.email ?? '')} loading={q.isLoading} maxHeight={560} emptyTitle={kind === 'noshow' ? 'No no-shows' : 'No data yet'} emptyBody={chosen ? `Nothing to report for ${chosen.name} yet.` : undefined} />
        </>
      )}
      {toastNode}
    </>
  );
}
