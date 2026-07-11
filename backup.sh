#!/bin/bash
set -e
cd "$(dirname "$0")"
mkdir -p backups

STAMP=$(date +%Y%m%d_%H%M%S)
docker compose exec -T postgres pg_dump -U sk_user schyot_kontrol | gzip > "backups/schyot_kontrol_${STAMP}.sql.gz"

# Храним последние 14 дневных бэкапов, остальное удаляем
ls -1t backups/*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --

echo "Backup saved: backups/schyot_kontrol_${STAMP}.sql.gz"
