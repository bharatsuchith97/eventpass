#!/usr/bin/env bash
# Back up the EventPass database (every company lives in it) as databases.sql.gz.
# Only needed for the bundled PostgreSQL container; managed services (Supabase, Neon, ...) have their own backups.
#
# Usage (from anywhere):      deploy/backup.sh
# Nightly at 03:15 via cron:  15 3 * * * /home/ubuntu/eventpass/deploy/backup.sh >> /home/ubuntu/eventpass-backup.log 2>&1
#
# Optional settings (environment):
#   BACKUP_DIR     where backups go             (default /var/backups/eventpass)
#   KEEP_DAYS      delete local backups older   (default 14)
#   RCLONE_REMOTE  also copy off the server, e.g. "r2:eventpass-backups" (needs rclone configured)
set -euo pipefail

cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-/var/backups/eventpass}"
KEEP_DAYS="${KEEP_DAYS:-14}"
stamp="$(date -u +%Y%m%d-%H%M%SZ)"
partial="$BACKUP_DIR/.partial-$stamp"
final="$BACKUP_DIR/$stamp"

mkdir -p "$partial"
trap 'rm -rf -- "$partial"' EXIT

echo "[$(date -u +%FT%TZ)] backing up to $final"
docker compose exec -T db pg_dump -U eventpass -d eventpass --clean --if-exists --no-owner | gzip > "$partial/database.sql.gz"

# A truncated or empty dump must never replace a good one.
gzip -t "$partial/database.sql.gz"
# grep -c reads to the end (grep -q would stop early and, with pipefail, fail on gunzip's broken pipe).
gunzip -c "$partial/database.sql.gz" | grep -c 'PostgreSQL database dump complete' > /dev/null \
  || { echo "database dump looks incomplete" >&2; exit 1; }

mv "$partial" "$final"
trap - EXIT
echo "[$(date -u +%FT%TZ)] ok: $(du -sh "$final" | cut -f1)"

if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "$final" "$RCLONE_REMOTE/$stamp"
  echo "[$(date -u +%FT%TZ)] copied to $RCLONE_REMOTE/$stamp"
fi

# Keep the last KEEP_DAYS days locally (off-server copies are managed by the bucket's own lifecycle rules).
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"$KEEP_DAYS" -exec rm -rf -- {} +
