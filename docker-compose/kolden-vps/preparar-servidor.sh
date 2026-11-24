#!/usr/bin/env bash
# Prepares a fresh Ubuntu 22.04/24.04 VPS: updates, Docker, firewall, swap,
# automatic security updates and Docker log rotation.
# Run once, as root:  sudo ./preparar-servidor.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root: sudo ./preparar-servidor.sh" >&2
  exit 1
fi

echo "==> Atualizando o sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl ufw fail2ban unattended-upgrades openssl

echo "==> Instalando o Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> Limitando o tamanho dos logs do Docker"
mkdir -p /etc/docker
if [ ! -f /etc/docker/daemon.json ]; then
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
  systemctl restart docker
fi

echo "==> Criando swap de 4 GB (memoria de reserva)"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
# Use swap only when RAM is really short
sysctl -w vm.swappiness=10
grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf

echo "==> Configurando o firewall (SSH, HTTP e HTTPS)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> Ativando atualizacoes automaticas de seguranca"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Ativando protecao contra forca bruta no SSH (fail2ban)"
systemctl enable --now fail2ban

echo
echo "Pronto. Proximo passo: cp .env.example .env, preencher os dominios e rodar ./gerar-segredos.sh"
