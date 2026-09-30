#!/usr/bin/env bash
# Backup diário do ERP Vanguard (rodado pelo timer vanguard-backup às 02:00, horário de Brasília).
# Guarda os últimos 14 dias em /opt/vanguard/backups:
#   vanguard-AAAAMMDD-HHMM.dump   banco inteiro (pg_dump formato custom, restaura com restore.sh)
#   media-AAAAMMDD-HHMM.tgz       vídeos enviados dos produtos
#   env-AAAAMMDD-HHMM             senhas do servidor (sem elas não dá para abrir certificados e senhas guardadas)
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/vanguard}"
DIR="$APP_DIR/backups"
KEEP="${KEEP:-14}"
# KIND=predeploy: cópia do banco antes de cada atualização (guarda as últimas 5, separadas das diárias).
KIND="${KIND:-vanguard}"
[ "$KIND" = vanguard ] || KEEP="${KEEP_PREDEPLOY:-5}"
STAMP="$(TZ=America/Sao_Paulo date +%Y%m%d-%H%M)"
COMPOSE=(docker compose --env-file "$APP_DIR/.env" -f "$APP_DIR/app/infra/docker-compose.yml")

exec 9>/run/vanguard-backup.lock
flock -n 9 || { echo "Outro backup em andamento"; exit 0; }
umask 077
install -d -m 700 "$DIR"

dump="$DIR/$KIND-$STAMP.dump"
"${COMPOSE[@]}" exec -T db pg_dump -U vanguard -d vanguard -Fc > "$dump.part"
# Confere se o arquivo abre antes de considerar o backup bom.
"${COMPOSE[@]}" exec -T db pg_restore --list < "$dump.part" > /dev/null
mv "$dump.part" "$dump"

if [ "$KIND" = vanguard ]; then
  docker run --rm -v vanguard_media-data:/m:ro -v "$DIR":/b alpine tar czf "/b/media-$STAMP.tgz" -C /m . 2>/dev/null || echo "Aviso: sem pasta de mídia"
  cp "$APP_DIR/.env" "$DIR/env-$STAMP"
  KINDS="vanguard media env"
else
  KINDS="$KIND"
fi

# Mantém só os últimos $KEEP de cada tipo.
for kind in $KINDS; do
  ls -1t "$DIR"/$kind-* 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
done
echo "Backup ok: $(basename "$dump") ($(du -h "$dump" | cut -f1)); guardados: $(ls -1 "$DIR"/$KIND-*.dump | wc -l)"
