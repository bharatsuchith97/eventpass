import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar, Avatar, Box, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, Toolbar, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import DashboardIcon from '@mui/icons-material/Dashboard';
import EventIcon from '@mui/icons-material/Event';
import PeopleIcon from '@mui/icons-material/People';
import MailIcon from '@mui/icons-material/Mail';
import AssessmentIcon from '@mui/icons-material/Assessment';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import SearchIcon from '@mui/icons-material/PersonSearch';
import GroupIcon from '@mui/icons-material/Groups';
import ExtensionIcon from '@mui/icons-material/Extension';
import SettingsIcon from '@mui/icons-material/Settings';
import { NAV_ROLES, useLogout, useMe } from '../../lib/auth/session';
import type { Role } from '../../types';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  roles: Role[];
  match?: string;
}

export function navFor(role: Role): NavItem[] {
  const items: NavItem[] = [
    { to: '/dashboard', label: 'Dashboard', icon: <DashboardIcon />, roles: NAV_ROLES.manage },
    { to: '/events', label: 'Events', icon: <EventIcon />, roles: NAV_ROLES.all },
    { to: '/guests', label: 'Guests', icon: <PeopleIcon />, roles: NAV_ROLES.manage },
    { to: '/invitations', label: 'Invitations', icon: <MailIcon />, roles: NAV_ROLES.manage },
    { to: '/reports', label: 'Reports', icon: <AssessmentIcon />, roles: NAV_ROLES.manage },
    { to: '/checkin', label: 'Check-In', icon: <QrCodeScannerIcon />, roles: NAV_ROLES.all },
    { to: '/checkin?tab=search', label: 'Guest Search', icon: <SearchIcon />, roles: ['CHECKIN_STAFF'], match: 'search' },
    { to: '/team', label: 'Team', icon: <GroupIcon />, roles: NAV_ROLES.admin },
    { to: '/integrations', label: 'Integrations', icon: <ExtensionIcon />, roles: NAV_ROLES.admin },
    { to: '/settings', label: role === 'COMPANY_ADMIN' ? 'Company Settings' : 'Account', icon: <SettingsIcon />, roles: NAV_ROLES.all },
  ];
  return items.filter((i) => i.roles.includes(role));
}

const WIDTH = 248;

export function AppShell() {
  const { data: me } = useMe();
  const logout = useLogout();
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const nav = useNavigate();
  const loc = useLocation();
  if (!me) return null;

  const isActive = (i: NavItem) => {
    const [path] = i.to.split('?');
    if (i.match) return loc.pathname === path && loc.search.includes(i.match);
    if (path === '/checkin' && loc.search.includes('search') && me.role === 'CHECKIN_STAFF') return false;
    return loc.pathname === path || loc.pathname.startsWith(`${path}/`);
  };

  const drawer = (
    <Box role="navigation" aria-label="Main">
      <Toolbar sx={{ gap: 1 }}>
        <Box sx={{ width: 30, height: 30, borderRadius: 1.5, bgcolor: 'primary.main', display: 'grid', placeItems: 'center' }}>
          <QrCodeScannerIcon sx={{ color: '#fff', fontSize: 20 }} />
        </Box>
        <Typography variant="h6" fontWeight={800}>Inviteley</Typography>
      </Toolbar>
      <Divider />
      <List sx={{ px: 1 }}>
        {navFor(me.role).map((i) => (
          <ListItemButton key={i.to} component={NavLink} to={i.to} selected={isActive(i)} onClick={() => setOpen(false)} sx={{ borderRadius: 2, mb: 0.5 }}>
            <ListItemIcon sx={{ minWidth: 38 }}>{i.icon}</ListItemIcon>
            <ListItemText primary={i.label} primaryTypographyProps={{ fontWeight: isActive(i) ? 700 : 500 }} />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh' }}>
      <AppBar position="fixed" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', ml: { md: `${WIDTH}px` }, width: { md: `calc(100% - ${WIDTH}px)` } }}>
        <Toolbar>
          {!desktop && (
            <IconButton edge="start" onClick={() => setOpen(true)} aria-label="Open menu" sx={{ mr: 1 }}>
              <MenuIcon />
            </IconButton>
          )}
          <Typography fontWeight={700} noWrap sx={{ flexGrow: 1 }}>{me.companyName}</Typography>
          <IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label="Account menu">
            <Avatar sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontSize: 14 }}>{(me.fullName || me.email)[0]?.toUpperCase()}</Avatar>
          </IconButton>
          <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
            <Box px={2} py={1}>
              <Typography fontWeight={600}>{me.fullName || me.email}</Typography>
              <Typography variant="caption" color="text.secondary">{me.email}</Typography>
            </Box>
            <Divider />
            <MenuItem onClick={() => { setAnchor(null); nav('/settings'); }}>Account</MenuItem>
            <MenuItem onClick={() => { setAnchor(null); logout.mutate(); }}>Sign out</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>
      <Box component="nav" sx={{ width: { md: WIDTH }, flexShrink: { md: 0 } }}>
        <Drawer variant={desktop ? 'permanent' : 'temporary'} open={desktop || open} onClose={() => setOpen(false)} ModalProps={{ keepMounted: true }} sx={{ '& .MuiDrawer-paper': { width: WIDTH, boxSizing: 'border-box' } }}>
          {drawer}
        </Drawer>
      </Box>
      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 3 }, pt: { xs: 10, md: 11 }, maxWidth: 1400 }}>
        <Outlet />
      </Box>
    </Box>
  );
}
