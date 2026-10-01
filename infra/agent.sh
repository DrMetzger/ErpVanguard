#!/usr/bin/env bash
# Agente da VPS: executa os pedidos do painel (admin.erpvanguard.com.br).
#
# Segurança:
#  - O painel (na internet) não tem acesso ao Docker nem ao servidor: só grava pedidos numa fila.
#  - Este agente busca a fila pelo 127.0.0.1 com a senha AGENT_TOKEN (gerada aqui no servidor).
#  - Só existem as ações abaixo (case fechado). Cliente e e-mail são conferidos de novo aqui;
#    nada que vem do painel vira comando: só nomes já validados e valores gerados aqui.
#  - Excluir cliente não existe aqui de propósito (só manual).
#
# Rodado pelo systemd (vanguard-agent.service), um pedido por vez.
set -uo pipefail
APP_DIR="${APP_DIR:-/opt/vanguard}"
ENV_FILE="$APP_DIR/.env"
TENANTS_DIR="$APP_DIR/tenants"
BACKUP_DIR="$APP_DIR/backups/clientes"
PANEL="${PANEL_URL:-http://127.0.0.1:3100/api/agent}"
NETWORK="${DOCKER_NETWORK:-vanguard_default}"
MAIN_API="${MAIN_API:-vanguard-api-1}"
DB="${DB_CONTAINER:-vanguard-db-1}"
MEMORY="${TENANT_MEMORY:-768m}"
KEEP=14

SLUG_RE='^[a-z][a-z0-9-]{1,28}[a-z0-9]$'
EMAIL_RE='^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
ID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
RESERVED=" app admin www api db web control vanguard mail smtp ftp webmail cpanel ns1 ns2 demo status suporte help static cdn download "

log() { echo "[agente] $*"; }
token() { sed -n 's/^AGENT_TOKEN=//p' "$ENV_FILE" | tail -1; }

# Chamadas ao painel: a senha vai num arquivo de cabeçalho (não aparece na lista de processos).
HDR="$(mktemp)"; chmod 600 "$HDR"
trap 'rm -f "$HDR"' EXIT
refresh_header() { printf 'Authorization: Bearer %s\n' "$(token)" > "$HDR"; }
panel() { curl -fsS --max-time 30 -H @"$HDR" "$@"; }

rand_hex() { openssl rand -hex "$1"; }
rand_pass() { LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$1"; }

names() {
  SLUG="$1"
  US="${SLUG//-/_}"
  CONTAINER="vanguard-t-$SLUG"
  ALIAS="$SLUG-api"
  VOLUME="vanguard-t-$SLUG-media"
  DBNAME="vg_$US"
  DBUSER="vg_$US"
  TDIR="$TENANTS_DIR/$SLUG"
}

psql_admin() { docker exec -i "$DB" psql -X -q -U vanguard -d vanguard -v ON_ERROR_STOP=1 "$@"; }
# Banco do cliente ainda sem nenhum usuário (nova criação ou tentativa anterior que não chegou a subir)?
no_users() { local n; n="$(docker exec "$DB" psql -X -tA -U vanguard -d "$DBNAME" -c "SELECT count(*) FROM users" 2>/dev/null)"; [ -z "$n" ] || [ "$n" = 0 ]; }
main_image() { docker inspect -f '{{.Image}}' "$MAIN_API" 2>/dev/null; }
exists() { docker inspect "$CONTAINER" > /dev/null 2>&1; }

# Sistema (API) do cliente: mesma imagem do ERP, rede interna com o apelido <cliente>-api,
# banco e arquivos próprios, memória limitada, sem privilégios extras.
run_container() {
  local image extra=()
  image="$(main_image)" || { echo "Não achei o sistema principal ($MAIN_API)"; return 1; }
  [ -f "$TDIR/first.env" ] && extra=(--env-file "$TDIR/first.env")
  docker run -d --name "$CONTAINER" \
    --network "$NETWORK" --network-alias "$ALIAS" \
    --restart unless-stopped --memory "$MEMORY" --pids-limit 512 \
    --cap-drop ALL --security-opt no-new-privileges \
    --log-opt max-size=10m --log-opt max-file=3 \
    --label "vanguard.tenant=$SLUG" \
    -v "$VOLUME:/data/media" \
    --env-file "$TDIR/app.env" --env-file "$TDIR/shared.env" "${extra[@]}" \
    "$image" > /dev/null
}

# IA e e-mail do servidor repassados ao cliente (só estas variáveis).
write_shared_env() {
  ( umask 077; grep -E '^(GEMINI_API_KEY|GEMINI_MODEL|GEMINI_FALLBACK_MODELS|SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASS|SMTP_FROM)=' "$ENV_FILE" > "$TDIR/shared.env" || true )
}

wait_up() {
  for _ in $(seq 1 90); do
    docker exec "$CONTAINER" wget -qO- http://localhost:3000/api/health > /dev/null 2>&1 && return 0
    # Caindo e voltando sem parar: não adianta esperar os 3 minutos.
    if [ "$(docker inspect -f '{{.RestartCount}}' "$CONTAINER" 2>/dev/null || echo 0)" -ge 3 ]; then
      echo "O sistema do cliente não consegue iniciar: $(docker logs --tail 5 "$CONTAINER" 2>&1 | tr '\n' ' ' | cut -c1-400)"
      return 1
    fi
    sleep 2
  done
  echo "O sistema do cliente não respondeu em 3 minutos: $(docker logs --tail 5 "$CONTAINER" 2>&1 | tr '\n' ' ' | cut -c1-400)"
  return 1
}

do_backup() {
  local dir="$BACKUP_DIR/$SLUG" stamp file
  install -d -m 700 "$dir"
  stamp="$(TZ=America/Sao_Paulo date +%Y%m%d-%H%M)"
  file="$dir/$SLUG-$stamp-${1:-manual}.dump"
  docker exec "$DB" pg_dump -U vanguard -d "$DBNAME" -Fc > "$file.part" || { rm -f "$file.part"; echo "Falha no pg_dump"; return 1; }
  docker exec -i "$DB" pg_restore --list < "$file.part" > /dev/null || { rm -f "$file.part"; echo "Backup não abre"; return 1; }
  mv "$file.part" "$file"; chmod 600 "$file"
  ls -1t "$dir"/*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
  echo "Backup $(basename "$file") ($(du -h "$file" | cut -f1))"
}

do_create() {
  local email="$1" admin_pass=""
  install -d -m 700 "$TENANTS_DIR" "$TDIR"
  if [ ! -f "$TDIR/app.env" ]; then
    local dbpass; dbpass="$(rand_hex 24)"
    ( umask 077; {
      echo "DATABASE_URL=postgres://$DBUSER:$dbpass@db:5432/$DBNAME"
      echo "JWT_SECRET=$(rand_hex 48)"
      echo "ADMIN_EMAIL=$email"
      echo "MEDIA_DIR=/data/media"
      echo "TZ=America/Sao_Paulo"
      echo "NODE_ENV=production"
    } > "$TDIR/app.env.part" && mv "$TDIR/app.env.part" "$TDIR/app.env" )
  fi
  # Chave de uso único para o painel configurar a matriz antes do primeiro login do cliente (que exige o código por e-mail).
  grep -q '^SETUP_TOKEN=' "$TDIR/app.env" || ( umask 077; echo "SETUP_TOKEN=$(rand_hex 32)" >> "$TDIR/app.env" )
  local dbpass; dbpass="$(sed -n "s|^DATABASE_URL=postgres://$DBUSER:\([a-f0-9]*\)@.*|\1|p" "$TDIR/app.env")"
  [[ "$dbpass" =~ ^[a-f0-9]{48}$ ]] || { echo "Configuração do cliente inválida em $TDIR/app.env"; return 1; }

  # Banco próprio: usuário só dele, sem privilégios de administrador. Nomes e senha já conferidos (só [a-z0-9_]); a senha vai pela entrada, não pela linha de comando.
  if ! psql_admin -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$DBUSER'" | grep -q 1; then
    psql_admin <<< "CREATE ROLE \"$DBUSER\" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '$dbpass'" || { echo "Falha ao criar o usuário do banco"; return 1; }
  fi
  if ! psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname = '$DBNAME'" | grep -q 1; then
    psql_admin -c "CREATE DATABASE \"$DBNAME\" OWNER \"$DBUSER\"" || { echo "Falha ao criar o banco"; return 1; }
  fi
  psql_admin -c "REVOKE ALL ON DATABASE \"$DBNAME\" FROM PUBLIC" > /dev/null

  write_shared_env
  if ! exists; then
    # Senha provisória do administrador do cliente: só enquanto o banco dele não tem nenhum usuário.
    if no_users; then
      admin_pass="$(rand_pass 14)"
      ( umask 077; echo "ADMIN_PASSWORD=$admin_pass" > "$TDIR/first.env" )
    fi
    run_container || { rm -f "$TDIR/first.env"; return 1; }
    # Vai para o painel mesmo se a primeira subida demorar (o "Refazer criação" usa a mesma).
    if [ -n "$admin_pass" ]; then ( umask 077; printf %s "$admin_pass" > "$TDIR/.pass" ); fi
  else
    docker start "$CONTAINER" > /dev/null
  fi
  rm -f "$TDIR/first.env"
  wait_up || return 1
  echo "Sistema no ar ($CONTAINER)"
}

do_update() {
  exists || { echo "Sistema do cliente não existe: use Refazer criação"; return 1; }
  local was_running; was_running="$(docker inspect -f '{{.State.Running}}' "$CONTAINER")"
  do_backup antes-atualizar > /dev/null || { echo "Backup antes de atualizar falhou: nada foi mudado"; return 1; }
  write_shared_env
  rm -f "$TDIR/first.env"
  docker rm -f "$CONTAINER" > /dev/null
  run_container || return 1
  if [ "$was_running" = true ]; then wait_up || return 1; else docker stop "$CONTAINER" > /dev/null; fi
  echo "Atualizado para a versão atual"
}

# Executa um pedido. Tudo validado antes; ação fora da lista é recusada.
handle() {
  local id="$1" kind="$2" slug="$3" email="$4" out rc
  RESULT_PASS=""
  if ! [[ "$id" =~ $ID_RE ]]; then log "pedido com id inválido ignorado"; return; fi
  if ! [[ "$slug" =~ $SLUG_RE ]] || [[ "$RESERVED" == *" $slug "* ]]; then finish "$id" erro "Cliente inválido"; return; fi
  names "$slug"
  case "$kind" in
    criar)
      [[ "$email" =~ $EMAIL_RE ]] && [ "${#email}" -le 120 ] || { finish "$id" erro "E-mail inválido"; return; }
      out="$(do_create "$email" 2>&1)"; rc=$? ;;
    suspender) out="$(docker stop -t 20 "$CONTAINER" 2>&1 > /dev/null && echo Suspenso)"; rc=$? ;;
    reativar)  out="$(docker start "$CONTAINER" 2>&1 > /dev/null && wait_up && echo Reativado)"; rc=$? ;;
    reiniciar) out="$(docker restart -t 20 "$CONTAINER" 2>&1 > /dev/null && wait_up && echo Reiniciado)"; rc=$? ;;
    atualizar) out="$(do_update 2>&1)"; rc=$? ;;
    backup)    out="$(do_backup manual 2>&1)"; rc=$? ;;
    *) finish "$id" erro "Ação não permitida"; log "ação recusada: $kind"; return ;;
  esac
  # A senha provisória sai pelo arquivo (subshell não devolve variável); guardada no painel até a configuração.
  if [ "$kind" = criar ] && [ -f "$TDIR/.pass" ]; then RESULT_PASS="$(cat "$TDIR/.pass")"; rm -f "$TDIR/.pass"; fi
  log "$kind $slug: $([ $rc = 0 ] && echo ok || echo erro) $(echo "$out" | tail -1)"
  finish "$id" "$([ $rc = 0 ] && echo ok || echo erro)" "$(echo "$out" | tail -3 | cut -c1-1500)"
}

finish() {
  local args=(--data-urlencode "status=$2" --data-urlencode "message=$3")
  if [ -n "$RESULT_PASS" ]; then
    ( umask 077; printf %s "$RESULT_PASS" > "$TDIR/.pass-send" )
    args+=(--data-urlencode "adminPassword@$TDIR/.pass-send")
    ( umask 077; sed -n 's/^SETUP_TOKEN=\([a-f0-9]\{64\}\)$/\1/p' "$TDIR/app.env" | tr -d '\n' > "$TDIR/.setup-send" )
    [ -s "$TDIR/.setup-send" ] && args+=(--data-urlencode "setupToken@$TDIR/.setup-send")
  fi
  for _ in 1 2 3 4 5; do
    panel -o /dev/null -X POST "${args[@]}" "$PANEL/jobs/$1" && break
    sleep 5
  done
  rm -f "${TDIR:-/nonexistent}/.pass-send" "${TDIR:-/nonexistent}/.setup-send"
}

report_state() {
  local list="" s st img
  for s in $(docker ps -a --filter label=vanguard.tenant --format '{{.Label "vanguard.tenant"}}'); do
    [[ "$s" =~ $SLUG_RE ]] || continue
    st="$(docker inspect -f '{{.State.Running}}' "vanguard-t-$s" 2>/dev/null)"
    img="$(docker inspect -f '{{.Image}}' "vanguard-t-$s" 2>/dev/null)"
    list+="$s:$([ "$st" = true ] && echo rodando || echo parado):$img,"
  done
  panel -o /dev/null -X POST --data-urlencode "main=$(main_image)" --data-urlencode "tenants=$list" "$PANEL/state" || true
}

log "iniciado (fila em $PANEL)"
last_state=0
while true; do
  refresh_header
  if [ "$(( $(date +%s) - last_state ))" -ge 60 ]; then report_state; last_state=$(date +%s); fi
  line="$(panel "$PANEL/next" 2>/dev/null || true)"
  if [ -n "$line" ]; then
    read -r j_id j_kind j_slug j_email _ <<< "$line"
    handle "${j_id:-}" "${j_kind:-}" "${j_slug:-}" "${j_email:-}"
    report_state; last_state=$(date +%s)
    continue
  fi
  sleep 5
done
