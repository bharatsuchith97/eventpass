import { Box, Card, CardActionArea, CardContent, LinearProgress, Stack, Typography } from '@mui/material';
import PlaceIcon from '@mui/icons-material/Place';
import EventIcon from '@mui/icons-material/Event';
import { formatDateTime } from '../../lib/utils/format';
import type { EventItem } from '../../types';
import { EventStatusBadge } from './basic';

export function EventCard({ event, onClick }: { event: EventItem; onClick: () => void }) {
  const pct = event.guestCount ? Math.round((event.checkedInCount / event.guestCount) * 100) : 0;
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardActionArea onClick={onClick} sx={{ height: '100%', alignItems: 'stretch', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
        {event.bannerUrl ? (
          <Box component="img" src={event.bannerUrl} alt="" referrerPolicy="no-referrer" sx={{ width: '100%', height: 110, objectFit: 'cover' }} />
        ) : (
          <Box sx={{ height: 8, bgcolor: 'primary.main' }} />
        )}
        <CardContent sx={{ width: '100%' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
            <Typography variant="h6" fontWeight={700} lineHeight={1.25}>{event.name}</Typography>
            <EventStatusBadge status={event.status} />
          </Stack>
          <Stack gap={0.5} mt={1.5} color="text.secondary">
            <Stack direction="row" gap={1} alignItems="center"><EventIcon fontSize="small" /><Typography variant="body2">{formatDateTime(event.startDatetime)}</Typography></Stack>
            {event.venueName && <Stack direction="row" gap={1} alignItems="center"><PlaceIcon fontSize="small" /><Typography variant="body2" noWrap>{event.venueName}</Typography></Stack>}
          </Stack>
          <Box mt={2}>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="caption" color="text.secondary">{event.guestCount} guests{event.capacity ? ` / ${event.capacity}` : ''}</Typography>
              <Typography variant="caption" color="text.secondary">{event.checkedInCount} checked in</Typography>
            </Stack>
            <LinearProgress variant="determinate" value={pct} sx={{ mt: 0.5, height: 6, borderRadius: 3 }} />
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
