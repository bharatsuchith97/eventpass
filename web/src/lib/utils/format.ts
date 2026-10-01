import type { EventStatus, TicketStatus } from '../../types';

let tz: string | undefined;
/** Company timezone used for all displayed times. Set once settings load. */
export function setDisplayTimezone(zone: string | undefined): void {
  tz = zone;
}

export const formatDateTime = (iso: string | null | undefined): string =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(iso)) : '-';

export const formatTime = (iso: string | null | undefined): string =>
  iso ? new Intl.DateTimeFormat(undefined, { timeStyle: 'medium', timeZone: tz }).format(new Date(iso)) : '-';

export const formatDate = (iso: string | null | undefined): string =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: tz }).format(new Date(iso)) : '-';

/** ISO string -> value for <input type="datetime-local"> in the browser's local zone. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = (v: string): string => new Date(v).toISOString();

export const fullName = (g: { firstName: string; lastName: string }): string => `${g.firstName} ${g.lastName}`.trim();
export const initials = (g: { firstName: string; lastName: string }): string => `${g.firstName[0] ?? ''}${g.lastName[0] ?? ''}`.toUpperCase();

export const EVENT_STATUS_COLOR: Record<EventStatus, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  DRAFT: 'default',
  PUBLISHED: 'info',
  ONGOING: 'success',
  COMPLETED: 'default',
  CANCELLED: 'error',
  ARCHIVED: 'default',
};
export const TICKET_STATUS_COLOR: Record<TicketStatus, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  ACTIVE: 'info',
  USED: 'success',
  CANCELLED: 'error',
  EXPIRED: 'warning',
};

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : 'Something went wrong');

/** Extract a QR token from a scanned value (bare token or /checkin/<token> URL). */
export function tokenFromScan(text: string): string | null {
  const m = text.trim().match(/([0-9a-f]{64})(?:[/?#].*)?$/i);
  return m?.[1]?.toLowerCase() ?? null;
}
