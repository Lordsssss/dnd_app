#!/usr/bin/env bash
# Met ce dossier du serveur à jour sur un commit précis, puis relance son service.
#   scripts/deploy.sh <commit>
# Appelé par scripts/deploy-hook.sh, lui-même déclenché par GitHub Actions (voir docs/DEPLOY.md).
# Les tests ont tourné dans GitHub Actions avant ; ici : code, dépendances, sauvegarde, redémarrage.
# Variables : DEPLOY_BRANCH (la branche suivie, ex. prod), DND_SERVICE (le service systemd),
#             DND_TABLE_CONFIG (la configuration de cette instance).
# Les migrations de la base tournent au démarrage, après une copie automatique de la base.
set -euo pipefail
cd "$(dirname "$0")/.."

sha="${1:?Usage : scripts/deploy.sh <commit>}"
branch="${DEPLOY_BRANCH:?DEPLOY_BRANCH manque}"
service="${DND_SERVICE:?DND_SERVICE manque}"
fail() { echo "✗ $*" >&2; exit 1; }

echo "→ Code : $branch @ ${sha:0:7}"
git fetch --quiet origin "$branch"
git merge-base --is-ancestor "$sha" "origin/$branch" || fail "$sha n'est pas sur origin/$branch"
[ -z "$(git status --porcelain --untracked-files=no)" ] || fail "modifications locales dans $(pwd) : rien n'est écrasé"
before="$(git rev-parse HEAD)"
git checkout --quiet "$branch" 2>/dev/null || git checkout --quiet -b "$branch" "origin/$branch"
git merge --ff-only --quiet "$sha" || fail "pas d'avance rapide de ${before:0:7} vers ${sha:0:7}"
echo "  $(git log --oneline -1)"

echo "→ Dépendances"
if ! git diff --quiet "$before" HEAD -- package.json package-lock.json || [ ! -d node_modules ]; then
  npm ci --omit=dev --no-audit --no-fund --silent
else
  echo "  inchangées"
fi

echo "→ Sauvegarde de la base"
npm run --silent cli -- backup

echo "→ Redémarrage de $service"
pid="$(systemctl show "$service" -p MainPID --value 2>/dev/null || echo 0)"
[ -n "$pid" ] && [ "$pid" != "0" ] || fail "le service $service ne tourne pas : sudo scripts/install-service.sh"
# Sans sudo : le service enregistre, sort avec le code 75, et systemd le relance.
kill -USR2 "$pid"
for _ in $(seq 1 30); do
  sleep 1
  now="$(systemctl show "$service" -p MainPID --value 2>/dev/null || echo 0)"
  if [ "$now" != "0" ] && [ "$now" != "$pid" ] && systemctl is-active --quiet "$service"; then
    port="$(node -e "import('./server/config.js').then(c => console.log(c.loadConfig({ create: false }).port))")"
    if curl -fsS -o /dev/null "http://127.0.0.1:${port}/"; then
      echo "✓ $service relancé sur ${sha:0:7}, port $port"
      exit 0
    fi
  fi
done
fail "$service ne répond pas après le redémarrage : journalctl -u $service -n 50"
