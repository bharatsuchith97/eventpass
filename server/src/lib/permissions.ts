export const ROLES = ['COMPANY_ADMIN', 'EVENT_MANAGER', 'CHECKIN_STAFF'] as const;
export type Role = (typeof ROLES)[number];

const A: Role = 'COMPANY_ADMIN';
const M: Role = 'EVENT_MANAGER';
const S: Role = 'CHECKIN_STAFF';

/** Single source of truth for the RBAC matrix. Enforced server-side only. */
export const PERMISSIONS = {
  'company:manage': [A],
  'users:manage': [A],
  'audit:view': [A],
  'events:read': [A, M, S],
  'events:write': [A, M],
  'guests:manage': [A, M],
  'guests:export': [A, M],
  'tickets:manage': [A, M],
  'invitations:send': [A, M],
  'reports:view': [A, M],
  'integrations:manage': [A],
  'checkin:scan': [A, M, S],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
