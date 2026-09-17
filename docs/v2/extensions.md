# Creating modules

The stable boundary is **private definition → validated command/state → public projection → lazy renderer**. A module decides whether its own task is satisfied. The engine decides checkpoint traversal, completion, score transactions and request safety.

Never add direct browser database writes, client `completed: true` flags, public expected answers, or an alternative checkpoint state machine to implement a new module.

## Add a puzzle

The existing sequence module is a small working reference; Sudoku, word search and jigsaw show grid, incremental and image cases.

| File | Addition |
| --- | --- |
| `lib/engine/puzzles/types.ts` | Private `PuzzleDefinition`, redacted `PuzzlePublicDefinition` and player-entered `PuzzleState` variants. |
| `lib/engine/puzzles/validation.ts` | Strict configuration validation, bounds, references and feasibility checks. |
| `lib/engine/puzzles/registry.ts` | `initial`, `public`, and `update` functions through `createPuzzleModule`. |
| `components/v2/puzzles/` | Keyboard/touch renderer and lazy dispatch in `PuzzlePlayer.tsx`. |
| `components/v2/builder/PuzzleEditor.tsx` and defaults | Organizer inputs and a valid starter configuration. |
| `tests/puzzles.test.ts` and focused browser tests | Invalid configs/submissions, public secrets, save/restore and accessible interaction. |

The generic engine `puzzle` action, puzzle-hint purchasing, save commands, revision checks, traversal and score completion do **not** need a puzzle-specific branch.

For example, a new arithmetic module could have a private definition `{type:'sum', operands:number[]}`, public operands, and state `{type:'sum', value:string}`. Its registry entry follows this pattern after those variants and validation are added:

```ts
sum: createPuzzleModule('sum', {
  initial: () => ({ type: 'sum', value: '' }),
  public: definition => ({ type: 'sum', operands: [...definition.operands] }),
  update(definition, _state, value) {
    const input = submission(value, ['value']).value
    if (typeof input !== 'string' || input.length > 30) {
      throw new PuzzleError('invalid_submission', 'Enter a short numeric answer.')
    }
    const answer = definition.operands.reduce((sum, operand) => sum + operand, 0)
    return {
      state: { type: 'sum', value: input },
      completed: input.trim() !== '' && Number(input) === answer,
    }
  },
})
```

This is an extension example, not an additional shipped tenth puzzle. Bound the configured operands and total, avoid ambiguous numeric formats if the puzzle needs exact integers, and test malformed values before adding its UI.

A renderer receives `definition`, `state`, `disabled` and `onChange(submission)`. It sends only its validated input shape. The current adapter wraps that input in `submit_puzzle` with checkpoint/action and per-puzzle `expectedRevision`; puzzle hints use `submit_hint_puzzle` with hint ID. `save_puzzle`/`save_hint_puzzle` persist without advancing if the interaction requires a separate Check button.

Do not invent a revision locally after a request fails. Accept the next authoritative view. A conflict means a teammate changed the puzzle; refresh and explicitly reapply the intended move. The engine's reset/reopen generation prevents pre-reset queued writes from being accepted again.

## Add a synchronous action or verifier

Use `verify_answer` as the simplest existing reference and `verify_gps` for a structured submission.

1. Add the private `InteractiveNode` and its public `PlayerNode` shape in `types.ts`. Expected codes/answers/private coordinates remain only in the private shape.
2. Add exact allowed fields and configuration checks in `validation.ts`. Preserve bounded graph edges and validate fallback targets.
3. Reuse an existing command such as `verify` when appropriate; otherwise add its command variant and strict `parseCommand` validation.
4. Add an `actionRegistry` entry with allowed commands, `execute` and `toPlayer`. Return the next node only when validation succeeds. A false result stays at the current node.
5. Add a lazy UI renderer and organizer editor fields. Use a meaningful player action label and recovery affordance.
6. Test wrong input, correct input, private projection, stale action, duplicated receipt, teammate race and configured fallback.

The generic engine owns revision/event/advance behavior. Automatic or display-only guidance must not claim it verified a physical landmark. If an action needs arbitrary external I/O, use the pending pattern below rather than calling a service while a team row is locked.

## Add asynchronous or external verification

`verify_image` is the executable human-review reference:

1. The authenticated upload adapter validates size/type, configured GPS and current team/checkpoint/action, writes an owned media record, and returns its ID.
2. `submit_photo` includes only that media ID. The server checks the ownership/action binding again before calling the engine. The engine records pending state and publishes a waiting view; no completion points are awarded.
3. A human or future server adapter works on the evidence **outside the game transaction**. A future ML provider may return accept/retry/reject/review; it must not write team state directly.
4. Before applying a result, reload the team and require the same pending photo/action. Use an idempotent request ID and the latest expected team revision through the server command boundary. Stale/mismatched evidence must not approve another action.
5. Apply organizer/service-authorized approval or rejection using the ordinary engine path; append audit information and respect media retention. Never expose a privileged result endpoint to ordinary team sessions.

The shipped UI/API authorizes human organizers. A production automated worker needs its own explicit authenticated service boundary, provider adapter, confidence/error policy and tests; those integrations are not secretly active today. No model API key is required for current photo review.

## Add a hint content renderer

Hints already have independent IDs, costs, purchase usage and availability. A content type must reuse those facts.

For a new display hint, extend `DisplayContent`, the content validator, the allowlisted `publicDisplay` projection, `MediaContent.tsx` and the organizer `HintEditor`. The generic purchase command and ledger require no separate hint system. Secret content appears only after purchase.

For a puzzle hint, configure `{type:'puzzle', puzzle, reveal}` using any registered puzzle. The existing engine keeps the reveal absent until the purchased puzzle is solved. Do not duplicate puzzle state inside a modal or mark a hint solved from React alone.

Availability supports independent purchase order, prerequisite hint IDs, elapsed seconds and a completed action such as GPS. New availability rules need server-side checks plus a public locked reason; hiding a button alone is not enforcement.

## Scoring and recovery invariants

- Record every cost/award/correction as a ledger entry; total always equals ledger sum.
- Use semantic identity for naturally one-time awards and transport receipts for request retries.
- Preserve previous entries when resetting: append a compensation reference rather than changing history.
- Keep `expectedRevision` on organizer controls and puzzle revisions monotonic through reset.
- Never let generic Continue satisfy a verifier.
- Keep private media, submitted secrets and expected answers out of public events/responses.
- Test a lost response after commit; then replay the same request from a refreshed page.

## Verify an extension

Run the focused module suite first, then integration/browser cases that exercise its actual boundaries. Before publication, check that malformed definitions fail with useful editor paths, unavailable devices have a configured recovery path, and the player join bundle does not include the new heavy dependency. An editor field or passing typecheck alone does not prove the module can be played.

The [architecture](architecture.md) describes server boundaries; [acceptance](acceptance.md) preserves the full product and failure requirements.
