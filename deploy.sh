#!/bin/bash
set -e

SERVER_IP="${1:?Usage: deploy.sh <SERVER_IP>}"

apt-get update -y
apt-get install -y ca-certificates curl gnupg git ufw cron
systemctl enable --now cron

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

mkdir -p /opt
cd /opt
if [ -d FlowPay ]; then
  cd FlowPay
  git pull
else
  git clone https://github.com/4work40-art/FlowPay.git
  cd FlowPay
fi

if [ ! -f .env ]; then
  cat > .env <<ENVEOF
POSTGRES_PASSWORD=$(openssl rand -hex 16)
REDIS_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
CORS_ORIGIN=http://${SERVER_IP}:3000
NEXT_PUBLIC_API_URL=http://${SERVER_IP}:3001/api/v1
APP_BASE_URL=http://${SERVER_IP}:3000
YOOKASSA_SHOP_ID=
YOOKASSA_SECRET_KEY=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
ENVEOF
fi

docker compose up -d --build

echo "Waiting for Postgres..."
for i in $(seq 1 30); do
  docker compose exec -T postgres pg_isready -U sk_user -d schyot_kontrol >/dev/null 2>&1 && break
  sleep 2
done

# Разово чистим демо-счета/платежи/контрагентов, засеянные первым запуском (безопасно перезапускать)
docker compose exec -T postgres psql -U sk_user -d schyot_kontrol < infra/postgres/cleanup_demo_data.sql || true

# Миграции — идемпотентны, безопасно перезапускать
docker compose exec -T postgres psql -U sk_user -d schyot_kontrol < infra/postgres/migration_platform_admin.sql || true
docker compose exec -T postgres psql -U sk_user -d schyot_kontrol < infra/postgres/migration_multi_tenancy.sql || true
docker compose exec -T postgres psql -U sk_user -d schyot_kontrol < infra/postgres/migration_billing.sql || true
docker compose exec -T postgres psql -U sk_user -d schyot_kontrol < infra/postgres/migration_documents.sql || true
docker compose exec -T postgres psql -U sk_user -d schyot_kontrol < infra/postgres/migration_password_reset.sql || true
docker compose exec -T postgres psql -U sk_user -d schyot_kontrol < infra/postgres/migration_release_2.sql || true
docker compose exec -T postgres psql -U sk_user -d schyot_kontrol < infra/postgres/migration_revenue_events.sql || true
docker compose exec -T postgres psql -U sk_user -d schyot_kontrol < infra/postgres/migration_bank_import_dedupe.sql || true
docker compose exec -T postgres psql -U sk_user -d schyot_kontrol < infra/postgres/migration_release_3.sql || true
docker compose exec -T postgres psql -U sk_user -d schyot_kontrol < infra/postgres/migration_release_4.sql || true
docker compose exec -T postgres psql -U sk_user -d schyot_kontrol < infra/postgres/migration_release_5.sql || true
docker compose exec -T postgres psql -U sk_user -d schyot_kontrol < infra/postgres/migration_release_6_reminders.sql || true
docker compose exec -T postgres psql -U sk_user -d schyot_kontrol < infra/postgres/migration_release_7_outgoing_invoices.sql || true
docker compose exec -T postgres psql -U sk_user -d schyot_kontrol < infra/postgres/migration_backfill_due_date.sql || true
docker compose exec -T postgres psql -U sk_user -d schyot_kontrol < infra/postgres/migration_edo_placeholder.sql || true
# Отдельный контур администратора платформы (таблица platform_admins + сид).
# Идёт последней: опирается на audit_logs/subscription_events из миграций выше.
docker compose exec -T postgres psql -U sk_user -d schyot_kontrol < infra/postgres/migration_platform_admin_separation.sql || true

# Сид администратора платформы. Пароль НЕ хранится в git (раньше лежал открытым
# текстом в миграции) — генерируем случайный при первой установке, вставляем
# идемпотентно (INSERT ... WHERE NOT EXISTS) и один раз показываем владельцу.
# set -e активен, поэтому psql оборачиваем в условие, чтобы непустой результат
# или чужой пароль не роняли деплой.
ADMIN_COUNT=$(docker compose exec -T postgres psql -U sk_user -d schyot_kontrol -tAc "SELECT count(*) FROM platform_admins;" 2>/dev/null | tr -d '[:space:]' || echo "")
if [ "$ADMIN_COUNT" = "0" ]; then
  PLATFORM_ADMIN_PW=$(openssl rand -hex 12)
  # -v pw + :'pw' — безопасная подстановка через переменную psql, а не через stdin-файл.
  docker compose exec -T postgres psql -U sk_user -d schyot_kontrol -v pw="$PLATFORM_ADMIN_PW" \
    -c "INSERT INTO platform_admins (email, password_hash, name) SELECT 'admin@flowpay.internal', crypt(:'pw', gen_salt('bf')), 'Владелец платформы' WHERE NOT EXISTS (SELECT 1 FROM platform_admins);" || true
  CRED_FILE="/opt/FlowPay/platform_admin_credentials.txt"
  cat > "$CRED_FILE" <<CREDEOF
FlowPay — учётные данные администратора платформы (god-mode).
Логин:  admin@flowpay.internal
Пароль: ${PLATFORM_ADMIN_PW}
ВНИМАНИЕ: смените пароль после первого входа. Этот файл виден только root (0600).
CREDEOF
  chmod 600 "$CRED_FILE"
  echo "=== PLATFORM ADMIN CREATED ==="
  echo "Логин:  admin@flowpay.internal"
  echo "Пароль: ${PLATFORM_ADMIN_PW}"
  echo "Продублировано в ${CRED_FILE} (chmod 600). Смените пароль после первого входа."
else
  echo "Platform admin already exists — password unchanged"
fi

chmod +x backup.sh
CRON_LINE="0 3 * * * cd /opt/FlowPay && ./backup.sh >> /opt/FlowPay/backup.log 2>&1"
( crontab -l 2>/dev/null | grep -vF 'FlowPay/backup.sh' ; echo "$CRON_LINE" ) | crontab -

# SSH через `limit` (а не `allow`): ufw начинает придерживать источник,
# делающий >6 попыток подключения за 30 секунд — базовая защита от брутфорса
# по SSH, легитимные подключения не страдают.
ufw limit 22/tcp
ufw allow 3000/tcp
ufw allow 3001/tcp
ufw --force enable

echo "=== DONE ==="
docker compose ps
curl -s http://localhost:3001/health
echo
echo "App: http://${SERVER_IP}:3000"
