-- Company logos are uploaded (PNG/JPEG, up to 512 KB) and stored here, so the server can put them on PDF passes and
-- into emails without fetching images from arbitrary URLs. The old logo_url column is no longer used.
ALTER TABLE company_settings
  ADD COLUMN logo_data bytea,
  ADD COLUMN logo_mime text CHECK (logo_mime IN ('image/png', 'image/jpeg')),
  ADD COLUMN logo_updated_at timestamptz;

-- @down
ALTER TABLE company_settings DROP COLUMN logo_updated_at, DROP COLUMN logo_mime, DROP COLUMN logo_data;
