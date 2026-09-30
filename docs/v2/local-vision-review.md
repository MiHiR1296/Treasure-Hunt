# Local vision review

## Decision

Photo recognition is an optional extension of the existing `verify_image`
action. The hosted application and PostgreSQL remain authoritative. A local
worker on the organizer's Mac claims durable jobs over outbound HTTPS, fetches
only the media assigned to that job, calls Ollama on loopback, and returns a
structured recommendation.

Existing photo actions remain human-reviewed. Enabling vision on one action
does not change another action or an already-published hunt version.

## Organizer workflow

An organizer supplies a target name, comparison scope, and reference images.
They select **Generate profile from references**. That creates a profile job;
the worker assigns useful reference views and drafts distinguishing features,
common confusers, and a concise comparison description. The generated profile
returns to the editor for review and is saved with the ordinary draft.

This deliberately requires one confirmation before publication: generated
metadata is useful authoring assistance, not a second source of truth.

Photo actions support three modes:

- `shadow`: record the recommendation without changing the team.
- `assisted`: show the recommendation beside existing human controls.
- `auto_approve`: approve only an eligible `MATCH`; every other result stays
  pending for the organizer.

Auto-approval is not based on the model's confidence label alone. The server
also requires an approved generated profile, usable image quality, affirmative
profile agreement, a configured number of visible evidence items, two
conservative verification passes, the configured confidence threshold, and
GPS when that action's policy requires it. The server reloads the team and
applies the ordinary revisioned engine control to the exact pending media.

## Data and transaction boundary

`hunt_v2.vision_jobs` is the durable outbox and result record. A photo job is
inserted in the same transaction as the accepted `submit_photo` state update
and command receipt. Its unique media binding makes replay idempotent. Target
profile jobs are created by an authenticated organizer endpoint.

Jobs contain immutable IDs and bounded policy/profile snapshots, never image
bytes or signed URLs. Claims use leases. Expired leases can be reclaimed, and
worker failures are retried a bounded number of times. Manual review never
depends on job success.

The result endpoint stores the structured result before attempting an
automatic transition. A stable job ID is also the engine request ID, so a
lost response or duplicate delivery cannot approve twice. A manual decision,
new photo, moved team, changed revision, or mismatched hunt version makes the
automatic application stale without affecting the later action.

## Trust boundaries

- The browser never receives the worker token, target profile, reference
  assets, or raw model result.
- The worker token is a high-entropy server secret stored on the Mac and in
  the hosted server environment. It can claim jobs and access only media
  listed on its active lease; it cannot issue arbitrary team controls.
- Reference inputs for generated profiles must be application-managed media
  (`/api/v2/media/<uuid>`). The worker never follows arbitrary organizer URLs.
- Supabase deployments redirect authorized worker reads to short-lived signed
  object URLs. Filesystem development serves the already-authorized bytes.
- Logs and durable results contain IDs, status, short rationale, bounded
  evidence, model, and prompt version—not signed URLs, image bytes, or hidden
  reasoning.

## Operations and risks

The worker processes one job at a time by default. It uses idle backoff, sends
heartbeats, deletes downloaded bytes from memory after each request, and tells
Ollama to unload after a short idle period. The organizer dashboard shows the
last worker heartbeat and per-photo job state.

The original smoke benchmark is not a production accuracy estimate. Before an
action uses auto-approval, collect real phone positives and hard negatives for
that exact target. Track false accepts, organizer overrides, queue age, and
latency per target. Disable auto-approval when a target or prompt/model version
has not been revalidated.

Include photographs containing misleading signs or on-image instructions in
that evaluation. Worker prompts treat image text as untrusted, but multimodal
prompt injection is still a model limitation and another reason automatic mode
must remain an explicit per-target choice.

Recognition does not prove live capture. The browser still permits choosing a
file. GPS, short-lived capture challenges, or physical supervision are
separate anti-replay measures.

For competitive timing, organizers should decide whether photo submission
time or eventual approval time governs bonuses. This release preserves the
existing engine timing behavior and records queue timestamps for later policy
work.

## Setup

1. Apply the additive database migration with `npm run db:migrate`, then deploy
   the reviewed `main` build.
2. Generate a secret, for example with `openssl rand -base64 48`. Configure it
   as the server-only `VISION_WORKER_TOKEN` in Vercel. Configure
   `VISION_MODEL=qwen3.8:27b-mlx` there as well. Redeploy after changing server
   environment values.
3. Store the same token in macOS Keychain rather than a committed env file:

   ```sh
   security add-generic-password -a "$USER" -s mrbt-treasure-hunt-vision -w '<generated token>' -U
   ```

4. Confirm Ollama and the model locally, then start the worker for the event:

   ```sh
   ollama list
   export VISION_WORKER_TOKEN="$(security find-generic-password -a "$USER" -s mrbt-treasure-hunt-vision -w)"
   export VISION_SERVER_URL="https://hunt.mrbtstudio.com"
   export VISION_WORKER_ID="mihir-event-mac"
   export VISION_MODEL="qwen3.8:27b-mlx"
   npm run vision:worker
   ```

5. Open **Run the event** and confirm that the worker is online. In a draft,
   add at least two uploaded references to a photo step, enable the assistant,
   enter the target name/scope, and generate its profile. Use shadow mode for
   the first real-device evaluation.

Stop the worker with `Ctrl-C`. Ollama receives a two-minute keep-alive and can
also be unloaded immediately with `ollama stop qwen3.8:27b-mlx`. Removing or
rotating `VISION_WORKER_TOKEN` on the server revokes the old worker. Delete the
matching Keychain item with `security delete-generic-password -a "$USER" -s
mrbt-treasure-hunt-vision` when it is no longer used.

The dashboard heartbeat is the health check. A queued profile or photo remains
durable while the worker is stopped; ordinary organizer photo review remains
available throughout.
