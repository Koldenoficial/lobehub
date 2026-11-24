#!/usr/bin/env bash
# Daily backup: both databases plus uploaded files, kept for 7 days in ./backups.
# Schedule it with cron (see LEIA-ME.md) and copy ./backups off the VPS.
set -euo pipefail
# Backups hold all company data: readable by root only
umask 077
cd "$(dirname "$0")"

KEEP_DAYS=${KEEP_DAYS:-7}
STAMP=$(date +%Y-%m-%d_%H%M)
DEST="backups/$STAMP"
mkdir -p "$DEST"

echo "==> Banco do LobeHub"
docker exec lobe-postgres pg_dump -U postgres -Fc lobechat > "$DEST/lobechat.dump"

echo "==> Banco do Twenty"
docker exec twenty-postgres pg_dump -U postgres -Fc twenty > "$DEST/twenty.dump"

echo "==> Arquivos (uploads do LobeHub e anexos do Twenty)"
docker run --rm -v kolden_rustfs-data:/data:ro -v "$PWD/$DEST":/out alpine \
  tar czf /out/lobe-arquivos.tar.gz -C /data .
docker run --rm -v kolden_twenty-local-data:/data:ro -v "$PWD/$DEST":/out alpine \
  tar czf /out/twenty-arquivos.tar.gz -C /data .

echo "==> Configuracao"
cp .env "$DEST/env.backup"
chmod 600 "$DEST/env.backup"

echo "==> Apagando backups com mais de $KEEP_DAYS dias"
find backups -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +

du -sh "$DEST"
echo "Backup concluido: $DEST"
