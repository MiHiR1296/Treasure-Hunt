# The Five Fragments showcase

The runnable example at `/v2?hunt=kalyan-demo` demonstrates the plan's six-checkpoint adventure and Kalyan landmark scoring. It uses the same published definitions, server validation, puzzle saving, hints and recovery controls as organizer-created hunts.

The Kalyan coordinates are an **illustrative workshop search area**, and the supplied gate art is an illustration. Before using the template outdoors, set coordinates to your inspected route, replace the reference set with photographs of the actual landmark, confirm access, and print the current QR materials. The demo makes no claim that the illustrated gate exists at its sample coordinate.

## Publish and test

With a locally configured PostgreSQL connection:

```sh
npm run db:migrate
npm run db:seed
```

If an older demo already exists, the normal seed keeps it unchanged. To publish this showcase for **new teams**, keeping existing teams on their original published version:

```sh
npm run db:seed -- --upgrade
```

Alternatively, sign in at `/v2/admin`, choose **Use example**, save the draft and select **Start player preview**. Preview uses an independent session and does not enter the live leaderboard. Publish the draft as Ready for later or Live for immediate play. A copied example has a new hunt ID; use its own player link.

Docker users can publish through the organizer UI or run `docker compose exec web npm run db:seed`. To upgrade an existing demo for new teams, run `docker compose exec web npm run db:seed -- --upgrade`.

## Complete the tabletop route

Every checkpoint awards 20 points. A no-hint run finishes with **120 points**. Hints deduct only their displayed cost, once per team.

| Checkpoint | Player route | Workshop answer/material |
| --- | --- | --- |
| 1. Find Your Bearings | Read clue → answer → collect fragment | Answer `compass`; fragment **LOOK**. |
| 2. The Hidden QR | Read clue → scan QR or printed recovery code → collect fragment | QR payload `demo-clock-tower-8cde79a2`; recovery `K7DM2Q`; fragment **BEYOND**. |
| 3. The Landmark | Read clue → GPS or tabletop fallback → camera guidance → observation question or reviewed photo → collect fragment | Choose tabletop option and enter `KALYAN`; observation answer `arch`; fragment **THE**. |
| 4. Picture, Words, Answer | 2×2 jigsaw → word search → answer → collect fragment | Arrange sky above plants to form the gate. Find `GATE` across row 1 and `OLD` across row 3; answer `gate`; fragment **OLD**. |
| 5. Two Ways Through | QR **or** GPS then marker code → collect fragment | QR payload `demo-trail-marker-649b7e20`, printed recovery `CROSSING`; GPS route then code `ADVENTURE`; fragment **GATE**. |
| 6. The Five Fragments | Combine collected words → final image → finish | Enter `LOOK BEYOND THE OLD GATE`. |

For a completely remote test, choose the tabletop route at checkpoint 3 and QR/recovery at checkpoint 5. No camera or GPS permission is required on that route. The camera guide can display its reference without opening the camera; continuing is an acknowledgement, not automated landmark recognition.

The jigsaw's correct piece IDs in row-major order are `sky`, `copper`, `fern`, `stone`. These are organizer/test instructions; the player receives tile images and their own saved arrangement, not the private solution array.

## Demonstrate real-event failures

At checkpoint 2, scan a normal wrong QR repeatedly, then either decoy payload:

- `demo-coffee-stash`
- `demo-sleeping-dragon`

The same scanner session should remain open with inline feedback until a correct QR is accepted. Unit tests prove the validation-session contract; confirm physical camera behavior on the event's actual phones too.

Deny camera permission and enter `K7DM2Q`. To simulate a destroyed QR, ask for help from the player page, then use the organizer's team controls to enable the configured organizer-verification fallback or approve the current task. Interventions require a reason and the team's current revision.

At checkpoint 5 choose the QR path, then **QR missing — use location and code**. GPS checks the region before allowing `ADVENTURE`. If GPS is unavailable, the organizer can enable that GPS action's recovery path or approve it remotely. Using recovery records an event; it does not edit the immutable published definition.

Start the puzzle on one device, switch to a teammate device, make a move, and return. The server rejects a stale puzzle revision instead of silently overwriting the teammate's work. Refreshing restores the saved puzzle. A lost response retains its original request ID for safe retry.

## Kalyan landmark hints

These are independent purchases: the team may choose Hint 4 first and never purchase Hint 1.

| Hint | Cost | Behavior |
| --- | ---: | --- |
| Riddle nudge | 2 | Describes the entrance. |
| Rough search area | 4 | Shows approximate map region. |
| Distance and direction | 5 | Requests a location reading on tap and optionally uses compass orientation. |
| Camera landmark guide | 6 | Overlays the gate outline on the camera; remains readable without camera access. |
| Additional reference image | 3 | Displays the illustrated gate separately. |

No hints gives **20/20** at this checkpoint. Buying only the first four gives **3/20**: `20 − 2 − 4 − 5 − 6`. The extra image hint is separate and optional. Hint totals may produce a negative interim score before completion; no hidden score floor or second hint deduction is applied.

## Photo review

Choose **Send a landmark photo for organizer review**. A phone photo is compressed locally, uploaded to private storage, associated with the current team/checkpoint/action, then submitted for review. The default retention deletes it after review. The organizer can approve it or reject it with useful retry instructions; the player resumes automatically on the next state refresh. A configured alternative allows the observation question if photography fails.

This implementation performs **human photo verification** with optional configured GPS proximity. It does not claim visual embeddings, local feature matching, VLM judgement or automatic landmark confidence. The sample photo node has no second GPS requirement because its flow already includes a region check or explicitly chosen tabletop recovery. Add the node's region requirement for an event that must enforce proximity at capture time.

## Templates and authoring

The organizer's template data includes:

- **Simple QR hunt:** three markers, optional hints and organizer recovery.
- **Puzzle trail:** jigsaw and word-search chain followed by a final text puzzle and reusable puzzle hint.
- **Landmark exploration:** two locations available in either order, followed by a hub requiring both.

Server-side `instantiateTemplate()` clones a definition and generates fresh QR/recovery values. Preview each edited template and print its new QR materials. Workshop answers and demo tokens are deliberately known; they are not competitive event secrets.

The showcase is exercised by `tests/showcase.test.ts`: complete tabletop run, exact Kalyan costs, GPS/photo review, alternate path, validated independent templates and local asset availability. These are engine/content tests; the full browser/device/deployment acceptance record is in [acceptance.md](acceptance.md).
