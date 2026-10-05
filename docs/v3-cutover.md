# V3 cutover, backup, and rollback runbook

This is an operator runbook. It does not authorize a production deployment. Use it only after the V3 pull request is externally approved for its exact HEAD SHA and merged to `main`.

## Permanent archive and release boundary

The final V2 source is already preserved at commit `cea603cf26250b48097cdf10af736aeff1916b91` in both:

- branch `archive/v2-final`;
- annotated tag `v2-final`.

Confirm the remote branch and tag before cutover. Do not move or recreate the tag. V3 has no runtime compatibility promise for V2 hunts, sessions, runs, or leaderboards. Recreate any hunt that should continue as a reviewed V3 draft; do not import historical attempts into competitive V3 results.

The Git archive is not a data backup. A **fresh, verified database and private-media backup immediately before cutover is mandatory**.

## Rehearsal gate

At least once before the event:

1. Back up the current environment while writes are stopped.
2. Restore into a completely separate database and private media directory/bucket.
3. Start the restored code against that isolated target and run the read-only smoke check.
4. Sign in through the actual public HTTPS origin and manually inspect an organizer view, a playable hunt, a private media item, and the public board.
5. Record archive location, hashes, source commit, restore target, operator, time, and outcome outside the repository.

Never use the production database, media directory, bucket, Compose project name, or public hostname for a restore rehearsal.

## V3 backup tool

The default `backup`, `restore`, and `smoke` package commands now mean V3. Explicit archival commands remain available as `backup:v2`, `restore:v2`, and `smoke:v2`.

V3 backup prerequisites:

- `DATABASE_URL` explicitly names its database user, host, and database; `MEDIA_STORAGE` and the matching filesystem or Supabase server credentials are configured;
- `pg_dump` matches the source PostgreSQL major version and `pg_restore` matches the destination PostgreSQL major version;
- for filesystem storage, `MEDIA_DIRECTORY` is an explicit absolute, non-symlink directory;
- for Supabase, the service-role key and private `SUPABASE_STORAGE_BUCKET` are configured;
- application writes and the retention worker are stopped or otherwise quiesced;
- in-flight direct uploads have finished or expired, and maintenance has drained the media deletion queue.

Native PostgreSQL tools use the connection URL's TLS parameters. When the deployment supplies a CA as a file, set `PGSSLMODE=verify-full` and `PGSSLROOTCERT=/absolute/path/to/ca.crt` for backup and restore. The archive contains private participant data, credential hashes, answers, QR secrets, photos, and audits; encrypt and access-control it accordingly. Environment secrets themselves are not included.

The scripts check client/server major versions before mutation. A backup may be restored to the same or a newer PostgreSQL server, but never an older server; use `pg_restore` matching the destination server to avoid version-specific session settings.

First print the password-free source confirmations without writing an archive:

```sh
npm run backup:v3 -- --describe-targets
```

Then create a **new absolute directory** using the exact values printed by that command:

```sh
V3_BACKUP_ACK=WRITES_QUIESCED \
V3_BACKUP_DATABASE_SOURCE='db.example:5432/treasure_hunt' \
V3_BACKUP_MEDIA_SOURCE='supabase:project.supabase.co/treasure-hunt-v3-media' \
npm run backup:v3 -- /absolute/private/backups/v3-2026-10-05
```

For filesystem media the confirmation looks like `filesystem:/absolute/persistent/media`. The tool never overwrites a directory. It writes `INCOMPLETE` first and removes that marker only after:

- a PostgreSQL custom-format dump of `hunt_v3` succeeds;
- the matching `pg_restore` can parse the completed custom archive;
- every referenced durable media object matches its database byte count and SHA-256 hash;
- pre/post table counts and media metadata prove the quiesced source did not change;
- the final database dump checksum is recorded and re-read.

Temporary objects in the incoming-upload bucket are not durable game media and are not archived. The tool refuses to proceed while an upload receipt is incomplete, so this exclusion cannot silently lose an accepted photo.

For a Compose-hosted V2 system at the initial V3 cutover, use `npm run backup:v2 -- /absolute/new-directory` while the V2 Compose services and volumes are still present. That command pauses V2 web/maintenance and captures its database and media volume. For a non-Compose V2 deployment, stop writes and take a provider database export plus a complete private-bucket export as one operational backup; the V3 schema-specific command cannot back up V2.

## Verify by restoring

Provision a new database in which the `hunt_v3` schema does not exist and a new empty private media directory/bucket. Keep every application process pointed at that target stopped. Configure the destination environment, then print the required confirmations:

```sh
npm run restore:v3 -- /absolute/private/backups/v3-2026-10-05 --describe-targets
```

Restore only after checking those labels character by character:

```sh
V3_RESTORE_ACK=EMPTY_TARGETS_AND_APP_STOPPED \
V3_RESTORE_DATABASE_TARGET='restore-db.example:5432/treasure_hunt_restore' \
V3_RESTORE_MEDIA_TARGET='supabase:restore-project.supabase.co/treasure-hunt-v3-media' \
npm run restore:v3 -- /absolute/private/backups/v3-2026-10-05
```

Restore validates all archive hashes before mutation. It refuses an existing `hunt_v3` schema, non-empty filesystem directory, or non-empty private bucket. It restores PostgreSQL in one transaction, uploads without overwrite, reads every media object back, and compares exact table counts. A failure does not delete or clean up the target; discard that isolated target and start again. Never turn a partially restored target into production.

Start the isolated application only after restore verification, then run:

```sh
SMOKE_ORIGIN=https://restore-hunt.example.test npm run smoke:v3
SMOKE_ORIGIN=https://restore-hunt.example.test \
SMOKE_PUBLIC_BOARD_SLUG=event-board npm run smoke:v3
```

The smoke check sends GET requests only. It checks V3 health, the public hunt listing, and optionally a public-board response for obvious private fields. It does not create a team, advance a run, upload media, or prove camera/GPS/share behavior.

## Production cutover

1. Confirm the approved release SHA, successful automated checks, migration notes, and the remote immutable `v2-final` archive.
2. Put the V2 event into a visible maintenance/closed state. Stop application writes, background retention, imports, and organizer edits.
3. Take the fresh V2 database/media archive described above and complete its restore verification. Do not continue with an unverified backup.
4. Provision/confirm V3's private database role, private durable-media target, separate private incoming-upload bucket where used, HTTPS origin, organizer secret, and maintenance secret. Keep the V3 app stopped.
5. Apply `npm run db:migrate:v3`. This creates/updates `hunt_v3`; it must not rewrite or drop V2 data.
6. Start the reviewed V3 release. Run `npm run smoke:v3` against the actual origin and inspect logs and the retention worker/cron result.
7. Import each event definition as a V3 draft, fix all path/schema/fairness errors, preview the exact revision, and publish explicitly. Create or import clean rosters; do not copy old runs into the V3 leaderboard.
8. Test self-serve/assigned/rostered registration as configured, two distinct member sessions, one run, a replay, contribution attribution, recognition privacy, organizer live operations, frozen/final public-board privacy, and a downloadable share card.
9. Open registrations and update the public link/QR material only after those checks pass. Keep the V2 deployment stopped but recoverable and retain the verified archive through the agreed retention period.

## Rollback

Rollback is an explicit environment switch, not an in-place downgrade:

1. Close V3 registration and pause/stop V3 writes. Preserve a fresh V3 backup even if the release is faulty; it may contain participant activity needed for support or audit.
2. Repoint a new recovery deployment to the reviewed `v2-final` source and restore the verified pre-cutover V2 database/media archive into clean V2 targets.
3. Run the V2 smoke/manual checks on a private hostname, then switch the public origin/DNS or reverse proxy only after it is healthy.
4. Regenerate or verify entry QR links for the restored origin. Existing browser sessions may not survive a hostname change.
5. Announce which attempts are authoritative. V3 registrations/runs created after cutover are not automatically compatible with V2 and must not be silently merged into the restored leaderboard.

Never drop `hunt_v3`, overwrite a media bucket, or restore over production as a shortcut. Keep failed V3 targets isolated for diagnosis and use the normal hotfix/PR/review workflow for a forward fix.

## Mandatory final device gate

Before a real event, test the actual production HTTPS URL on at least one physical Android phone and one physical iPhone. Verify team creation/join or roster claim, refresh/rejoin, QR scanning, denied then granted camera/location permissions, real GPS at a checkpoint, photo upload/review, parallel-member behavior on separate devices, finish/replay, story-image download, native share sheet, caption-copy fallback, organizer polling, and public-board privacy. Record device/browser versions and outcome. Playwright mobile emulation is useful coverage but cannot satisfy this gate.
