#!/bin/sh
set -eu
umask 077
: "${PGHOST:?}" "${PGUSER:?}" "${PGDATABASE:?}" "${PGPASSWORD:?}"
CG_BACKUP_DIR=${CG_BACKUP_DIR:-/var/backups/cinegather}
mkdir -p "$CG_BACKUP_DIR"
CG_BACKUP_TEMP=$(mktemp "$CG_BACKUP_DIR/.pending.XXXXXX")
trap 'rm -f "$CG_BACKUP_TEMP"' EXIT INT TERM
pg_dump --format=custom --file="$CG_BACKUP_TEMP"
test -s "$CG_BACKUP_TEMP"
mv "$CG_BACKUP_TEMP" "$CG_BACKUP_DIR/cinegather-$(date -u +%Y%m%dT%H%M%SZ).dump"
date -u +%Y-%m-%dT%H:%M:%SZ > "$CG_BACKUP_DIR/last-success"
find "$CG_BACKUP_DIR" -type f -name 'cinegather-????????T??????Z.dump' -mtime +30 -delete
