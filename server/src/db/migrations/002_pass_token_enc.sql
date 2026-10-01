-- Keep each pass's QR token encrypted (AES-256-GCM, key derived from the server secret) next to its SHA-256 hash,
-- so a pass can be shown, downloaded or re-sent without changing it. Check-in still looks tickets up by the hash.
-- Tickets issued before this column existed get a token the first time their pass is shown.
ALTER TABLE tickets ADD COLUMN qr_token_enc text;

-- @down
ALTER TABLE tickets DROP COLUMN qr_token_enc;
