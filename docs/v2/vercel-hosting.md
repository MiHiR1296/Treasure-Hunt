# Treasure Hunt on Vercel

Treasure Hunt has its own Vercel project, `treasure-hunt-v2`, in the existing MRBT account. Its custom address is `hunt.mrbtstudio.com`. The portfolio remains a separate project at `mrbtstudio.com`: there is no portfolio route for the game and no navigation link between the two applications.

The existing Supabase database and private media bucket remain in place, preserving published hunts, custom puzzles, team progress and uploads. Vercel runs the Next.js application; Render is not needed for this runtime. Local Docker hosting remains supported.

The [player demo](https://hunt.mrbtstudio.com/v2) and [organizer console](https://hunt.mrbtstudio.com/v2/admin) are live on the custom domain. On 2026-09-19 (IST), GoDaddy DNS, trusted HTTPS, organizer sign-in, the full game, mobile feedback and private uploads passed verification there. The organizer password is unchanged. The earlier Render service is suspended; the existing Supabase database and storage remain active.

## Project configuration

Use Node 22, the Next.js framework preset and the repository root. [`vercel.json`](../../vercel.json) selects Singapore and a daily cleanup job. Keep the project on Hobby and Supabase on Free for the demo.

Configure these server-only environment variables for the deployment:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Existing Supabase session-pooler URL, with `sslmode=verify-full` |
| `DATABASE_CA_CERT` | Supabase root CA certificate in PEM format |
| `ORGANIZER_PASSWORD` | Existing organizer password |
| `APP_ORIGIN` | `https://hunt.mrbtstudio.com` |
| `ADDITIONAL_ORIGINS` | The exact Vercel aliases, comma-separated: `https://treasure-hunt-v2-mihirs-projects-067a6cd3.vercel.app,https://treasure-hunt-v2-seven.vercel.app` |
| `MEDIA_STORAGE` | `supabase` |
| `SUPABASE_URL` | Existing project's HTTPS origin |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service-role key |
| `SUPABASE_STORAGE_BUCKET` | `treasure-hunt-v2-media` |
| `SUPABASE_UPLOAD_BUCKET` | `treasure-hunt-v2-incoming` |
| `ENABLE_LEGACY_V1` | `false` |
| `CRON_SECRET` | Random secret of at least 32 characters |
| `NEXT_PUBLIC_MAP_PROVIDER` | Optional: `google` (default is OpenStreetMap / `osm`) |
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | Optional: Public browser API key for Google Maps JavaScript API |

### Google Maps API Key Security & Quotas

If configuring `NEXT_PUBLIC_MAP_PROVIDER=google`, you must provide `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`.

1. **Security & Restrictions**:
   - Restrict the browser API key in Google Cloud Console under **API & Services > Credentials**.
   - Enable **HTTP Referrers** restriction: add your production origin (`https://hunt.mrbtstudio.com/*`) and dev origins (`http://localhost:3000/*`).
   - Enable **API Restrictions**: restrict key usage strictly to the **Maps JavaScript API**. Do NOT enable Places, Directions, Geocoding, or Routes APIs for this key.

2. **Billing & Quota Safeguards**:
   - Google Maps JavaScript API requires a Google Cloud project with billing enabled, even though monthly free tier usage covers standard volume.
   - Configure **Budget Alerts** and daily quota caps in Google Cloud Console under **Billing > Budgets & alerts** to prevent unexpected billing.
   - **Fallback & Animation Note**: Automatic fallback to OpenStreetMap occurs on missing API keys and script load failures. Google Maps SDK controls its own viewport animations; exact parity with Leaflet reduced-motion handling is not guaranteed. Runtime authorization or quota exhaustion after SDK load is not guaranteed to auto-fallback.

The inline CA enables certificate and hostname verification without a filesystem secret. Vercel's database pool uses three connections per instance and the official pool lifecycle helper. No connection strings or storage service keys go to the browser.

Create both Storage buckets as **private**, with a 20,000,000-byte file limit and only the supported image/audio/video MIME types. Do not grant public upload/read policies. Apply the additive migration before publishing:

```sh
npm run db:migrate
npm run typecheck
npm run lint
npm test
npm run build
vercel deploy --prod
```

Run database integration tests against a dedicated test database, not the live Supabase database. Do not seed or restore over existing cloud data when moving between hosts.

If the remote build queue is delayed, Vercel also accepts a prebuilt deployment. Run `vercel pull --environment=production`, then `vercel build --prod` in a Linux x64 environment with Node 22 and Linux dependencies, followed by `vercel deploy --prebuilt --prod`. Building in a temporary Docker container does not make the deployed app depend on that container. Keep real environment files excluded from uploads; the public `.env.example` template must remain available because Vercel includes it in the function file map.

## Uploads and private downloads

Vercel functions have a [4.5 MB request and response limit](https://vercel.com/docs/functions/limitations#request-body-size). The browser obtains an authorized upload ticket, sends file bytes directly to the private incoming bucket, then asks the application to validate and commit the upload. Only small JSON requests pass through Vercel. Existing limits remain 20 MB for organizer assets and 10 MB for player photos.

Tickets bind the session owner, request ID, file size, checksum and photo task. Finalization rechecks the player's current task and GPS requirements, validates the file bytes and strips image metadata. Retries return the same committed media record. Unvalidated files cannot be read through the application.

Media reads still check organizer/player permissions and retention rules. Authorized reads redirect to an exact private object with a signed URL lasting at most 60 seconds; large audio/video downloads and range requests bypass the function response limit. A signed URL already issued can remain valid for its short lifetime.

## Cleanup and free hosting

The authenticated `/api/v2/maintenance` cron runs daily at 03:00 UTC. This follows [Hobby's daily cron limit](https://vercel.com/docs/cron-jobs/usage-and-pricing). It processes bounded batches of expired media, deletion receipts, temporary uploads, expired sessions and rate-limit windows. Large backlogs can take more than one run to drain. Expired media is denied by the application immediately, independently of the cleanup schedule.

Raw incoming files are removed after successful finalization. Their receipts remain past the signed write token's lifetime so cleanup also catches abandoned uploads or late token replays. Provider failures retain receipts for a later attempt. The existing continuous maintenance worker remains available for Docker/container hosting.

Supabase Free may pause after inactivity; check its [current plan limits](https://supabase.com/pricing) and resume the project before a scheduled demo if needed. This deployment does not require the laptop to run. Vercel deployment changes do not erase database rows or stored files.

## MRBT subdomain

Only `hunt.mrbtstudio.com` is attached to this Vercel project. DNS is managed at GoDaddy. This record was verified on 2026-09-19:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | `hunt` | `9423d65eeb7953e8.vercel-dns-017.com` |

The record uses a one-hour TTL. Vercel reports the DNS configuration as valid and has issued an automatically renewing HTTPS certificate. Re-check the project's domain settings before future DNS changes; Vercel may change the recommended value. Keep the portfolio's existing apex, `www`, nameservers and project configuration intact.

The application accepts the configured custom origin, the explicitly configured stable Vercel alias, and its exact Vercel-provided deployment hostname. Other Vercel projects and the portfolio origin are not accepted as mutation origins. Switching hostnames requires signing in again or rejoining with the existing team PIN because cookies belong to their original hostname.

Keep cloud database/media backups together; see the existing [backup notes](cloud-hosting.md#move-the-current-demo). Open **Events → QR materials** on the custom-domain organizer console to print entry codes using the new address. Replace any previously printed entry code that points to an older hostname; checkpoint payloads remain unchanged.
