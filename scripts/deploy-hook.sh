#!/usr/bin/env bash
# Point d'entrée des déploiements automatiques, pour une clé SSH réservée à GitHub Actions.
# Installé une fois hors du code (le code qu'il met à jour ne peut pas le modifier) :
#   install -m 755 scripts/deploy-hook.sh ~/.local/bin/dnd-deploy-hook
# et la clé de GitHub Actions, dans ~/.ssh/authorized_keys, ne peut lancer que lui :
#   command="/home/<user>/.local/bin/dnd-deploy-hook",restrict ssh-ed25519 AAAA… github-actions
# GitHub Actions envoie « staging <commit> » ou « production <commit> » ; rien d'autre n'est accepté.
# Réglages dans ~/.config/dnd-deploy.env (facultatif) : PROD_DIR, PROD_CONFIG, STAGING_DIR, STAGING_CONFIG.
set -euo pipefail

[ -f "$HOME/.config/dnd-deploy.env" ] && . "$HOME/.config/dnd-deploy.env"
PROD_DIR="${PROD_DIR:-$HOME/dnd-table}"
PROD_CONFIG="${PROD_CONFIG:-$HOME/dnd-table-data/config.json}"
STAGING_DIR="${STAGING_DIR:-$HOME/dnd-table-staging}"
STAGING_CONFIG="${STAGING_CONFIG:-$HOME/dnd-table-staging-data/config.json}"

read -r target sha extra <<< "${SSH_ORIGINAL_COMMAND:-}"
[ -z "${extra:-}" ] && [[ "${sha:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "Commande refusée" >&2; exit 2; }

case "$target" in
  production) dir="$PROD_DIR"; branch=prod; service=dnd-table; config="$PROD_CONFIG" ;;
  staging) dir="$STAGING_DIR"; branch=dev; service=dnd-table-staging; config="$STAGING_CONFIG" ;;
  *) echo "Cible inconnue : $target" >&2; exit 2 ;;
esac

# Un déploiement à la fois par instance.
mkdir -p "$HOME/.local/state"
exec 9>"$HOME/.local/state/dnd-deploy-$target.lock"
flock -w 600 9 || { echo "Un autre déploiement de $target est en cours" >&2; exit 1; }

log="$HOME/.local/state/dnd-deploy.log"
echo "$(date '+%F %T') $target ${sha:0:7} début" >> "$log"
if DEPLOY_BRANCH="$branch" DND_SERVICE="$service" DND_TABLE_CONFIG="$config" "$dir/scripts/deploy.sh" "$sha"; then
  echo "$(date '+%F %T') $target ${sha:0:7} réussi" >> "$log"
else
  code=$?
  echo "$(date '+%F %T') $target ${sha:0:7} ÉCHEC ($code)" >> "$log"
  exit "$code"
fi
