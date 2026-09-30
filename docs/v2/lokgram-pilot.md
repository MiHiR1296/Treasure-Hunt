# Lok Dhara / Lokgram Treasure Hunt

Authoring brief for the Kalyan East pilot. This is the content layer for the V2
engine; it deliberately does not invent GPS pins, a sponsor, or a prize venue.
Those values must be added after an on-site check.

## Player promise

Teams of 2–6 people explore Lokgram through a gentle, competitive trail of
observation, puzzles, and teamwork. No running, climbing, school entry, or
private-property access is required. The hunt has nine checkpoints and should
take about 60–90 minutes once the route is field-tested.

Suggested event copy:

> Follow the clues, solve together, and discover a side of Lokgram you may have
> walked past before. Every checkpoint rewards thinking, not speed. Stay on
> public paths, keep your team together, and ask the organizer for help when
> technology gets in the way.

## Route definition

| # | Player-facing title | Type | Progression | Field status |
|---:|---|---|---|---|
| 1 | The Green Beginning | GPS + clue | Find the Mango Garden area | Pin and safe standing area required |
| 2 | The Library Hunt | 10×10 word search | Find six words; unlock library direction | Four varied variants generated and validator-tested |
| 3 | Truth in Action | 10-question civic quiz | Three correct answers pass; wrong questions close; skips cost 2 points | Question bank below |
| 4 | The Quiet Corner | GPS | Reach Satyamev Jayate Public Library vicinity | Pin and radius supplied; field-test standing area required |
| 5 | Picture the Next Place | Jigsaw | Assemble an image that suggests the next landmark | Reference image still required |
| 6 | Bells, Books, Belonging | Mini-crossword | Solve one of four equivalent variants | Clue pools below |
| 7 | Where Learning Begins | GPS only | Reach Lok Kalyan Public School vicinity | Safe public-road pin required |
| 8 | One Last Thought | Beginner Sudoku | Fill one missing cell | Ready |
| 9 | The Prize Stop | Organizer handoff | Confirm final arrival and redeem prize | Sponsor and venue undecided |

All three location checkpoints should use approximate GPS regions, not precise
building-door targeting. Players tap **I’m here**; the server checks proximity.
The app must not require a venue to be open. Checkpoint 7 is GPS-only: no
campus entry, photography, or interaction with students or staff.

## Checkpoint copy

### 1. The Green Beginning

> Your first destination is a leafy outdoor space in Lokgram, with trees, open
> paths, shaded corners, and room to pause. It carries the name of a tropical
> summer favourite—the fruit known for golden flesh, a sweet fragrance, and a
> taste people wait for all year. Find this refreshing green retreat, then let
> the map confirm when you are nearby.

On arrival, reveal: **“Good start. Look closely at the words that come next.”**

### 2. The Library Hunt

> Six words are hiding in your grid. Find them together. When the last word is
> found, your next destination will be revealed.

Completion message:

> Books, pages, quiet corners, and curious minds point you toward a place where
> stories are shared. Your next destination is the Satyamev Jayate Public
> Library area.

### 3. Truth in Action

Intro:

> “Satyamev Jayate” means “Truth alone triumphs.” Answer the questions in plain
> language. Three correct answers are enough to continue; extra correct answers
> earn points and a clearer next-landmark hint.

Question bank (one correct answer each):

1. What is the fairest way to choose one team representative? **Let everyone
   have an equal vote.**
2. If you do not know whether a message is true, what should you do first?
   **Check a reliable source.**
3. What does it mean to listen respectfully? **Give someone attention even when
   you disagree.**
4. Which action helps keep a shared park pleasant? **Put waste in a bin.**
5. If two teammates have different ideas, what is a good next step? **Discuss
   both ideas and agree together.**
6. Why should a team follow a clearly stated rule? **So the same standard is
   fair to everyone.**
7. What should you do when you make a mistake in a team puzzle? **Say so and
   help the team correct it.**
8. Which is an example of civic responsibility? **Taking care of shared spaces.**
9. What makes information more trustworthy? **Evidence that can be checked.**
10. What is the strongest team advantage in this hunt? **Cooperation.**

Use the engine’s threshold-quiz implementation so that three correct answers
unlock the checkpoint, each later correct answer adds two points, and question
order is fixed for a team. A wrong answer closes that question instead of
allowing brute-force retries. A skip moves to the next question without a
penalty in this pilot. The engine still supports an explicit per-question skip
cost for hunts that intentionally want one. Do not make the player enter an
extracted word.

### 4. The Quiet Corner

> You are looking for a place where pages turn, questions are welcome, and a
> neighbourhood can learn together. Stay on the public approach and let the map
> confirm when you are nearby.

Arrival message:

> You found the quiet corner. Now rebuild a picture to discover where learning
> gathers next.

### 5. Picture the Next Place

Use a 3×3 jigsaw showing a non-sensitive, recognizable detail near the next
public landmark. The image must not show children, private homes, vehicle
number plates, or a school interior. After completion:

> The picture is complete. Look for the place of bells, books, and bright minds.

Organizers can upload one source image in the jigsaw editor and choose the
grid size; the server creates the individual tiles and the same tiles are
available in a player preview. Do not ask the organizer to prepare or upload
each tile manually.

### 6. Bells, Books, Belonging

> Complete the small crossword. Every answer is connected to learning,
> friendship, or the sounds of a school day. When you finish, the next clue will
> point you toward a school vicinity.

Completion message:

> Bells, books, learning, and friendship all point in one direction. Find the
> Lok Kalyan Public School vicinity. Stay outside on the public road.

### 7. Where Learning Begins

> Your next destination is where mornings begin with bells, backpacks, and bright
> minds heading toward new lessons. Look for the place where learning brings the
> neighbourhood together. Stay on the public road outside, and let the map
> confirm when you reach its vicinity.

Optional hint (make expensive): **“You are looking for a school whose name
begins with ‘Lok.’”**

### 8. One Last Thought

> One square is missing from this tiny Sudoku. Fill it with the only number that
> keeps every row, column, and box correct.

Use a 4×4 grid with exactly one blank. Suggested grid:

```text
1 2 | 3 4
3 4 | 1 2
----+----
2 1 | 4 _
4 3 | 2 1
```

Answer: **3**.

### 9. The Prize Stop

> You made it through the trail. Show this completion screen to the organizer at
> the announced public prize stop to receive your team reward.

Keep the prize stop separate from any organizer’s home address. The final
checkpoint should be enabled only after the sponsor agrees to the handoff,
opening hours, capacity, and redemption wording.

## Word-search authoring contract

Create four fixed variants, each a 10×10 grid with six words and similar
difficulty. Assign one variant once per team using the engine’s deterministic
route assignment; never reroll on refresh, retry, or a second device.

| Variant | Words |
|---|---|
| A | BOOK, AUTHOR, PAGE, QUIET, STORY, READ |
| B | NOVEL, CHAPTER, SHELF, STUDY, POEM, WORD |
| C | AUTHOR, TITLE, PAPER, LEARN, STORY, QUIET |
| D | READER, LIBRARY, CHAPTER, PAGE, POET, BOOK |

Use the same six-word completion rule, hint cost, and points for every variant.
Give a hint by revealing one target word, never by exposing leftover-letter
extraction. Test every generated grid with the server validator before preview.

## Crossword authoring contract

Use a compact, mobile-friendly six-to-eight-answer grid. Keep the same approximate
size, clue difficulty, hint cost, and points across variants.

| Variant | Answer pool |
|---|---|
| A | BOOK, CLASS, BELL, TEACH, LEARN, FRIEND |
| B | PAGE, LESSON, RING, GUIDE, STUDY, TEAM |
| C | NOVEL, SCHOOL, CHIME, MENTOR, READ, ALLY |
| D | STORY, PUPIL, TONE, COACH, KNOW, PARTNER |

All variants use the same completion message. Do not require a hidden-word
extraction from the crossword.

## Scoring and hints

Recommended pilot defaults:

- Team size: 2–6.
- Time limit: 90 minutes, paused only by the organizer.
- Base checkpoint value: 10 points each; the civic quiz may add 2 points for
  each correct answer after the third.
- Hint costs: 2 points for a gentle nudge, 4 for a map/word reveal, 6 for a
  strong location-specific hint.
- Ranking: points, then finish time.
- No speed bonus at the first pilot; add one only after field testing.

Hints must help without becoming a second route. GPS hints should reveal a broad
area, not a doorway. The app should record purchases server-side and charge each
hint once per team.

## Field-test gate before publishing

1. Record exact GPS centers and safe public standing areas for Mango Garden,
   Satyamev Jayate Public Library, and Lok Kalyan Public School.
2. Test each radius with three phones and weak GPS; confirm it does not overlap
   the next checkpoint.
3. Walk the route at the intended event time and check lighting, traffic,
   seating, shade, accessibility, and mobile signal.
4. Photograph only organizer-owned/reference material for the jigsaw; obtain
   permission before using any identifiable venue image.
5. Generate and visually inspect all four word-search and crossword variants.
6. Confirm the quiz’s three-correct progression, penalty-free skips, and bonus
   scoring in a player preview.
7. Confirm the prize shop’s consent, redemption process, and fallback contact.
8. Publish only after the organizer has replaced every field-test placeholder.
