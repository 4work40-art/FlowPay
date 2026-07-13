#!/bin/bash
set -e
cd "$(dirname "$0")"
mkdir -p backups

STAMP=$(date +%Y%m%d_%H%M%S)
docker compose exec -T postgres pg_dump -U sk_user schyot_kontrol | gzip > "backups/schyot_kontrol_${STAMP}.sql.gz"

# Файлы-вложения (документы счетов, логотипы) — тоже в бэкап, иначе
# потеря диска = потеря документов при целой БД.
if docker compose exec -T api-gateway test -d /app/uploads 2>/dev/null; then
  docker compose exec -T api-gateway tar -czf - -C /app uploads > "backups/uploads_${STAMP}.tar.gz" || true
fi

# Храним последние 14 дневных бэкапов, остальное удаляем
ls -1t backups/*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --
ls -1t backups/uploads_*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm --

echo "Backup saved: backups/schyot_kontrol_${STAMP}.sql.gz"
