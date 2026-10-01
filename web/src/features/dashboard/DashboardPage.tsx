import { useNavigate } from 'react-router-dom';
import { Button, Grid, Skeleton, Typography } from '@mui/material';
import EventIcon from '@mui/icons-material/Event';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import { useMe } from '../../lib/auth/session';
import { EmptyState, ErrorAlert, EventCard, PageHeader, StatCard } from '../../components/ui';
import type { EventItem } from '../../types';

export function DashboardPage() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const q = useQuery({
    queryKey: ['events', 'dashboard'],
    queryFn: async () => (await api<{ items: EventItem[] }>('/events')).items,
    refetchInterval: 15_000,
  });
  const events = q.data ?? [];
  const live = events.filter((e) => e.status === 'ONGOING' || e.status === 'PUBLISHED');
  const totals = events.filter((e) => !['CANCELLED', 'ARCHIVED'].includes(e.status)).reduce((a, e) => ({ guests: a.guests + e.guestCount, checked: a.checked + e.checkedInCount }), { guests: 0, checked: 0 });
  const upcoming = [...live].sort((a, b) => +new Date(a.startDatetime) - +new Date(b.startDatetime));

  return (
    <>
      <PageHeader
        title={`Welcome${me?.fullName ? `, ${me.fullName.split(' ')[0]}` : ''}`}
        subtitle="Live view of your events"
        actions={<Button variant="contained" onClick={() => nav('/events')}>Manage events</Button>}
      />
      <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />
      <Grid container spacing={2} mb={4}>
        <Grid item xs={6} md={3}><StatCard label="Open events" value={live.length} loading={q.isLoading} /></Grid>
        <Grid item xs={6} md={3}><StatCard label="Guests with passes" value={totals.guests} loading={q.isLoading} /></Grid>
        <Grid item xs={6} md={3}><StatCard label="Checked in" value={totals.checked} color="success.main" loading={q.isLoading} /></Grid>
        <Grid item xs={6} md={3}><StatCard label="Attendance" value={totals.guests ? `${Math.round((totals.checked / totals.guests) * 100)}%` : '-'} loading={q.isLoading} /></Grid>
      </Grid>
      <Typography variant="h6" fontWeight={700} mb={2}>Published and live events</Typography>
      {q.isLoading ? (
        <Skeleton variant="rounded" height={180} />
      ) : upcoming.length ? (
        <Grid container spacing={2}>
          {upcoming.map((e) => <Grid item xs={12} sm={6} lg={4} key={e.id}><EventCard event={e} onClick={() => nav(`/events/${e.id}`)} /></Grid>)}
        </Grid>
      ) : (
        !q.error && (
          <EmptyState
            icon={<EventIcon sx={{ fontSize: 56 }} />}
            title={events.length ? 'No published events' : 'Create your first event'}
            body={events.length ? 'Publish a draft event to open check-in and RSVPs.' : 'Then import your guest list, generate QR passes and email invitations.'}
            action={<Button variant="contained" onClick={() => nav('/events')}>{events.length ? 'View events' : 'Create event'}</Button>}
          />
        )
      )}
    </>
  );
}
