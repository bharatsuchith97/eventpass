import { useState } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import {
  Alert, AppBar, Box, Button, CircularProgress, Container, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, Tab, Tabs,
  TextField, Toolbar, Typography,
} from '@mui/material';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api, ApiError, qs } from '../../lib/api/client';
import { errorMessage, formatDate, formatDateTime } from '../../lib/utils/format';
import { loginSchema } from '../../lib/validation/schemas';
import { ConfirmDialog, DataTable, ErrorAlert, PageHeader, StatusBadge, useToast, type Column } from '../../components/ui';
import type { CompanyRequest, CompanyRequestStatus, PlatformAdmin, PlatformCompany, Plan } from '../../types';
import { applyServerErrors, AuthLayout } from '../auth/AuthPages';

const ADMIN_ME_KEY = ['admin', 'me'] as const;

/** Superadmin session (separate cookie from company sessions). */
function useAdminMe() {
  return useQuery({
    queryKey: ADMIN_ME_KEY,
    queryFn: async (): Promise<PlatformAdmin | null> => {
      try {
        return (await api<{ admin: PlatformAdmin }>('/admin/me')).admin;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
  });
}

const Loading = () => (
  <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60dvh' }}>
    <CircularProgress />
  </Box>
);

/** UX-only guard. Every /api/admin endpoint checks the superadmin session itself. */
export function RequireSuperadmin() {
  const { data: admin, isLoading } = useAdminMe();
  if (isLoading) return <Loading />;
  if (!admin) return <Navigate to="/admin/login" replace />;
  return <Outlet />;
}

export function AdminLoginPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data: admin, isLoading } = useAdminMe();
  const { register, handleSubmit, formState: { errors }, setError } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  const m = useMutation({
    mutationFn: (v: { email: string; password: string }) => api<{ admin: PlatformAdmin }>('/admin/login', { method: 'POST', body: v }),
    onSuccess: ({ admin: a }) => {
      qc.setQueryData(ADMIN_ME_KEY, a);
      nav('/admin', { replace: true });
    },
    onError: (e) => applyServerErrors(e, setError),
  });
  if (isLoading) return <Loading />;
  if (admin) return <Navigate to="/admin" replace />;
  return (
    <AuthLayout title="Platform admin" subtitle="Approve company accounts and manage the platform.">
      <Stack component="form" gap={2} onSubmit={handleSubmit((v) => m.mutate(v))} noValidate>
        {m.error && <Alert severity="error">{m.error.message}</Alert>}
        <TextField label="Email" type="email" autoComplete="username" autoFocus {...register('email')} error={!!errors.email} helperText={errors.email?.message} />
        <TextField label="Password" type="password" autoComplete="current-password" {...register('password')} error={!!errors.password} helperText={errors.password?.message} />
        <Button type="submit" variant="contained" size="large" disabled={m.isPending}>{m.isPending ? 'Signing in...' : 'Sign in'}</Button>
      </Stack>
    </AuthLayout>
  );
}

function RejectDialog({ request, onClose, onDone }: { request: CompanyRequest | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/admin/requests/${request!.id}/reject`, { method: 'POST', body: { reason: reason.trim() || undefined } }),
    onSuccess: () => { setReason(''); onDone(); },
  });
  return (
    <Dialog open={!!request} onClose={m.isPending ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Reject {request?.companyName}?</DialogTitle>
      <DialogContent>
        <Stack gap={2} pt={1}>
          {m.error && <Alert severity="error">{m.error.message}</Alert>}
          <Typography color="text.secondary">{request?.email} will be emailed that the request was not approved. They can apply again later.</Typography>
          <TextField label="Reason (optional, included in the email)" multiline minRows={2} value={reason} onChange={(e) => setReason(e.target.value)} inputProps={{ maxLength: 500 }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={m.isPending}>Cancel</Button>
        <Button variant="contained" color="error" onClick={() => m.mutate()} disabled={m.isPending}>Reject</Button>
      </DialogActions>
    </Dialog>
  );
}

function RequestsTab() {
  const qc = useQueryClient();
  const { toast, toastNode } = useToast();
  const [status, setStatus] = useState<CompanyRequestStatus>('PENDING');
  const [approving, setApproving] = useState<CompanyRequest | null>(null);
  const [rejecting, setRejecting] = useState<CompanyRequest | null>(null);
  const q = useQuery({ queryKey: ['admin', 'requests', status], queryFn: async () => (await api<{ items: CompanyRequest[] }>(`/admin/requests${qs({ status })}`)).items });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin'] });
  const approve = useMutation({
    mutationFn: (r: CompanyRequest) => api(`/admin/requests/${r.id}/approve`, { method: 'POST' }),
    onSuccess: (_d, r) => { setApproving(null); refresh(); toast(`${r.companyName} approved. ${r.email} has been emailed.`); },
    onError: (e) => { setApproving(null); refresh(); toast(errorMessage(e), 'error'); },
  });
  const columns: Column<CompanyRequest>[] = [
    { key: 'company', header: 'Company', render: (r) => <b>{r.companyName}</b> },
    { key: 'who', header: 'Requested by', render: (r) => <>{r.fullName}<br /><small>{r.email}</small></> },
    { key: 'when', header: 'Requested', hideOnMobile: true, render: (r) => formatDateTime(r.createdAt) },
    ...(status === 'PENDING'
      ? [{ key: 'act', header: '', align: 'right' as const, render: (r: CompanyRequest) => (
          <Stack direction="row" gap={1} justifyContent="flex-end">
            <Button size="small" color="error" onClick={() => setRejecting(r)}>Reject</Button>
            <Button size="small" variant="contained" onClick={() => setApproving(r)}>Approve</Button>
          </Stack>
        ) }]
      : [
          { key: 'decided', header: 'Decided', render: (r: CompanyRequest) => <>{formatDateTime(r.decidedAt)}<br /><small>{r.decidedBy ?? ''}</small></> },
          ...(status === 'REJECTED' ? [{ key: 'reason', header: 'Reason', render: (r: CompanyRequest) => r.rejectReason ?? '-' }] : []),
        ]),
  ];
  return (
    <>
      <TextField select size="small" label="Show" value={status} onChange={(e) => setStatus(e.target.value as CompanyRequestStatus)} sx={{ mb: 2, minWidth: 180 }}>
        <MenuItem value="PENDING">Waiting for approval</MenuItem>
        <MenuItem value="APPROVED">Approved</MenuItem>
        <MenuItem value="REJECTED">Rejected</MenuItem>
      </TextField>
      <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />
      <DataTable
        columns={columns}
        rows={q.data ?? []}
        rowKey={(r) => r.id}
        loading={q.isLoading}
        emptyTitle={status === 'PENDING' ? 'No requests waiting' : 'Nothing here yet'}
        emptyBody={status === 'PENDING' ? 'New company signups will appear here for you to approve.' : undefined}
      />
      <ConfirmDialog
        open={!!approving}
        title={`Approve ${approving?.companyName ?? ''}?`}
        body={<>This creates the company account and makes <b>{approving?.email}</b> its admin. They will be emailed a sign-in link.</>}
        confirmLabel={approve.isPending ? 'Setting up...' : 'Approve'}
        loading={approve.isPending}
        onClose={() => setApproving(null)}
        onConfirm={() => approving && approve.mutate(approving)}
      />
      <RejectDialog request={rejecting} onClose={() => setRejecting(null)} onDone={() => { toast(`${rejecting?.companyName ?? 'Request'} rejected.`); setRejecting(null); refresh(); }} />
      {toastNode}
    </>
  );
}

function CompaniesTab() {
  const qc = useQueryClient();
  const { toast, toastNode } = useToast();
  const [suspending, setSuspending] = useState<PlatformCompany | null>(null);
  const q = useQuery({ queryKey: ['admin', 'companies'], queryFn: async () => (await api<{ items: PlatformCompany[] }>('/admin/companies')).items });
  const plans = useQuery({ queryKey: ['admin', 'plans'], queryFn: async () => (await api<{ items: Plan[] }>('/admin/plans')).items, staleTime: Infinity });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: 'ACTIVE' | 'SUSPENDED'; plan?: string }) => api(`/admin/companies/${id}`, { method: 'PATCH', body }),
    onSuccess: () => { setSuspending(null); void qc.invalidateQueries({ queryKey: ['admin', 'companies'] }); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const columns: Column<PlatformCompany>[] = [
    { key: 'name', header: 'Company', render: (c) => <><b>{c.name}</b><br /><small>{c.slug}</small></> },
    { key: 'owner', header: 'Owner', hideOnMobile: true, render: (c) => <>{c.ownerEmail ?? '-'}<br /><small>{c.userCount} {c.userCount === 1 ? 'user' : 'users'}</small></> },
    { key: 'plan', header: 'Plan', render: (c) => (
      <TextField select size="small" value={c.plan} onChange={(e) => update.mutate({ id: c.id, plan: e.target.value })} sx={{ minWidth: 140 }} inputProps={{ 'aria-label': `Plan for ${c.name}` }}>
        {(plans.data ?? [{ code: c.plan, name: c.plan, maxEvents: null, maxGuestsPerEvent: null }]).map((p) => <MenuItem key={p.code} value={p.code}>{p.name}</MenuItem>)}
      </TextField>
    ) },
    { key: 'status', header: 'Status', render: (c) => <StatusBadge label={c.status} tone={c.status === 'SUSPENDED' ? 'error' : 'success'} /> },
    { key: 'since', header: 'Since', hideOnMobile: true, render: (c) => formatDate(c.createdAt) },
    { key: 'act', header: '', align: 'right', render: (c) => (
      <Button size="small" color={c.status === 'SUSPENDED' ? 'primary' : 'error'} onClick={() => (c.status === 'SUSPENDED' ? update.mutate({ id: c.id, status: 'ACTIVE' }) : setSuspending(c))}>
        {c.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
      </Button>
    ) },
  ];
  return (
    <>
      <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />
      <DataTable columns={columns} rows={q.data ?? []} rowKey={(c) => c.id} loading={q.isLoading} emptyTitle="No companies yet" />
      <ConfirmDialog
        open={!!suspending}
        title={`Suspend ${suspending?.name ?? ''}?`}
        body="Everyone in this company is signed out immediately and cannot sign in, and guest pass links stop working. Their data is kept and everything comes back when you reactivate."
        confirmLabel="Suspend"
        destructive
        loading={update.isPending}
        onClose={() => setSuspending(null)}
        onConfirm={() => suspending && update.mutate({ id: suspending.id, status: 'SUSPENDED' })}
      />
      {toastNode}
    </>
  );
}

export function AdminConsolePage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data: admin } = useAdminMe();
  const [tab, setTab] = useState(0);
  const pending = useQuery({ queryKey: ['admin', 'requests', 'PENDING'], queryFn: async () => (await api<{ items: CompanyRequest[] }>('/admin/requests')).items });
  const logout = useMutation({
    mutationFn: () => api('/admin/logout', { method: 'POST' }),
    onSettled: () => {
      qc.removeQueries({ queryKey: ['admin'] });
      qc.setQueryData(ADMIN_ME_KEY, null);
      nav('/admin/login', { replace: true });
    },
  });
  const waiting = pending.data?.length ?? 0;
  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }}>
      <AppBar position="static" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 1 }}>
          <AdminPanelSettingsIcon color="primary" />
          <Typography variant="h6" fontWeight={800} sx={{ flexGrow: 1 }}>EventPass admin</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>{admin?.email}</Typography>
          <Button onClick={() => logout.mutate()} disabled={logout.isPending}>Sign out</Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <PageHeader title="Platform" subtitle="Approve new companies and manage existing ones" />
        <Tabs value={tab} onChange={(_, v: number) => setTab(v)} sx={{ mb: 2 }}>
          <Tab label={waiting ? `Requests (${waiting})` : 'Requests'} />
          <Tab label="Companies" />
        </Tabs>
        {tab === 0 ? <RequestsTab /> : <CompaniesTab />}
      </Container>
    </Box>
  );
}
