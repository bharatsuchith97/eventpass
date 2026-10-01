import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import UploadIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import { api, download, qs } from '../../lib/api/client';
import { errorMessage, fullName } from '../../lib/utils/format';
import { guestSchema, type GuestFormValues } from '../../lib/validation/schemas';
import { CategoryChip, ConfirmDialog, DataTable, ErrorAlert, FilterBar, GuestAvatar, MonoCell, NotesCell, PageHeader, SearchField, useToast, type Column } from '../../components/ui';
import { GUEST_CATEGORIES, type Guest, type Paged } from '../../types';
import { applyServerErrors } from '../auth/AuthPages';

function GuestDialog({ guest, open, onClose }: { guest?: Guest; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, control, handleSubmit, formState: { errors }, setError, reset } = useForm<GuestFormValues>({
    resolver: zodResolver(guestSchema),
    values: {
      externalId: guest?.externalId ?? '', firstName: guest?.firstName ?? '', lastName: guest?.lastName ?? '', email: guest?.email ?? '', phone: guest?.phone ?? '',
      companyName: guest?.companyName ?? '', category: guest?.category ?? 'ATTENDEE', notes: guest?.notes ?? '',
    },
  });
  const save = useMutation({
    mutationFn: (v: GuestFormValues) => {
      const body = { ...v, externalId: v.externalId.trim() || null, phone: v.phone.trim() || null, companyName: v.companyName.trim() || null, notes: v.notes.trim() || null };
      return guest ? api(`/guests/${guest.id}`, { method: 'PATCH', body }) : api('/guests', { method: 'POST', body });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['guests'] });
      void qc.invalidateQueries({ queryKey: ['guest-search'] });
      reset();
      onClose();
    },
    onError: (e) => applyServerErrors(e, setError),
  });
  return (
    <Dialog open={open} onClose={save.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
        <DialogTitle>{guest ? 'Edit guest' : 'Add guest'}</DialogTitle>
        <DialogContent>
          <Stack gap={2} pt={1}>
            {save.error && <Alert severity="error">{save.error.message}</Alert>}
            <TextField label="Guest ID (optional)" {...register('externalId')} error={!!errors.externalId} helperText={errors.externalId?.message ?? 'Your own reference, e.g. a member or registration number. Must be unique.'} />
            <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
              <TextField label="First name" autoFocus {...register('firstName')} error={!!errors.firstName} helperText={errors.firstName?.message} />
              <TextField label="Last name" {...register('lastName')} error={!!errors.lastName} helperText={errors.lastName?.message} />
            </Stack>
            <TextField label="Email" type="email" {...register('email')} error={!!errors.email} helperText={errors.email?.message} />
            <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
              <TextField label="Phone" {...register('phone')} error={!!errors.phone} helperText={errors.phone?.message} />
              <TextField label="Company" {...register('companyName')} error={!!errors.companyName} helperText={errors.companyName?.message} />
            </Stack>
            <Controller control={control} name="category" render={({ field }) => (
              <TextField select label="Category" {...field}>{GUEST_CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}</TextField>
            )} />
            <TextField label="Notes" multiline minRows={2} {...register('notes')} error={!!errors.notes} helperText={errors.notes?.message} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={save.isPending}>{guest ? 'Save' : 'Add guest'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export function GuestsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Guest | 'new' | null>(null);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const { toast, toastNode } = useToast();
  const q = useQuery({
    queryKey: ['guests', search, category, page, pageSize],
    queryFn: () => api<Paged<Guest>>(`/guests${qs({ search, category, page, pageSize })}`),
    placeholderData: (p) => p,
  });
  const del = useMutation({
    mutationFn: (ids: string[]) => api<{ deleted: number }>('/guests/bulk-delete', { method: 'POST', body: { ids } }),
    onSuccess: (r) => {
      toast(`${r.deleted} guest${r.deleted === 1 ? '' : 's'} deleted`);
      setDeleting(null);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['guests'] });
      void qc.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const rows = q.data?.items ?? [];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const columns: Column<Guest>[] = [
    { key: 'sel', header: '', width: 48, render: (g) => <Checkbox size="small" checked={selected.has(g.id)} onChange={() => toggle(g.id)} inputProps={{ 'aria-label': `Select ${fullName(g)}` }} /> },
    { key: 'xid', header: 'ID', render: (g) => <MonoCell value={g.externalId} /> },
    { key: 'name', header: 'Guest', render: (g) => (
      <Stack direction="row" gap={1.5} alignItems="center"><GuestAvatar guest={g} size={32} /><Box minWidth={0}><Typography variant="body2" fontWeight={600} noWrap>{fullName(g)}</Typography><Typography variant="caption" color="text.secondary" noWrap>{g.email}</Typography></Box></Stack>
    ) },
    { key: 'company', header: 'Company', hideOnMobile: true, render: (g) => g.companyName ?? '-' },
    { key: 'phone', header: 'Phone', hideOnMobile: true, render: (g) => g.phone ?? '-' },
    { key: 'cat', header: 'Category', render: (g) => <CategoryChip category={g.category} /> },
    { key: 'notes', header: 'Notes', hideOnMobile: true, render: (g) => <NotesCell text={g.notes} /> },
    { key: 'linked', header: 'Passes', hideOnMobile: true, render: (g) => (
      <Typography variant="body2" noWrap>{g.passes ?? 0} pass{g.passes === 1 ? '' : 'es'}<br /><Typography component="span" variant="caption" color="text.secondary">{g.checkIns ?? 0} check-in{g.checkIns === 1 ? '' : 's'}</Typography></Typography>
    ) },
    { key: 'act', header: '', align: 'right', render: (g) => (
      <Stack direction="row" justifyContent="flex-end">
        <IconButton size="small" aria-label={`Edit ${fullName(g)}`} onClick={() => setEditing(g)}><EditIcon fontSize="small" /></IconButton>
        <IconButton size="small" aria-label={`Delete ${fullName(g)}`} onClick={() => setDeleting([g.id])}><DeleteIcon fontSize="small" /></IconButton>
      </Stack>
    ) },
  ];

  return (
    <>
      <PageHeader
        title="Guests"
        subtitle="Everyone you can invite, across all events"
        actions={
          <>
            <Button startIcon={<DownloadIcon />} onClick={() => download('/guests/export.csv', 'guests.csv').catch((e: unknown) => toast(errorMessage(e), 'error'))}>Export guests</Button>
            <Button startIcon={<DownloadIcon />} onClick={() => download('/guests/export-full.csv', 'full-report.csv').catch((e: unknown) => toast(errorMessage(e), 'error'))}>Full report</Button>
            <Button startIcon={<UploadIcon />} onClick={() => nav('/guests/import')}>Import CSV</Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>Add guest</Button>
          </>
        }
      />
      <FilterBar>
        <SearchField placeholder="Search name, email, phone or ID" onChange={(v) => { setSearch(v); setPage(1); }} />
        <TextField select label="Category" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} sx={{ minWidth: 150, maxWidth: 200 }}>
          <MenuItem value="">All</MenuItem>
          {GUEST_CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
        </TextField>
        <Checkbox size="small" checked={allOnPage} indeterminate={!allOnPage && selected.size > 0} onChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))} inputProps={{ 'aria-label': 'Select all on page' }} />
        {selected.size > 0 && <Button color="error" startIcon={<DeleteIcon />} onClick={() => setDeleting([...selected])}>Delete {selected.size}</Button>}
      </FilterBar>
      <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(g) => g.id}
        loading={q.isLoading}
        total={q.data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        emptyTitle={search || category ? 'No guests match' : 'No guests yet'}
        emptyBody={search || category ? undefined : 'Add guests one by one or import a CSV.'}
        emptyAction={!search && !category ? <Button variant="contained" onClick={() => nav('/guests/import')}>Import CSV</Button> : undefined}
      />
      <GuestDialog open={editing !== null} guest={editing === 'new' ? undefined : (editing ?? undefined)} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        title={`Delete ${deleting?.length ?? 0} guest${deleting?.length === 1 ? '' : 's'}?`}
        body="They will be removed from your guest list and any unused passes will be cancelled. Past check-in history is kept."
        confirmLabel="Delete"
        destructive
        loading={del.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting)}
      />
      {toastNode}
    </>
  );
}
