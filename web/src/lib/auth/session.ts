import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { CompanySettings, Role, SessionUser } from '../../types';

export const ME_KEY = ['me'] as const;

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<SessionUser | null> => {
      try {
        return (await api<{ user: SessionUser }>('/auth/me')).user;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useSettings(enabled = true) {
  return useQuery({ queryKey: ['settings'], queryFn: () => api<CompanySettings>('/company/settings'), enabled, staleTime: 5 * 60_000 });
}

export function useLogout() {
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    // "/" is the static landing page, outside the React app, so this must be a full page load.
    // The load also discards every cached query, so nothing from the session survives.
    onSettled: () => window.location.assign('/'),
  });
}

/**
 * UI-only hint used to hide navigation. The server enforces every permission; nothing here is a security control.
 */
export const NAV_ROLES = {
  manage: ['COMPANY_ADMIN', 'EVENT_MANAGER'] as Role[],
  admin: ['COMPANY_ADMIN'] as Role[],
  all: ['COMPANY_ADMIN', 'EVENT_MANAGER', 'CHECKIN_STAFF'] as Role[],
};
