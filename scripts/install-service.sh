#!/usr/bin/env bash
# Installe une instance de l'application comme service systemd, et son site HTTPS dans Caddy.
# Une fois par instance, avec sudo :
#   sudo scripts/install-service.sh production
#   sudo DOMAIN=dev.dnd.example.org scripts/install-service.sh staging
# Variables :
#   RUN_USER  le compte qui fait tourner l'application (par défaut celui qui lance sudo)
#   APP       le dossier du code   (production : ~/dnd-table,      staging : ~/dnd-table-staging)
#   DATA      le dossier des données (production : ~/dnd-table-data, staging : ~/dnd-table-staging-data)
#   VAULT     un coffre Obsidian relié par le pont, ouvert en écriture (production seulement)
#   DOMAIN    le nom de domaine du site ; sans lui, Caddy n'est pas touché
# Les mises à jour suivantes se font sans sudo : scripts/deploy.sh (voir docs/DEPLOY.md).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Avec sudo : sudo $0 ${1:-production}"; exit 1; }

target="${1:-production}"
RUN_USER="${RUN_USER:-${SUDO_USER:-}}"
[ -n "$RUN_USER" ] && [ "$RUN_USER" != root ] || { echo "Indique RUN_USER : le compte qui fait tourner l'application"; exit 1; }
HOME_DIR="$(getent passwd "$RUN_USER" | cut -d: -f6)"
GROUP="$(id -gn "$RUN_USER")"
case "$target" in
  production) SERVICE=dnd-table; APP="${APP:-$HOME_DIR/dnd-table}"; DATA="${DATA:-$HOME_DIR/dnd-table-data}" ;;
  staging) SERVICE=dnd-table-staging; APP="${APP:-$HOME_DIR/dnd-table-staging}"; DATA="${DATA:-$HOME_DIR/dnd-table-staging-data}"; VAULT="" ;;
  *) echo "Cible inconnue : $target (production ou staging)"; exit 1 ;;
esac
NODE="$(command -v node || true)"
[ -x "$NODE" ] || { echo "Node.js 22 introuvable"; exit 1; }
[ -f "$APP/server/index.js" ] || { echo "Pas de code dans $APP"; exit 1; }
[ -f "$DATA/config.json" ] || { echo "Pas de configuration dans $DATA/config.json"; exit 1; }

writable="\"$DATA\""
if [ -n "${VAULT:-}" ]; then
  [ -d "$VAULT" ] || { echo "Coffre introuvable : $VAULT"; exit 1; }
  writable="$writable \"$VAULT\""
fi

echo "→ Service $SERVICE : $APP, données $DATA${VAULT:+, coffre $VAULT}"
sed -e "s|@SERVICE@|$SERVICE|g" -e "s|@USER@|$RUN_USER|g" -e "s|@GROUP@|$GROUP|g" -e "s|@APP@|$APP|g" \
    -e "s|@DATA@|$DATA|g" -e "s|@NODE@|$NODE|g" -e "s|@WRITABLE@|$writable|g" \
    "$APP/deploy/dnd-table.service.in" > "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable --now "$SERVICE"
systemctl restart "$SERVICE"
sleep 3
systemctl is-active --quiet "$SERVICE" && echo "  $SERVICE actif" || { echo "  $SERVICE ne démarre pas : journalctl -u $SERVICE -n 50"; exit 1; }

if [ -n "${DOMAIN:-}" ] && [ -f /etc/caddy/Caddyfile ]; then
  port="$(sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' "$DATA/config.json" | head -1)"
  if grep -q "^$DOMAIN[[:space:]]*{" /etc/caddy/Caddyfile; then
    echo "→ Caddy : $DOMAIN déjà configuré"
  else
    echo "→ Caddy : $DOMAIN vers le port $port"
    cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-$(date +%Y%m%d-%H%M%S)"
    cat >> /etc/caddy/Caddyfile <<EOF

$DOMAIN {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "SAMEORIGIN"
		Referrer-Policy "no-referrer"
		-Server
	}
	request_body {
		max_size 64MB
	}
	reverse_proxy 127.0.0.1:$port
}
EOF
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null && systemctl reload caddy && echo "  https://$DOMAIN" \
      || { echo "  Caddyfile refusé : la copie de sauvegarde est à côté"; exit 1; }
  fi
fi

# Mauvais mots de passe : la règle fail2ban, si ce serveur en a une.
if [ -f /etc/fail2ban/filter.d/dnd-pin.conf ] && ! grep -q 'login|join|signup|recover' /etc/fail2ban/filter.d/dnd-pin.conf; then
  sed -i 's#"uri":"/api/join"#"uri":"/api/(?:login|join|signup|recover)"#' /etc/fail2ban/filter.d/dnd-pin.conf
  systemctl reload fail2ban 2>/dev/null || systemctl restart fail2ban
fi
echo "Fini."
