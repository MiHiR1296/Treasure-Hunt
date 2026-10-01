# Puzzle generators

The organiser builder can generate and verify word searches, Sudoku boards, and crosswords without hand-authoring a grid or coordinates. The generator is only available in the authenticated organiser workspace; player-facing hunt definitions continue to use the normal puzzle types and server-side verification.

## Organiser workflow

1. Add a Word search, Sudoku, or Crossword puzzle node.
2. Enter the word list, or the crossword clues and answers. For Sudoku, select a board size and difficulty.
3. Choose one to four alternatives and generate. An optional seed reproduces the same set later.
4. Inspect the organiser-only answer key and use the preferred version. Selecting it replaces only that puzzle’s ordinary definition, so it can still be edited manually.
5. Place different selected versions in existing random-branch nodes when a checkpoint needs route variants. In Draft → “Route choices for the next preview,” force each route to test it.

The temporary answer key is never put into the saved/exported player definition. Sudoku and crossword verification remains private on the server; word-search targets and their grid are intentionally visible to players.

## Quality guarantees and limits

- Word search: 4–25 rows and columns, up to 50 letter-only target words, and easy/medium/hard direction sets. The placement search succeeds only when it can place every requested word; it does not silently drop words.
- Sudoku: 4×4 (2×2 boxes), 6×6 (2×3 boxes), and 9×9 (3×3 boxes). Every generated board is checked to have exactly one solution. Difficulty controls the target count of given numbers; it is deliberately a practical clue-density setting, not a claim that every human solver experiences the same difficulty.
- Crossword: 3–25 rows and columns, up to 30 clue/answer pairs. The auto-layout requires every entry to be in one connected crossing layout and refuses incompatible sets instead of omitting answers. Choose answers with shared letters or increase the board size when it reports that no connected layout exists.

All three factories use a bounded, deterministic search when given a seed, validate their result through the same `validatePuzzle` contract used at publication, and return clear recovery guidance if constraints cannot be satisfied.

## Design goals

The generator work is intentionally bounded by these commitments:

- Keep normal saved definitions portable and editable; no opaque generated format or database migration.
- Make each generated candidate independently valid before it reaches a draft.
- Keep private answers and generated Sudoku solutions out of player views and public exports.
- Prefer a visible failure over quietly weakening a puzzle, dropping a word, or creating a non-unique Sudoku.
- Preserve manual editing for organisers who need to tune copy, difficulty, clue positions, rewards, or route topology.
