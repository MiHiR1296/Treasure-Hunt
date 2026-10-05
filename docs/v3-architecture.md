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

A team persists across replays. Starting again creates another run and never resets the previous attempt. Each run pins its hunt version, route, resolved variables, seed commitment, participating members, engine state, result, and eligibility. The leaderboard chooses one best eligible completed run per team by score, elapsed time, then completion time.

Stable member identity is required on gameplay commands. Registration supports self-serve, organizer-assigned, and rostered events. Canonical team codes remain usable even when an organizer corrects a display name. Roster claims, check-ins, session revocation, and organizer corrections are audited rather than used to rewrite run history.

## Deterministic planning and fairness

`lib/v3` is the pure V3 domain layer:

- `seed.ts`, `variables.ts`, and `planning.ts` deterministically derive route choices, challenge-pool variants, and safe placeholder values from the private run seed;
- `fairness.ts` enumerates or bounds eligible route combinations and rejects unequal score ceilings, duplicate checkpoint materializations, variant mismatches, and duration differences outside policy;
- `leaderboard.ts` implements best-run selection, score/time tie-breaking, and replay-board eligibility;
- `recognition.ts` blends positive server evidence with optional peer support without exposing failed attempts.

Publishing, rather than the player client, is the fairness gate. A published definition is immutable. New content creates a new version; active runs continue against their pinned version. Bonus impact is bound to the authoritative time, flow, or puzzle score source: competitive points must keep every route ceiling equal, while explicitly excluded delight points are stored separately and never affect official score or rank. Non-zero dud-QR awards and positive puzzle bonuses inside optional hints must be excluded because V3 cannot prove those opportunities reachable across every runtime path.

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

The existing modular engine remains responsible for checkpoint flows, timing, hints, verifier actions, and player views. V3 materializes only the selected run route and variants before invoking it. Hunt lifecycle and schedule checks are centralized so starts, commands, parallel lanes, and media submissions agree about ready/live/paused/ended state. Pause and review intervals excluded by policy are represented in server-owned timing state rather than client clocks.

Parallel mechanics require distinct authenticated members and record each accepted lane action with an idempotency key. Photo evidence is private, size/hash checked, bound to the member/run/task, and organizer reviewed. Durable bytes live either in a protected filesystem directory or a private Supabase bucket; database metadata remains authoritative.

## Player and public privacy

Player responses show only the current run material needed for that member. Team contribution and recognition views are private to authenticated teammates. Organizers can inspect named evidence and ballot audits and may create reasoned, append-only overrides.

The public board is a separate projection. It contains team-level fields selected by the organizer and never member names, contribution scores, ballot identities, private titles, session data, seeds, or answers. Frozen/final boards use an immutable snapshot so later run changes cannot silently alter an announced result.

## Authoring boundary

V3 does not call an AI provider. The versioned JSON Schema and authoring kit in `public/authoring/` and `docs/v3-authoring-kit.md` let an organizer use Codex or another external tool. Import always creates or updates an editable draft. Server-side JSON Schema validation, semantic validation, fairness validation, an organizer preview receipt for the exact draft revision, and an explicit publish action are all required before a version becomes playable. Generated run seeds, QR secrets, and production identifiers are not exported in the kit.

## Operations and deployment

The organizer console reads slim live rollups for team/member search, check-in state, active/best run, checkpoint, score, alerts, photo review, board capture, and analytics. Detailed reports and exports remain authenticated. Five-second visible-tab polling is an operational refresh mechanism, not a source of authority.

Live fairness alerts are deliberately observational and private to organizers. The server compares eligible completed runs only after each of two route peers or two variants in the same challenge pool has at least four completions from four distinct teams. It flags a group only when its average score trails by at least 10 points and 10%, or its median elapsed time trails by at least five minutes and 20%. The console displays the completion and team sample counts and explicitly calls the result an operational review signal, never proof that a route is unfair; publication-time exhaustive fairness validation remains the authoritative gate.

`scripts/v3-cloud-start.mjs` validates the HTTPS origin and durable private media configuration, applies the additive V3 schema, then supervises Next.js and the retention worker. Compose applies the same schema and runs a separate maintenance service. Vercel invokes the bounded maintenance endpoint with `CRON_SECRET`. `/api/v3/health` proves database reachability; `npm run smoke:v3` performs read-only HTTP checks.

V3 backup and restore are intentionally separate from migration. `npm run backup:v3` exports only the private `hunt_v3` schema plus every referenced durable media object and hashes both. It requires quiesced writes and fails if uploads or deletions are in flight. `npm run restore:v3` accepts only a fresh database without `hunt_v3` and an empty private media target. See [the cutover runbook](v3-cutover.md).

## Verification boundary

Unit tests cover deterministic planning, fairness, ranking, recognition, validation, and redaction. PostgreSQL integration tests cover constraints, isolation, concurrency, receipts, rollups, and audit behavior. Playwright covers supported mobile-sized browser flows. Real Android Chrome and iPhone Safari testing remains mandatory for camera permission, GPS accuracy, QR scanning, outdoor behavior, public HTTPS, download/share fallback, and the native share sheet; emulation is not evidence for those capabilities.
