import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { fromLocalInput, toLocalInput } from '../../lib/utils/format';
import { eventSchema, type EventFormValues } from '../../lib/validation/schemas';
import type { EventItem } from '../../types';
import { applyServerErrors } from '../auth/AuthPages';
import { useSaveEvent } from './api';

const defaults = (e?: EventItem): EventFormValues => {
  const start = new Date(Date.now() + 24 * 3600_000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 3 * 3600_000);
  return {
    name: e?.name ?? '',
    description: e?.description ?? '',
    venueName: e?.venueName ?? '',
    venueAddress: e?.venueAddress ?? '',
    startDatetime: toLocalInput(e?.startDatetime ?? start.toISOString()),
    endDatetime: toLocalInput(e?.endDatetime ?? end.toISOString()),
    capacity: e?.capacity ? String(e.capacity) : '',
    bannerUrl: e?.bannerUrl ?? '',
  };
};

export function EventFormDialog({ open, event, onClose, onSaved }: { open: boolean; event?: EventItem; onClose: () => void; onSaved?: (e: EventItem) => void }) {
  const save = useSaveEvent(event?.id);
  const { register, handleSubmit, formState: { errors }, setError, reset } = useForm<EventFormValues>({ resolver: zodResolver(eventSchema), values: defaults(event) });
  const close = () => {
    save.reset();
    reset();
    onClose();
  };
  const submit = handleSubmit((v) =>
    save.mutate(
      {
        name: v.name,
        description: v.description,
        venueName: v.venueName,
        venueAddress: v.venueAddress,
        startDatetime: fromLocalInput(v.startDatetime),
        endDatetime: fromLocalInput(v.endDatetime),
        capacity: v.capacity ? Number(v.capacity) : null,
        bannerUrl: v.bannerUrl,
      },
      {
        onSuccess: (e) => {
          onSaved?.(e);
          close();
        },
        onError: (e) => applyServerErrors(e, setError),
      },
    ),
  );
  return (
    <Dialog open={open} onClose={save.isPending ? undefined : close} maxWidth="sm" fullWidth>
      <form onSubmit={submit} noValidate>
        <DialogTitle>{event ? 'Edit event' : 'New event'}</DialogTitle>
        <DialogContent>
          <Stack gap={2} pt={1}>
            {save.error && <Alert severity="error">{save.error.message}</Alert>}
            <TextField label="Event name" autoFocus {...register('name')} error={!!errors.name} helperText={errors.name?.message} />
            <TextField label="Description" multiline minRows={2} {...register('description')} error={!!errors.description} helperText={errors.description?.message} />
            <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
              <TextField label="Starts" type="datetime-local" InputLabelProps={{ shrink: true }} {...register('startDatetime')} error={!!errors.startDatetime} helperText={errors.startDatetime?.message} />
              <TextField label="Ends" type="datetime-local" InputLabelProps={{ shrink: true }} {...register('endDatetime')} error={!!errors.endDatetime} helperText={errors.endDatetime?.message} />
            </Stack>
            <TextField label="Venue name" {...register('venueName')} error={!!errors.venueName} helperText={errors.venueName?.message} />
            <TextField label="Venue address" {...register('venueAddress')} error={!!errors.venueAddress} helperText={errors.venueAddress?.message} />
            <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
              <TextField label="Capacity" inputMode="numeric" {...register('capacity')} error={!!errors.capacity} helperText={errors.capacity?.message ?? 'Optional'} />
              <TextField label="Banner image URL" {...register('bannerUrl')} error={!!errors.bannerUrl} helperText={errors.bannerUrl?.message ?? 'Optional, https only'} />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={save.isPending}>{event ? 'Save changes' : 'Create event'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
