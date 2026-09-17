#!/bin/sh
set -eu
destination=${1:?Usage: npm run backup -- /absolute/new-backup-directory}
umask 077
mkdir "$destination"
destination=$(cd "$destination" && pwd)
web_was_running=$(docker compose ps --status running --services web)
maintenance_was_running=$(docker compose ps --status running --services maintenance)
resume_web() {
  if [ -n "$web_was_running" ]; then docker compose start web >/dev/null; fi
  if [ -n "$maintenance_was_running" ]; then docker compose start maintenance >/dev/null; fi
}
trap resume_web EXIT HUP INT TERM
docker compose stop web maintenance >/dev/null
docker compose exec -T db pg_dump -U postgres -d treasure_hunt -Fc > "$destination/database.dump"
# A stopped web container still holds its persistent media volume.
docker compose run --rm --no-deps -T --entrypoint tar web -C /app/.data/media -czf - . > "$destination/media.tar.gz"
printf '%s\n' 'treasure-hunt-v2-backup-1' > "$destination/format"
printf 'Database and media backup saved to %s\n' "$destination"
