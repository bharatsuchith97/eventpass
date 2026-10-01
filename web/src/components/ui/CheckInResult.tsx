import { useEffect } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import { formatTime, fullName } from '../../lib/utils/format';
import type { CheckInSuccess, Guestish } from '../../types';

export type ScanOutcome =
  | { kind: 'success'; data: CheckInSuccess }
  | { kind: 'error'; code: string; message: string; guest?: Guestish; checkedInAt?: string; gate?: string | null };

const TITLES: Record<string, string> = {
  INVALID_TICKET: 'Invalid ticket',
  TICKET_EXPIRED: 'Ticket expired',
  TICKET_CANCELLED: 'Ticket cancelled',
  TICKET_ALREADY_USED: 'Already checked in',
  EVENT_NOT_ACTIVE: 'Check-in not open',
};

function beep(ok: boolean): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.08;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.12 : 0.4));
    o.onended = () => void ctx.close();
  } catch {
    /* sound is a nicety only */
  }
  navigator.vibrate?.(ok ? 60 : [120, 60, 120]);
}

/** Full-screen, high-contrast result: green = let them in, amber = already used, red = do not admit. */
export function CheckInResult({ outcome, onDismiss }: { outcome: ScanOutcome; onDismiss: () => void }) {
  const success = outcome.kind === 'success';
  const warn = outcome.kind === 'error' && outcome.code === 'TICKET_ALREADY_USED';
  useEffect(() => {
    beep(success);
    if (!success) return;
    const t = setTimeout(onDismiss, 2500);
    return () => clearTimeout(t);
  }, [success, onDismiss]);

  const bg = success ? '#2e7d32' : warn ? '#ed6c02' : '#c62828';
  const Icon = success ? CheckCircleIcon : warn ? WarningIcon : ErrorIcon;
  const guest = outcome.kind === 'success' ? outcome.data.guest : outcome.guest;

  return (
    <Box
      role="alert"
      aria-live="assertive"
      onClick={onDismiss}
      sx={{ position: 'fixed', inset: 0, zIndex: 2000, bgcolor: bg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3, textAlign: 'center', cursor: 'pointer' }}
    >
      <Stack alignItems="center" gap={2} maxWidth={520}>
        <Icon sx={{ fontSize: 120 }} />
        <Typography variant="h3" fontWeight={800}>
          {success ? 'Welcome!' : (TITLES[outcome.code] ?? 'Not valid')}
        </Typography>
        {guest && (
          <>
            <Typography variant="h4" fontWeight={700}>{fullName(guest)}</Typography>
            <Typography variant="h6" sx={{ opacity: 0.95 }}>
              {guest.category}{guest.companyName ? ` - ${guest.companyName}` : ''}
            </Typography>
          </>
        )}
        {outcome.kind === 'success' && <Typography sx={{ opacity: 0.9 }}>Checked in at {formatTime(outcome.data.checkedInAt)}</Typography>}
        {outcome.kind === 'error' && (
          <Typography variant="h6">
            {outcome.message}
            {outcome.checkedInAt ? ` at ${formatTime(outcome.checkedInAt)}` : ''}
            {outcome.gate ? ` (${outcome.gate})` : ''}
          </Typography>
        )}
        <Button variant="contained" color="inherit" sx={{ color: bg, mt: 2, minWidth: 200 }} size="large" onClick={onDismiss}>
          {success ? 'Next guest' : 'Dismiss'}
        </Button>
      </Stack>
    </Box>
  );
}
