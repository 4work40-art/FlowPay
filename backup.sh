#!/bin/bash
set -e
# pipefail критичен: бэкап это `pg_dump | gzip`. Без него код выхода берётся
# от gzip (0), даже когда pg_dump упал, — и на диск ложится валидный gzip
# нулевого содержимого, а скрипт рапортует «успех».
set -o pipefail
cd "$(dirname "$0")"
mkdir -p backups

STAMP=$(date +%Y%m%d_%H%M%S)
DB_BACKUP="backups/schyot_kontrol_${STAMP}.sql.gz"
docker compose exec -T postgres pg_dump -U sk_user schyot_kontrol | gzip > "$DB_BACKUP"

# Проверяем целостность дампа: gzip должен быть валиден и не пустым.
# Если pg_dump всё же отдал пустой/битый результат — удаляем файл и падаем,
# чтобы cron-лог и владелец увидели проблему, а не ложный «Backup saved».
if ! gunzip -t "$DB_BACKUP" 2>/dev/null; then
  echo "ERROR: битый gzip-дамп ($DB_BACKUP) — бэкап БД не удался" >&2
  rm -f "$DB_BACKUP"
  exit 1
fi
DB_SIZE=$(stat -c%s "$DB_BACKUP" 2>/dev/null || echo 0)
if [ "$DB_SIZE" -le 1000 ]; then
  echo "ERROR: дамп подозрительно мал (${DB_SIZE} байт) — вероятно, pg_dump упал" >&2
  rm -f "$DB_BACKUP"
  exit 1
fi

# Файлы-вложения (документы счетов, логотипы) — тоже в бэкап, иначе
# потеря диска = потеря документов при целой БД.
if docker compose exec -T api-gateway test -d /app/uploads 2>/dev/null; then
  docker compose exec -T api-gateway tar -czf - -C /app uploads > "backups/uploads_${STAMP}.tar.gz" || true
fi

# Храним последние 14 дневных бэкапов, остальное удаляем
ls -1t backups/*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --
ls -1t backups/uploads_*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm --

echo "Backup saved: $DB_BACKUP"
