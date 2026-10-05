# Treasure Hunt V3 external-AI authoring kit

This kit lets an organizer create or repair a Treasure Hunt V3 draft with Codex or another external AI without adding an AI provider to the website. It is an interchange format for editable drafts, not a publishing API.

The server remains authoritative. An imported file must pass JSON Schema validation, semantic engine validation, exhaustive fairness validation, preview, and an explicit organizer publish action. Import must never start a run, overwrite a published version, or publish by itself.

## Kit files

- Schema: [`/authoring/treasure-hunt-v3.schema.json`](../public/authoring/treasure-hunt-v3.schema.json)
- Safe starter: [`/authoring/treasure-hunt-v3.starter.json`](../public/authoring/treasure-hunt-v3.starter.json)
- Annotated parallel-play example: [`/authoring/treasure-hunt-v3.annotated-example.json`](../public/authoring/treasure-hunt-v3.annotated-example.json)

The annotated example uses its valid top-level `description` field and player-facing copy for explanations. JSON comments, unknown helper fields, and trailing commas are intentionally not used because they would make the document invalid or fail the strict schema.

## What validation means

Passing the JSON Schema proves field names, primitive types, supported variants, and basic bounds. It does not prove cross-references or game balance. The import pipeline must then check:

1. Every ID is unique in its required scope and every reference exists.
2. Every checkpoint flow is acyclic, every node is reachable, and every path reaches `complete`.
3. Puzzle layouts, solutions, options, dimensions, and referenced IDs are internally valid.
4. Placeholders refer to configured variables and use the safe `{{name}}` grammar.
5. Route locations resolve to a checkpoint or a challenge pool.
6. Every possible route and challenge-pool combination fits within the proof limit.
7. Every eligible route has the same calculated maximum competitive score.
8. Estimated route durations stay within the configured tolerance.
9. Parallel mechanics reference a `verify_organizer` gate and contain two to twenty valid lanes.
10. QR generation directives are replaced with private server-generated values before preview or publication.

Errors should identify an exact path such as `settings.challengePools.library.variants[1].scoreCeiling` and explain the calculated value that caused the failure.

## Top-level document

Every document has this shape:

```json
{
  "schemaVersion": 3,
  "id": "stable-hunt-id",
  "version": 1,
  "title": "Player-facing title",
  "description": "Optional organizer and player context",
  "settings": {},
  "theme": {},
  "checkpoints": []
}
```

IDs use letters, digits, underscores, and hyphens, begin with a letter or digit, and are at most 100 characters. Treat an ID as a durable reference: rename it only when the organizer explicitly asks. Published versions are immutable; editing creates a draft for a later version.

`checkpoints` retain the mature engine's private checkpoint, flow, action, puzzle, hint, recovery, and scoring shapes. V3 adds run orchestration around those definitions rather than creating another progression engine.

## V3 settings

The following V3 fields are required so imports do not silently inherit competition-critical behavior.

| Field | Purpose |
| --- | --- |
| `registrationMode` | `self-serve`, `organizer-assigned`, or `rostered`. |
| `runPolicy` | Controls whether official replays are disabled, capped, unlimited, or practice-only. |
| `leaderboardPolicy` | Fixes best-run ordering and controls the main/replay boards and time reveal. |
| `publicBoard` | Controls public team-level columns, identity display, and live/frozen/final state. |
| `socialShare` | Enables player-initiated share cards and optional organizer handle/hashtag. |
| `recognition` | Enables private contribution titles and optional peer recognition. |
| `routePlan` | Declares fixed locations, seeded selection, ordering, exclusions, and estimates. |
| `challengePools` | Maps a physical route location to alternative checkpoint definitions. |
| `variableGenerators` | Resolves deterministic per-run values from the private run seed. |
| `fairnessPolicy` | Sets proof limits, duration tolerance, travel assumptions, and bonus treatment. |

`parallelMechanics` is optional. Existing runtime-compatible fields remain available: `mode`, `map`, `rules`, `minTeamSize`, `maxTeamSize`, `sessionDurationSeconds`, `registrationOpen`, `startsAt`, `endsAt`, `completionMessage`, and `photoRetention`.

### Registration and team identity

- `self-serve`: players can create or join a team.
- `organizer-assigned`: players may join only a team created by the organizer.
- `rostered`: players claim a listed identity in an imported or organizer-entered roster.

Canonical team codes and display-name moderation are server concerns, not AI-authored hunt content. Do not put team names, member names, PINs, or a roster in this JSON. A roster uses the protected registration workflow after the hunt draft exists.

### Run policy

```json
{ "mode": "unlimited" }
```

Supported modes are:

- `disabled`: one official run; no replay creation.
- `capped`: at most `maxOfficialRuns`, counting the first run.
- `unlimited`: every completed replay can remain eligible.
- `practice-only`: the initial official run remains competitive and later runs are practice.

A replay always creates a new run. It never resets or overwrites an earlier run.

### Leaderboard policy

```json
{
  "bestRunRule": "score_then_time_then_completion",
  "mainBoardEnabled": true,
  "replayBoardEnabled": true,
  "replayBoardPublic": false,
  "timeVisibility": "after_second_eligible_run",
  "showProgress": true
}
```

`bestRunRule` is fixed: highest score, then lowest elapsed time, then earlier completion. The main board contains one best eligible completed run per team. The replay board contains only teams with at least two eligible completed runs and adds run count and improvement.

`timeVisibility` may be `never`, `after_second_eligible_run`, or `always`. Time still breaks ties even when it is hidden.

### Public board

`publicBoard.enabled` is an explicit opt-in. Supported columns are `rank`, `team_code`, `team_name`, `points`, `progress`, `completion_status`, `runs`, and `time`. Use `teamIdentity: "code_only"` when nicknames should not be shown.

Never add member names, contribution scores, peer votes, private titles, answer attempts, or route seeds to the public board. Whether main and replay tabs appear is derived from `leaderboardPolicy` and `replayBoardPublic`; `publicBoard.columns` controls only allowed columns.

### Social sharing

`socialShare` configures a branded result asset and player-initiated native share/download/copy actions. `organizerHandle` and `campaignHashtag` are optional. `allowPersonalTitle` controls whether a player may include their private recognition title.

Do not promise automatic Instagram posting or guaranteed tagging. A browser can open its native share sheet; the player chooses the destination and confirms the post.

### Recognition

```json
{
  "enabled": true,
  "peerVotingEnabled": true,
  "votingWindowMinutes": 60,
  "dataWeight": 0.7,
  "peerWeight": 0.3,
  "titleLibrary": {
    "trailblazer": "Trailblazer",
    "puzzle_ace": "Puzzle Ace",
    "codebreaker": "Codebreaker",
    "eagle_eye": "Eagle Eye",
    "clutch_player": "Clutch Player",
    "team_spark": "Team Spark"
  }
}
```

Weights must be non-negative and have a positive total. `0.7` and `0.3` are the product defaults. `titleLibrary` is optional and can override any of the six curated contribution titles with one to 100 characters.

Peer recognition is private, optional, other-member-only, and editable until the window closes. The three-step category/subtype flow is runtime configuration derived from actual hunt content; do not fabricate votes or put named vote data in the authoring JSON. Organizer title overrides are audited run data, not definition content.

## Seeds, generated variables, and placeholders

A run receives a private server-generated seed. Route selection, challenge choice, and variables derive from that seed with separate deterministic domains. The seed itself never appears in player views, this kit, screenshots, analytics exports, or share cards.

`variableGenerators` is an object keyed by a safe variable name matching `[A-Za-z][A-Za-z0-9_]{0,63}`:

| Type | Shape | Notes |
| --- | --- | --- |
| Literal | `{ "type": "literal", "value": "BLUE" }` | Fixed value. Useful for a branch that must not reroll. |
| Choice | `{ "type": "choice", "values": ["BLUE", "GREEN"] }` | One of 1–10,000 unique bounded string/number/boolean values. |
| Integer | `{ "type": "integer", "minimum": 10, "maximum": 90, "step": 10 }` | Inclusive safe-integer range; at most one million possible values. |
| Code | `{ "type": "code", "alphabet": "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", "length": 4 }` | Two to 128 unique characters and a length from four to 64. Shorter verifier codes fail publication. |

Use only a simple placeholder:

```text
Find the {{colour}} marker.
Enter {{code}}.
```

Whitespace inside braces is accepted. Expressions, filters, function calls, property access, and nesting are forbidden. `{{colour + 1}}`, `{{user.name}}`, and unbalanced braces fail validation. Unknown variables fail rather than rendering blank.

The importer allow-lists template-bearing, run-scoped fields. Placeholders are supported in the run description/theme, checkpoint titles and content (including prompts, answers, verifier codes, hints, and media content), run rules/completion text, dud-QR display content, and parallel lane labels/codes. Structural IDs and routing fields are never templated. The hunt title and event-level configuration such as `publicBoard`, `socialShare`, `recognition`, `routePlan`, `challengePools`, `fairnessPolicy`, registration, and replay policy also cannot contain placeholders because those values do not vary per run. The starter demonstrates supported use in `show_text.text`, action/puzzle prompts, `verify_answer.answers`, `verify_code.code`, and a parallel code lane.

A placeholder is resolved once for a run and then stored in that run's immutable resolved plan; adding another generator later must not reroll existing values. Publication checks every eligible route and challenge variant. It exhaustively checks generator outcomes when they can alter URL, puzzle-semantic, colour, or unique-token validity, and fails closed when that proof would exceed the bounded safety limit. Ordinary text/code fields use conservative length and non-whitespace proofs across the generator's full domain.

Generated values must not change score ceilings or difficulty. A branch driven by a non-literal generated variable must have equal reachable score ceilings on both sides.

## Route plans

`routePlan` describes physical route location IDs. A location either names a normal checkpoint directly or is a key in `challengePools`.

```json
{
  "startCheckpointId": "start",
  "finaleCheckpointId": "finale",
  "requiredCheckpointIds": ["mural"],
  "choose": {
    "count": 2,
    "fromCheckpointIds": ["library", "park", "cafe", "temple"]
  },
  "shuffleSelectedCheckpoints": true,
  "avoidTransitions": [
    { "from": "library", "to": "cafe" }
  ],
  "checkpointEstimates": {
    "start": { "durationMinutes": 1 },
    "mural": { "difficulty": 2 },
    "library": { "durationMinutes": 5 },
    "park": { "durationMinutes": 5 },
    "cafe": { "durationMinutes": 5 },
    "temple": { "durationMinutes": 5 },
    "finale": { "durationMinutes": 1 }
  },
  "travelEstimates": [
    { "from": "start", "to": "mural", "distanceMeters": 180, "bidirectional": true }
  ]
}
```

Rules:

- Start and finale must differ and must not appear in `requiredCheckpointIds` or the selectable list.
- Fixed required IDs and selectable IDs must be unique and disjoint.
- `choose.count` may be zero but cannot exceed the selectable list length.
- `shuffleSelectedCheckpoints: false` preserves the authored middle order. Otherwise every permutation is eligible.
- `avoidTransitions` is directional. Add the reverse edge separately when both directions are forbidden.
- Every location in an eligible route needs a checkpoint or challenge pool.
- Every location or chosen variant needs either a duration estimate or difficulty estimate.
- A travel entry can supply explicit `durationMinutes` or `distanceMeters`; distance uses `walkingSpeedMetersPerMinute`.
- When `requireTravelEstimates` is true, every possible consecutive route pair needs an explicit or bidirectional travel entry.

The resolver enumerates eligible routes. It does not sample a few routes and assume the rest are fair. If the possible route × challenge-variant space exceeds `maxResolvedRoutes` or the hard 100,000-combination bound, publication fails closed.

## Challenge pools

A pool key is a physical location in the route plan. Each variant points to a complete engine checkpoint definition.

```json
{
  "library": {
    "id": "library-challenges",
    "variants": [
      {
        "id": "library-observation",
        "checkpointId": "library-observation",
        "estimatedDurationMinutes": 4,
        "difficulty": 2,
        "scoreCeiling": 20,
        "weight": 1
      },
      {
        "id": "library-riddle",
        "checkpointId": "library-riddle",
        "estimatedDurationMinutes": 4,
        "difficulty": 2,
        "scoreCeiling": 20,
        "weight": 1
      }
    ]
  }
}
```

`scoreCeiling` is an optional author assertion, not trusted scoring data. The fairness validator calculates the real ceiling from the referenced checkpoint and rejects a mismatch. `weight` changes selection frequency only; even a low-weight variant must be fair because any team may receive it.

Use separate checkpoint definitions for meaningfully different variants. Do not hide an unrelated variant in client code or switch expected answers after the run begins.

## Strict fairness

The fairness validator evaluates every eligible physical route and every challenge-pool product up to the proof limit.

The calculated competitive maximum for a checkpoint includes:

- checkpoint `basePoints`;
- positive `timeBonus.points` unless that source is explicitly excluded;
- reachable `add_points` awards unless that source is explicitly excluded;
- maximum word-search extra-word and threshold-quiz extra-correct bonuses unless that puzzle bonus is explicitly excluded;
- profitable puzzle-hint bonuses after hint cost.

Penalties do not reduce the maximum ceiling. A route cannot be made fair by assuming some teams will answer incorrectly or buy hints.

Publication fails when:

- random branches have different reachable score ceilings;
- a generated-variable branch has different reachable score ceilings;
- variants in the same challenge pool have different calculated ceilings;
- a declared variant ceiling differs from its calculated ceiling;
- complete eligible routes have different maximum competitive scores;
- required duration/travel data is missing;
- longest minus shortest estimated duration exceeds `durationToleranceMinutes`;
- a graph/reference is invalid; or
- the route space cannot be exhaustively proven within the limit.

Bonus treatment is bound directly to the authoritative scoring source; there is no detached bonus declaration to drift away from runtime behavior. Omitted impact defaults to `competitive`. Set `rankingImpact: "excluded"` on a checkpoint `timeBonus` or `add_points` node, and set `bonusRankingImpact: "excluded"` on a word-search or quiz bonus, to record it as an extra delight point without changing official score, rank, or the competitive route proof. The run ledger and player result keep those excluded points visible in a separate extra-points total. Any competitive source remains in the calculated ceiling, so a route-specific competitive bonus will make publication fail unless every eligible route has the same maximum.

Two optional sources are always required to be excluded in V3: non-zero dud-QR awards and positive puzzle bonuses embedded inside hints. A dud token can only be tried while a QR verifier is active, and hint availability can depend on disabled flags, prerequisite hints, node paths, attempts, timing, and solve expiry. Until those opportunity paths are explicitly bound and proven, publication fails closed instead of pretending those points are attainable on every route. Put the same puzzle in the normal checkpoint flow if its reward must be competitive.

Publication also proves that the positive and negative magnitudes of both official score and excluded extra points fit the PostgreSQL score caches for every resolved route. The proof uses integer arithmetic and includes base points, time awards, flow actions, puzzle rewards and quiz skips, hint costs, checkpoint skips, and dud discoveries. A puzzle reward earned before choosing its fallback is counted together with the fallback continuation. Scored wrong attempts are rejected in V3 because retries have no lifetime cap; failed attempts are still captured in run events and analytics without changing score. Runtime enforces the same cache boundary before accepting any score mutation.

Fairness proves configured score ceilings and estimated durations. It cannot prove that two riddles feel equally difficult to real players. Pilot variants, review per-route completion times, and revise estimates using analytics.

## Parallel mechanics

Parallel mechanics require two or more distinct authenticated members to complete linked lanes within one window. They do not trust a client-supplied member ID.

```json
{
  "id": "crew-gate-sync",
  "checkpointId": "crew-gate-checkpoint",
  "nodeId": "crew-gate",
  "timeWindowSeconds": 90,
  "lanes": [
    {
      "id": "east-marker",
      "label": "Scan the east marker",
      "type": "qr",
      "token": "@server:generate:crew-gate-east"
    },
    {
      "id": "west-code",
      "label": "Enter the west code",
      "type": "code",
      "code": "{{laneCode}}",
      "caseSensitive": false
    }
  ]
}
```

`checkpointId` must exist, and `nodeId` must identify a `verify_organizer` gate in that checkpoint flow. A mechanic needs two to twenty unique lanes. Lane types are:

- `qr`: private `token`; external files use an `@server:generate:<logical-name>` directive only.
- `code`: private `code`, preferably a run variable placeholder instead of a reusable static secret.
- `gps`: a private `location` with latitude, longitude, radius, and maximum accepted accuracy.
- `photo`: optional private GPS region plus photo review evidence.

The command layer must make lane claims idempotent, start the window with the first accepted lane, require a different authenticated `team_member_id` per lane, and record contribution events. Public projection contains only lane ID, label, and type—never tokens, codes, or target coordinates.

## Checkpoint and flow contract

A checkpoint includes `id`, `title`, integer `basePoints`, `flow`, and `hints`. Optional fields are `required`, `prerequisites`, `group`, public map `location`, `wrongAttemptPenalty`, `skipPenalty`, and `timeBonus`.

Every flow has a `startNodeId` and 1–200 nodes. Node IDs are unique within that checkpoint. Every referenced destination must exist. Flows are directed and acyclic; a wrong answer retries the active verifier and does not require a graph cycle.

### Supported nodes

| Node | Required private shape and use |
| --- | --- |
| `show_text` | `text`, `next`. Show story or instructions. |
| `show_media` | `content`, `next`. Content can be text, image, map, audio, video, or camera guidance. |
| `verify_qr` | `prompt`, private generation-directive `token`, `next`; optional generated `backupCode`. |
| `verify_code` | `prompt`, private `code`, `next`; optional case sensitivity and safe recap. |
| `verify_answer` | `prompt`, one or more private `answers`, `next`; optional case sensitivity, recap, and bounded attempt recording. |
| `verify_gps` | `prompt`, latitude, longitude, radius, maximum accuracy, `next`. Use an approximate safe region. |
| `choose_path` | `prompt`, two to twenty `{id,label,next}` choices. This is a player choice, not seeded route assignment. |
| `puzzle` | `prompt`, one supported private puzzle definition, `next`. |
| `camera_guide` | `prompt`, `next`; optional reference image and paired latitude/longitude. Guidance is not automatic verification. |
| `verify_organizer` | `prompt`, `next`. Wait for server-authorized approval; also serves as a parallel-mechanic gate. |
| `verify_image` | `prompt`, zero to thirty organizer reference images, optional private GPS region, `next`. Player evidence remains pending until review. |
| `set_variable` | Typed literal `key`/`value`, `next`. Sets flow state; it is distinct from seeded run generators. |
| `branch` | A bounded condition plus `ifTrue`/`ifFalse`. Conditions support variable equality, completed checkpoint, used hint, or UTC time interval. |
| `random_branch` | Two to twenty weighted destinations. Assignment is deterministic and immutable for the run. |
| `add_points` | Integer `amount`, audit `label`, `next`. All seeded alternatives must keep equal competitive ceilings. |
| `complete` | Terminal node. It is the only normal path that completes a checkpoint and awards base points. |

Interactive nodes may include a configured `fallback` with `nodeId`, player-facing `label`, and initial `enabled` state. Verification/gameplay prompts may include a `clue`. Recovery still travels through the same engine and is recorded.

### Display content

- `text`: nonempty `text`.
- `image`: HTTPS or local absolute `url` plus meaningful `alt` text.
- `map`: latitude, longitude, and radius.
- `audio` / `video`: URL, title, and optional transcript.
- `camera`: description, optional reference image, and optional paired coordinates.

Use uploaded media references rather than embedding bytes or data URLs. Provide alt text and transcripts for accessible alternatives.

## Supported puzzles

| Puzzle | Private authoring fields | Key semantic checks |
| --- | --- | --- |
| `jigsaw` | 2–8 rows/columns, image pieces, solution order | Exactly rows × columns unique pieces; solution is a full permutation. |
| `sudoku` | size 4, 6, or 9; `givens` grid using `0` for blanks | Exact dimensions, valid values, at least one blank, and a supported solvable board. |
| `word_search` | 2×2 to 25×25 letter grid, 1–50 words, optional threshold/bonus | Rectangular grid; unique words occur in a straight line; threshold is in range. |
| `crossword` | 2–30 rows/columns and 1–100 entries | Letter-only answers fit, intersections agree, and IDs/starting directions are unique. |
| `rotation` | 1–8 columns and image tiles with 0/90/180/270 correct rotation | Unique tiles and at least one tile that is not already at zero. |
| `text` | prompt, one or more accepted answers, optional case sensitivity | Private accepted answers stay server-side. |
| `multiple_choice` | prompt, 2–30 labeled options, correct option ID | Correct ID references one unique option. |
| `quiz` | 1–50 questions, required correct threshold, optional skip/extra bonuses | Unique question IDs, valid correct options, bounded threshold and scoring. |
| `matching` | two 2–30 item lists and solution pairs | Equal list sizes and a complete one-to-one solution. |
| `sequence` | 2–30 labeled items and solution order | Solution is a full permutation of item IDs. |

Solutions and expected answers belong in the private draft because the server needs them. They must be removed from player projections, public boards, analytics, and share assets.

## Hints

Hints have globally unique IDs, title, non-negative cost, and content. Content may be any display type or a puzzle that reveals display content after solving.

`availability` can require other hint IDs, elapsed checkpoint seconds, or a completed node. `relevance` can target an interactive node and, for independently discoverable word-search/crossword items, a `puzzleItemId`. Attempt/time unlocks and solve expiry are optional.

Target route-specific hints to their route node. Do not make a hint depend on another hint that exists only on a different random route.

## Secrets and private data

Never put any of the following in a file sent to an external AI or bundled in this public kit:

- a real run seed or resolved values from a live run;
- live QR tokens, backup codes, or dud QR tokens;
- database URLs, service-role tokens, API keys, organizer passwords, cookies, or session tokens;
- team PINs, member IDs, rosters, participant names, contact details, or check-in records;
- peer-vote identities, contribution evidence, organizer override audits, or private result exports;
- production database/media IDs or expiring signed media URLs;
- production-only internal identifiers copied from logs or backups.

For QR fields, use only `@server:generate:<logical-name>`. Import must replace each directive with an independent cryptographically random private value and retain the logical name only as non-secret audit context. Never reuse a generated QR or static code across events.

An expected answer or puzzle solution may be AI-authored, but it becomes private server configuration at import. Do not use an answer that is also a credential or a real-world secret.

## Anti-patterns

Reject or repair a draft that does any of the following:

- adds JavaScript, expressions, HTML injection, executable URLs, or an unknown node type;
- uses client-computed points, client-reported completion, or client-supplied member identity;
- creates a separate progression system for QR, photo, puzzle, or parallel tasks;
- includes a graph cycle to model answer retry;
- references missing/unreachable nodes, hints, checkpoints, variables, or options;
- chooses a random route at request time instead of pinning it to the run seed;
- gives one random branch, route, or pool variant a higher score ceiling;
- uses route-specific competitive bonuses or assumes penalties will equalize a route;
- omits duration estimates or hides a large route space above the proof bound;
- labels camera guidance as automatic landmark recognition;
- auto-approves photo evidence without an authorized verifier;
- includes a real QR secret, run seed, player record, or production credential;
- exposes member names, votes, titles, or contributions on a public board;
- claims a browser can post directly to Instagram;
- marks AI output published or production-ready without validation and organizer preview.

## Import and review workflow

1. In the builder, start from the V3 starter or export the current sanitized draft.
2. Download the schema and this guide with the draft.
3. Give those files and the copy-ready prompt below to Codex.
4. Require one JSON object only. Do not accept Markdown fences around the returned file.
5. Import into the builder. The server parses a bounded request and validates the schema.
6. Show all structural and semantic errors with paths; do not partially discard invalid fields.
7. Materialize server-only QR directives in the private draft and keep them out of subsequent AI exports.
8. Run graph, placeholder, puzzle, parallel-mechanic, privacy, and exhaustive fairness validation.
9. Create a new editable draft only. Preserve the previous draft/version for recovery.
10. Review every prompt, answer, location, image, accessibility alternative, point value, and estimate.
11. Preview at least one run per route/variant; use forced choices only in isolated organizer previews.
12. Publish only after validation is clean and the organizer explicitly confirms publication.

Schema-valid does not mean event-ready. Camera, GPS, QR placement, network behavior, outdoor readability, and native share sheets still require physical Android/iPhone testing.

## Copy-ready Codex prompt

Replace the bracketed inputs, attach the schema, and attach either the starter or current sanitized draft.

```text
You are authoring an editable Treasure Hunt V3 draft.

GOAL
[Describe the audience, location, story, duration, team size, desired checkpoints,
scoring, registration mode, replay policy, and accessibility/recovery needs.]

AUTHORITATIVE INPUTS
1. treasure-hunt-v3.schema.json
2. v3-authoring-kit.md
3. [treasure-hunt-v3.starter.json OR current sanitized draft]
4. Optional validator errors to repair:
[Paste exact path + message errors, or write NONE.]

OUTPUT CONTRACT
- Return exactly one valid JSON object and no Markdown fence or commentary.
- Use schemaVersion 3 and only fields allowed by the supplied schema.
- Preserve existing stable IDs unless the goal explicitly requires a replacement.
- Keep every flow acyclic, reachable from startNodeId, and terminating in complete.
- Use only documented node, content, hint, condition, puzzle, route, generator,
  recognition, leaderboard, public-board, sharing, and parallel-mechanic shapes.
- Use only safe {{name}} placeholders backed by settings.variableGenerators.
- Never use an expression inside a placeholder.
- Never include real run seeds, live QR/backup/dud tokens, credentials, cookies,
  session/member/team identifiers, rosters, votes, contribution evidence, private
  results, signed URLs, database/media IDs, or production-only identifiers.
- For every QR token or backup-code field, use a unique
  @server:generate:<logical-name> directive. Never invent a production token.
- Expected answers and puzzle solutions may be present because this is a private
  draft, but they must never be repeated in player-facing text.
- Keep start/finale/fixed/selectable route IDs disjoint and references valid.
- Every route location must resolve to a checkpoint or challenge-pool key.
- Give every checkpoint/pool variant a duration or difficulty estimate and every
  required travel edge an estimate.
- Calculate each checkpoint and route maximum. Make every challenge variant and
  every eligible competitive route exactly equal in maximum score.
- Keep estimated route durations within fairnessPolicy.durationToleranceMinutes.
- Treat every weighted alternative as eligible regardless of weight.
- Bind every bonus at its real score source. Omitted impact is competitive; use
  rankingImpact/bonusRankingImpact = excluded only for points that must never
  influence official score, rank, or the competitive route-ceiling proof.
- Always mark non-zero dud-QR awards and positive puzzle bonuses inside hints as
  excluded; V3 cannot prove those optional opportunities route-neutral.
- Do not configure wrongAttemptPenalty in V3. Retries are intentionally
  unbounded; use failure analytics rather than an unbounded ranking penalty.
- Keep every route's official and excluded positive/negative score magnitude
  inside a signed 32-bit cache. The publication report rejects overflow.
- Parallel mechanics need 2–20 lanes, a verify_organizer gate, a bounded window,
  and no real verifier secret. Distinct-member enforcement is server-side.
- Public-board configuration must contain team-level data only.
- AI output is a draft only; do not add any field that claims it is published.

QUALITY CHECK BEFORE OUTPUT
Silently verify JSON syntax, schema field names, ID uniqueness, references,
placeholder definitions, graph termination, puzzle feasibility, QR directives,
score equality, duration tolerance, and absence of production/private data.
If the requested design cannot satisfy strict fairness, repair the design rather
than weakening fairness. If a necessary fact is unknown, use clear editable
content such as "REPLACE WITH ..." only where the schema permits ordinary text;
never fabricate coordinates, rosters, secrets, or production identifiers.
```

When repairing a file, include the validator's exact path messages. Codex should make the smallest coherent correction and preserve unrelated organizer content and IDs.
