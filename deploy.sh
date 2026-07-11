#!/bin/bash
set -e

SERVER_IP="${1:?Usage: deploy.sh <SERVER_IP>}"

apt-get update -y
apt-get install -y ca-certificates curl gnupg git ufw

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
ENVEOF
fi

docker compose up -d --build

ufw allow 22/tcp
ufw allow 3000/tcp
ufw allow 3001/tcp
ufw --force enable

echo "=== DONE ==="
docker compose ps
curl -s http://localhost:3001/health
echo
echo "App: http://${SERVER_IP}:3000"
