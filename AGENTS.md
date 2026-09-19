# AGENTS.md
# Treasure Hunt Engine - Repository Development Contract

This file is the governing workflow for all human and AI contributors working
in this repository.

READ THIS FILE COMPLETELY BEFORE MAKING ANY CHANGE.

If another instruction conflicts with this file, stop and ask the repository
owner before proceeding.

---

# 1. Core Rule

NEVER make feature, bug-fix, refactor, infrastructure, database, documentation,
or configuration changes directly on `main`.

Every change must follow:

main (or base branch during bootstrap phase)
→ dedicated branch
→ implementation
→ validation
→ Pull Request
→ external review
→ approval
→ merge
→ deployment

No exceptions for "small" changes. (See Temporary Bootstrap Exception below for the one-time V2 setup).

---

## Temporary Bootstrap Exception

This section describes a one-time transition exception for bootstrapping the repository workflow.

1. **Permanent Rule**: The permanent rule remains that all normal future PRs target `main`.
2. **Bootstrap Scope**: Before V2 promotion, repository-governance/setup changes required to establish the workflow may target `codex/treasure-hunt-v2-foundation`.
3. **PR #1 Coverage**: PR #1 (`chore/repository-workflow`) is explicitly covered by this one-time exception.
4. **Expiration**: After `codex/treasure-hunt-v2-foundation` is promoted and merged into `main`, this exception permanently expires.
5. **Post-Promotion Enforcement**: After promotion, every `feature/*`, `fix/*`, `refactor/*`, `chore/*`, `docs/*`, `test/*`, and `hotfix/*` branch must be created from and target `main`.
6. **Uncompromised Safeguards**: This temporary exception does **not** weaken:
   - External review requirement;
   - Exact-SHA approval (`MRBT_REVIEW: APPROVED`);
   - Prohibitions against self-merging;
   - Required validation checks;
   - Post-merge deployment from `main` after promotion.
7. **Promotion PR**: The V2 promotion itself (`codex/treasure-hunt-v2-foundation -> main`) remains a separate, externally reviewed PR.

---

# 2. Repository Architecture

Treasure Hunt V2 is a configurable, web-first engine for real-world games.

The core architectural rule is:

- The server/database is authoritative.
- The client renders a redacted PlayerView.
- The browser must not directly decide points, answers, checkpoint completion,
  organizer privileges, or private game configuration.
- Hunts are composed from flows/actions rather than hard-coded checkpoint types.
- Existing V1 code under legacy paths is historical and must not be extended
  unless a task explicitly concerns migration or V1 compatibility.

Before architecture-level work, read:

- README.md
- docs/v2/architecture.md
- docs/v2/extensions.md
- docs/v2/acceptance.md

Relevant implementation areas include:

- lib/engine/
- lib/server/
- app/api/v2/
- app/v2/
- components/v2/
- database/v2.sql
- tests/

Do not bypass the engine/server boundary for convenience.

---

# 3. Start of Every Coding Session

Before editing anything:

1. Read this AGENTS.md.
2. Confirm the current branch.
3. Ensure the branch is based on the latest `main` (or `codex/treasure-hunt-v2-foundation` during the temporary bootstrap phase).
4. Read the relevant architecture/docs for the requested feature.
5. Inspect the existing implementation before proposing a replacement.
6. State what will change and what should remain unchanged.
7. Identify tests likely affected.

Do not immediately start rewriting files based only on the user request.

Understand the existing system first.

---

# 4. Branch Rules

All work must happen on a dedicated branch created from current `main` (or `codex/treasure-hunt-v2-foundation` during the temporary bootstrap phase; see Temporary Bootstrap Exception).

Naming:

    feature/<short-description>
    fix/<short-description>
    refactor/<short-description>
    chore/<short-description>
    docs/<short-description>
    test/<short-description>
    hotfix/<short-description>

Examples:

    feature/sponsored-hunt-rewards
    fix/photo-review-retry
    feature/cafe-promo-codes
    refactor/hint-renderer
    docs/deployment-guide

Do not reuse old feature branches for unrelated work.

One branch should represent one coherent change.

---

# 5. Keep PR Scope Understandable

Prefer one clear purpose per PR.

Good:

    "Add venue reward redemption"

Bad:

    "Add venue rewards + redesign admin + rewrite auth + upgrade database +
    change theme + refactor engine"

If unrelated problems are discovered while working:

- document them;
- open a separate branch/PR later;
- do not silently expand scope unless required to safely complete the task.

Avoid unnecessary drive-by refactors.

---

# 6. Implementation Principles

Preserve these product principles:

## Web first

The player must not need to install a native application.

## Mobile first

Player experiences must remain usable on normal and older mobile devices.

## Lightweight player

Do not ship heavy modules to the player unless the current action needs them.

## Server authority

Never expose private answers, QR secrets, admin configuration, scoring mutation,
or authoritative completion state to the browser.

## Modular game engine

QR, GPS, camera, photo verification, puzzles, hints, maps and future AR/vision
features are modules in the same engine.

Do not create separate progression systems for each feature.

## Recovery

Real-world failures are expected.

Consider:

- bad network
- destroyed QR
- denied camera permission
- poor GPS
- refresh
- multiple team devices
- stale requests
- repeated taps

## Idempotency

Mutating operations must remain safe against retries and duplicate requests.

## Compatibility

Do not modify V1/legacy behavior unless explicitly required.

---

# 7. Security Rules

Never commit:

- passwords
- API keys
- database credentials
- service-role tokens
- production cookies
- private secrets

Never place secrets in NEXT_PUBLIC_* variables.

Privileged operations must remain server-side.

Do not weaken authorization/RLS/session/origin protections to make a feature
easier to implement.

If a feature appears to require weakening security, stop and explain the
trade-off before proceeding.

---

# 8. Database Changes

Database/schema changes require special care.

When changing database structure:

1. Make the migration explicit.
2. Preserve existing production data whenever possible.
3. Document migration behavior.
4. Consider rollback/recovery.
5. Update types/validation/queries together.
6. Run integration tests.
7. Mention the migration prominently in the PR.

Never silently modify a production schema assumption without documenting it.

---

# 9. Required Validation Before Opening PR

The normal minimum validation is:

    npm test
    npm run typecheck
    npm run lint
    npm run build

All four must pass unless the PR explicitly explains why one cannot run.

For server/database/storage changes also run:

    npm run test:integration

with an isolated test database.

For player/admin interaction changes, run the relevant Playwright tests:

    npm run test:e2e

or the relevant targeted Playwright project/spec.

Tests must not be removed or weakened merely to make CI pass.

If behavior changes, update/add tests.

---

# 10. Manual Testing

Automated tests do not replace physical-device testing for:

- camera
- QR scanning
- GPS
- compass
- mobile permissions
- outdoor visibility
- public-network behavior

If a PR touches one of these areas, the PR must explicitly state whether
physical testing has been completed or remains required.

Never claim physical-device verification from emulation alone.

---

# 11. Pull Request Requirement

The agent must NEVER merge its own work immediately.

After implementation:

1. Push the branch.
2. Open a Pull Request targeting `main` (or `codex/treasure-hunt-v2-foundation` during the temporary bootstrap phase; see Temporary Bootstrap Exception).
3. Fill the PR template completely.
4. Provide:
   - what changed;
   - why;
   - architectural impact;
   - tests run;
   - known risks;
   - migration/deployment impact;
   - screenshots where UI changed.
5. Stop.

The PR must then be externally reviewed.

---

# 12. External Review Gate

The designated reviewer is ChatGPT working with the repository owner.

The development agent MUST NOT impersonate, fabricate, or assume reviewer
approval.

Valid review states are:

    MRBT_REVIEW: APPROVED
    SHA: <exact PR HEAD SHA>

or:

    MRBT_REVIEW: CHANGES_REQUESTED
    SHA: <exact PR HEAD SHA>

Only the reviewer may provide this marker.

A previous approval becomes INVALID as soon as the PR HEAD SHA changes.

Therefore:

If additional commits are pushed after approval:
→ request review again.

Never merge based on an approval for an older commit.

---

# 13. Handling Requested Changes

When the reviewer requests changes:

1. Read every review comment.
2. Do not blindly patch individual lines.
3. Understand the underlying concern.
4. Update the implementation.
5. Update/add tests where relevant.
6. Re-run validation.
7. Push new commits to the same PR.
8. Summarize how each review point was addressed.
9. Request another review.

Do not mark review concerns as resolved without addressing them.

---

# 14. Merge Rule

A PR can be merged only when ALL are true:

- PR targets `main` (or `codex/treasure-hunt-v2-foundation` during the temporary bootstrap phase; see Temporary Bootstrap Exception).
- Branch is up to date enough to merge safely.
- Required CI/checks pass.
- No unresolved blocking review comments remain.
- Latest reviewer status is MRBT_REVIEW: APPROVED.
- Approved SHA exactly equals current PR HEAD SHA.
- Required migrations/deployment notes are documented.

If any condition is false:

DO NOT MERGE.

---

# 15. Merge Method

Prefer squash merge for normal feature/fix PRs unless preserving individual
commits provides real value.

The final commit message should clearly describe the feature/fix.

Delete feature branches after successful merge unless there is a specific
reason to retain them.

---

# 16. Deployment Rule

Deployment happens from `main`, not from unreviewed feature branches.

After merge:

1. Deploy `main` using the current documented deployment target.
2. Run a health/smoke check.
3. Verify the changed user flow.
4. Check logs/errors where available.
5. Record any required physical-device test separately.

If deployment fails:

- do not patch production directly;
- create a fix/hotfix branch;
- use the same PR workflow.

---

# 17. Production Hotfixes

Urgency does not remove review.

For urgent production bugs:

    main
    → hotfix/<issue>
    → minimal fix
    → focused tests
    → PR
    → review
    → merge
    → deploy

Keep hotfixes narrowly scoped.

Follow-up cleanup can happen in a later PR.

---

# 18. Documentation

Update documentation whenever behavior, setup, deployment or architecture
changes.

Especially review:

    README.md
    docs/v2/architecture.md
    docs/v2/extensions.md
    docs/v2/self-hosting.md
    docs/v2/vercel-hosting.md
    docs/v2/acceptance.md

Do not claim a capability is verified unless there is evidence.

---

# 19. PR Handoff Format

When the development agent finishes a task, report:

    ## Completed
    Short description.

    ## Branch
    branch-name

    ## PR
    PR URL / number

    ## Files changed
    Important files only.

    ## Tests
    PASS/FAIL for each command.

    ## Manual verification
    What was actually tested.

    ## Risks
    Known edge cases or limitations.

    ## Deployment
    Any migration/env/deployment action required.

    ## Review status
    WAITING_FOR_MRBT_REVIEW

Then STOP.

Do not merge while waiting.

---

# 20. Prohibited Actions

Unless explicitly authorized by the repository owner:

DO NOT:

- push directly to main;
- force-push main;
- delete production data;
- rewrite published migration history;
- disable tests to get a passing build;
- expose secrets to the browser;
- weaken security controls;
- bypass the engine with direct DB writes from client code;
- merge without current review approval;
- deploy an unreviewed feature branch as production;
- claim testing that was not actually performed;
- modify unrelated parts of the application.

---

# 21. Definition of Done

A feature is not "done" when code exists.

It is done when:

- implementation is complete;
- architecture remains coherent;
- appropriate tests pass;
- PR is opened;
- review issues are resolved;
- current HEAD is approved;
- PR is merged;
- production deployment succeeds where applicable;
- relevant smoke/manual verification passes.

---

# 22. Guiding Principle

Treasure Hunt Engine is intended to become a reusable real-world experience
platform, not a collection of one-off hacks.

Optimize for:

    clarity
    reliability
    modularity
    recoverability
    security
    mobile usability
    future extension

over short-term convenience.
