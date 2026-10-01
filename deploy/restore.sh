#!/usr/bin/env bash
# Restore a backup made by deploy/backup.sh into this server's database container. REPLACES all current data.
#
# Usage:  deploy/restore.sh /var/backups/eventpass/20260930-031500Z
set -euo pipefail

src="${1:?usage: deploy/restore.sh <backup directory>}"
[ -f "$src/database.sql.gz" ] || { echo "$src must contain database.sql.gz" >&2; exit 1; }
gzip -t "$src/database.sql.gz"
cd "$(dirname "$0")/.."

echo "This replaces ALL EventPass data on this server with the backup in $src."
read -r -p "Type 'restore' to continue: " answer
[ "$answer" = "restore" ] || { echo "Cancelled."; exit 1; }

echo "Stopping the app..."
docker compose stop app caddy
docker compose up -d db
until docker compose exec -T db pg_isready -U eventpass -d eventpass -q; do sleep 1; done

echo "Restoring the database..."
gunzip -c "$src/database.sql.gz" | docker compose exec -T db psql -q -v ON_ERROR_STOP=1 -U eventpass -d eventpass > /dev/null

echo "Starting everything..."
docker compose up -d
echo "Done. Check: docker compose logs -f app   (it should say 'EventPass API listening')"
