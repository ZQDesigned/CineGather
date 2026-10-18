#!/bin/sh
set -eu
umask 077
CG_DEPLOY_DIR=${CG_DEPLOY_DIR:-/opt/cinegather}
CG_ENV_FILE=${CG_ENV_FILE:-/etc/cinegather/production.env}
CG_BACKUP_DIR=${CG_BACKUP_DIR:-/var/backups/cinegather}
mkdir -p "$CG_BACKUP_DIR"
CG_BACKUP_FILE="$CG_BACKUP_DIR/cinegather-$(date -u +%Y%m%dT%H%M%SZ).dump"
CG_BACKUP_TEMP=$(mktemp "$CG_BACKUP_DIR/.pending.XXXXXX")
trap 'rm -f "$CG_BACKUP_TEMP"' EXIT INT TERM
docker compose --env-file "$CG_ENV_FILE" -f "$CG_DEPLOY_DIR/infra/compose/production.yml" exec -T postgres pg_dump -U cinegather -d cinegather -Fc > "$CG_BACKUP_TEMP"
test -s "$CG_BACKUP_TEMP"
mv "$CG_BACKUP_TEMP" "$CG_BACKUP_FILE"
date -u +%Y-%m-%dT%H:%M:%SZ > "$CG_BACKUP_DIR/last-success"
find "$CG_BACKUP_DIR" -type f -name 'cinegather-????????T??????Z.dump' -mtime +30 -delete
