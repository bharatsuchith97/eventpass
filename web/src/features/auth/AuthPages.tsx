import { forwardRef, useState, type ReactNode } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, IconButton, InputAdornment, Link, Stack, TextField, Typography, type TextFieldProps } from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import PriorityHighRoundedIcon from '@mui/icons-material/PriorityHighRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import MarkEmailReadOutlinedIcon from '@mui/icons-material/MarkEmailReadOutlined';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
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

// Same look as the public landing page (web/index.html): ink panel, electric blue, display type for headings.
const INK = '#0b1220';
const ACCENT = '#1f5eff';
const DISPLAY = '"Bricolage Grotesque", "Segoe UI", system-ui, sans-serif';
const BODY = '"Instrument Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <Box component="svg" viewBox="0 0 32 32" aria-hidden="true" sx={{ width: size, height: size, flexShrink: 0 }}>
      <rect width="32" height="32" rx="8" fill={ACCENT} />
      <path d="M9 9h6v6H9zM17 9h6v6h-6zM9 17h6v6H9zM19 19h4v4h-4z" fill="#fff" />
    </Box>
  );
}

/** "/" is the static landing page outside the React app, so it is a plain link (full page load). */
function HomeLink({ light }: { light?: boolean }) {
  return (
    <Link href="/" underline="none" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25, color: light ? '#fff' : 'text.primary' }} aria-label="Inviteley home">
      <BrandMark />
      <Typography component="span" sx={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: '1.3rem', letterSpacing: '-0.02em' }}>Inviteley</Typography>
    </Link>
  );
}

const DOOR_RESULTS = [
  { bg: '#12895a', icon: <CheckRoundedIcon />, title: 'Welcome!', text: 'Valid pass. Let them in.' },
  { bg: '#c97a00', icon: <PriorityHighRoundedIcon />, title: 'Already checked in', text: 'Shows when and where.' },
  { bg: '#cc3b3b', icon: <CloseRoundedIcon />, title: 'Not valid', text: 'Cancelled or wrong event.' },
];

/** Left half on desktop: the brand, the promise, and the three results staff see at the door. */
function BrandPanel() {
  return (
    <Box
      sx={{
        display: { xs: 'none', md: 'flex' }, flexDirection: 'column', justifyContent: 'space-between', gap: 6,
        p: { md: 5, lg: 7 }, color: '#e9eef8', position: 'relative', overflow: 'hidden',
        background: `radial-gradient(600px 380px at 85% 10%, rgba(31,94,255,0.35), transparent 70%), radial-gradient(500px 340px at 0% 100%, rgba(31,94,255,0.18), transparent 70%), ${INK}`,
      }}
    >
      <HomeLink light />
      <Box sx={{ maxWidth: 460 }}>
        <Typography component="p" sx={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: { md: '2.4rem', lg: '2.9rem' }, lineHeight: 1.08, letterSpacing: '-0.02em', mb: 2 }}>
          From guest list to front door, <Box component="span" sx={{ color: '#8fb0ff' }}>without the queue.</Box>
        </Typography>
        <Typography sx={{ color: '#a3afc4', fontSize: '1.05rem', mb: 4 }}>
          Guest lists, QR passes, invitations and check-in in one place, with every result clear at a glance.
        </Typography>
        <Stack gap={1.5} aria-hidden="true">
          {DOOR_RESULTS.map((r) => (
            <Stack key={r.title} direction="row" alignItems="center" gap={1.5} sx={{ bgcolor: r.bg, borderRadius: 3, px: 2, py: 1.5, maxWidth: 360 }}>
              <Box sx={{ width: 34, height: 34, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.2)', display: 'grid', placeItems: 'center', '& svg': { fontSize: 20, color: '#fff' } }}>{r.icon}</Box>
              <Box>
                <Typography sx={{ fontFamily: DISPLAY, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>{r.title}</Typography>
                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.88)' }}>{r.text}</Typography>
              </Box>
            </Stack>
          ))}
        </Stack>
      </Box>
      <Typography variant="body2" sx={{ color: '#7f8ba1' }}>Private to your company · No app for guests · Works on any phone</Typography>
    </Box>
  );
}

/** Shared frame for sign-in, request access, password reset and the superadmin sign-in. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', lg: '5fr 6fr' }, fontFamily: BODY, bgcolor: 'background.default' }}>
      <BrandPanel />
      <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, px: { xs: 2, sm: 4 }, py: { xs: 2.5, sm: 4 } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: { xs: 4, md: 0 } }}>
          <Box sx={{ display: { md: 'none' } }}><HomeLink /></Box>
          <Link href="/" underline="hover" variant="body2" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, ml: 'auto', color: 'text.secondary' }}>
            <ArrowBackRoundedIcon sx={{ fontSize: 18 }} /> Back to home
          </Link>
        </Stack>
        <Box sx={{ flex: 1, display: 'grid', placeItems: { xs: 'start center', md: 'center' }, pt: { xs: 2, md: 0 } }}>
          <Box
            sx={{
              width: '100%', maxWidth: 420, py: { md: 4 },
              '& .MuiOutlinedInput-root': { borderRadius: '12px', bgcolor: 'background.paper' },
              '& .MuiLink-root': { textDecoration: 'none', '&:hover': { textDecoration: 'underline' } },
              '& .MuiButton-containedPrimary': { borderRadius: 999, py: 1.4, fontSize: '1rem', boxShadow: 'none' },
            }}
          >
            <Typography component="h1" sx={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: { xs: '1.9rem', sm: '2.2rem' }, letterSpacing: '-0.02em', lineHeight: 1.1, mb: 1 }}>{title}</Typography>
            {subtitle && <Typography color="text.secondary" sx={{ mb: 3.5 }}>{subtitle}</Typography>}
            {!subtitle && <Box sx={{ mb: 3 }} />}
            {children}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * Password input with a show/hide toggle. Forwards the ref to the real <input>: react-hook-form reads the typed
 * value through it, so without this the form sees an empty password.
 */
const PasswordField = forwardRef<HTMLInputElement, TextFieldProps>(function PasswordField(props, ref) {
  const [show, setShow] = useState(false);
  return (
    <TextField
      {...props}
      inputRef={ref}
      type={show ? 'text' : 'password'}
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton edge="end" size="small" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
});

/** Big round icon for confirmation screens. */
function Badge({ children, color }: { children: ReactNode; color: string }) {
  return <Box sx={{ width: 64, height: 64, borderRadius: '50%', bgcolor: `${color}1f`, color, display: 'grid', placeItems: 'center', mb: 2.5, '& svg': { fontSize: 32 } }}>{children}</Box>;
}

const NEXT_STEPS = ['We review your request', 'You get an email', 'Sign in and create your event'];

function NextSteps() {
  return (
    <Stack component="ol" gap={1.25} sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {NEXT_STEPS.map((s, i) => (
        <Stack component="li" key={s} direction="row" alignItems="center" gap={1.5}>
          <Box sx={{ width: 26, height: 26, flexShrink: 0, borderRadius: '50%', bgcolor: ACCENT, color: '#fff', display: 'grid', placeItems: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: '0.85rem' }}>{i + 1}</Box>
          <Typography variant="body2">{s}</Typography>
        </Stack>
      ))}
    </Stack>
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
      qc.setQueryData(ME_KEY, user);
      // Drop anything cached before sign-in, but with resetQueries rather than clear(): clear() detaches components
      // that are already watching a query (e.g. the theme reading the company's brand colour), so they would keep
      // showing pre-sign-in values until the page is reloaded.
      void qc.resetQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
      nav(next, { replace: true });
    },
    onError: (e) => applyServerErrors(e, setError),
  });
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to manage your events, guests and check-in.">
      <Stack component="form" gap={2.25} onSubmit={handleSubmit((v) => m.mutate(v))} noValidate>
        {m.error && <Alert severity={m.error instanceof ApiError && m.error.code === 'PENDING_APPROVAL' ? 'info' : 'error'}>{m.error.message}</Alert>}
        <TextField size="medium" label="Email" type="email" autoComplete="email" autoFocus {...register('email')} error={!!errors.email} helperText={errors.email?.message} />
        <Box>
          <PasswordField size="medium" label="Password" autoComplete="current-password" {...register('password')} error={!!errors.password} helperText={errors.password?.message} />
          <Link component={RouterLink} to="/forgot-password" variant="body2" sx={{ display: 'inline-block', mt: 1 }}>Forgot password?</Link>
        </Box>
        <Button type="submit" variant="contained" size="large" disabled={m.isPending}>{m.isPending ? 'Signing in...' : 'Sign in'}</Button>
        <Typography variant="body2" color="text.secondary" textAlign="center">
          New to Inviteley? <Link component={RouterLink} to="/register" fontWeight={600}>Request a company account</Link>
        </Typography>
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
        <Badge color="#12895a"><CheckRoundedIcon /></Badge>
        <Typography sx={{ mb: 3 }}>
          Thanks! Your company account is waiting for approval. We will email <b>{m.variables.email}</b> as soon as it has been reviewed, then you can sign in with the password you just chose.
        </Typography>
        <NextSteps />
        <Button component={RouterLink} to="/login" variant="outlined" sx={{ mt: 4, borderRadius: 999 }} fullWidth>Back to sign in</Button>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Request a company account" subtitle="Tell us who you are. We review every request and email you once it is approved.">
      <Stack component="form" gap={2.25} onSubmit={handleSubmit((v) => m.mutate(v))} noValidate>
        {m.error && <Alert severity="error">{m.error.message}</Alert>}
        <TextField size="medium" label="Company name" autoFocus {...register('companyName')} error={!!errors.companyName} helperText={errors.companyName?.message} />
        <TextField size="medium" label="Your name" autoComplete="name" {...register('fullName')} error={!!errors.fullName} helperText={errors.fullName?.message} />
        <TextField size="medium" label="Work email" type="email" autoComplete="email" {...register('email')} error={!!errors.email} helperText={errors.email?.message} />
        <PasswordField size="medium" label="Password" autoComplete="new-password" {...register('password')} error={!!errors.password} helperText={errors.password?.message ?? 'At least 10 characters, with letters and a number'} />
        <Button type="submit" variant="contained" size="large" disabled={m.isPending}>{m.isPending ? 'Sending request...' : 'Request access'}</Button>
        <Box sx={{ p: 2, borderRadius: 3, bgcolor: 'action.hover' }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 1.25 }}>What happens next</Typography>
          <NextSteps />
        </Box>
        <Typography variant="body2" color="text.secondary" textAlign="center">
          Already approved? <Link component={RouterLink} to="/login" fontWeight={600}>Sign in</Link>
        </Typography>
      </Stack>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(forgotSchema), defaultValues: { email: '' } });
  const m = useMutation({ mutationFn: (v: { email: string }) => api('/auth/forgot-password', { method: 'POST', body: v }) });
  if (m.isSuccess) {
    return (
      <AuthLayout title="Check your email">
        <Badge color={ACCENT}><MarkEmailReadOutlinedIcon /></Badge>
        <Typography sx={{ mb: 1 }}>If an account exists for <b>{m.variables.email}</b>, a link to choose a new password is on its way.</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>The link works for one hour. Not there? Check your spam folder.</Typography>
        <Button component={RouterLink} to="/login" variant="outlined" sx={{ borderRadius: 999 }} fullWidth>Back to sign in</Button>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Forgot your password?" subtitle="Enter your email and we will send you a link to choose a new one.">
      <Stack component="form" gap={2.25} onSubmit={handleSubmit((v) => m.mutate(v))} noValidate>
        {m.error && <Alert severity="error">{m.error.message}</Alert>}
        <TextField size="medium" label="Email" type="email" autoComplete="email" autoFocus {...register('email')} error={!!errors.email} helperText={errors.email?.message} />
        <Button type="submit" variant="contained" size="large" disabled={m.isPending}>{m.isPending ? 'Sending...' : 'Send reset link'}</Button>
        <Typography variant="body2" color="text.secondary" textAlign="center">
          Remembered it? <Link component={RouterLink} to="/login" fontWeight={600}>Back to sign in</Link>
        </Typography>
      </Stack>
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
  if (done) {
    return (
      <AuthLayout title="Password changed">
        <Badge color="#12895a"><CheckRoundedIcon /></Badge>
        <Typography sx={{ mb: 4 }}>You can now sign in with your new password. Any other devices that were signed in have been signed out.</Typography>
        <Button component={RouterLink} to="/login" variant="contained" size="large" fullWidth sx={{ borderRadius: 999 }}>Sign in</Button>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Choose a new password" subtitle={/^[0-9a-f]{64}$/.test(token) ? 'Use at least 10 characters, with letters and a number.' : undefined}>
      {!/^[0-9a-f]{64}$/.test(token) ? (
        <Stack gap={2}>
          <Alert severity="error">This reset link is not valid. Request a new one.</Alert>
          <Button component={RouterLink} to="/forgot-password" variant="outlined" sx={{ borderRadius: 999 }}>Request a new link</Button>
        </Stack>
      ) : (
        <Stack component="form" gap={2.25} onSubmit={handleSubmit((v) => m.mutate(v))} noValidate>
          {m.error && <Alert severity="error">{m.error.message}</Alert>}
          <PasswordField size="medium" label="New password" autoComplete="new-password" autoFocus {...register('newPassword')} error={!!errors.newPassword} helperText={errors.newPassword?.message} />
          <Button type="submit" variant="contained" size="large" disabled={m.isPending}>{m.isPending ? 'Saving...' : 'Change password'}</Button>
        </Stack>
      )}
    </AuthLayout>
  );
}
