export type Role = 'COMPANY_ADMIN' | 'EVENT_MANAGER' | 'CHECKIN_STAFF';
export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED' | 'ARCHIVED';
export type GuestCategory = 'VIP' | 'SPEAKER' | 'SPONSOR' | 'STAFF' | 'ATTENDEE' | 'FAMILY' | 'OTHER';
export type TicketStatus = 'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'USED';
export type RsvpStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED';

export const GUEST_CATEGORIES: GuestCategory[] = ['VIP', 'SPEAKER', 'SPONSOR', 'STAFF', 'ATTENDEE', 'FAMILY', 'OTHER'];
export const ROLE_LABELS: Record<Role, string> = {
  COMPANY_ADMIN: 'Company admin',
  EVENT_MANAGER: 'Event manager',
  CHECKIN_STAFF: 'Check-in staff',
};

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  companyId: string;
  companyName: string;
  companySlug: string;
  features: Record<string, boolean>;
}

export interface CompanySettings {
  companyName: string;
  logoUrl: string | null;
  primaryBrandColor: string;
  timezone: string;
  defaultLanguage: string;
  contactEmail: string | null;
  contactPhone: string | null;
}

export interface EventItem {
  id: string;
  name: string;
  description: string;
  eventCode: string;
  venueName: string;
  venueAddress: string;
  latitude: number | null;
  longitude: number | null;
  startDatetime: string;
  endDatetime: string;
  capacity: number | null;
  status: EventStatus;
  bannerUrl: string | null;
  createdBy: string;
  guestCount: number;
  checkedInCount: number;
}

export interface Guest {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  companyName: string | null;
  category: GuestCategory;
  notes: string | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
}

export interface TicketRow {
  id: string;
  ticketNumber: string;
  status: TicketStatus;
  rsvpStatus: RsvpStatus;
  guestId: string;
  firstName: string;
  lastName: string;
  email: string;
  companyName: string | null;
  category: GuestCategory;
  checkedInAt: string | null;
  gate: string | null;
  invitationStatus: string | null;
}

export interface EventStats {
  totalInvited: number;
  rsvpConfirmed: number;
  rsvpDeclined: number;
  rsvpPending: number;
  checkedIn: number;
  notCheckedIn: number;
  attendancePct: number;
  checkinsOverTime: { bucket: string; count: number }[];
  categories: { category: string; count: number }[];
  gates: { gate: string; count: number }[];
}

export interface TeamUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
}

export interface Guestish {
  firstName: string;
  lastName: string;
  category: GuestCategory;
  companyName: string | null;
}

export interface CheckInSuccess {
  ok: true;
  checkinId: string;
  checkedInAt: string;
  ticketNumber: string;
  eventName: string;
  guest: Guestish;
}

export interface CheckInRow {
  id: string;
  checkedInAt: string;
  gate: string | null;
  method: 'QR' | 'MANUAL';
  firstName: string;
  lastName: string;
  category: GuestCategory;
  ticketNumber: string;
  checkedInBy: string;
}

export interface SearchHit {
  ticketId: string;
  ticketNumber: string;
  status: TicketStatus;
  firstName: string;
  lastName: string;
  email: string;
  category: GuestCategory;
  companyName: string | null;
  checkedInAt: string | null;
}

export interface Report {
  kind: 'attendance' | 'noshow' | 'rsvp';
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | null>[];
  summary?: Record<string, number>;
}

export interface ImportPreview {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: { row: number; field: string; message: string }[];
  sample: { row: number; firstName: string; lastName: string; email: string; phone: string | null; category: GuestCategory }[];
}

export interface InvitationRow {
  id: string;
  sent: boolean;
  sentAt: string | null;
  deliveryStatus: string;
  openedAt: string | null;
  eventId: string;
  eventName: string;
  firstName: string;
  lastName: string;
  email: string;
  ticketNumber: string;
}

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  timestamp: string;
  userEmail: string | null;
  metadata: Record<string, unknown>;
}

export interface PublicPass {
  ticketNumber: string;
  status: TicketStatus;
  rsvpStatus: RsvpStatus;
  eventName: string;
  eventStatus: EventStatus;
  startDatetime: string;
  endDatetime: string;
  venueName: string;
  venueAddress: string;
  firstName: string;
  lastName: string;
  category: GuestCategory;
  companyName: string;
  brandColor: string;
}

// ---- Superadmin (platform operator) ----
export interface PlatformAdmin {
  id: string;
  email: string;
}
export type CompanyRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export interface CompanyRequest {
  id: string;
  companyName: string;
  fullName: string;
  email: string;
  timezone: string | null;
  status: CompanyRequestStatus;
  rejectReason: string | null;
  companyId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}
export interface PlatformCompany {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  plan: string;
  ownerEmail: string | null;
  userCount: number;
  createdAt: string;
}
export interface Plan {
  code: string;
  name: string;
  maxEvents: number | null;
  maxGuestsPerEvent: number | null;
}
