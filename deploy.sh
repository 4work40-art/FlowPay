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

chmod +x backup.sh
CRON_LINE="0 3 * * * cd /opt/FlowPay && ./backup.sh >> /opt/FlowPay/backup.log 2>&1"
( crontab -l 2>/dev/null | grep -vF 'FlowPay/backup.sh' ; echo "$CRON_LINE" ) | crontab -

ufw allow 22/tcp
ufw allow 3000/tcp
ufw allow 3001/tcp
ufw --force enable

echo "=== DONE ==="
docker compose ps
curl -s http://localhost:3001/health
echo
echo "App: http://${SERVER_IP}:3000"
