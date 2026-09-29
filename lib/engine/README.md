# Engine contract

`HuntDefinition` and `GameState` are server data. Only `getPlayerView()` may project a player's current task; never serialize a published definition into a player endpoint or import demo answers into the player bundle. Use `import type` for frontend contracts.

The engine is pure: input definition/state plus a command and explicit server timestamp produce a new state and feedback. The server authenticates, locks a team's current PostgreSQL row, checks the immutable pinned version and request receipt, calls the engine, then commits state and receipt atomically. Two unlocked calls to the pure function alone cannot prevent teammate races.

- `parseHuntDefinition()` strictly validates and copies private configuration. `validateHunt()` returns editor issues. Flow, hint and checkpoint-prerequisite cycles are rejected.
- `createInitialState()` initializes explicit access/progress; waiting initialization must not execute or expose the first task. Idempotent `start_session` commits timing and initial traversal once. Legacy immediate initialization remains supported.
- `executeCommand()` accepts only supported player commands for the expected checkpoint/action. Hint identity and completion are not inferred from counts.
- `executeControl()` is organizer-only, requires a reason and exact `expectedRevision`, and appends audit/compensation rather than deleting ledger history.
- `executeOverride()` preserves the original authenticated approval API, using current action identity.
- `getPlayerView()` reveals only permitted content. Puzzle keys, unpublished hints, unsolved hint rewards, QR/code/answer secrets and private landmark references remain server-side.

Interactive action behavior lives in `actionRegistry`; puzzle-specific behavior lives in `puzzles/puzzleRegistry`. A new puzzle implements initial state, public projection, validated state update and configuration validation. It uses generic puzzle save/submit and does not rewrite checkpoint traversal. Renderers load when needed.

Puzzle save/submit commands carry per-puzzle `expectedRevision`; stale writes fail. Saving never advances. Submitting advances only on module success. The same protocol serves hint puzzles, where success reveals content instead of completing an action. Reset/reopen generations remain monotonic.

Checkpoint modes are sequential, open and prerequisites; optional challenges can remain after the required finish timestamp. Fallback flags live in team state while fallback edges stay in the immutable definition. Conditions are bounded variable/checkpoint/hint/daily-UTC-time checks; weighted routes are deterministic per team/action.

`session.ts` owns personal expiry and clipped pause accounting. Optional play still requires an unexpired playable session. Use the post-lock database timestamp and recover existing receipts before enforcing expiry. Extensions never subtract from elapsed time. `server/routes.ts` computes/persists all random assignments: legacy algorithm 1 is immutable; domain-separated SHA-256 algorithm 2 applies to new authoring. Forced choices are preview-creation inputs only.

Hint targeting uses sticky first-solve/discovery facts across edits and ordinary resets. Never expose an unreached hint's title, cost, target or media; disabled/expired unpurchased hints are omitted. Purchased history must use the same puzzle-reward gating as the active view. Missing historical solve timestamps remain missing.

The server persists private append-only activity alongside accepted state and receipt. Roster/review mutations are revision-protected server operations on that aggregate; review status does not affect scores/ranking. Answer recording stays opt-in for old definitions. See [timed-team contracts](../../docs/v2/timed-teams.md) for compatibility, reporting and release rules.

The score is the sum of immutable ledger entries. Base points, hints, penalties, bonuses, organizer corrections and refunds all have explicit causes. Reopening a completed checkpoint compensates its prior completion/action/time awards before replay; it preserves hint and wrong-attempt history.

`verify_image` records an uploaded, server-authorized media ID for human review. The storage adapter checks ownership, task binding, size and configured GPS. No player command can approve an image. External vision work must occur outside a team-row transaction, then return through an authenticated, idempotent server result/control against the expected current action.

Read [architecture](../../docs/v2/architecture.md), [extension guide](../../docs/v2/extensions.md), and [acceptance evidence](../../docs/v2/acceptance.md) before extending contracts. Run `npm test` for pure behavior and real PostgreSQL/browser suites for their respective boundaries.
