-- An optional ID of the company's own for each guest (member number, staff ID, ...), unique among a company's
-- active guests (case-insensitive). Shown in every guest table and report, searchable, imported and exported.
ALTER TABLE guests ADD COLUMN external_id text;
CREATE UNIQUE INDEX guests_external_id_active_key ON guests (company_id, lower(external_id))
  WHERE status = 'ACTIVE' AND external_id IS NOT NULL;

-- @down
DROP INDEX guests_external_id_active_key;
ALTER TABLE guests DROP COLUMN external_id;
