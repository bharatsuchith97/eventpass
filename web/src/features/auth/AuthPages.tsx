import { useState, type ReactNode } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, Link, Stack, TextField, Typography } from '@mui/material';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, type FieldValues, type Path, type UseFormSetError } from 'react-hook-form';
import { api, ApiError } from '../../lib/api/client';
import { ME_KEY } from '../../lib/auth/session';
import { forgotSchema, loginSchema, registerSchema, resetSchema } from '../../lib/validation/schemas';
import type { SessionUser } from '../../types';

export function applyServerErrors<T extends FieldValues>(e: unknown, setError: UseFormSetError<T>): void {
  if (e instanceof ApiError) for (const [f, m] of Object.entries(e.fieldErrors)) setError(f as Path<T>, { message: m });
}

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 2, bgcolor: 'background.default' }}>
      <Box width="100%" maxWidth={420}>
        <Stack direction="row" alignItems="center" justifyContent="center" gap={1} mb={3}>
          <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: 'primary.main', display: 'grid', placeItems: 'center' }}>
            <QrCodeScannerIcon sx={{ color: '#fff' }} />
          </Box>
          <Typography variant="h5" fontWeight={800}>Inviteley</Typography>
        </Stack>
        <Card variant="outlined">
          <CardContent sx={{ p: { xs: 2.5, sm: 4 } }}>
            <Typography variant="h5" fontWeight={700} gutterBottom>{title}</Typography>
            {subtitle && <Typography color="text.secondary" mb={2}>{subtitle}</Typography>}
            {children}
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}

export function LoginPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  const next = (loc.state as { next?: string } | null)?.next ?? '/';
  const { register, handleSubmit, formState: { errors }, setError } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  const m = useMutation({
    mutationFn: (v: { email: string; password: string }) => api<{ user: SessionUser }>('/auth/login', { method: 'POST', body: v }),
    onSuccess: ({ user }) => {
      qc.clear();
      qc.setQueryData(ME_KEY, user);
      nav(next, { replace: true });
    },
    onError: (e) => applyServerErrors(e, setError),
  });
  return (
    <AuthLayout title="Sign in" subtitle="Welcome back. Sign in to manage your events.">
      <Stack component="form" gap={2} onSubmit={handleSubmit((v) => m.mutate(v))} noValidate>
        {m.error && <Alert severity="error">{m.error.message}</Alert>}
        <TextField label="Email" type="email" autoComplete="email" autoFocus {...register('email')} error={!!errors.email} helperText={errors.email?.message} />
        <TextField label="Password" type="password" autoComplete="current-password" {...register('password')} error={!!errors.password} helperText={errors.password?.message} />
        <Button type="submit" variant="contained" size="large" disabled={m.isPending}>{m.isPending ? 'Signing in...' : 'Sign in'}</Button>
        <Stack direction="row" justifyContent="space-between">
          <Link component={RouterLink} to="/forgot-password" variant="body2">Forgot password?</Link>
          <Link component={RouterLink} to="/register" variant="body2">Request a company account</Link>
        </Stack>
      </Stack>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { register, handleSubmit, formState: { errors }, setError } = useForm({ resolver: zodResolver(registerSchema), defaultValues: { companyName: '', fullName: '', email: '', password: '' } });
  const m = useMutation({
    mutationFn: (v: { companyName: string; fullName: string; email: string; password: string }) => api<{ requestId: string; status: 'PENDING' }>('/auth/register', { method: 'POST', body: { ...v, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } }),
    onError: (e) => applyServerErrors(e, setError),
  });
  if (m.isSuccess) {
    return (
      <AuthLayout title="Request received">
        <Stack gap={2}>
          <Alert severity="success">
            Thanks! Your company account is waiting for approval. We will email <b>{m.variables.email}</b> as soon as it has been reviewed, then you can sign in with the password you just chose.
          </Alert>
          <Link component={RouterLink} to="/login" textAlign="center">Back to sign in</Link>
        </Stack>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Request a company account" subtitle="We review every request. Once approved, you can sign in and create your first event.">
      <Stack component="form" gap={2} onSubmit={handleSubmit((v) => m.mutate(v))} noValidate>
        {m.error && <Alert severity="error">{m.error.message}</Alert>}
        <TextField label="Company name" autoFocus {...register('companyName')} error={!!errors.companyName} helperText={errors.companyName?.message} />
        <TextField label="Your name" autoComplete="name" {...register('fullName')} error={!!errors.fullName} helperText={errors.fullName?.message} />
        <TextField label="Work email" type="email" autoComplete="email" {...register('email')} error={!!errors.email} helperText={errors.email?.message} />
        <TextField label="Password" type="password" autoComplete="new-password" {...register('password')} error={!!errors.password} helperText={errors.password?.message ?? 'At least 10 characters, with letters and a number'} />
        <Button type="submit" variant="contained" size="large" disabled={m.isPending}>{m.isPending ? 'Sending request...' : 'Request access'}</Button>
        <Link component={RouterLink} to="/login" variant="body2" textAlign="center">Already approved? Sign in</Link>
      </Stack>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(forgotSchema), defaultValues: { email: '' } });
  const m = useMutation({ mutationFn: (v: { email: string }) => api('/auth/forgot-password', { method: 'POST', body: v }) });
  return (
    <AuthLayout title="Reset your password" subtitle="We will email you a link to choose a new password.">
      {m.isSuccess ? (
        <Stack gap={2}>
          <Alert severity="success">If an account exists for that email, a reset link is on its way. It expires in one hour.</Alert>
          <Link component={RouterLink} to="/login">Back to sign in</Link>
        </Stack>
      ) : (
        <Stack component="form" gap={2} onSubmit={handleSubmit((v) => m.mutate(v))} noValidate>
          {m.error && <Alert severity="error">{m.error.message}</Alert>}
          <TextField label="Email" type="email" autoFocus {...register('email')} error={!!errors.email} helperText={errors.email?.message} />
          <Button type="submit" variant="contained" size="large" disabled={m.isPending}>Send reset link</Button>
          <Link component={RouterLink} to="/login" variant="body2" textAlign="center">Back to sign in</Link>
        </Stack>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(resetSchema), defaultValues: { newPassword: '' } });
  const m = useMutation({
    mutationFn: (v: { newPassword: string }) => api('/auth/reset-password', { method: 'POST', body: { token, newPassword: v.newPassword } }),
    onSuccess: () => setDone(true),
  });
  return (
    <AuthLayout title="Choose a new password">
      {done ? (
        <Stack gap={2}>
          <Alert severity="success">Your password has been changed.</Alert>
          <Button component={RouterLink} to="/login" variant="contained">Sign in</Button>
        </Stack>
      ) : !/^[0-9a-f]{64}$/.test(token) ? (
        <Alert severity="error">This reset link is not valid. Request a new one.</Alert>
      ) : (
        <Stack component="form" gap={2} onSubmit={handleSubmit((v) => m.mutate(v))} noValidate>
          {m.error && <Alert severity="error">{m.error.message}</Alert>}
          <TextField label="New password" type="password" autoComplete="new-password" autoFocus {...register('newPassword')} error={!!errors.newPassword} helperText={errors.newPassword?.message} />
          <Button type="submit" variant="contained" size="large" disabled={m.isPending}>Change password</Button>
        </Stack>
      )}
    </AuthLayout>
  );
}
