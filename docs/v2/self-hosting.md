# Self-hosting and operations

V2 runs on Node 22, PostgreSQL and either persistent filesystem media or a private Supabase Storage bucket. The default Docker Compose setup uses PostgreSQL 17 and filesystem media without a hosted database dependency; a tunnel or the optional Caddy configuration supplies public HTTPS.

For a demo that stays available when the organizer computer is off, use the [free cloud hosting setup](cloud-hosting.md). It runs the web server and retention worker on Render, with PostgreSQL and private media in Supabase.

## Docker on an organizer computer

Copy `.env.example` to `.env`. Set a long unique `ORGANIZER_PASSWORD` (at least 12 characters), a URL-safe `POSTGRES_PASSWORD`, and `APP_ORIGIN` to the exact browser origin without a trailing slash. Example values are placeholders, not credentials to deploy.

```sh
docker compose up -d --build

docker compose ps
curl http://localhost:3000/api/v2/health
```

The health response is `{"status":"ok"}` only after the web app can query its V2 database. The database and web services have health checks. A separate maintenance service removes expired photos/sessions and old rate-limit windows every 60 seconds. The web container runs as the Node user and applies the additive V2 schema before starting. It does not automatically publish a demo. To publish the six-checkpoint demo explicitly, run `docker compose exec web npm run db:seed`; use `-- --upgrade` to publish a changed demo as a new version.

Open `http://localhost:3000/v2/admin`, sign in, choose the example or a template, preview it and publish. Share the published hunt's player URL. To change the local port, set `WEB_PORT` and update `APP_ORIGIN` to match.

Compose exposes only the web service on loopback. PostgreSQL has no host port. Data persists in `hunt-data`; uploaded assets and photos persist in `hunt-media`. Do not remove these volumes when simply stopping or updating the application.

```sh
docker compose down
```

This stops the services while retaining their volumes. Restart with the same Compose project name/directory to reuse that data.

## Public HTTPS from the local computer

Participant phones cannot use your computer's `localhost` URL. Camera/location browser permissions also need HTTPS away from localhost.

One preview option, after installing Cloudflare's tunnel client, is:

```sh
cloudflared tunnel --url http://localhost:3000
```

The command prints a temporary public HTTPS address. Set `APP_ORIGIN` to that exact origin and restart the web service; keep the tunnel process and organizer computer running. Quick tunnels are intended for testing and their hostname can change. Use a named tunnel or your own domain for a scheduled event. The command and testing limitations are documented in [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

```sh
docker compose up -d web
```

If local desktop access must remain available alongside the public URL, set `ADDITIONAL_ORIGINS=http://localhost:3000` (or a comma-separated list of specific trusted origins). Mutation requests accept only these configured exact origins. Do not use wildcards. Session Secure behavior follows the actual request origin, so a local HTTP session and a public HTTPS session can coexist.

Forward only the web endpoint. Preserve browser Origin and the original Host through the proxy. Do not expose the database or the raw media directory. Verify `/api/v2/health`, organizer sign-in, team join, a command, camera and location through the **actual public URL**. A successful local build does not establish this setup.

## Domain HTTPS on a public server

Point the domain's DNS at your server and make ports 80/443 available to the reverse proxy. Set:

```dotenv
HUNT_DOMAIN=hunt.example.com
APP_ORIGIN=https://hunt.example.com
```

Then use the included Caddy configuration:

```sh
docker compose -f compose.yaml -f compose.https.yaml up -d --build
```

Caddy proxies to `web:3000` and persists certificates/configuration in separate volumes. A hostname in its site configuration enables automatic HTTPS; the server must meet the certificate authority's reachability requirements. See [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https) for deployment conditions. `Caddyfile` sets camera/geolocation permissions for the same origin and denies microphone use.

Use the same Compose files for future proxy operations. The application health endpoint and container logs distinguish app/database errors from DNS/certificate/tunnel errors.

## Optional Map Provider Configuration

Treasure Hunt V2 uses OpenStreetMap / Leaflet by default (`NEXT_PUBLIC_MAP_PROVIDER=osm`), requiring no API keys or Google Cloud setup.

To enable Google Maps:
1. Set `NEXT_PUBLIC_MAP_PROVIDER=google` in your environment files or container definitions.
2. Set `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=<your-google-maps-browser-key>`.
3. Restrict the browser API key in Google Cloud Console to authorized HTTP referrers (e.g. `https://hunt.example.com/*` and `http://localhost:3000/*`) and restrict usage to the Maps JavaScript API only.
4. If `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` is missing or fails to load, the map renderer automatically falls back to OpenStreetMap without interrupting player sessions.

## Development and generic cloud hosting

Supply `DATABASE_URL`, `ORGANIZER_PASSWORD`, `APP_ORIGIN`, and optionally `MEDIA_DIRECTORY` in `.env` or the process environment. The default media directory is `.data/media`; use a persistent path in production. Remote PostgreSQL TLS settings belong in the connection URL.

```sh
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

For a production Node process:

```sh
npm ci
npm run db:migrate
npm run build
npm start
```

Build does not require a live database. Run the migration once before deploying multiple app instances. All instances need the same database, configured credentials/origins and shared durable media path; independent ephemeral filesystems will lose or split uploaded files. Standard reverse proxies/load balancers can forward HTTP to the Node service.

V2 tables live in private schema `hunt_v2` with public privileges revoked and row-level security enabled. Use a server-only database role and never expose the schema through a public database API. Supabase-hosted PostgreSQL is possible as a server database, but browser Supabase credentials are not needed.

## Backups and restoration

The supplied backup pauses the web and maintenance services so database metadata and media files stay consistent, writes a PostgreSQL custom-format dump and compressed media archive, then restores the prior running state. It creates a **new** destination directory and uses restrictive permissions.

```sh
npm run backup -- /absolute/path/to/new-backup-directory
```

The archive contains private event data and credential hashes. Store it as private event data. Keep the deployment environment/credentials separately; they are not included in the archive.

Restoration intentionally refuses any destination containing non-system tables. It stops both web and maintenance, then restores PostgreSQL in one transaction with immediate failure on an error. Choose a new Compose project and unused host port for a restore drill:

```sh
COMPOSE_PROJECT_NAME=hunt-restore WEB_PORT=3001 APP_ORIGIN=http://localhost:3001 npm run restore -- /absolute/path/to/backup-directory
```

This creates separate volumes, restores database/media and starts the app. Open the chosen URL and verify the restored hunt, team progression and an uploaded asset. Do not point the restore drill at your live event's volumes. Custom multi-file Compose deployments can set `COMPOSE_FILE` consistently for these scripts.

For a reproducible HTTP check, seed the current demo and run `npm run smoke` against the running app before the backup. It completes all six checkpoints in an isolated preview, tests wrong/dud QR recovery and puzzle validation, uploads a small asset, and saves `.data/verification/proof.json`. After restoring, run `SMOKE_ORIGIN=http://localhost:3001 npm run smoke -- --verify .data/verification/proof.json`; this compares restored session/progress and the uploaded bytes. Run the drill while those sessions are still valid. The proof contains session cookies: keep it private and do not commit or share it. This HTTP check does not replace browser camera or physical-device testing.

## Media and privacy

Organizer assets allow images/audio/video up to 20 MB. Images are reoriented, resized to fit 1600×1600, stripped to a standard JPEG derivative and served through authenticated access checks. Photos are compressed on the player device, limited to 10 MB at upload, validated/re-encoded server-side, and bound to team/checkpoint/action. Jigsaws can be generated from a managed image.

Photo retention options are after verification (default), after event, or retained. Unreviewed photographs with the default after-verification policy expire after seven days. After-event photographs wait for the team’s pinned event end time or an explicit event end/archive, so longer events retain their evidence. Review removes default-retention photo files; ending/archiving triggers cleanup for after-event photos. Expired media is denied on read, and opening media maintenance removes expired records/files. The Docker maintenance service also runs cleanup every 60 seconds, including scheduled event end times, expired sessions and old rate-limit windows. For generic Node hosting, run `npm run maintenance` as a supervised process or `npm run maintenance -- --once` from a periodic job.

The media library allows deletion only when no saved draft or published version references an asset. Event deletion removes its teams, sessions, command receipts, messages, photo records/files and event-linked audit. Published asset references in other events remain protected. End or archive an event first, then use the organizer deletion control and type its ID. Backups and downloaded copies have their own retention; deleting the running event does not erase those copies.

GPS submissions are used for a region check; raw position histories are not persisted. Media bytes, answers and session secrets must not be placed in public logs.

## Live event checklist

Create and preview the event, print its current QR/recovery materials, verify a wrong QR stays in the scanner, and try the fallback from a second device. Check the configured GPS region on site, deny camera/GPS once, submit a photo for review, and confirm organizer help/recovery works. Run an actual backup/restore drill before relying on the deployment.

Check health and logs when needed:

```sh
docker compose ps
docker compose logs --tail=100 web db
```

During an interruption, players retain cached current content and queued request identity; teammates can continue with the team PIN. Full offline installation/synchronization and LAN-only trusted certificates are not configured by this deployment.

## Browser checks

Run the [README verification commands](../../README.md#verify-changes) against a dedicated test database. Install the configured engines with `npx playwright install chrome webkit`; Linux hosts may need `--with-deps`. `npm run test:e2e` starts its own loopback development server on port 3100 and runs the `android-chrome`, `iphone-webkit` and organizer-only `desktop-chrome` projects. Do not run a second browser suite or another server on that port at the same time. The tests publish temporary hunts and remove them afterward.

For a focused compatibility check, set the same test `DATABASE_URL` and run `npm run test:e2e -- tests/e2e/mobile-compatibility.spec.ts`. This exercises grid entry while requests are pending, keyboard navigation, reload persistence, portrait/landscape layout and camera stream cleanup in both engines. WebKit emulation does not replace trying Safari camera permissions, GPS accuracy and the actual HTTPS event link on an iPhone.

In Events, expand a published hunt's **QR materials** and choose **Print QR materials**. The print layout contains only that event, with one QR per A4 page and any configured recovery code. Entry QRs use the browser's current origin, so print from the public HTTPS address for phone access. Disable browser-added print headers/footers if they are enabled. Checkpoint and mystery-marker QRs are scanned inside the hunt; only the entry QR opens the event URL directly.

## V1 boundary and verification record

V2 startup does not alter the old Supabase application's tables or security policies. Use the [V1 migration guide](migration.md) to convert content, review ambiguous historical hints, and deliberately retire old public access. The retirement SQL must be run against the old database by its operator; route disabling alone does not secure it.

The [acceptance register](acceptance.md) separates verified engine/database/browser behavior from deployment and physical-device evidence. No domain, tunnel or phone capability should be marked operational until tested against its actual current endpoint.
