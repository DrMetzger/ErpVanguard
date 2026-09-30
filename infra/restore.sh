#!/usr/bin/env bash
# Restaura um backup do banco (APAGA os dados atuais do ERP e volta os do arquivo).
# Uso (na VPS, como root): bash /opt/vanguard/bin/restore.sh /opt/vanguard/backups/vanguard-AAAAMMDD-HHMM.dump
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/vanguard}"
FILE="${1:?informe o arquivo .dump}"
[ -f "$FILE" ] || { echo "Arquivo não encontrado: $FILE"; exit 1; }
COMPOSE=(docker compose --env-file "$APP_DIR/.env" -f "$APP_DIR/app/infra/docker-compose.yml")
read -r -p "Isto substitui TODOS os dados atuais pelos de $(basename "$FILE"). Digite RESTAURAR para continuar: " ok
[ "$ok" = "RESTAURAR" ] || { echo "Cancelado"; exit 1; }
# Antes, um backup do estado atual (por segurança).
bash "$APP_DIR/bin/backup.sh" || true
"${COMPOSE[@]}" stop api
"${COMPOSE[@]}" exec -T db pg_restore -U vanguard -d vanguard --clean --if-exists --no-owner < "$FILE"
"${COMPOSE[@]}" start api
echo "Restaurado: $(basename "$FILE")"
