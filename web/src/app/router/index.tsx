import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { AppShell } from '../../components/layout/AppShell';
import { useMe } from '../../lib/auth/session';
import type { Role } from '../../types';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from '../../features/auth/AuthPages';
import { DashboardPage } from '../../features/dashboard/DashboardPage';
import { EventsPage } from '../../features/events/EventsPage';
import { EventDetailPage } from '../../features/events/EventDetailPage';
import { GuestsPage } from '../../features/guests/GuestsPage';
import { ImportGuestsPage } from '../../features/guests/ImportGuestsPage';
import { InvitationsPage } from '../../features/invitations/InvitationsPage';
import { ReportsPage } from '../../features/reports/ReportsPage';
import { CheckInPage, CheckInLinkPage } from '../../features/checkin/CheckInPage';
import { TeamPage } from '../../features/users/TeamPage';
import { IntegrationsPage } from '../../features/integrations/IntegrationsPage';
import { SettingsPage } from '../../features/settings/SettingsPage';
import { PublicPassPage } from '../../features/pass/PublicPassPage';
import { AdminConsolePage, AdminLoginPage, RequireSuperadmin } from '../../features/admin/AdminPages';

const Loading = () => (
  <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60dvh' }}>
    <CircularProgress />
  </Box>
);

/** UX-only guard. The API independently enforces authentication and roles on every request. */
function RequireAuth() {
  const { data: me, isLoading } = useMe();
  const loc = useLocation();
  if (isLoading) return <Loading />;
  if (!me) return <Navigate to="/login" replace state={{ next: loc.pathname + loc.search }} />;
  return <Outlet />;
}

function RequireRole({ roles }: { roles: Role[] }) {
  const { data: me } = useMe();
  if (me && !roles.includes(me.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}

function Home() {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  return <Navigate to={me.role === 'CHECKIN_STAFF' ? '/checkin' : '/dashboard'} replace />;
}

function GuestOnly() {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <Loading />;
  if (me) return <Navigate to="/" replace />;
  return <Outlet />;
}

const MANAGE: Role[] = ['COMPANY_ADMIN', 'EVENT_MANAGER'];
const ADMIN: Role[] = ['COMPANY_ADMIN'];

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Route>
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/pass/:slug/:token" element={<PublicPassPage />} />

      {/* Platform superadmin: own session, independent of any company login */}
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route element={<RequireSuperadmin />}>
        <Route path="/admin" element={<AdminConsolePage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route path="/checkin/:token" element={<CheckInLinkPage />} />
        <Route element={<AppShell />}>
          <Route path="/events" element={<EventsPage />} />
          <Route path="/events/:id" element={<EventDetailPage />} />
          <Route path="/checkin" element={<CheckInPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route element={<RequireRole roles={MANAGE} />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/guests" element={<GuestsPage />} />
            <Route path="/guests/import" element={<ImportGuestsPage />} />
            <Route path="/invitations" element={<InvitationsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
          </Route>
          <Route element={<RequireRole roles={ADMIN} />}>
            <Route path="/team" element={<TeamPage />} />
            <Route path="/integrations" element={<IntegrationsPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
