#!/bin/sh
set -eu
source_directory=${1:?Usage: npm run restore -- /absolute/backup-directory}
test "$(cat "$source_directory/format")" = 'treasure-hunt-v2-backup-1'
test -s "$source_directory/database.dump"
test -s "$source_directory/media.tar.gz"
docker compose up -d --wait db >/dev/null
existing=$(docker compose exec -T db psql -U postgres -d treasure_hunt -Atc "select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema') and schemaname not like 'pg_toast%'")
if [ "$existing" -ne 0 ]; then
  printf '%s\n' 'Restore requires an empty destination database. Choose a new COMPOSE_PROJECT_NAME and new Docker volumes.' >&2
  exit 1
fi
docker compose stop web maintenance >/dev/null
docker compose exec -T db pg_restore -U postgres -d treasure_hunt --no-owner --no-privileges --single-transaction --exit-on-error < "$source_directory/database.dump"
docker compose run --rm --no-deps -T --entrypoint tar web -C /app/.data/media -xzf - < "$source_directory/media.tar.gz"
docker compose up -d web maintenance >/dev/null
printf '%s\n' 'Database and media restored. The application is starting.'
