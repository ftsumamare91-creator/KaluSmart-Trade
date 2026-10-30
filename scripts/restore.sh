#!/usr/bin/env bash
# Usage: DATABASE_URL=postgresql://... ./scripts/restore.sh backups/file.dump
# WARNING: replaces the objects in the target database.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
FILE="${1:?usage: restore.sh <file.dump>}"
read -r -p "This REPLACES data in the target database. Type YES to continue: " ans
[ "$ans" = "YES" ] || { echo "Aborted."; exit 1; }
pg_restore --clean --if-exists --no-owner --dbname "${DATABASE_URL%%\?*}" "$FILE"
echo "Restore finished. Run a health check on /api/health before using the system."
