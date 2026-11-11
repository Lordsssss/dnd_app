#!/usr/bin/env bash
# Sauvegarde hors du serveur : une copie cohérente de la base et tous les fichiers envoyés
# (images, mondes), poussés vers une destination rsync. À lancer chaque nuit (cron ou timer).
#   DEST=user@machine:/chemin/sauvegardes scripts/backup-offsite.sh
#   DEST=/mnt/disque/sauvegardes          scripts/backup-offsite.sh
# Garde 14 copies datées de la base à destination ; les fichiers sont synchronisés.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DEST:?Indique la destination : DEST=user@hote:/chemin scripts/backup-offsite.sh}"
data="$(node -e "import('./server/config.js').then(c => { const cfg = c.loadConfig({ create: false }); console.log(c.resolveFromApp(cfg.dataDir)); })")"
stamp="$(date +%Y-%m-%d)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Copie cohérente même pendant que le serveur écrit (VACUUM INTO, mode WAL).
node --disable-warning=ExperimentalWarning -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[1], { readOnly: true });
db.prepare('VACUUM INTO ?').run(process.argv[2]);
" "$data/fiches.sqlite" "$tmp/fiches-$stamp.sqlite"

rsync -a "$tmp/fiches-$stamp.sqlite" "$DEST/db/"
rsync -a --delete "$data/files/" "$DEST/files/"

# Rotation des copies de la base à destination (locale seulement ; distante, voir le README).
if [[ "$DEST" != *:* ]]; then
  ls -1 "$DEST/db/"fiches-*.sqlite 2>/dev/null | sort | head -n -14 | xargs -r rm -f
fi
echo "Sauvegarde envoyée vers $DEST ($stamp)"
