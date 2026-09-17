# Free cloud demo hosting

The demo runs on a **Render Free web service** with **Supabase Free PostgreSQL and a private Storage bucket**. The application, saved hunts, team progress and uploads are independent of the organizer computer. No paid disk, paid database or Railway subscription is required.

## Current demo

- [Player home](https://treasure-hunt-v2-demo.onrender.com/v2)
- [Six-checkpoint showcase](https://treasure-hunt-v2-demo.onrender.com/v2?hunt=kalyan-demo)
- [Organizer console](https://treasure-hunt-v2-demo.onrender.com/v2/admin), using the existing organizer password
- [Render service dashboard](https://dashboard.render.com/web/srv-dam55f3m8hqs73bl7hf0)
- [Supabase project dashboard](https://supabase.com/dashboard/project/yutjqywygwueudxishei)

Verified on 2026-09-18 (IST), running commit `59e3079b8b368bc827ea62db4b19a987adab6d67`. Existing hunt definitions, published versions, team progress and three media assets were migrated and checked. The public six-checkpoint game reached 120 points; its session and exact uploaded image bytes survived a Render restart. Mobile Chrome at 390×844 passed organizer sign-in, repeated nearby wrong-answer feedback, floating success/points feedback and reload recovery. See the [cloud acceptance record](acceptance.md#free-cloud-deployment-verification).

## Free-plan limits

Render sleeps after 15 minutes without inbound traffic and typically takes about a minute to wake. Open the link before a demonstration. Its free filesystem is temporary, so `MEDIA_STORAGE=supabase` is required for this setup. Render provides 750 free instance hours per workspace each month. See [Render's free service limits](https://render.com/docs/free).

Supabase Free includes a 500 MB database, 1 GB of file storage and 5 GB egress, and pauses projects after a week of inactivity. Check the project before a scheduled demonstration and resume it if necessary. See [Supabase pricing](https://supabase.com/pricing). Keep the organization on Free and use an existing free project or an available free project slot.

Do not attach a payment method to Render for this zero-spend demo. Without a payment method, quota exhaustion suspends services instead of purchasing extra usage. See [Render's billing FAQ](https://render.com/docs/faq#all-of-my-services-run-on-free-instances-can-i-still-be-billed). If the account already has a payment method, review its usage/billing settings before launch; the free web-service plan alone does not cap account-wide overages.

## Deploy

The repository's [`render.yaml`](../../render.yaml) declares only one `plan: free` web service, uses the Dockerfile and starts `node scripts/v2-cloud-start.mjs`. It does not provision a Render database, whose free tier would expire after 30 days, or any paid disk. Deploy branch `codex/treasure-hunt-v2-foundation`. The health endpoint is `/api/v2/health`; the HTTP port is 3000. Automatic deployment is off so a later commit does not publish unexpectedly.

Create a **private** Supabase Storage bucket named `treasure-hunt-v2-media`, with a 20 MB file limit. Do not add public read/write policies for this bucket. The server checks that the bucket is private before starting. The service-role key stays in the server's environment; the browser continues using `/api/v2/media/:id` with the existing per-player and organizer access checks.

Supply these variables in Render:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase PostgreSQL session-pooler connection URL with TLS |
| `ORGANIZER_PASSWORD` | Long unique password, at least 12 characters |
| `MEDIA_STORAGE` | `supabase` |
| `SUPABASE_URL` | Project HTTPS origin, without a trailing slash |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service-role key |
| `SUPABASE_STORAGE_BUCKET` | `treasure-hunt-v2-media` |
| `ENABLE_LEGACY_V1` | `false` |
| `PORT` | `3000` |

Use the Supabase dashboard's **Connect** panel to obtain the exact session-pooler hostname and username; do not infer them from the project URL. See [connecting to PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres). Do not use an anonymous browser key as a database credential.

Use `sslmode=verify-full` in `DATABASE_URL`. Download the Supabase root CA from the project's Database settings, upload it to Render as the secret file `supabase-ca.crt`, and set `NODE_EXTRA_CA_CERTS=/etc/secrets/supabase-ca.crt`. For local import commands, set `NODE_EXTRA_CA_CERTS` to the absolute local certificate path; for `pg_restore`, use `PGSSLROOTCERT` and `PGSSLMODE=verify-full`. This verifies both the certificate and database hostname.

The public origin is read from Render's `RENDER_EXTERNAL_URL`. For a custom domain, set `APP_ORIGIN` to its exact HTTPS origin, without a trailing slash. Do not point the database URL or media configuration back to the laptop.

`start:cloud` validates the configuration and private bucket, applies the additive database schema, then supervises the web server and retention worker together. If either process exits, it stops the other and exits unsuccessfully for the host to restart. SIGTERM stops both cleanly. Startup does not automatically seed or overwrite any event.

## Move the current demo

Preserve custom puzzles, published versions, team progress and media together.

1. Take a fresh, consistent backup using the [backup procedure](self-hosting.md#backups-and-restoration) with `COMPOSE_PROJECT_NAME=treasure-hunt-v2-preview`. It briefly pauses writes, then restores the prior running state. Keep this archive private.
2. Keep the cloud web service stopped during import. Verify the destination project/database and that `hunt_v2` does not exist. Create only the empty namespace with `CREATE SCHEMA hunt_v2; REVOKE ALL ON SCHEMA hunt_v2 FROM public;`, then restore `pg_restore --schema=hunt_v2 --no-owner --no-privileges --single-transaction --exit-on-error`. The schema filter does not create the namespace itself. This full restore creates tables, loads data and sequence values, then installs foreign keys in the correct order. After restoration, apply `scripts/v2-migrate.mjs` for additive upgrades. Existing Supabase auth/storage/public V1 tables must remain untouched. If the target already contains V2 tables, use a new database/project instead of overwriting it.
3. Extract the media archive into a private local directory. With the **destination** database and Storage variables configured, run:

   ```sh
   node --env-file=.env.cloud scripts/v2-upload-media.mjs /absolute/path/to/extracted-media
   ```

   The script copies only media referenced by the destination database, verifies source size/hash, uploads without overwriting objects, and reads every remote object back to verify its hash. Re-running accepts an existing object only when its hash matches. Source files remain untouched. Keep `.env.cloud` outside Git.

4. Start the cloud web service. Compare hunt/version/team/media counts with the backup. Open the actual HTTPS URL and verify organizer sign-in, the custom puzzle, a player answer, private media authorization and an uploaded image.
5. Restart the cloud service and verify the same progress and image bytes remain. Check the retention worker logs. Share `/v2` and `/v2/admin` only after these checks pass.
6. Regenerate entry QR materials from the new origin. Browser cookies belong to the old hostname, so existing players rejoin with their team PIN. Checkpoint QR payloads remain in the saved definitions.

Keep the original preview and private backup until verification passes. The existing Compose backup/restore scripts target filesystem media; they are not a complete cloud backup. For cloud backups, export PostgreSQL and the private Storage bucket together while event writes are paused.

## Retention and restarts

Photo access still checks session permissions and expiry before reading private storage. The cleanup worker removes expired media while the service runs. Deleting a media record queues its storage key transactionally, including event/team cascades, so a temporary storage outage can be retried. The queue is private and drained by maintenance.

A sleeping free service does not run its cleanup worker. Cleanup resumes when the service wakes; expired media is denied by the application on read. This free demo setup does not promise continuously running background jobs.

## Other deployment options

The filesystem backend remains the default for local Docker Compose and servers with a persistent volume. Set an absolute `MEDIA_DIRECTORY` before using `npm run start:cloud` with that backend. Railway deployments additionally require an attached volume; this provider is not part of the free demo configuration.

Vercel requires further upload-flow changes because [its function payload limit](https://vercel.com/docs/errors/function_payload_too_large) is 4.5 MB. Render preserves the existing 20 MB organizer upload flow.

For subsequent releases, repeat the public endpoint, database, upload and restart checks before marking the deployment verified.
