import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, MenuItem, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api, qs } from '../../lib/api/client';
import { useMe, useSettings } from '../../lib/auth/session';
import { formatDateTime } from '../../lib/utils/format';
import { changePasswordSchema, settingsSchema, type SettingsFormValues } from '../../lib/validation/schemas';
import { DataTable, ErrorAlert, PageHeader, useToast, type Column } from '../../components/ui';
import type { AuditRow, CompanySettings, Paged } from '../../types';
import { applyServerErrors } from '../auth/AuthPages';

const ZONES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];

const MAX_LOGO_BYTES = 512 * 1024;

/** Upload / replace / remove the company logo. Shown on passes, the guest pass page, emails and the app header. */
function LogoField({ logoUrl }: { logoUrl: string | null }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const done = (d: CompanySettings) => {
    setErr(null);
    qc.setQueryData(['settings'], d);
  };
  const upload = useMutation({
    mutationFn: (file: File) => api<CompanySettings>('/company/logo', { method: 'PUT', body: file }),
    onSuccess: done,
    onError: (e) => setErr(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api<CompanySettings>('/company/logo', { method: 'DELETE' }),
    onSuccess: done,
    onError: (e) => setErr(e.message),
  });
  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) return setErr('Choose a PNG or JPG image.');
    if (file.size > MAX_LOGO_BYTES) return setErr('The logo must be 512 KB or smaller.');
    upload.mutate(file);
  };
  const busy = upload.isPending || remove.isPending;
  return (
    <Stack gap={1}>
      <Typography variant="body2" fontWeight={600}>Logo</Typography>
      <Stack direction="row" gap={2} alignItems="center" flexWrap="wrap">
        <Box sx={{ width: 160, height: 64, border: 1, borderColor: 'divider', borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: '#fff', p: 1 }}>
          {logoUrl
            ? <Box component="img" src={logoUrl} alt="Company logo" sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            : <Typography variant="caption" color="text.secondary">No logo yet</Typography>}
        </Box>
        <Stack direction="row" gap={1}>
          <Button component="label" variant="outlined" size="small" disabled={busy}>
            {upload.isPending ? 'Uploading...' : logoUrl ? 'Replace' : 'Upload logo'}
            <input hidden type="file" accept="image/png,image/jpeg" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          </Button>
          {logoUrl && <Button size="small" color="error" disabled={busy} onClick={() => remove.mutate()}>Remove</Button>}
        </Stack>
      </Stack>
      {err ? <Alert severity="error">{err}</Alert> : (
        <Typography variant="caption" color="text.secondary">PNG or JPG, up to 512 KB. A wide logo on a transparent or white background works best. It appears on passes, invitation emails and the guest pass page.</Typography>
      )}
    </Stack>
  );
}

function CompanyForm() {
  const qc = useQueryClient();
  const s = useSettings();
  const { toast, toastNode } = useToast();
  const { register, handleSubmit, formState: { errors, isDirty }, setError } = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    values: s.data ? {
      companyName: s.data.companyName, primaryBrandColor: s.data.primaryBrandColor, timezone: s.data.timezone,
      defaultLanguage: s.data.defaultLanguage, contactEmail: s.data.contactEmail ?? '', contactPhone: s.data.contactPhone ?? '',
    } : undefined,
  });
  const m = useMutation({
    mutationFn: (v: SettingsFormValues) => api<CompanySettings>('/company/settings', { method: 'PUT', body: v }),
    onSuccess: (d) => { qc.setQueryData(['settings'], d); void qc.invalidateQueries({ queryKey: ['me'] }); toast('Settings saved'); },
    onError: (e) => applyServerErrors(e, setError),
  });
  if (!s.data) return <ErrorAlert error={s.error} />;
  return (
    <Card variant="outlined" sx={{ maxWidth: 640 }}>
      <CardContent>
        <Stack component="form" gap={2} onSubmit={handleSubmit((v) => m.mutate(v))} noValidate>
          {m.error && <Alert severity="error">{m.error.message}</Alert>}
          <TextField label="Company name" {...register('companyName')} error={!!errors.companyName} helperText={errors.companyName?.message} />
          <LogoField logoUrl={s.data.logoUrl} />
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
            <TextField label="Brand color" {...register('primaryBrandColor')} error={!!errors.primaryBrandColor} helperText={errors.primaryBrandColor?.message ?? 'Hex, e.g. #1565c0'} />
            <TextField label="Language" {...register('defaultLanguage')} error={!!errors.defaultLanguage} helperText={errors.defaultLanguage?.message ?? 'ISO code, e.g. en'} />
          </Stack>
          <TextField select label="Timezone" defaultValue={s.data.timezone} {...register('timezone')} error={!!errors.timezone} helperText={errors.timezone?.message ?? 'Used to display event times'} SelectProps={{ MenuProps: { PaperProps: { sx: { maxHeight: 320 } } } }}>
            {(ZONES.includes(s.data.timezone) ? ZONES : [s.data.timezone, ...ZONES]).map((z) => <MenuItem key={z} value={z}>{z}</MenuItem>)}
          </TextField>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
            <TextField label="Contact email" {...register('contactEmail')} error={!!errors.contactEmail} helperText={errors.contactEmail?.message} />
            <TextField label="Contact phone" {...register('contactPhone')} error={!!errors.contactPhone} helperText={errors.contactPhone?.message} />
          </Stack>
          <Button type="submit" variant="contained" disabled={m.isPending || !isDirty} sx={{ alignSelf: 'flex-start' }}>Save changes</Button>
        </Stack>
      </CardContent>
      {toastNode}
    </Card>
  );
}

function PasswordForm() {
  const { toast, toastNode } = useToast();
  const { register, handleSubmit, formState: { errors }, setError, reset } = useForm({ resolver: zodResolver(changePasswordSchema), defaultValues: { currentPassword: '', newPassword: '' } });
  const m = useMutation({
    mutationFn: (v: { currentPassword: string; newPassword: string }) => api('/auth/change-password', { method: 'POST', body: v }),
    onSuccess: () => { reset(); toast('Password changed. Other devices were signed out.'); },
    onError: (e) => applyServerErrors(e, setError),
  });
  return (
    <Card variant="outlined" sx={{ maxWidth: 640 }}>
      <CardContent>
        <Stack component="form" gap={2} onSubmit={handleSubmit((v) => m.mutate(v))} noValidate>
          <Typography variant="h6" fontWeight={700}>Change password</Typography>
          {m.error && !Object.keys((m.error as { fieldErrors?: object }).fieldErrors ?? {}).length && <Alert severity="error">{m.error.message}</Alert>}
          <TextField label="Current password" type="password" autoComplete="current-password" {...register('currentPassword')} error={!!errors.currentPassword} helperText={errors.currentPassword?.message} />
          <TextField label="New password" type="password" autoComplete="new-password" {...register('newPassword')} error={!!errors.newPassword} helperText={errors.newPassword?.message} />
          <Button type="submit" variant="contained" disabled={m.isPending} sx={{ alignSelf: 'flex-start' }}>Change password</Button>
        </Stack>
      </CardContent>
      {toastNode}
    </Card>
  );
}

function AuditLog() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const q = useQuery({ queryKey: ['audit', page, pageSize], queryFn: () => api<Paged<AuditRow>>(`/audit-logs${qs({ page, pageSize })}`), placeholderData: (p) => p });
  const columns: Column<AuditRow>[] = [
    { key: 't', header: 'When', render: (r) => formatDateTime(r.timestamp) },
    { key: 'a', header: 'Action', render: (r) => <code>{r.action}</code> },
    { key: 'u', header: 'User', hideOnMobile: true, render: (r) => r.userEmail ?? '-' },
    { key: 'e', header: 'Entity', hideOnMobile: true, render: (r) => r.entityType },
    { key: 'm', header: 'Details', hideOnMobile: true, render: (r) => <Typography variant="caption" color="text.secondary">{Object.entries(r.metadata).map(([k, v]) => `${k}: ${String(v)}`).join(', ')}</Typography> },
  ];
  return (
    <>
      <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />
      <DataTable columns={columns} rows={q.data?.items ?? []} rowKey={(r) => r.id} loading={q.isLoading} total={q.data?.total ?? 0} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} emptyTitle="No activity yet" />
    </>
  );
}

export function SettingsPage() {
  const { data: me } = useMe();
  const admin = me?.role === 'COMPANY_ADMIN';
  const [tab, setTab] = useState(admin ? 'company' : 'account');
  return (
    <>
      <PageHeader title={admin ? 'Company settings' : 'Account'} subtitle={me?.email} />
      <Tabs value={tab} onChange={(_, v: string) => setTab(v)} sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        {admin && <Tab value="company" label="Company" />}
        <Tab value="account" label="Password" />
        {admin && <Tab value="audit" label="Audit log" />}
      </Tabs>
      {tab === 'company' && admin && <CompanyForm />}
      {tab === 'account' && <PasswordForm />}
      {tab === 'audit' && admin && <AuditLog />}
    </>
  );
}
