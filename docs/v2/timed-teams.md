# Timed teams, stable routes, hints and results

This upgrade extends the existing engine and transactional team aggregate. It does not randomize checkpoint order, verify identities or attendance, prevent screenshots, select official winners, or introduce a second hint/progression system. The release evidence and outstanding field checks are recorded in [acceptance](acceptance.md#timed-teams-upgrade-verification).

## Compatibility and authoring

New blank hunts default to a **120-minute personal allowance, two minimum members and four maximum members**. Organizers can change these in Design → Hunt settings, including explicitly allowing solo teams. Imported definitions, existing drafts, templates with their own settings, and published versions are not silently rewritten. Absent minimum means one, absent maximum keeps the previous default of 50, and absent duration means no personal deadline. Existing explicitly configured maxima remain unchanged. The supported size bounds remain 1–1,000; minimum cannot exceed maximum.

Existing teams stay pinned to their published version. Enabling a timer, changing team limits or upgrading route distribution affects newly registered teams on a future publication, not teams already playing. Do not publish or deploy during an event. Publication of an existing hunt preserves its lifecycle status; use Events to resume it explicitly.

Checkpoint access remains sequential, open or prerequisite-based; required/optional and skipped/completed semantics are preserved. Required completion records a finish timestamp, but does **not** bypass the personal deadline for subsequent optional play. The seven-day team authentication lifetime is independent of game duration, as is the 12-hour organizer session lifetime.

## Route assignments and preview

The weighted random-branch node remains the authoring model. Internal version 2 hashes a domain-separated tuple of hunt ID, published version, team ID, checkpoint ID and router ID with SHA-256. Selection retains the current weighted interpretation: proportions are probabilistic, not guaranteed equal headcounts. Legacy version 1 retains the exact previous hash/selection behavior, including its cross-router correlation.

Newly authored hunts use version 2. Existing drafts offer an explicit **Upgrade assignments for newly registered teams** action. Algorithm versions are not free-form authoring fields. All random routers are assigned when a team is created, including routers it might never reach. The state records choice index, destination, algorithm, assignment time and source. This does not execute branches, reveal tasks or award points. Existing teams without stored assignments materialize their unchanged legacy choices on their next accepted mutation; the recorded assignment time is the materialization time, not an invented registration time.

Reset, rescue, rejoin and deployment retain these assignments. Conditional and player-choice branches still execute normally. The player projection omits assignments and unreached branch content.

In Preview, each random router offers **Automatic** or an explicit route. Starting a preview creates an isolated team; changing a choice requires a fresh preview and never rewrites its history. Live registration/command endpoints reject override fields. Preview teams remain excluded from public standings and Results.

Warnings identify different potential automatic point totals, checkpoint-wide hints in branched flows and apparently incompatible hint dependencies. They are conservative graph checks, not judgments of difficulty or guaranteed scoring balance. Organizers still review routes, supply physical materials and decide fairness.

## Roster and start

A personal timer or a minimum above one enables the lobby. Creating a team saves its declared roster and assignments but does not reveal the first task, traverse the graph or begin timing. The creator may enter everyone; other members do not have to preregister or log in together. Incomplete rosters are allowed; every mutation enforces the maximum and normalized, case-insensitive duplicate detection.

Any authenticated teammate may edit a waiting roster. Start checks the pinned limits, live event status and start window. Roster snapshot, start timestamp, first progression, personal deadline and receipt commit together. Concurrent starts and a lost successful response cannot restart the timer. A stale roster edit cannot overwrite a start.

After start, players can only rejoin using a listed name. Devices are not members. Organizers can correct the roster with a reason and expected revision; the original starting roster remains in state/audit. Removing a member revokes that member's associated sessions (including matching legacy name-only sessions). A shared PIN still permits somebody to claim a listed name: **these are declared identities, not verified attendance or a secure captain role**. No contact details or cross-team duplicate-player registry are added.

Existing teams can authenticate and read saved progress when paused, expired or past the latest-start cutoff. Being signed in does not authorize gameplay after expiry.

## Time and lifecycle

For timed hunts, `startsAt` opens starting and `endsAt` closes **new starts**, not running teams. Starting exactly at `endsAt` is rejected. A two-hour team starting at 21:30 may play until 23:30 even when the latest start is 22:00. Untimed legacy hunts retain their existing event-end gate.

The server acquires locks in hunt → team order, then reads PostgreSQL `clock_timestamp()`. It recovers an existing command receipt before evaluating expiry. At `now >= deadline`, new answers, scans, hint purchases, puzzle saves/submissions, navigation and photo submissions fail with a stable reason code. Preparing a photo or entering text earlier does not backdate submission. A committed result remains recoverable with its original request ID after expiry.

The compact player timer derives from server time, anchored to the browser's monotonic clock; changing the device wall clock cannot extend it. Foreground/reconnection refreshes synchronize state. Paused/waiting/expired states are explicit. Offline work remains local for recovery, but **offline time counts** and reconnecting after expiry does not submit it retroactively. Saved progress, purchased information, help and permitted standings remain accessible.

Events → Pause freezes only timed teams that still had allowance when the lifecycle transaction acquired its locks. Already expired teams are not revived. Resume closes each open pause once and shifts its deadline. The same lifecycle operation is used by publication; publishing cannot silently skip pause accounting. Actual pause intersections are excluded from timed elapsed-time ranking, checkpoint time bonuses and elapsed-time hint unlocks.

Live control or Results → Extend allowance requires a reason and an exact team revision. Running teams receive extra allowance; an expired team is shown **Reopen for X minutes**, starting that allowance from authoritative now. Reopening while paused freezes the new allowance until resume. Extensions record old/new deadlines but do not subtract allowance or expired waiting from measured completion time. There are no automatic overtime deductions and no overtime gameplay.

Explicit End or Archive stops gameplay even for teams with remaining time. Its confirmation warns about running teams, pending photo reviews and retention. Ending a paused event closes its pause interval; reopening an ended event does not retroactively freeze the ended interval. Status updates use the hunt lifecycle revision so stale controls cannot reapply transitions.

## Photo evidence

Photo upload preparation and evidence submission independently verify the current task and playability. Image processing revalidates task permission. Crossing the deadline invalidates a new submission even when upload began earlier; only a previously committed submission receipt may be recovered.

Evidence submitted before expiry can be reviewed afterward. Organizer approval records the actual approval time and remains an organizer intervention, not a fabricated earlier player finish. Waiting for review does not automatically pause a team; an organizer can grant allowance if appropriate. Submission/review records and outcomes appear in the audit.

For timed hunts, neither latest-start cutoff nor personal expiry activates `after_event` deletion. Explicit End/Archive does. Existing `after_review` and retained policies remain honored, including the existing pending-evidence retention limit. After-review photos can disappear immediately after review; the audit is not a promise that the bytes remain available. Results links old evidence only while its policy permits access.

Cleanup rechecks eligibility under the same hunt/team lock order and queues storage deletion in the media-row transaction. Physical deletion happens after commit with retryable deletion jobs. Media reads and cleanup use the same timed/untimed retention rule. Private reference images and uploaded evidence stay organizer/team-authorized.

## Hint controls and discovery

Use one hint relationship: whole checkpoint, a step, or a supported crossword entry/word-search word. The existing costs, attempts, delays, completed-step requirements, dependency IDs and puzzle content remain authoritative. The new enabled switch and **show while otherwise locked** setting affect visibility, not transaction enforcement.

- Disabled, unpurchased hints are absent from the player response.
- Unreached targeted hints are entirely absent, including titles, costs, target metadata and media URLs.
- Once the target is demonstrably solved, its unpurchased hint disappears unless solve-based expiry is explicitly disabled.
- A previously purchased hint remains in reached-stage history without another charge. A purchased unsolved puzzle hint still withholds its reward; resets/refunds do not reveal it through history.
- Dependencies are satisfied by purchase, or by an enabled prerequisite rendered unnecessary by a demonstrated target solve with solve-expiry enabled. Disabled, unreached and unrelated-route prerequisites do not qualify.

First-solve facts survive grid erasure and ordinary resets. New discoveries record their server time; an old saved correct grid establishes a solve without inventing a historical timestamp. Existing completed timestamps can establish older node solves. Purchase and solve use the same team lock: solve first means no obsolete charge; purchase first retains a legitimate charge and content.

## Saved drafts versus this device

**Delete saved draft** removes only the server draft, with confirmation naming it. Published definitions, player progress and referenced media are unaffected. Both revision and immutable generation must match; a stale window cannot delete or overwrite a newly recreated draft with the same ID/revision. Retrying deletion of an already absent draft is harmless; if somebody recreated it, the old generation conflicts.

Dirty device work is retained by default, with an explicit discard choice. **Discard this device's recovery copy** affects only the named local copy; unrelated drafts/storage are left alone. Retained work from a deleted server draft can be saved as a new generation. Older open tabs lacking the generation must reload and reconcile their work before saving.

## Results, reviews and exports

Results is organizer-only and includes waiting/incomplete/expired teams as well as finishers. List pages contain 50 summaries. The dashboard polls a maximum of 200 recent team summaries, not full puzzle/answer/ledger histories; inspect a team on demand. Results can page through all live teams. Authoring definitions/drafts and pending photo metadata are still part of the organizer dashboard, so response size also depends on the event catalog and outstanding photos.

A team detail includes pinned definition metadata/version, declared and starting rosters, stored routes, playability, start/deadline/finish, pauses/extensions, ledger totals, completed/skipped checkpoints, visit/selection timings, attempts/discoveries, hints, photo audit, help and interventions. Wall checkpoint duration describes the latest recorded attempt. Selected time sums recorded visits and can include earlier attempts; neither proves physical time at a location. Missing historical measurements are labeled, not estimated.

Results and its JSON export allowlist hunt ID/title and checkpoint ID/title/base points/required metadata. They do not include configured answers, QR tokens, backup codes, dud tokens, GPS targets, or full nested player-view content. Actual recorded submissions and discoveries remain available for adjudication; exports still contain private roster/evidence data and should be stored securely. There is no solutions export. Live operations retains a separate **Inspect team, controls & private solutions** action, backed by organizer-only `/api/v2/admin/team-inspector`, for pinned-version recovery (including previews). It is not a Results endpoint. Every Results detail, activity and history endpoint rejects preview teams with 404.

Private review states are `pending`, `approved`, `flagged` and `disqualified`. Each records note, reviewer session, timestamp and reviewed state revision. Later state mutations visibly make the review outdated. These statuses neither alter points/public rankings nor declare winners. Compare interventions and final progress manually before official winner verification.

New accepted commands append activity records in the **same transaction** as state and receipt. Answer recording stays opt-in for existing definitions; newly created answer steps default to on with an explicit editor setting. The state keeps its existing latest-20, 500-character display cache; the private activity stream retains the full accepted submission (up to the existing 2,048-character input bound). Recorded answers, server-confirmed discoveries and interventions are not a keystroke log, raw QR-secret log or continuous location stream. Actors are authenticated sessions and declared names, not verified people. Historical data that was never captured is unavailable.

The inspector shows limited history with its full counts: latest 100 engine events/ledger entries (plus active hint charges), first 100 help requests and paginated audit activity. **Export complete team record (JSON)** fetches every recorded page at the inspected revision/count cutoff. Ledger/events are append-only prefixes; help requests use the read cutoff and their replies are explicitly read-time values. A detected missing page aborts export instead of silently truncating it.

**Export all team summaries (CSV)** first freezes the committed set of team IDs, then loads batches of 50. Late registrations cannot fall between UUID pages. Rows identify registration cutoff, read time and state revision; this is not a simultaneous whole-event score snapshot. A removed team aborts the export. The browser exporter explicitly caps at 10,000 teams; larger events must use paginated APIs. CSV fields are quoted and untrusted formula prefixes neutralized. Preview teams are excluded.

Private API entry point: `/api/v2/admin/results`. GET supports hunt summary pages, an export manifest, a team detail and revision/cursor-bounded activity/events/ledger/help pages. POST reads a validated manifest batch. Every path independently requires organizer authentication; requests and responses use the existing no-store/origin protections.

## Migration and release safeguards

`database/v2.sql` adds draft generation, nullable session/member association, lifecycle revision/pause metadata and append-only `team_activity` with private permissions. Timers, route choices, roster snapshot and result review remain authoritative in `GameState`, not independently writable copies in team columns. Existing sessions with null member IDs remain valid. The migration is repeatable and does not rewrite old definitions, scores, receipts or state histories.

Before release, back up database/media and schedule an idle event window. Apply the additive schema, deploy the compatibility-capable application to the established **`treasure-hunt-v2`** target, and only then let organizers save/publish new settings. Keep authoring closed during a mixed-version rollout; new fields are enabled by the new builder, not by a separate feature flag. Ask organizers to reload older tabs. Verify health, old-session receipt recovery, one isolated timed preview, photo policy and private Results after deployment.

An old binary is **not** a safe automatic rollback after new fields have been authored: strict old validators can reject them. Prefer a reviewed forward fix or a coordinated backup/recovery plan with authoring/play stopped and data-loss consequences understood. Do not delete additive columns/tables or rewrite published versions to make an old binary accept them. This implementation does not run production migrations, merge or deploy. Exact-final-SHA external review remains required.

No new production environment variable is required. The local stress runner supports `STRESS_ROUNDS` (8–1,000). Database-backed tests reject remote/non-test targets; use a disposable loopback PostgreSQL database whose name has a `test` segment. For example:

```sh
DATABASE_URL=postgresql://postgres:DISPOSABLE_PASSWORD@127.0.0.1:5432/hunt_test npm run test:integration
DATABASE_URL=postgresql://postgres:DISPOSABLE_PASSWORD@127.0.0.1:5432/hunt_test npm run test:e2e
DATABASE_URL=postgresql://postgres:DISPOSABLE_PASSWORD@127.0.0.1:5432/hunt_test STRESS_ROUNDS=60 npm run test:stress
```

The stress runner creates/removes its own synthetic event, verifies 100 teams with four sessions each, exact charges/awards, immutable routes, retry recovery and complete paginated activity. It measures local service/database operations, not Vercel HTTP latency or physical-phone behavior. Keep a real Android/iPhone field check for camera/GPS denial, poor connectivity, backgrounding and outdoor usability as an event-readiness requirement.
