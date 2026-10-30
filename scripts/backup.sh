#!/usr/bin/env bash
# Usage: DATABASE_URL=postgresql://... ./scripts/backup.sh [output-file]
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
OUT="${1:-backups/kalusmart-$(date +%Y%m%d-%H%M%S).dump}"
mkdir -p "$(dirname "$OUT")"
# pg_dump does not accept Prisma's ?schema= parameter, so strip the query string.
pg_dump --format=custom --no-owner --file "$OUT" "${DATABASE_URL%%\?*}"
echo "Backup written to $OUT"
