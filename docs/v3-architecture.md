# Treasure Hunt V3 architecture

## Boundary and ownership

V3 is the current runtime, not a compatibility layer over V2. Player and organizer traffic uses `/v3`, `/board`, and `/api/v3`; persistent V3 data lives in the private `hunt_v3` PostgreSQL schema. The `archive/v2-final` branch and annotated `v2-final` tag preserve the last V2 code. Historical V2 data is not included in V3 rankings and V3 code must not write V2 tables.

The server is authoritative. Browsers receive redacted views and submit authenticated, idempotent commands; they never receive private run seeds, expected answers, unused variants, credential hashes, named recognition ballots, or unrestricted organizer settings. PostgreSQL constraints and immutable-event triggers are the final integrity boundary.

## Persistent model

```text
Hunt
├── immutable published Hunt Versions
├── editable Drafts and private QR material
├── Teams (stable canonical identity)
│   ├── Team Members and check-ins
│   ├── Sessions and claim audit
│   └── Runs (one record per attempt)
│       ├── pinned version, private seed, route and variables
│       ├── member snapshot
│       ├── append-only events and score ledger
│       ├── positive contribution evidence
│       ├── private recognition votes/results/overrides
│       └── private media evidence
├── Public Board configuration and frozen snapshots
└── Live and analytics rollups
```

A team persists across replays. Starting again creates another run and never resets the previous attempt. Each run pins its hunt version, structural plan key/allocation cycle, route, resolved variables, seed commitment, participating members, engine state, result, and eligibility. The leaderboard chooses one best eligible completed run per team by score, elapsed time, then completion time; canonical team code is the final deterministic tie-break so an event has one winner.

Stable member identity is required on gameplay commands. A run takes an immutable snapshot of checked-in members when it starts; members who check in later cannot read, command, upload to, vote in, or view private results for that attempt and join the next run instead. Registration supports self-serve, organizer-assigned, and rostered events. Self-serve teams remain competition-pending until organizer approval, and moving an event live closes new-team creation while preserving existing-team sign-in. Approval is an organizer attestation, not proof of a unique human: cookies, names, and IP addresses cannot reliably stop one person using several browsers or aliases. Prize events that require one-team-per-person enforcement must use rostered registration plus organizer-issued participant identities and real check-in verification. Canonical team codes remain usable even when an organizer corrects a display name. Roster claims, check-ins, approval, disqualification, session revocation, and organizer corrections are audited rather than used to rewrite run history.

## Deterministic planning and fairness

`lib/v3` is the pure V3 domain layer:

- `seed.ts`, `variables.ts`, and `planning.ts` deterministically derive route choices, challenge-pool variants, and safe placeholder values from the private run seed;
- `fairness.ts` enumerates or bounds eligible route combinations and rejects unequal score ceilings, duplicate checkpoint materializations, variant mismatches, and duration differences outside policy;
- `leaderboard.ts` implements best-run selection, score/time tie-breaking, and replay-board eligibility;
- `recognition.ts` blends positive server evidence with optional peer support without exposing failed attempts.

Official structural plans are dealt from a private balanced deck rather than sampled independently with replacement. Allocation first chooses a plan the team has used the fewest times, then the least-used event-wide plan, and uses the private seed only to break a true tie. Publication declares a minimum meaningful plan count. This prevents route shopping and accidental clustering, but does not pretend a finite plan deck can remain unique after it is exhausted; official attempt caps remain part of event fairness. Practice is a one-way boundary for a team/hunt identity: once any practice run exists, every later run for that identity remains practice-only, even after disqualification restoration or a policy change. Players are never instructed to evade this boundary by creating another team. A legitimate correction requires an organizer-issued replacement registration after the organizer verifies the people involved.

The resolved V3 plan is also the only progression graph: selected checkpoints are required and linked sequentially in their private route order. V3 publication rejects open/dependency mode, optional selected checkpoints, and authored checkpoint prerequisites instead of previewing settings that runtime would replace.

Every run stores a unique per-hunt seed commitment, so the exact private seed cannot be assigned twice accidentally. This is not a promise that every bounded resolved value is unique: two distinct seeds can still choose the same colour or code. Security-bearing code generators therefore need at least 32 comparison-stable bits, while structural diversity comes from the separately balanced finite plan deck.

Publishing, rather than the player client, is the fairness gate. A published definition is immutable. New content creates a new version; active runs continue against their pinned version. Bonus impact is bound to the authoritative time, flow, or puzzle score source: competitive points must keep every route ceiling equal, while explicitly excluded delight points are stored separately and never affect official score or rank. Time tolerance is zero and every travel edge is required because raw elapsed time breaks score ties. Hidden seeded branches, unequal variant weights, immediate player fallbacks, GPS/QR-only completion paths, non-zero dud-QR awards, and positive puzzle bonuses inside optional hints fail publication when they cannot be proven neutral.

The same proof calculates separate positive and negative integer-cache exposure for official and excluded scores on every resolved route, including puzzle rewards that can be earned before a fallback. Publication rejects an overflow or any repeatable scored wrong-attempt penalty; runtime checks the cache boundary again before appending a ledger entry.

## Runtime request path

The V3 route handlers are thin adapters around `lib/server/v3` services. A mutating request is expected to pass this sequence:

```text
origin and body limits
→ authenticated organizer or team-member session
→ source and target rate limits
→ normalized input and idempotency receipt
→ transaction and row locks
→ engine/domain validation
→ append-only event/ledger/audit writes
→ redacted response
```

The existing modular engine remains responsible for checkpoint flows, timing, hints, verifier actions, and player views. V3 materializes only the selected run route and variants before invoking it. Hunt lifecycle and schedule checks are centralized so starts, commands, parallel lanes, and media submissions agree about ready/live/paused/ended state. Pause is the only reversible operator stop. Ending atomically abandons every open run and is terminal for that hunt identity; archived identities are terminal too. Archiving is available only for an unused ready hunt, never as an escape from a paused event with open runs. Pause and review intervals excluded by policy are represented in server-owned timing state rather than client clocks.

Parallel mechanics require distinct authenticated starting-roster members and record each accepted lane action with an idempotency key. Run/task-wide verifier budgets prevent extra identities from multiplying guesses. Photo evidence is private, size/hash checked, bound to the member/run/task/task-start epoch, and organizer reviewed; exact event-wide reuse is rejected even after media retention, while an approved media ID is consumed by at most one parallel lane. Rejected photo review time remains competitive elapsed time. Browser GPS is explicitly treated as spoofable, while QR values, static codes, and static answers are remotely shareable; each requires companion photo or a standalone organizer decision for competitive completion. Only a high-entropy run-scoped generated code can stand alone. Durable bytes live either in a protected filesystem directory or a private Supabase bucket; provider I/O occurs outside database transactions and database metadata remains authoritative.

Organizer recovery is narrow, authenticated, idempotent, and revision-locked. The server derives the current checkpoint and node after locking the run, so the live console cannot approve or reset an action named by stale browser state. A reset never deletes rejected guesses or accepted lane history: it appends a reasoned attempt allowance and a monotonic lane-window boundary. Earlier parallel successes remain auditable but cannot satisfy the reset window, and terminal or disqualified runs cannot be resurrected through recovery.

All cross-aggregate mutations use one explicit lock hierarchy: hunt, then team, then run, then lower media/result/board rows. This includes paths where PostgreSQL foreign-key checks would otherwise take implicit parent-row locks in the reverse order. Deterministic barrier tests cover run creation, finalization, expiration, media preparation/completion, and team competition controls.

## Player and public privacy

Player responses show only the current run material needed for that member. Until a stage is reached, its authored checkpoint and challenge-variant identifiers are replaced by an ordinal placeholder and its title, group, and map coordinates are omitted. The current stage keeps its authored identifier so idempotent commands remain bound to the exact authoritative action. Team contribution and recognition views are private to authenticated members of that run's starting roster. Organizers can inspect named evidence and ballot audits and may create reasoned, append-only overrides.

The public board is a separate projection. It contains team-level fields selected by the organizer and never member names, contribution scores, ballot identities, private titles, session data, seeds, or answers. Frozen/final boards use an immutable snapshot so later run changes cannot silently alter an announced result.

## Authoring boundary

V3 does not call an AI provider. The versioned JSON Schema and authoring kit in `public/authoring/` and `docs/v3-authoring-kit.md` let an organizer use Codex or another external tool. Import always creates or updates an editable draft. Server-side JSON Schema validation, semantic validation, fairness validation, an organizer preview receipt for the exact draft revision, and an explicit publish action are all required before a version becomes playable. Generated run seeds, QR secrets, and production identifiers are not exported in the kit.

## Operations and deployment

The organizer console reads slim live rollups for team/member search, check-in state, active/best run, checkpoint, score, alerts, photo review, board capture, and analytics. Detailed reports and exports remain authenticated. Five-second visible-tab polling is an operational refresh mechanism, not a source of authority.

Live fairness alerts are deliberately observational and private to organizers. The server compares eligible completed runs only after each of two route peers or two variants in the same challenge pool has at least four completions from four distinct teams. It flags a group only when its average score trails by at least 10 points and 10%, or its median elapsed time trails by at least five minutes and 20%. The console displays the completion and team sample counts and explicitly calls the result an operational review signal, never proof that a route is unfair; publication-time exhaustive fairness validation remains the authoritative gate.

`scripts/v3-cloud-start.mjs` validates the HTTPS origin and durable private media configuration, applies the additive V3 schema, then supervises Next.js and the retention worker. Compose applies the same schema and runs a separate maintenance service. Vercel invokes the bounded maintenance endpoint with `CRON_SECRET`. `/api/v3/health` proves database reachability; `npm run smoke:v3` performs read-only HTTP checks.

V3 backup and restore are intentionally separate from migration. `npm run backup:v3` exports only the private `hunt_v3` schema plus every referenced durable media object and hashes both. It requires quiesced writes and fails if uploads or deletions are in flight. `npm run restore:v3` accepts only a fresh database without `hunt_v3` and an empty private media target. See [the cutover runbook](v3-cutover.md).

## Verification boundary

Unit tests cover deterministic planning, fairness, ranking, recognition, validation, and redaction. PostgreSQL integration tests cover constraints, isolation, concurrent balanced allocation, immutable rosters, aggregate attempt budgets, evidence reuse, stale upload tickets, receipts, rollups, and audit behavior. Playwright covers supported mobile-sized browser flows. The full threat matrix is in [the adversarial release gate](v3-adversarial-release-gate.md). Real Android Chrome and iPhone Safari testing remains mandatory for camera permission, GPS accuracy, spoofing posture, QR scanning, outdoor behavior, public HTTPS, download/share fallback, and the native share sheet; emulation is not evidence for those capabilities.
