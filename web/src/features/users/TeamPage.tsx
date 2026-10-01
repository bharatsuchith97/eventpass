import { useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import AddIcon from '@mui/icons-material/PersonAdd';
import { api } from '../../lib/api/client';
import { useMe } from '../../lib/auth/session';
import { errorMessage, formatDate } from '../../lib/utils/format';
import { userSchema } from '../../lib/validation/schemas';
import { ConfirmDialog, DataTable, ErrorAlert, PageHeader, StatusBadge, useToast, type Column } from '../../components/ui';
import { ROLE_LABELS, type Role, type TeamUser } from '../../types';
import { applyServerErrors } from '../auth/AuthPages';

interface NewUser { fullName: string; email: string; role: Role; password: string }
const ROLES = Object.keys(ROLE_LABELS) as Role[];

function AddUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, control, handleSubmit, formState: { errors }, setError, reset } = useForm<NewUser>({ resolver: zodResolver(userSchema), defaultValues: { fullName: '', email: '', role: 'CHECKIN_STAFF', password: '' } });
  const m = useMutation({
    mutationFn: (v: NewUser) => api('/users', { method: 'POST', body: v }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['users'] }); reset(); onClose(); },
    onError: (e) => applyServerErrors(e, setError),
  });
  return (
    <Dialog open={open} onClose={m.isPending ? undefined : onClose} maxWidth="xs" fullWidth>
      <form onSubmit={handleSubmit((v) => m.mutate(v))} noValidate>
        <DialogTitle>Add team member</DialogTitle>
        <DialogContent>
          <Stack gap={2} pt={1}>
            {m.error && <Alert severity="error">{m.error.message}</Alert>}
            <TextField label="Full name" autoFocus {...register('fullName')} error={!!errors.fullName} helperText={errors.fullName?.message} />
            <TextField label="Email" type="email" {...register('email')} error={!!errors.email} helperText={errors.email?.message} />
            <Controller control={control} name="role" render={({ field }) => (
              <TextField select label="Role" {...field}>{ROLES.map((r) => <MenuItem key={r} value={r}>{ROLE_LABELS[r]}</MenuItem>)}</TextField>
            )} />
            <TextField label="Temporary password" type="password" autoComplete="new-password" {...register('password')} error={!!errors.password} helperText={errors.password?.message ?? 'Share it securely; they can change it after signing in'} />
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={onClose} disabled={m.isPending}>Cancel</Button><Button type="submit" variant="contained" disabled={m.isPending}>Add member</Button></DialogActions>
      </form>
    </Dialog>
  );
}

export function TeamPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { toast, toastNode } = useToast();
  const [adding, setAdding] = useState(false);
  const [toggle, setToggle] = useState<TeamUser | null>(null);
  const q = useQuery({ queryKey: ['users'], queryFn: async () => (await api<{ items: TeamUser[] }>('/users')).items });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; role?: Role; status?: 'ACTIVE' | 'DISABLED' }) => api(`/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const columns: Column<TeamUser>[] = [
    { key: 'name', header: 'Name', render: (u) => <><b>{u.fullName || '-'}</b><br /><small>{u.email}</small></> },
    { key: 'role', header: 'Role', render: (u) => (
      <TextField select size="small" value={u.role} disabled={u.id === me?.id} onChange={(e) => update.mutate({ id: u.id, role: e.target.value as Role })} sx={{ minWidth: 170 }} inputProps={{ 'aria-label': `Role for ${u.email}` }}>
        {ROLES.map((r) => <MenuItem key={r} value={r}>{ROLE_LABELS[r]}</MenuItem>)}
      </TextField>
    ) },
    { key: 'status', header: 'Status', render: (u) => <StatusBadge label={u.status} tone={u.status === 'ACTIVE' ? 'success' : 'default'} /> },
    { key: 'since', header: 'Added', hideOnMobile: true, render: (u) => formatDate(u.createdAt) },
    { key: 'act', header: '', align: 'right', render: (u) => u.id !== me?.id && (
      <Button size="small" color={u.status === 'ACTIVE' ? 'error' : 'primary'} onClick={() => (u.status === 'ACTIVE' ? setToggle(u) : update.mutate({ id: u.id, status: 'ACTIVE' }))}>
        {u.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
      </Button>
    ) },
  ];
  return (
    <>
      <PageHeader title="Team" subtitle="Who can access your company workspace" actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>Add member</Button>} />
      <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />
      <DataTable columns={columns} rows={q.data ?? []} rowKey={(u) => u.id} loading={q.isLoading} />
      <AddUserDialog open={adding} onClose={() => setAdding(false)} />
      <ConfirmDialog
        open={!!toggle}
        title="Deactivate this account?"
        body={<>{toggle?.email} will be signed out immediately and will not be able to sign in.</>}
        confirmLabel="Deactivate"
        destructive
        loading={update.isPending}
        onClose={() => setToggle(null)}
        onConfirm={() => toggle && update.mutate({ id: toggle.id, status: 'DISABLED' }, { onSuccess: () => setToggle(null) })}
      />
      {toastNode}
    </>
  );
}
