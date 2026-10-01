import { useParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import { setDisplayTimezone } from '../../lib/utils/format';
import { PassPreview } from '../../components/ui';
import type { PublicPass } from '../../types';

/** Guest-facing pass (no login). Shows only what a guest needs: their pass, event info and RSVP. */
export function PublicPassPage() {
  const { slug = '', token = '' } = useParams();
  const qc = useQueryClient();
  setDisplayTimezone(undefined);
  const key = ['public-pass', slug, token];
  const q = useQuery({ queryKey: key, queryFn: () => api<PublicPass>(`/public/pass/${slug}/${token}`), retry: false });
  const rsvp = useMutation({
    mutationFn: (response: 'CONFIRMED' | 'DECLINED') => api<{ rsvpStatus: PublicPass['rsvpStatus'] }>(`/public/pass/${slug}/${token}/rsvp`, { method: 'POST', body: { response } }),
    onSuccess: (r) => qc.setQueryData<PublicPass>(key, (p) => (p ? { ...p, rsvpStatus: r.rsvpStatus } : p)),
  });

  if (q.isLoading) return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}><CircularProgress /></Box>;
  if (q.error || !q.data) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', p: 2 }}>
        <Alert severity="error" sx={{ maxWidth: 420 }}>
          This pass link is not valid or is no longer active. If you received a newer email, please use the link in that one.
        </Alert>
      </Box>
    );
  }
  const p = q.data;
  const usable = p.status === 'ACTIVE';
  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'grey.100', p: 2, py: 4 }}>
      <Stack gap={3} alignItems="center">
        {!usable && <Alert severity={p.status === 'USED' ? 'success' : 'warning'} sx={{ maxWidth: 340, width: '100%' }}>{p.status === 'USED' ? 'This pass has been used to check in.' : `This pass is ${p.status.toLowerCase()}.`}</Alert>}
        <Box sx={{ opacity: usable ? 1 : 0.5, width: '100%' }}>
          <PassPreview
            pass={{
              companyName: p.companyName, eventName: p.eventName, startDatetime: p.startDatetime,
              venue: [p.venueName, p.venueAddress].filter(Boolean).join(', '),
              guestName: `${p.firstName} ${p.lastName}`, category: p.category, ticketNumber: p.ticketNumber,
              qrValue: `${window.location.origin}/checkin/${token}`, brandColor: p.brandColor,
            }}
          />
        </Box>
        {usable && ['PUBLISHED', 'ONGOING'].includes(p.eventStatus) && (
          <Stack gap={1.5} alignItems="center" width="100%" maxWidth={340}>
            <Typography fontWeight={700}>Will you attend?</Typography>
            {rsvp.error && <Alert severity="error" sx={{ width: '100%' }}>{rsvp.error.message}</Alert>}
            <Stack direction="row" gap={1} width="100%">
              <Button fullWidth variant={p.rsvpStatus === 'CONFIRMED' ? 'contained' : 'outlined'} color="success" disabled={rsvp.isPending} onClick={() => rsvp.mutate('CONFIRMED')}>Yes, I'll be there</Button>
              <Button fullWidth variant={p.rsvpStatus === 'DECLINED' ? 'contained' : 'outlined'} color="error" disabled={rsvp.isPending} onClick={() => rsvp.mutate('DECLINED')}>Can't make it</Button>
            </Stack>
            {p.rsvpStatus !== 'PENDING' && <Typography variant="body2" color="text.secondary">Your response: {p.rsvpStatus === 'CONFIRMED' ? 'attending' : 'not attending'}. You can change it any time.</Typography>}
          </Stack>
        )}
        <Button onClick={() => window.print()} sx={{ '@media print': { display: 'none' } }}>Print or save as PDF</Button>
      </Stack>
    </Box>
  );
}
