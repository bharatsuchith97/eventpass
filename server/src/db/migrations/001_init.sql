-- One database for the whole platform; companies share tables.
-- Every company-owned row carries company_id. Composite foreign keys on (company_id, id) make it impossible
-- to link rows that belong to different companies (e.g. a ticket for another company's event), even by mistake.

CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  max_events int,            -- NULL = unlimited
  max_guests_per_event int,  -- NULL = unlimited
  features jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO plans (code, name, max_events, max_guests_per_event, features) VALUES
  ('starter',    'Starter',    3,    500,  '{"reports":true,"googleSheets":false,"sso":false}'),
  ('business',   'Business',   50,   5000, '{"reports":true,"googleSheets":true,"sso":false}'),
  ('enterprise', 'Enterprise', NULL, NULL, '{"reports":true,"googleSheets":true,"sso":true}');

CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','DELETED')),
  plan_id uuid NOT NULL REFERENCES plans(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE company_settings (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  logo_url text,
  primary_brand_color text NOT NULL DEFAULT '#1565c0',
  timezone text NOT NULL DEFAULT 'UTC',
  default_language text NOT NULL DEFAULT 'en',
  contact_email text,
  contact_phone text
);

-- Company users. Email is unique across the platform because people sign in by email alone.
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  email text NOT NULL,
  full_name text NOT NULL DEFAULT '',
  role text NOT NULL CHECK (role IN ('COMPANY_ADMIN','EVENT_MANAGER','CHECKIN_STAFF')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE INDEX users_company_idx ON users (company_id);

-- Password hashes, kept apart from profile data.
CREATE TABLE auth_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()  -- doubles as the session "password version"
);

CREATE TABLE password_resets (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

-- Platform superadmins (operators of this install). Not company users.
CREATE TABLE platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX platform_admins_email_key ON platform_admins (lower(email));

-- Self-service signups wait here until a superadmin approves them.
CREATE TABLE company_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  password_hash text,        -- cleared once the request is decided
  timezone text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  reject_reason text,
  company_id uuid REFERENCES companies(id),
  decided_by uuid REFERENCES platform_admins(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX company_requests_pending_email_key ON company_requests (lower(email)) WHERE status = 'PENDING';
CREATE INDEX company_requests_status_idx ON company_requests (status, created_at);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  event_code text NOT NULL,
  venue_name text NOT NULL DEFAULT '',
  venue_address text NOT NULL DEFAULT '',
  latitude double precision,
  longitude double precision,
  start_datetime timestamptz NOT NULL,
  end_datetime timestamptz NOT NULL,
  capacity int CHECK (capacity IS NULL OR capacity > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ONGOING','COMPLETED','CANCELLED','ARCHIVED')),
  banner_url text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_datetime > start_datetime),
  UNIQUE (company_id, id),
  UNIQUE (company_id, event_code),
  FOREIGN KEY (company_id, created_by) REFERENCES users (company_id, id)
);
CREATE INDEX events_company_status_idx ON events (company_id, status);
CREATE INDEX events_company_start_idx ON events (company_id, start_datetime);

CREATE TABLE event_managers (
  company_id uuid NOT NULL,
  event_id uuid NOT NULL,
  user_id uuid NOT NULL,
  PRIMARY KEY (event_id, user_id),
  FOREIGN KEY (company_id, event_id) REFERENCES events (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, user_id) REFERENCES users (company_id, id) ON DELETE CASCADE
);
CREATE INDEX event_managers_user_idx ON event_managers (user_id);

-- Guests are company-wide contacts; they attend events through tickets.
CREATE TABLE guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  phone text,
  company_name text,
  category text NOT NULL DEFAULT 'ATTENDEE' CHECK (category IN ('VIP','SPEAKER','SPONSOR','STAFF','ATTENDEE','FAMILY','OTHER')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DELETED')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);
CREATE UNIQUE INDEX guests_email_active_key ON guests (company_id, lower(email)) WHERE status = 'ACTIVE';
CREATE INDEX guests_phone_idx ON guests (company_id, phone);
CREATE INDEX guests_first_idx ON guests (company_id, lower(first_name) text_pattern_ops);
CREATE INDEX guests_last_idx ON guests (company_id, lower(last_name) text_pattern_ops);

CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  event_id uuid NOT NULL,
  guest_id uuid NOT NULL,
  ticket_number text NOT NULL,
  qr_token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED','EXPIRED','USED')),
  rsvp_status text NOT NULL DEFAULT 'PENDING' CHECK (rsvp_status IN ('PENDING','CONFIRMED','DECLINED')),
  rsvp_at timestamptz,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, event_id) REFERENCES events (company_id, id),
  FOREIGN KEY (company_id, guest_id) REFERENCES guests (company_id, id)
);
CREATE UNIQUE INDEX tickets_number_key ON tickets (company_id, ticket_number);
CREATE UNIQUE INDEX tickets_token_hash_key ON tickets (qr_token_hash);
CREATE INDEX tickets_guest_idx ON tickets (guest_id);
CREATE INDEX tickets_event_idx ON tickets (event_id);
-- One live ticket per guest per event.
CREATE UNIQUE INDEX tickets_event_guest_live_key ON tickets (event_id, guest_id) WHERE status <> 'CANCELLED';

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  ticket_id uuid NOT NULL,
  guest_id uuid NOT NULL,
  event_id uuid NOT NULL,
  sent boolean NOT NULL DEFAULT false,
  sent_at timestamptz,
  delivery_status text NOT NULL DEFAULT 'PENDING' CHECK (delivery_status IN ('PENDING','SENT','FAILED','DELIVERED','OPENED')),
  opened_at timestamptz,
  clicked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, ticket_id) REFERENCES tickets (company_id, id),
  FOREIGN KEY (company_id, guest_id) REFERENCES guests (company_id, id),
  FOREIGN KEY (company_id, event_id) REFERENCES events (company_id, id)
);
CREATE INDEX invitations_company_idx ON invitations (company_id, created_at DESC);
CREATE INDEX invitations_event_idx ON invitations (event_id);
CREATE INDEX invitations_ticket_idx ON invitations (ticket_id);

CREATE TABLE checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  ticket_id uuid NOT NULL,
  event_id uuid NOT NULL,
  guest_id uuid NOT NULL,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  checked_in_by uuid NOT NULL,
  gate text,
  device_id text,
  method text NOT NULL DEFAULT 'QR' CHECK (method IN ('QR','MANUAL')),
  FOREIGN KEY (company_id, ticket_id) REFERENCES tickets (company_id, id),
  FOREIGN KEY (company_id, event_id) REFERENCES events (company_id, id),
  FOREIGN KEY (company_id, guest_id) REFERENCES guests (company_id, id),
  FOREIGN KEY (company_id, checked_in_by) REFERENCES users (company_id, id)
);
-- Exactly-once check-in is enforced by the database itself.
CREATE UNIQUE INDEX checkins_ticket_key ON checkins (ticket_id);
CREATE INDEX checkins_event_idx ON checkins (event_id);
CREATE INDEX checkins_time_idx ON checkins (checked_in_at);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  timestamp timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}',
  FOREIGN KEY (company_id, user_id) REFERENCES users (company_id, id)
);
CREATE INDEX audit_logs_company_time_idx ON audit_logs (company_id, timestamp DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (company_id, entity_type, entity_id);

-- @down
DROP TABLE audit_logs;
DROP TABLE checkins;
DROP TABLE invitations;
DROP TABLE tickets;
DROP TABLE guests;
DROP TABLE event_managers;
DROP TABLE events;
DROP TABLE company_requests;
DROP TABLE platform_admins;
DROP TABLE password_resets;
DROP TABLE auth_credentials;
DROP TABLE users;
DROP TABLE company_settings;
DROP TABLE companies;
DROP TABLE plans;
