# Treasure Hunt V2

## Configurable Real-World Treasure Hunt / Location Game Engine

### Context

This repository contains V1 of a treasure hunt application that was originally built extremely quickly for a real event.

V1 already demonstrates the core concept and contains a surprising amount of functionality:

* team creation and joining
* team PINs
* checkpoints
* checkpoint progression
* QR verification
* GPS verification
* manual codes
* fake/dud QR codes
* hints
* points
* leaderboard
* maps
* puzzle chains
* jigsaw puzzles
* Sudoku
* crossword-style puzzles
* word search
* circular rotation puzzles
* admin controls
* QR generation
* mobile UI
* Supabase persistence

The existing README itself describes the application as supporting multiple unlock methods, puzzle chains, hints, checkpoints, maps, teams, scoring and an administrator panel.

The current application uses Next.js 15, React 18, TypeScript, Supabase, Leaflet and html5-qrcode among other libraries. There is currently no automated test command in `package.json`; the project is largely built around development, build, start and lint scripts.

V1 should therefore **not be treated as a failed application**.

It should be treated as a working prototype that revealed what this product actually needs to become.

---

# 1. The Most Important Product Decision

We are **NOT building a QR treasure hunt game**.

We are also **NOT building one predefined game**.

We are building a:

# CONFIGURABLE REAL-WORLD GAME ENGINE

An organizer should be able to create many different kinds of treasure hunts, scavenger hunts, city trails, campus games, puzzle events, exploration games and location-based experiences using the same engine.

The system should be highly modular.

A hunt should be composed from configurable:

* stages
* checkpoints
* actions
* verification methods
* puzzles
* clues
* hints
* media
* scoring rules
* fallback paths
* branching rules
* completion conditions

The application should support very simple games and much more elaborate experiences without requiring custom code for every event.

A simple hunt might be:

```text
Clue
↓
Find QR
↓
Scan QR
↓
Checkpoint complete
```

Another checkpoint might be:

```text
Riddle
↓
Travel to location
↓
GPS enters approximate zone
↓
AR/camera guidance activates
↓
Player identifies landmark
↓
Photo verification
↓
Question appears
↓
Correct answer
↓
Checkpoint complete
```

Another might be:

```text
Clue
↓
Jigsaw puzzle
↓
Puzzle reveals location
↓
Player reaches location
↓
Manual code found on sign
↓
Checkpoint complete
```

Another might allow alternatives:

```text
Find landmark
↓
QR verification
OR
GPS + photograph verification
OR
organizer rescue code
↓
Complete
```

The architecture must therefore be designed around **composable actions**, not hard-coded checkpoint types.

---

# 2. What Happened With V1

V1 was built under severe time pressure and had to work for an event.

During the actual event, some parts worked surprisingly well.

Players generally understood:

* joining
* progressing through the hunt
* pressing obvious next/start actions
* completing straightforward checkpoints
* basic puzzle interaction

Other parts required constant organizer intervention.

Typical problems included:

* QR codes were physically removed, torn or tampered with.
* Some QR codes were difficult to scan.
* Wrong QR scans created poor recovery UX.
* Camera permissions caused confusion.
* GPS was too inaccurate to serve as exact verification.
* hints occasionally behaved incorrectly
* progression state became inconsistent
* players sometimes needed the organizer to explain the UI
* the organizer had insufficient tools to rescue teams remotely
* different generations of hint/puzzle logic became entangled
* frontend state and database state sometimes drifted apart
* the code accumulated patches required to keep the event operational

This is expected from a prototype built quickly.

V2 should use those real-world failures as product requirements.

---

# 3. Problems in the Existing Architecture That Should Not Be Carried Forward

The coding agent should inspect the repository itself before making architectural decisions.

Some known areas need particular attention.

## QR scanning

The existing QR scanner invokes the scan-success callback and stops scanning immediately after decoding any QR.

This creates bad UX when a QR is valid as a QR but is not the correct checkpoint QR.

A wrong QR should normally **not terminate the scanning session**.

V2 should have one authoritative QR verification pathway.

The intended behavior should be:

```text
Camera opens

↓
QR detected

↓
Server validates token

├─ incorrect QR
│    show small inline feedback
│    KEEP CAMERA RUNNING
│
├─ known dud QR
│    show configured playful message
│    KEEP CAMERA RUNNING
│
└─ correct QR
     success animation
     stop scanner
     advance flow
```

No scanner restart cycle should be required after a normal wrong scan.

---

# 4. Hint Architecture Must Be Rebuilt

The current text hint system tracks a `hints_used` count and reconstructs which hints were used by assuming:

```text
1 used = Hint 1
2 used = Hint 1 + Hint 2
3 used = Hint 1 + Hint 2 + Hint 3
```

That assumption exists directly in the current hint code.

But V2 must support arbitrary hint types and arbitrary order.

A player might choose:

* Image Hint first
* then Map Hint
* never use Text Hint
* then later use AR Guidance

Counting hints cannot represent that.

Every hint must therefore be an individual entity.

For example:

```text
Hint
    id
    checkpoint/action association
    type
    content/config
    point cost
    availability rules
    order
```

And usage should be recorded individually:

```text
HintUsage
    id
    team_id
    hint_id
    used_at
    cost
```

Never infer hint identity from a count.

---

# 5. Hints Are Content Modules

Do not create separate independent hint systems for every kind of hint.

There should be **one hint engine** with typed content.

Potential hint types:

* text
* image
* audio
* video
* location/map
* direction
* distance
* reveal letters
* reveal answer section
* puzzle
* mini-game
* AR guidance
* landmark reference image
* compass guidance
* GPS area reveal
* QR clue
* external media
* custom rich content

Example:

```text
Hint 1
Type: Text
Cost: 2 points
"Look near something that never moves."

Hint 2
Type: Image
Cost: 4 points
[blurred photo]

Hint 3
Type: Map
Cost: 5 points
[approximate search area]

Hint 4
Type: AR Guidance
Cost: 7 points
[launch camera guidance]
```

Hints may optionally unlock progressively, but that should be configuration rather than an architectural limitation.

Possible rules:

```text
all hints available immediately
```

or

```text
Hint 2 only after Hint 1
```

or

```text
Hint 3 available after 5 minutes
```

or

```text
AR hint becomes available once inside GPS radius
```

The organizer should choose.

---

# 6. Core Engine Concept: Hunt → Stage/Checkpoint → Flow

The central architectural change is that a checkpoint should contain a **flow**.

Think of a checkpoint as a small workflow.

Example:

```text
Checkpoint: Old Clock Tower

START
 ↓
SHOW_CLUE
 ↓
GPS_ZONE
 ↓
CAMERA_GUIDANCE
 ↓
IMAGE_VERIFY
 ↓
SHOW_QUESTION
 ↓
ANSWER_VERIFY
 ↓
AWARD_POINTS
 ↓
COMPLETE
```

The engine interprets this flow.

Do not hard-code:

```text
if checkpoint.type === "qr"
...
if checkpoint.type === "gps"
...
```

throughout the UI.

Instead, define reusable action/node types.

---

# 7. Suggested Action / Node Categories

The naming and exact implementation are flexible.

The important concept is modularity.

## Display Actions

Show something to the player.

Examples:

```text
SHOW_TEXT
SHOW_IMAGE
SHOW_VIDEO
SHOW_AUDIO
SHOW_CLUE
SHOW_STORY
SHOW_MAP
SHOW_REFERENCE_IMAGE
```

---

## Verification Actions

Confirm that the player has achieved something.

Examples:

```text
VERIFY_QR
VERIFY_CODE
VERIFY_GPS
VERIFY_ANSWER
VERIFY_IMAGE
VERIFY_ORGANIZER
VERIFY_AR_ALIGNMENT
```

---

## Puzzle Actions

Examples:

```text
PUZZLE_JIGSAW
PUZZLE_SUDOKU
PUZZLE_WORD_SEARCH
PUZZLE_CROSSWORD
PUZZLE_ROTATION
PUZZLE_TEXT
PUZZLE_SEQUENCE
PUZZLE_MATCHING
PUZZLE_CUSTOM
```

The existing puzzle components can potentially be adapted instead of discarded.

---

## Navigation / Location Actions

Examples:

```text
SHOW_MAP
SHOW_SEARCH_AREA
SHOW_DIRECTION
SHOW_DISTANCE
OPEN_AR_GUIDE
WAIT_FOR_GPS_ZONE
```

---

## Game Logic Actions

Examples:

```text
ADD_POINTS
DEDUCT_POINTS
SET_VARIABLE
START_TIMER
END_TIMER
REQUIRE_PREVIOUS
COMPLETE_CHECKPOINT
UNLOCK_CHECKPOINT
BRANCH
RANDOM_BRANCH
```

---

## Recovery Actions

Examples:

```text
ALLOW_BACKUP_CODE
REQUEST_ORGANIZER_HELP
ALLOW_ALTERNATIVE_VERIFICATION
SKIP_WITH_PENALTY
```

---

# 8. Flow Builder

The administrator should eventually be able to construct checkpoint flows visually.

Something conceptually similar to:

```text
[Show Clue]
      ↓
[GPS Zone]
      ↓
[AR Guide]
      ↓
[Take Photo]
      ↓
[Verify Image]
      ↓
[Word Puzzle]
      ↓
[Complete]
```

Nodes should be connectable.

The UI can eventually resemble a lightweight workflow editor / node editor.

However, do not prioritize visual fanciness over a clean underlying data structure.

The important requirement is:

**Flows must exist as structured data.**

Whether they are edited initially using forms, ordered blocks or a graphical node editor is an implementation decision.

Eventually I want a proper visual builder.

---

# 9. Branching Must Be Possible

The engine should not assume every flow is linear.

For example:

```text
              ┌─ QR verified ───────────┐
              │                         │
START → FIND LOCATION                   ├→ NEXT CHALLENGE
              │                         │
              └─ GPS + Image verified ──┘
```

Or:

```text
Question
   ↓
Correct?
 ├─ Yes → Complete
 └─ No
      ↓
  attempts < 3?
      ├─ Yes → Retry
      └─ No → Offer hint
```

Or:

```text
GPS zone reached

├─ daytime → visual clue
└─ nighttime → alternate clue
```

The initial implementation does not need an enormous scripting language, but the architecture should not make branching impossible.

---

# 10. The Player Experience Must Stay Extremely Simple

This is critical.

The engine may be sophisticated.

The player's UI should **not feel sophisticated**.

The participant should usually see only:

```text
What am I supposed to do now?
```

and

```text
What action can I take?
```

The engine decides complexity behind the scenes.

A player might see:

> Find the place where the king still watches the market.

Then:

**Need a Hint?**

Then eventually:

**Open Camera**

Then:

**You found it!**

They should not see concepts like:

* verification nodes
* flow state
* checkpoint configuration
* GPS confidence
* workflow transitions

Those are engine concepts.

---

# 11. Player Interface Principles

Mobile first.

Most players will use phones.

The UI should optimize for:

* one-handed use
* bright outdoor environments
* older Android phones
* varying screen sizes
* poor connections
* accidental refreshes
* browser navigation
* camera permission problems
* GPS permission problems

Primary actions should be obvious.

Prefer:

```text
Open Camera
Use Hint
Submit Answer
Continue
Need Help?
```

over complicated menus.

Every state must answer:

1. What am I doing?
2. What should I do next?
3. What happened after I pressed something?
4. How do I recover if it failed?

---

# 12. The Application Must Remain a Web Application

This is an important constraint.

Do not require:

* native Android installation
* native iOS installation
* special event application installation
* anti-cheat software
* complicated registration

The goal is:

```text
scan/open URL
↓
join team
↓
play
```

It should work from normal modern mobile browsers.

A PWA is acceptable and potentially useful, but installation should remain optional.

---

# 13. Performance Is a Product Feature

The app needs to work on older and lower-powered mobile devices.

Do not load the entire game engine on the initial page.

Use lazy loading/code splitting aggressively.

For example:

```text
Player joins hunt
```

should NOT download:

* AR engine
* jigsaw engine
* Sudoku code
* image processing code
* admin application
* every puzzle component

Load capabilities only when required.

Example:

```text
QR checkpoint → load QR module
AR checkpoint → load AR module
Jigsaw → load jigsaw module
```

The normal clue interface should remain extremely lightweight.

Images should be resized/compressed appropriately.

Do not send massive original images to phones unnecessarily.

---

# 14. Team System

V1's team concept should remain.

Basic flow:

```text
Join Hunt
↓
Create Team / Join Team
↓
Team name
↓
PIN
↓
Player name
↓
Enter Hunt
```

For casual events we do not need enterprise identity.

A team session should persist so refreshing the page does not log the player out.

Multiple team members may access the same team from different devices.

The server must therefore handle concurrent interactions sensibly.

---

# 15. Security Philosophy

This is a fun event.

We do **not** need extreme anti-cheat.

We should still prevent trivial cheating.

Examples we should prevent where practical:

* correct QR token visible in frontend source
* correct answers downloaded before question submission
* changing score from browser devtools
* calling a public database update directly
* changing checkpoint completion manually
* seeing administrator functions by knowing a URL
* reading all secret codes from client-side API responses

Important authoritative operations should happen server-side.

Client submits:

```text
QR token
```

Server determines whether it is valid.

Client should not receive:

```text
expected_qr_token
```

before verification.

Same principle applies to:

* manual code answers
* puzzle answers
* score modifications
* checkpoint completion
* organizer controls

---

# 16. Existing V1 Security Should Not Be Preserved

The current Supabase policies include rules such as:

```text
Anyone can update hunts
Anyone can delete hunts
Anyone can create/update/delete checkpoints
Anyone can update/delete teams
Anyone can view all progress
```

with unconditional `true` checks.

Those policies were understandable for getting V1 operational quickly but should not be the V2 security model.

Use server-side APIs/RPCs and appropriate database permissions.

The administrator must have real server-side authentication/session protection.

Again, this does not need enterprise complexity.

It simply needs to avoid making privileged actions public.

---

# 17. Authoritative Game State

The server/database should be authoritative.

Do not rely on combinations of:

* React state
* optimistic booleans
* localStorage
* repeated database polling
* inferred completion status

for core game progression.

The UI may optimistically display feedback where appropriate, but permanent state must come from the game engine.

At the simplest level, a checkpoint can have:

```text
LOCKED
ACTIVE
COMPLETED
SKIPPED
```

Individual actions inside a flow can have:

```text
PENDING
ACTIVE
COMPLETED
FAILED
SKIPPED
```

The exact state model is for the implementation to determine.

It should be explicit and deterministic.

---

# 18. Idempotency Matters

Mobile players double tap.

Networks retry.

Browsers reload.

Two teammates may perform the same action simultaneously.

Operations such as:

```text
useHint(hintId)
scanQR(token)
submitAnswer(answer)
completeAction(actionId)
completeCheckpoint(checkpointId)
```

should be safe to execute twice.

A hint must not charge twice because a request retried.

A QR should not award checkpoint points twice.

A double tap should not complete two checkpoints.

---

# 19. QR Verification

QR remains valuable.

Do not remove it.

Improve it.

QR can be used as:

* checkpoint verification
* puzzle answer
* clue source
* branch trigger
* hidden object
* decoy/dud
* event entry
* team registration
* AR activation
* recovery token

QR tokens should preferably be generated values rather than predictable:

```text
CHECKPOINT_1
CHECKPOINT_2
```

The printed QR can optionally include a short human-readable recovery code.

For example:

```text
QR

K7DM2Q
```

If camera access fails, player can enter:

```text
K7DM2Q
```

The organizer should decide whether fallback codes are enabled.

---

# 20. Physical QR Failure Is Expected

A major lesson from the real event:

**physical game objects are unreliable.**

QRs may be:

* torn
* removed
* damaged
* covered
* wet
* poorly printed
* moved
* vandalized

A checkpoint must therefore not necessarily have one irreversible dependency.

Allow fallback verification.

Example:

```text
Primary verification:
QR

Fallback:
GPS + landmark photograph

Emergency:
Organizer approval
```

An organizer should be able to activate/change fallback behavior while the hunt is live.

---

# 21. GPS Is a Region Signal, Not Exact Proof

GPS was unreliable in V1 because mobile GPS can drift significantly.

Do not use GPS as proof that someone is standing beside a particular statue.

Instead use GPS to answer:

> Is this player approximately where the checkpoint is located?

Example configuration:

```text
latitude
longitude
recommended radius
minimum radius
accuracy tolerance
```

The UI should understand location accuracy.

Example:

```text
You appear to be nearby.
GPS accuracy: approximately ±45 m.
```

The system may require several readings or use accuracy as part of verification.

But do not over-engineer anti-spoofing.

The purpose is player guidance and casual verification.

---

# 22. GPS + Camera Is More Powerful Than GPS Alone

An intended major V2 experience is:

```text
clue
↓
player travels
↓
GPS determines they are in the general area
↓
camera guidance becomes available
↓
player identifies the actual landmark
```

This is especially useful for locations where a GPS coordinate alone is ambiguous.

---

# 23. AR Philosophy

Do not assume AR means a massive Pokémon-Go-style system.

The core goal of AR in this project is **guidance and alignment**.

Potential AR/camera experiences:

### Directional guidance

```text
← rotate left
↑ continue forward
32 metres
```

### Landmark guidance

Display:

* transparent reference image
* silhouette
* outline
* guide rectangle
* landmark description
* directional arrow

Player aligns the real-world camera.

### Image-target interaction

The user points camera toward a known large object such as:

* building facade
* statue
* gate
* mural
* shop entrance
* banner
* sign

When the system recognizes/alignment matches it, an overlay appears.

Example:

```text
camera sees gate
↓
virtual symbol aligns with gate
↓
player taps symbol
↓
next clue revealed
```

Do not require full 3D world mapping unless it actually improves the experience.

The implementation should choose the lightest web-compatible approach.

---

# 24. Image Verification — Important, But Can Be Later

Image verification is part of the long-term product vision but does not need to block the V2 core architecture.

Design the flow system so that:

```text
IMAGE_VERIFY
```

can be introduced cleanly later.

Do not build the entire architecture around whichever vision model happens to be convenient today.

---

# 25. Intended Image Verification Experience

Example checkpoint:

> Find the historic gate described in the clue.

Player finds what they believe is the correct gate.

The player presses:

**Verify Landmark**

Camera opens.

They photograph the gate.

The system considers multiple signals:

```text
GPS proximity
+
visual similarity
+
local visual features
+
optional AI/VLM judgement
```

Then returns something like:

### Strong match

> Landmark verified ✓

### Uncertain

> You are very close. Try taking another photo showing the entire entrance.

### Wrong

> This does not appear to be the landmark yet.

### Repeated uncertainty

> Having trouble? Request organizer verification.

---

# 26. Landmark Reference Sets

Do not assume one reference photograph will be sufficient.

When creating an image-verification location, an organizer should eventually be able to store multiple references.

Example:

```text
Gate:
front.jpg
left.jpg
right.jpg
distance.jpg
evening.jpg
close.jpg
```

Different:

* angles
* distances
* lighting
* weather
* crowd conditions

should improve robustness.

---

# 27. Possible Future Vision Architecture

Do not treat this as a mandatory implementation specification.

This is a direction.

A future image verification pipeline might use:

### First signal

GPS.

If the player is nowhere near the correct region, reject or ask them to get closer.

### Second signal

Image embeddings / similarity against reference images.

### Third signal

Local feature matching / geometric matching for distinctive structures and signage.

### Fourth signal

Optional vision-language model for uncertain cases.

### Fifth signal

Human organizer approval.

This produces something like:

```text
AUTO_ACCEPT
RETRY
AUTO_REJECT
HUMAN_REVIEW
```

The implementation may evolve significantly as vision tooling improves.

The important requirement now is that `IMAGE_VERIFY` can exist as an engine node without forcing the entire engine to understand its internals.

---

# 28. Puzzles Are Modules Too

Do not distinguish architecturally between:

> “real puzzle”

and

> “hint puzzle.”

A puzzle is a reusable content/action module.

It can appear anywhere.

Example:

```text
Checkpoint Challenge:
Jigsaw puzzle
```

or:

```text
Hint:
Complete this jigsaw to reveal the landmark.
```

Same engine/component.

Context determines its purpose.

---

# 29. Puzzle Extensibility

V1 already contains several puzzle types.

V2 should create a puzzle interface/protocol so that adding a puzzle does not require rewriting checkpoint logic.

Conceptually each puzzle should know:

```text
configuration
current state
validation/completion
save/restore
display component
```

Potential puzzle types:

* text answer
* multiple choice
* jigsaw
* Sudoku
* crossword
* word search
* rotation puzzle
* matching
* ordering
* memory
* sequence
* image hotspot
* observation
* cipher
* audio identification
* image identification
* custom plugin

Puzzle progress should survive refresh.

---

# 30. Autosave

Any multi-step puzzle should save safely.

Players may:

* refresh
* switch apps
* lose network
* close browser
* receive a phone call

Puzzle state should preferably restore.

The save system must avoid stale-state problems.

Use a robust debounce/queue mechanism and explicit persistence rather than relying on timing assumptions.

---

# 31. Checkpoint Completion Must Be Deliberate

V1 blurred several concepts:

```text
unlock checkpoint
solve something
mark complete
go next
```

V2 should distinguish:

### Access

Can this team interact with this checkpoint?

### Active flow

Where are they inside the checkpoint?

### Completion

Has the required completion path reached its terminal condition?

A checkpoint should complete because its flow says it is complete.

Not because every checkpoint always shows an arbitrary:

**Mark Complete**

button.

Manual completion can still exist as one action type if desired.

---

# 32. Scoring Engine

Scoring should be configurable.

Possible factors:

* checkpoint base points
* hint cost
* time bonus
* wrong-attempt penalty
* skip penalty
* puzzle bonus
* optional challenge bonus
* exploration bonus
* hidden object bonus

But keep the default simple.

For most events:

```text
checkpoint = 20 points
hint 1 = -2
hint 2 = -4
hint 3 = -6
```

is enough.

The engine should support more without forcing organizers to use it.

---

# 33. Score Ledger Is Better Than Random Mutations

Consider treating score changes as transactions/events:

```text
+20 checkpoint completion
-4 map hint
+5 bonus puzzle
-2 wrong answer
```

Then team total is understandable and debuggable.

The organizer can see why a team has 137 points.

This will greatly improve live-event troubleshooting.

---

# 34. Organizer Dashboard Is a Major Part of the Product

The admin panel should not merely create database rows.

It should eventually become the place from which an entire event is designed and operated.

Think:

# TREASURE HUNT CONTROL ROOM

---

# 35. Hunt Creation

Organizer should be able to define:

* title
* description
* cover
* theme
* rules
* team rules
* start/end times
* scoring mode
* leaderboard behavior
* location/map settings
* maximum team size
* registration settings
* visibility/status
* branding
* completion screen

Potential statuses:

```text
DRAFT
READY
LIVE
PAUSED
ENDED
ARCHIVED
```

---

# 36. Hunt Builder

Organizer should be able to:

* create checkpoints
* reorder them
* branch them
* duplicate them
* group them
* configure required/optional checkpoints
* configure flows
* configure hints
* configure fallback paths
* assign point values
* add media
* preview player experience
* test checkpoints

Eventually the hunt should be reusable as a template.

---

# 37. Checkpoint Editor

A checkpoint editor should have understandable sections.

For example:

```text
Basic Information

Flow

Hints

Scoring

Location

Fallbacks

Testing

Advanced
```

The organizer should not be forced to understand database tables.

---

# 38. Live Operations Dashboard

This feature is essential because V1 required too much personal assistance.

During a hunt the organizer should see something like:

| Team  | Current checkpoint | Status    | Last activity | Points | Hints | Issue         |
| ----- | ------------------ | --------- | ------------- | -----: | ----: | ------------- |
| Red   | Clock Tower        | Searching | 20 sec        |     87 |     1 | —             |
| Blue  | Market Gate        | GPS       | 15 sec        |     82 |     2 | —             |
| Green | Temple             | Stuck     | 9 min         |     75 |     3 | Camera denied |

Possible actions:

* view team
* view progression
* unlock current step
* approve image
* reject image
* skip action
* skip checkpoint
* move team backward
* move team forward
* restore points
* deduct points
* reset hint
* resend clue
* enable fallback verification
* manually verify checkpoint

These actions should be logged.

---

# 39. Event Activity Feed

Useful organizer view:

```text
14:32 Red Team scanned Clock Tower QR
14:33 Blue Team used Map Hint (-4)
14:34 Green Team submitted wrong answer
14:35 Red Team completed Clock Tower (+20)
14:36 Purple Team camera permission failed
14:37 Organizer manually verified Purple Team
```

This turns debugging into event management.

---

# 40. Event Health

Eventually provide a simple event-health layer.

Examples:

```text
3 teams have been stuck >10 minutes

Checkpoint 4 has unusually high failure rate

6 camera permission failures

QR checkpoint 8 has 14 failed scans

GPS verification at checkpoint 6 is failing frequently
```

This is much more useful than discovering a physical QR was destroyed because six people come looking for the organizer.

---

# 41. Recovery Is a Core Feature

Real-world games fail in physical ways.

Build recovery deliberately.

A persistent:

**Need Help?**

entry point should exist where appropriate.

Possible failure:

### Camera permission denied

Show understandable instructions and fallback options.

### Camera unavailable

Offer manual code if configured.

### QR damaged

Offer configured alternate verification.

### GPS inaccurate

Explain accuracy and offer retry/fallback.

### Network down

Keep state locally where possible and retry.

### Puzzle broken

Organizer can skip/reset.

### Photograph repeatedly uncertain

Request organizer review.

### Device battery dying

Another teammate can continue.

The desired design rule is:

> A normal failure should not require the organizer to physically take the participant's phone.

---

# 42. Offline / Weak Network Resilience

The application will often be used outdoors.

Assume unstable mobile data.

At minimum:

* preserve active checkpoint locally
* preserve puzzle state where reasonable
* preserve unsent actions temporarily
* clearly indicate connectivity state
* retry safe operations
* avoid losing the player's screen because one API request failed

Example UI:

> You're offline. Your current progress is safe. We'll reconnect automatically.

Do not pretend an operation saved if it did not.

---

# 43. Do Not Overdo Offline Complexity Initially

Full offline synchronization is difficult.

The engine does not need to become Google Docs.

Prioritize:

* graceful connection failures
* cached current content
* persisted local state
* safe retries

before complex multi-device offline conflict resolution.

---

# 44. Notifications and Feedback

The game should feel alive.

Use subtle:

* haptics where supported
* confetti
* sound
* progress animations
* successful scan indicators
* point changes
* checkpoint completion screens

But keep these lightweight.

They should be optional per hunt/theme.

---

# 45. Themes and Branding

Because this is an engine, hunts should eventually have basic customization:

* colors
* logo
* hero image
* typography preset
* button styling preset
* checkpoint icon styles
* success animation style
* background assets

Do not let full visual customization destroy maintainability.

Use controlled theme tokens.

---

# 46. Maps

Maps are optional game modules.

An organizer may decide:

```text
No map
```

or:

```text
Show complete map
```

or:

```text
Only show rough regions
```

or:

```text
Unlock map after hint
```

or:

```text
Only show visited checkpoints
```

This should be configuration.

---

# 47. Location Privacy

Only request GPS when it is actually needed.

Do not continuously track every player unnecessarily.

Explain why permission is required.

Example:

> This checkpoint uses your approximate location to confirm that you've reached the area.

---

# 48. QR Decoys

The V1 concept of dud QR codes is fun and should remain.

But decoys should be proper game content.

Example:

```text
Dud QR:
"You found the accountant's secret coffee stash. Unfortunately this isn't your checkpoint."
```

They might optionally:

* do nothing
* show comedy message
* deduct points
* award Easter egg
* reveal clue
* record discovery

Dud QR detection should happen through the same central QR verification system.

---

# 49. Variables / Game Memory

For advanced customization, the engine may eventually need simple game variables.

Example:

```text
found_red_key = true
visited_market = true
secret_route = unlocked
```

This allows flows such as:

```text
If player found red key
    unlock secret puzzle
else
    normal route
```

Do not necessarily build a programming language.

A simple key/value game-state system is enough initially.

---

# 50. Sequential and Non-Sequential Hunts

Do not assume all hunts are:

```text
1 → 2 → 3 → 4
```

Support the concept of:

### Sequential

One checkpoint at a time.

### Open world

Any checkpoint can be attempted.

### Branching

Player chooses path.

### Hub

Complete several sub-checkpoints then return.

### Required + optional

Five required checkpoints plus bonus challenges.

This greatly expands what the engine can create.

---

# 51. Hunt Templates

Long term, allow duplication/templates.

Examples:

```text
City Treasure Hunt
Office Team Building
Birthday Hunt
Campus Orientation
Museum Trail
Mall Hunt
School Scavenger Hunt
Wedding Game
```

The organizer duplicates and edits.

---

# 52. Team Progress Model

Store enough information to answer:

* What checkpoint is the team on?
* What flow node is active?
* What has been completed?
* What hints were used?
* What points changed?
* What puzzle state exists?
* What verification attempts occurred?
* What organizer interventions occurred?

Do not derive critical facts by guessing from unrelated counts.

---

# 53. Event Log / Audit Trail

Consider event-based records such as:

```text
TEAM_JOINED
CHECKPOINT_STARTED
QR_SCANNED
QR_FAILED
GPS_ENTERED
HINT_USED
ANSWER_SUBMITTED
PUZZLE_COMPLETED
IMAGE_SUBMITTED
CHECKPOINT_COMPLETED
ORGANIZER_OVERRIDE
POINTS_CHANGED
```

The game does not necessarily need full event sourcing.

But an event log is extremely valuable for:

* debugging
* analytics
* organizer visibility
* restoring context

---

# 54. Database Design

Do not blindly migrate every V1 table.

Design the V2 schema around the engine.

Conceptual entities may include:

```text
Hunt
HuntVersion/Configuration

Checkpoint

Flow
FlowNode
FlowEdge

Hint

PuzzleConfiguration

Team
Player/TeamMember

TeamHuntSession

CheckpointProgress
NodeProgress

HintUsage

ScoreTransaction

PuzzleState

VerificationAttempt

MediaAsset

Landmark

Organizer

EventLog

OrganizerOverride
```

These names are suggestions.

Choose a schema that is clean and maintainable.

---

# 55. Hunt Versioning

Changing a live hunt while teams are halfway through it can cause problems.

Eventually consider separating:

```text
editable draft configuration
```

from:

```text
published/live configuration
```

At minimum, avoid accidentally deleting/changing objects that active progress depends on.

---

# 56. Media

The engine should handle media cleanly.

Media types:

* images
* audio
* short video
* thumbnails
* puzzle assets
* landmark references

Use object storage or filesystem storage depending on deployment.

Generate appropriately sized derivatives.

Avoid loading full-resolution originals unnecessarily.

---

# 57. Hosting Philosophy

V2 should not be structurally dependent on Vercel.

Vercel can remain one deployment target.

The application should also be self-hostable.

The desired deployment modes are:

### Cloud-hosted

Normal public server.

### Local machine + public tunnel

Application/database run on organizer's own computer.

Public HTTPS address reaches it through a secure tunnel.

### Event LAN

Potential future mode where participants connect to a local network.

Full LAN-only camera support requires additional HTTPS/certificate planning and can remain a later capability.

---

# 58. Local Hosting

It should be possible to run the complete game engine on a desktop/laptop.

For example:

```text
Docker Compose

Web App
Database
Storage
Optional Redis/queue
Optional vision service
Reverse proxy
```

or another sensible architecture.

The exact infrastructure is for the coding agent to select.

The important requirement:

```text
docker compose up
```

or another simple command should eventually be capable of running a self-contained event server.

---

# 59. Public Access From Local Server

One intended setup:

```text
Participant Phone
      ↓
hunt.example.com
      ↓
HTTPS/Tunnel
      ↓
Organizer Computer
      ↓
Treasure Hunt Server
```

This allows the organizer to own the runtime without requiring Vercel.

Do not expose raw database ports publicly.

Only expose the appropriate web endpoint.

---

# 60. Hosting Should Be Portable

Avoid unnecessary platform-specific dependencies.

Prefer standard technology:

* Node
* PostgreSQL
* object/file storage
* Docker
* standard HTTP/WebSocket/SSE where needed

Supabase can still be used if it genuinely helps.

But the application architecture should not make Supabase mandatory forever.

---

# 61. Keep Supabase if Useful, Replace if Simpler

V1 uses Supabase heavily.

Do not replace technology merely for the sake of rewriting.

Evaluate whether V2 benefits from:

* Supabase Auth
* PostgreSQL
* Storage
* Realtime

If yes, retain appropriate parts.

If a normal PostgreSQL + server API architecture is cleaner, that is also acceptable.

The product requirements matter more than preserving the current stack.

---

# 62. Real-Time Features

True real-time updates are useful primarily for:

* leaderboard
* organizer dashboard
* team status
* human image approvals
* live overrides

They do not need to infect every part of the application.

Use simple polling/SSE/WebSocket/realtime subscription depending on what is appropriate.

---

# 63. Organizer Authentication

The V1 approach of a client-side administrator password should be replaced.

An organizer should have a proper authenticated session.

For personal/self-hosted events this can still be simple:

```text
email/password
```

or:

```text
configured admin credentials
```

with server validation.

The important point is that admin privileges must not be represented only by frontend JavaScript.

---

# 64. Team Authentication

Keep team access lightweight.

Team PIN/password is acceptable for casual events.

Potentially generate a session token after successful join.

Do not repeatedly download team PINs and compare them only in the browser.

---

# 65. Privacy and Cleanup

Events may contain:

* names
* photos
* location attempts

Provide a simple way to delete/archive event data.

Image verification photographs should have configurable retention.

For example:

```text
delete after verification
delete after event
retain for analytics
```

depending on organizer choice.

Default toward sensible minimal retention.

---

# 66. Image Upload Performance

When image verification is introduced:

Do not upload 12-megapixel raw phone photographs unnecessarily.

Client can:

* resize
* compress
* correct orientation

before upload.

Keep enough resolution for recognition but avoid wasting bandwidth.

---

# 67. Accessibility

Basic requirements:

* readable contrast
* large tap targets
* text alternatives for important images where possible
* no critical information communicated by color alone
* screen orientation resilience
* reasonable keyboard behavior
* support for reduced motion where practical

---

# 68. Testing

V2 needs automated tests around the engine.

V1 currently has no test command in the project scripts.

The coding agent should introduce an appropriate testing strategy.

Especially test real event failure scenarios.

Examples:

```text
Create/join team

Refresh mid-checkpoint

Correct QR

Wrong QR

Repeated wrong QR

Dud QR

QR camera permission denied

Fallback code

GPS permission denied

GPS inaccurate

Use Hint 3 before Hint 1

Refresh after hint

Double tap hint

Two teammates request same hint

Network timeout while hint is being used

Wrong answer

Correct answer

Puzzle refresh

Checkpoint complete

Double completion request

Organizer manual override

Leaderboard update

Score consistency
```

Add browser E2E coverage for the critical player journey.

---

# 69. Multi-Device Team Tests

Explicitly test:

```text
Phone A and Phone B belong to same team.
```

Phone A uses a hint.

Phone B should correctly see the new game state.

Phone A completes checkpoint.

Phone B should not independently award completion again.

This is likely to happen in real events.

---

# 70. Device Testing

Priority environments:

* Android Chrome
* iPhone Safari
* older Android Chrome
* desktop Chrome for admin
* low bandwidth simulation
* permission denial scenarios

AR/image functionality can progressively enhance.

Core hunt progression should not depend on the newest phone hardware unless the organizer deliberately chooses such a checkpoint type.

---

# 71. Admin Preview / Test Mode

Extremely important.

Before an event, the organizer should be able to:

**Preview as Player**

Ideally:

```text
Start Test Session
```

without affecting real leaderboard data.

Allow jumping between checkpoints during testing.

Allow simulating:

* successful QR
* GPS arrival
* hint use
* correct answer
* incorrect answer
* fallback

This will make configuring complex hunts dramatically easier.

---

# 72. Validation Before Publishing

The builder should detect obviously broken hunts.

Examples:

```text
Flow node has no outgoing path.

QR verification has no QR token.

GPS node has no coordinates.

Question has no correct answer.

Checkpoint cannot reach COMPLETE.

Flow references deleted hint.

Hunt has no starting checkpoint.
```

Ideally show:

> Hunt has 3 configuration issues.

before allowing it to go live.

---

# 73. User-Friendly Error Messages

Never display raw:

* database errors
* JavaScript errors
* Supabase errors
* permission exception strings

to participants.

Translate them.

Example:

Instead of:

```text
NotAllowedError: Permission denied
```

show:

> Camera permission is blocked. Enable camera access in your browser settings or use the backup code.

Include:

**Try Again**

and any configured fallback.

---

# 74. Avoid Excessive Modal Stacking

V1 accumulated several modal-based flows.

V2 should keep interactions simpler.

Camera, hints and puzzles can use focused views/sheets where appropriate.

Avoid:

```text
modal
inside modal
inside error modal
inside confirmation modal
```

especially on mobile.

---

# 75. Player Navigation

Avoid forcing players to understand browser Back.

Provide game-level navigation where necessary.

The current task should always be recoverable.

Potential persistent layout:

```text
Team / score
Progress
────────────
Current content
────────────
Hint
Need Help?
```

Keep it visually light.

---

# 76. Leaderboard

Configurable.

Organizer may choose:

```text
Live leaderboard
Hidden leaderboard
Leaderboard only at finish
Points only
Progress only
Points + time
```

This prevents leaderboard pressure in casual events.

---

# 77. Completion Experience

Finishing the hunt should feel rewarding.

Possible:

* animation
* final score
* checkpoint summary
* team position if leaderboard enabled
* hints used
* time taken
* final media/message
* share image
* certificate later if desired

---

# 78. Analytics

Not mandatory for initial implementation, but the architecture should allow useful analytics.

Examples:

* average checkpoint time
* hint usage by checkpoint
* failed verification rate
* most difficult puzzle
* QR failure counts
* abandonment
* average score
* completion rate

This can help organizers improve future hunts.

---

# 79. Plugin-Like Future Direction

Eventually actions/puzzles/hints should feel extensible.

A new puzzle should not require modifying twenty checkpoint files.

A new verification method should not require rewriting the flow engine.

Ideally there is a registry concept:

```text
actionRegistry
puzzleRegistry
hintRendererRegistry
verificationRegistry
```

Exact implementation is flexible.

The architectural principle is more important than names.

---

# 80. Important Scope Philosophy

Build a powerful engine.

But do not make every possible feature mandatory.

Every feature should be composable.

A beginner should still be able to create:

```text
Checkpoint 1
Question
QR
20 points
```

in minutes.

Advanced organizers can build:

```text
Riddle
↓
GPS region
↓
AR guidance
↓
Landmark verification
↓
Puzzle
↓
Branch
↓
Bonus challenge
```

The sophistication should scale with the organizer.

---

# 81. V1 → V2 Migration Philosophy

Do not blindly refactor every old component.

Inspect V1 and decide what is worth reusing.

Potentially reusable:

* styling
* puzzle implementations
* team UI
* leaderboard ideas
* QR scanner concepts
* map components
* utility components
* data/content from existing hunts

Potentially rewrite:

* checkpoint state logic
* hint state
* verification logic
* admin architecture
* database permissions
* scoring mutations
* flow architecture
* recovery handling

The coding agent has permission to significantly restructure the repository if it results in a cleaner V2.

Do not preserve poor architecture purely to minimize diff size.

---

# 82. Remove Prototype Debris

The existing repository contains many patches and troubleshooting artifacts from getting V1 operational.

As V2 stabilizes:

* archive obsolete documentation
* remove dead code
* remove debug network calls
* remove duplicated systems
* remove legacy compatibility once migration is complete
* consolidate documentation

The final repository should communicate one coherent architecture.

---

# 83. Documentation

Create strong project documentation.

At minimum explain:

### Product

What Treasure Hunt Engine is.

### Architecture

How hunts, checkpoints and flow nodes work.

### Development

How to run locally.

### Self Hosting

How to deploy using Docker/local server.

### Cloud Deployment

Generic deployment guidance.

### Creating Modules

How to add a new:

* action
* verification type
* puzzle
* hint renderer

### Data

Core schema/state concepts.

---

# 84. Desired Product Identity

The final application should feel like:

**a lightweight game-design tool for real-world treasure hunts.**

The closest mental model is not:

> “a website containing a treasure hunt.”

It is:

> **“a small no-code/low-code engine for designing location-based real-world games.”**

The organizer builds the experience.

The engine executes it.

The player only sees the adventure.

---

# 85. Example Hunt Demonstrating the Vision

Create one strong example/demo hunt eventually.

## Checkpoint 1 — Beginning

```text
Text clue
↓
Simple answer
↓
Complete
```

## Checkpoint 2 — Hidden QR

```text
Riddle
↓
QR scan
↓
Wrong QR stays in scanner
↓
Correct QR
↓
Complete
```

## Checkpoint 3 — Landmark

```text
Riddle
↓
Hint 1: text
↓
Hint 2: image
↓
Hint 3: rough map
↓
GPS area
↓
Camera guidance
↓
Future: photo verification
↓
Complete
```

## Checkpoint 4 — Puzzle Chain

```text
Jigsaw
↓
Word search
↓
Answer
↓
Complete
```

## Checkpoint 5 — Alternate Verification

```text
Find location
↓
QR
OR
GPS + backup code
↓
Complete
```

## Final Checkpoint

```text
Use information collected from previous checkpoints
↓
Final puzzle
↓
Complete Hunt
```

This one hunt can act as a showcase of the engine.

---

# 86. Specific Example: Kalyan Landmark Experience

This describes the intended sophisticated use case very closely.

Suppose a checkpoint points toward a landmark somewhere in Kalyan.

Starting clue:

> Historical/riddle information describing the location.

Maximum checkpoint value:

```text
20 points
```

If the team recognizes the clue and finds the location without help:

```text
20/20
```

If stuck:

### Hint 1

Textual clarification.

```text
-2 points
```

### Hint 2

Approximate map/search area.

```text
-4 points
```

### Hint 3

GPS-assisted navigation.

```text
-5 points
```

### Hint 4

Camera/AR landmark guidance.

```text
-6 points
```

Player reaches location.

GPS confirms that they are broadly nearby.

Camera opens.

The UI helps them align with a large permanent object such as:

* gate
* statue
* shop frontage
* building
* mural
* sign

Eventually:

```text
Take Photo
↓
Image Verification
↓
Landmark Confirmed
```

The next question/puzzle then appears.

This is representative of the kind of experience the engine must make possible.

---

# 87. What AR and AI Should NOT Do

Do not add technology simply because it sounds advanced.

Do not require:

* downloading huge ML models on player phones
* constant camera analysis
* full 3D reconstruction
* SLAM if not necessary
* persistent GPS tracking
* expensive AI call for every screen

Most computation should stay simple.

If image recognition becomes heavy:

```text
phone captures/compresses image
↓
server processes
↓
result returned
```

Do not make low-end participant phones run heavy inference.

---

# 88. Human Override Is a Feature

AI confidence will never be perfect.

Physical events are messy.

The organizer should always have a way to say:

```text
Yes, they found it.
```

or:

```text
No, retry.
```

The human organizer is the final fallback.

That is not a failure of automation.

It is good event design.

---

# 89. Development Freedom

This document defines the intended product and important behavioral requirements.

It does **not** prescribe every library, directory or coding pattern.

Inspect the current repository.

Understand existing behavior.

Choose appropriate architecture.

Refactor/rebuild where necessary.

Break implementation into whatever internal plan makes sense.

Do not ask the product owner to manually break this specification into hundreds of coding tasks unless a genuine product ambiguity prevents implementation.

Use engineering judgment.

---

# 90. Priority of Correctness

When choosing between:

```text
preserving V1 implementation
```

and

```text
creating a clean V2 engine
```

prefer the clean engine.

When choosing between:

```text
adding another puzzle
```

and

```text
making persistence/recovery reliable
```

prefer reliability.

When choosing between:

```text
complex AR
```

and

```text
solid checkpoint composition
```

build the checkpoint engine first.

When choosing between:

```text
image AI now
```

and

```text
architecting IMAGE_VERIFY so it can be added later
```

architect it first.

---

# 91. Suggested Capability Maturity

This is not a required task breakdown.

It describes how the product capabilities logically mature.

## Core V2

Must establish:

* modular engine
* flow-based checkpoints
* robust state
* team sessions
* hints
* puzzles
* QR
* GPS
* manual answers/codes
* scoring
* recovery
* admin creation
* admin live controls
* secure server-side validation
* mobile UX
* self-hosting capability

## Enhanced V2

Can expand:

* graphical flow builder
* hunt templates
* richer media
* advanced branching
* analytics
* event health
* richer maps
* PWA/offline improvements

## Experimental / Advanced

Can eventually add:

* AR landmark alignment
* sophisticated AR guidance
* image verification
* visual embeddings
* local feature matching
* VLM fallback
* automated landmark confidence
* advanced computer vision

The architecture created now must make the final category possible without needing another complete rewrite.

---

# 92. Definition of Success

Treasure Hunt V2 succeeds when all of these statements are true:

### For a player

> I opened a link and immediately understood how to play.

> When something failed, the application told me what to do.

> I never needed to understand the internal game engine.

> My progress survived normal browser/network problems.

### For an organizer

> I can create very different treasure hunts without changing code.

> I can combine QR, GPS, puzzles, hints, codes, maps and eventually AR/image verification in different sequences.

> I can understand what every team is doing during the event.

> If someone gets stuck because technology fails, I can rescue them remotely.

> A destroyed QR does not destroy my event.

### For a developer

> Adding a new puzzle does not require rewriting checkpoint progression.

> Adding a new verification method does not require duplicating the game engine.

> Important game state is authoritative and understandable.

> The application can be self-hosted without depending fundamentally on Vercel.

> The architecture is understandable enough that future AI coding agents can continue extending it.

---

# Final Product Statement

Build Treasure Hunt V2 as a:

# Modular, lightweight, web-first real-world game engine.

It should allow organizers to create anything from a five-checkpoint QR hunt to a sophisticated city adventure involving riddles, maps, GPS, camera guidance, puzzles, branching paths, scoring, multimedia hints, alternative verification and eventually computer-vision landmark recognition.

The underlying engine may be complex.

The participant experience must remain simple.

The organizer should have enormous flexibility.

Physical failure should be expected.

Recovery should be designed in.

QR, GPS, puzzles, hints, AR and image recognition are not separate games.

They are **building blocks of the same engine**.

V1 proved that the basic idea works.

V2 should turn that prototype into the system that V1 was trying to become.
