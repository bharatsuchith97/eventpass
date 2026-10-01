import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Grid, MenuItem, Skeleton, TextField } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EventIcon from '@mui/icons-material/Event';
import { useMe } from '../../lib/auth/session';
import { EmptyState, ErrorAlert, EventCard, FilterBar, PageHeader, SearchField } from '../../components/ui';
import { EventFormDialog } from './EventFormDialog';
import { useEvents } from './api';

const STATUSES = ['DRAFT', 'PUBLISHED', 'ONGOING', 'COMPLETED', 'CANCELLED', 'ARCHIVED'];

export function EventsPage() {
  const { data: me } = useMe();
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useEvents({ search, status });
  const canCreate = me?.role !== 'CHECKIN_STAFF';

  return (
    <>
      <PageHeader
        title="Events"
        subtitle={me?.role === 'CHECKIN_STAFF' ? 'Events open for check-in' : 'Create and manage your events'}
        actions={canCreate && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>New event</Button>}
      />
      <FilterBar>
        <SearchField placeholder="Search events" onChange={setSearch} />
        {canCreate && (
          <TextField select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 160, maxWidth: 200 }}>
            <MenuItem value="">All</MenuItem>
            {STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </TextField>
        )}
      </FilterBar>
      <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />
      {q.isLoading ? (
        <Grid container spacing={2}>{[0, 1, 2].map((i) => <Grid item xs={12} sm={6} lg={4} key={i}><Skeleton variant="rounded" height={190} /></Grid>)}</Grid>
      ) : q.data && q.data.length > 0 ? (
        <Grid container spacing={2}>
          {q.data.map((e) => (
            <Grid item xs={12} sm={6} lg={4} key={e.id}>
              <EventCard event={e} onClick={() => nav(`/events/${e.id}`)} />
            </Grid>
          ))}
        </Grid>
      ) : (
        !q.error && (
          <EmptyState
            icon={<EventIcon sx={{ fontSize: 56 }} />}
            title={search || status ? 'No events match your filters' : 'No events yet'}
            body={canCreate ? 'Create your first event, then import guests and issue QR passes.' : 'No events are open for check-in right now.'}
            action={canCreate && !search && !status ? <Button variant="contained" onClick={() => setCreating(true)}>Create event</Button> : undefined}
          />
        )
      )}
      <EventFormDialog open={creating} onClose={() => setCreating(false)} onSaved={(e) => nav(`/events/${e.id}`)} />
    </>
  );
}
