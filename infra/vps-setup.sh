#!/usr/bin/env bash
# Prepara uma VPS Ubuntu 24.04 limpa para rodar o ERP Vanguard.
# Uso (como root, na VPS):
#   curl -fsSL https://raw.githubusercontent.com/PrimeERPSolucoes/ERP-Vanguard/claude/keen-dirac-i5mx15/infra/vps-setup.sh -o vps-setup.sh
#   bash vps-setup.sh
# Pode ser executado de novo sem problemas.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_DIR="/opt/vanguard"
SWAP_SIZE="${SWAP_SIZE:-2G}"
# SSH_KEY_ONLY=1 desliga o login por senha (só depois de ter chave no seu PC).
SSH_KEY_ONLY="${SSH_KEY_ONLY:-0}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root: sudo bash $0" >&2
  exit 1
fi

log "Atualizando o sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -y -q
apt-get install -y -q ca-certificates curl git ufw fail2ban unattended-upgrades htop

log "Fuso horário America/Sao_Paulo"
timedatectl set-timezone America/Sao_Paulo

log "Usuário '$DEPLOY_USER'"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG sudo "$DEPLOY_USER"
echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$DEPLOY_USER"
chmod 440 "/etc/sudoers.d/90-$DEPLOY_USER"

# Reaproveita as chaves SSH do root para o usuário de deploy.
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
if [ -s /root/.ssh/authorized_keys ]; then
  touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
  sort -u /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys" -o "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
fi

log "SSH"
# Senha só é desligada quando pedido e já existe chave, para ninguém ficar trancado para fora.
if [ "$SSH_KEY_ONLY" = "1" ] && [ -s "/home/$DEPLOY_USER/.ssh/authorized_keys" ]; then
  cat > /etc/ssh/sshd_config.d/90-vanguard.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF
  systemctl reload ssh
  echo "Login por senha desativado (somente chave SSH)."
else
  rm -f /etc/ssh/sshd_config.d/90-vanguard.conf
  echo "Login por senha continua ativo (fail2ban protege contra força bruta)."
  echo "Para exigir chave SSH: SSH_KEY_ONLY=1 bash vps-setup.sh"
fi

log "Firewall (SSH, HTTP, HTTPS)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

log "Fail2ban e atualizações automáticas de segurança"
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

log "Swap de $SWAP_SIZE"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l "$SWAP_SIZE" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
usermod -aG docker "$DEPLOY_USER"
systemctl enable --now docker

# Limita o tamanho dos logs dos containers para não encher o disco.
# Atenção: portas publicadas pelo Docker passam por cima do ufw, então os serviços
# internos (banco, API) devem expor portas só em 127.0.0.1 ou ficar sem porta publicada.
cat > /etc/docker/daemon.json <<'CONF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
CONF
systemctl restart docker

log "Pasta da aplicação $APP_DIR"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"

log "Pronto!"
echo "Docker:  $(docker --version)"
echo "Compose: $(docker compose version)"
echo "IP:      $(hostname -I | awk '{print $1}')"
echo
echo "Próximo passo: teste 'ssh $DEPLOY_USER@<IP>' de outro terminal antes de fechar este."
