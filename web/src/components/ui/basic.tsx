import { useEffect, useState, type ReactNode } from 'react';
import {
  Alert, Avatar, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  InputAdornment, Skeleton, Stack, TextField, Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { EVENT_STATUS_COLOR, initials, TICKET_STATUS_COLOR } from '../../lib/utils/format';
import type { EventStatus, GuestCategory, TicketStatus } from '../../types';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={2} mb={3}>
      <Box minWidth={0}>
        <Typography variant="h4" component="h1" fontWeight={700} sx={{ maxWidth: '100%', overflowWrap: 'anywhere' }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography color="text.secondary" component="div">
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && <Stack direction="row" gap={1} flexWrap="wrap">{actions}</Stack>}
    </Stack>
  );
}

type Tone = 'default' | 'info' | 'success' | 'warning' | 'error' | 'primary' | 'secondary';
export function StatusBadge({ label, tone = 'default' }: { label: string; tone?: Tone }) {
  return <Chip size="small" label={label} color={tone} variant={tone === 'default' ? 'outlined' : 'filled'} sx={{ fontWeight: 600 }} />;
}
export const EventStatusBadge = ({ status }: { status: EventStatus }) => <StatusBadge label={status} tone={EVENT_STATUS_COLOR[status]} />;
export const TicketStatusBadge = ({ status }: { status: TicketStatus }) => <StatusBadge label={status} tone={TICKET_STATUS_COLOR[status]} />;

export function StatCard({ label, value, hint, color, loading }: { label: string; value: ReactNode; hint?: ReactNode; color?: string; loading?: boolean }) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h4" fontWeight={700} color={color}>
          {loading ? <Skeleton width={60} /> : value}
        </Typography>
        {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
      </CardContent>
    </Card>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <Stack alignItems="center" textAlign="center" gap={1.5} py={6} px={2} color="text.secondary">
      {icon}
      <Typography variant="h6" color="text.primary">
        {title}
      </Typography>
      {body && <Typography maxWidth={420}>{body}</Typography>}
      {action}
    </Stack>
  );
}

export function ErrorAlert({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <Alert severity="error" action={onRetry && <Button color="inherit" size="small" onClick={onRetry}>Retry</Button>} sx={{ mb: 2 }}>
      {error instanceof Error ? error.message : 'Something went wrong'}
    </Alert>
  );
}

export function ConfirmDialog({
  open, title, body, confirmLabel = 'Confirm', destructive, loading, onConfirm, onClose,
}: {
  open: boolean; title: string; body: ReactNode; confirmLabel?: string; destructive?: boolean; loading?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText component="div">{body}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Button variant="contained" color={destructive ? 'error' : 'primary'} onClick={onConfirm} disabled={loading}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Debounced search input; calls onChange 300ms after the user stops typing. */
export function SearchField({ onChange, placeholder = 'Search', autoFocus }: { onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const [v, setV] = useState('');
  useEffect(() => {
    const t = setTimeout(() => onChange(v.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return (
    <TextField
      size="small"
      value={v}
      autoFocus={autoFocus}
      onChange={(e) => setV(e.target.value)}
      placeholder={placeholder}
      inputProps={{ 'aria-label': placeholder }}
      InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
      sx={{ minWidth: { xs: '100%', sm: 280 } }}
    />
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5} mb={2} alignItems={{ sm: 'center' }} flexWrap="wrap">{children}</Stack>;
}

const CATEGORY_COLOR: Record<GuestCategory, string> = {
  VIP: '#b8860b', SPEAKER: '#6a1b9a', SPONSOR: '#00695c', STAFF: '#455a64', ATTENDEE: '#1565c0', FAMILY: '#ad1457', OTHER: '#616161',
};
export function GuestAvatar({ guest, size = 36 }: { guest: { firstName: string; lastName: string; category?: GuestCategory }; size?: number }) {
  return (
    <Avatar sx={{ width: size, height: size, fontSize: size * 0.4, bgcolor: CATEGORY_COLOR[guest.category ?? 'OTHER'] }}>{initials(guest)}</Avatar>
  );
}
export const CategoryChip = ({ category }: { category: GuestCategory }) => (
  <Chip size="small" label={category} sx={{ bgcolor: CATEGORY_COLOR[category], color: '#fff', fontWeight: 600 }} />
);
