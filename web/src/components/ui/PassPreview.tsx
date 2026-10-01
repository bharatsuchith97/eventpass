import { Box, Stack, Typography } from '@mui/material';
import { formatDateTime } from '../../lib/utils/format';
import { QRCode } from './QRCode';
import { CategoryChip } from './basic';
import type { GuestCategory } from '../../types';

export interface PassData {
  companyName: string;
  eventName: string;
  startDatetime: string;
  venue: string;
  guestName: string;
  category: GuestCategory;
  ticketNumber: string;
  qrValue: string;
  brandColor?: string;
  logoUrl?: string | null;
  note?: string;
}

/** Digital pass card. Used for the admin preview and the guest's public pass page. */
export function PassPreview({ pass }: { pass: PassData }) {
  return (
    <Box sx={{ width: '100%', maxWidth: 340, mx: 'auto', borderRadius: 3, overflow: 'hidden', boxShadow: 3, bgcolor: 'background.paper', border: 1, borderColor: 'divider' }}>
      <Box sx={{ bgcolor: pass.brandColor ?? 'primary.main', color: '#fff', p: 2.5, textAlign: 'center' }}>
        {pass.logoUrl && (
          // White plate so any logo reads well on any brand colour.
          <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#fff', borderRadius: 2, px: 1.5, py: 1, mb: 1.5, maxWidth: '80%' }}>
            <Box component="img" src={pass.logoUrl} alt={pass.companyName} sx={{ display: 'block', maxHeight: 48, maxWidth: '100%', objectFit: 'contain' }} />
          </Box>
        )}
        <Typography variant="overline" component="div" sx={{ opacity: 0.85, letterSpacing: 1.5 }}>{pass.companyName}</Typography>
        <Typography variant="h5" fontWeight={700} lineHeight={1.2}>{pass.eventName}</Typography>
        <Typography variant="body2" sx={{ opacity: 0.9, mt: 0.5 }}>{formatDateTime(pass.startDatetime)}</Typography>
        {pass.venue && <Typography variant="body2" sx={{ opacity: 0.9 }}>{pass.venue}</Typography>}
      </Box>
      <Stack alignItems="center" gap={1.5} p={3}>
        <Box sx={{ p: 1, bgcolor: '#fff', borderRadius: 2, border: 1, borderColor: 'divider' }}>
          <QRCode value={pass.qrValue} size={210} />
        </Box>
        <Typography variant="h6" fontWeight={700}>{pass.guestName}</Typography>
        <Stack direction="row" gap={1} alignItems="center">
          <CategoryChip category={pass.category} />
          <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{pass.ticketNumber}</Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" textAlign="center">
          {pass.note ?? 'Show this QR code at the entrance. One entry per pass.'}
        </Typography>
      </Stack>
    </Box>
  );
}
