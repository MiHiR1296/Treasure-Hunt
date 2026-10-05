# V3 adversarial release gate

V3 is not release-ready merely because the happy path works. This gate targets a small event in which the same participants may retry, share information, create extra identities, spoof browser inputs, or deliberately reorder requests. It does not substitute for a capacity/stress test; it is an integrity and recovery test.

## Security posture

- A private random seed makes a run unpredictable before assignment. The database rejects an exact seed commitment reused within one hunt, but distinct seeds can still resolve to the same bounded colour, word, or code by chance. Official runs use a serialized, balanced structural-plan deck. A team receives every plan once before a repeat; new starts prefer the least-used event-wide plans.
- A finite authored deck cannot remain globally unique forever. Publication therefore declares `minimumDistinctPlans` and records an allocation cycle after exhaustion. Unlimited official replay remains the product default, so organizers must understand that later cycles carry a rehearsal advantage; capped or practice-only policies are available for stricter events.
- Practice is irreversible for one team/hunt identity. After a team receives any practice run, restoration or a later policy change cannot grant that identity another official attempt. Players cannot self-create an official restart; a legitimate correction requires an organizer-issued replacement registration after identity review.
- Self-serve approval is explicit policy. New casual drafts default to automatic approval; an organizer can instead require a named approval action. New-team creation is a separate audited switch that may remain open after the event starts or be closed at any time without blocking existing-team sign-in.
- A browser cannot prove that two aliases are different humans. Self-serve approval is a review gate, not Sybil-proof identity. Prize events that require one-person/one-team enforcement must use rostered or organizer-issued identities plus real check-in.
- Roster participation is explicit policy. Frozen mode admits only the starting roster. Flexible mode adds a checked-in late participant to the active run. The casual `flexible_fixed_scoring` default also admits the participant but prevents that late participant from receiving contribution credit, peer votes, or a title for the attempt; they may still celebrate an eligible teammate. None of the modes turns team-wide verifier, puzzle, or lane limits into per-person allowances.
- GPS corroboration is explicit policy: GPS only, GPS plus photo, GPS plus organizer approval, or strict photo plus organizer approval. QR values and reusable static answers/codes remain forwardable and keep their independent companion-evidence rules. Physical-device tests demonstrate UX and accuracy, not cryptographic assurance.
- A published definition missing or malformed in the new integrity policy cannot start a run. Only an editable draft can be normalized to the explicit casual defaults, after which it must be validated, previewed, and published by the organizer. Migration refuses existing run history pinned to a pre-policy version so immutable results are never silently reinterpreted.
- Static answers and static codes are equally forwardable. Publication requires downstream fresh photo or a standalone human organizer gate; aliases derived from one high-entropy run-scoped generated code are the only code/answer exception. Independently generated accepted alternatives are not treated as fully strong because each alternative increases a guess's success probability.
- Exact normalized photo reuse is rejected event-wide and its digest survives media retention. This does not detect every crop, screenshot, recompression, or synthetic image; organizer review and run-specific scene instructions remain necessary.
- Media is bound to the exact run, task, and task-start epoch. An upload ticket or approved photo from before an organizer reset cannot satisfy the reset action, and one approved photo can be consumed by only one parallel lane.
- Verifier and puzzle budgets are run/task-wide as well as member-scoped. Creating extra member sessions must not multiply guesses. Official multiple-choice submission is a final team submission.
- Future route IDs, variant IDs, coordinates, and titles remain hidden until reached. The organizer can see assignments; players receive opaque stage ordinals.

## Automated adversarial matrix

Every row is a required release check. A regression is a release blocker.

| Area | Attack or failure | Required assertion |
| --- | --- | --- |
| Team farming | Create several self-serve teams before/after live start in both approval modes | Automatic mode approves only while creation is open; organizer mode remains pending until audited approval; closing creation atomically blocks new teams while existing teams still sign in |
| Identity | Reuse the team PIN in multiple browser profiles under every roster policy | Frozen mode rejects late access; flexible modes add one auditable participant; fixed-scoring late participants receive no contribution/recognition result; parallel and verifier budgets never expand |
| Approval race | Approve/disqualify/start concurrently or replay the admin request | One audited result; stale revision/request is rejected or idempotently replayed |
| Incident response | Disqualify a live team | Sessions revoke immediately; active and historical runs become ineligible; public/private boards exclude it |
| Restore | Restore a disqualified team before/after practice | Old runs never regain eligibility; an identity that entered practice remains practice-only and reports no replacement official slot |
| Plan allocation | Start many teams concurrently | Counts differ by at most one; assignments are auditable and atomic |
| Replay | Start more runs than plan count | No same-team repeat before exhaustion; the next repeat has a new allocation cycle |
| Route shopping | Inspect initial and intermediate player JSON | No future semantic ID, variant, title, location, answer, seed, or unused branch appears |
| Run isolation | Submit a command using another team/run/member | Server rejects it without state, event, score, or receipt mutation |
| Idempotency | Duplicate/reorder the same mutation | Exactly one state transition; same payload replays; changed payload with reused request ID conflicts |
| Guessing | Add many members and submit wrong codes/answers | All identities share the run/task cap; rejected attempts consume the budget |
| Multiple choice | Try choices sequentially | An official run cannot guarantee a solve by enumerating choices |
| Hint sharing | Forward a solved hint puzzle that reveals a shortcut or run-specific clue | Reusable hint puzzles require companion evidence on every containing checkpoint path; strong single-code text hints are the exception |
| GPS | Submit target coordinates directly with zero accuracy under all four location modes | GPS-only accepts only the configured region/accuracy check; photo, organizer, and strict modes cannot complete without their selected downstream evidence |
| QR sharing | Send a scanned token to another team | QR alone cannot complete a publishable competitive checkpoint; a fresh photo or human organizer gate remains required |
| Static answer sharing | Send a long code/accepted answer to another team, or list many generated alternatives | Length alone is insufficient; without downstream evidence, all accepted aliases derive from one strong run-code variable |
| Parallel GPS | Forge the GPS lane under all four location modes | GPS-only may omit corroboration; photo mode requires a photo lane; organizer mode requires a separate human gate; strict requires both; distinct authenticated actors remain required |
| Parallel code sharing | Reuse a static lane code on another team | Publication requires a photo lane unless the lane uses a high-entropy run-scoped code |
| Photo reuse | Upload identical bytes across teams/runs and after deletion | First accepted digest owns the evidence; all later reuse conflicts; no orphan object remains |
| Photo reset | Prepare/upload before an organizer reset, then submit afterward | Old task epoch is rejected; the reset requires new evidence |
| Parallel photo reuse | Submit one approved photo to two lanes concurrently | Exactly one lane consumes the media ID; the other request conflicts without partial progress |
| Photo timing | Submit junk and wait for rejection | Rejected review time remains in competitive elapsed time; approval may credit bounded review wait |
| Upload ticket | Prepare in Run 1 and complete in Run 2/same node | Ticket stays bound to Run 1 and cannot create Run 2 media |
| Upload race | Complete one ticket concurrently or change metadata | One media record/object; exact retry is stable; altered owner/hash/bytes/type conflicts |
| Provider stall | Hold three upload-provider calls with a three-client DB pool | Provider I/O holds no DB client; an unrelated durable write still completes |
| Lock order | Start/finalize/upload while approving, disqualifying, freezing, or expiring | Explicit hunt → team → run ordering completes without a PostgreSQL deadlock |
| Fairness | Unequal score/duration, unprovable time bonus, missing travel, skewed weights, hidden random branch | Publication fails with exact paths and route explanations; time bonuses are excluded-only |
| Fallback | Invoke a player fallback immediately | Competitive publication rejects enabled fallbacks; recovery is an audited organizer action |
| Ranking | Equal score/time/completion | One deterministic winner using canonical code as the final non-performance tie-break |
| Privacy | Read public board, frozen snapshot, exports, and share data | No player names, IDs, votes, contributions, answers, seeds, private routes, or sessions |
| Lifecycle | Pause/end/reopen at exact boundaries | Server clock and eligibility remain authoritative; stale clients cannot act through a pause |
| Timed expiry | Let a timed run expire without another player command | Organizer, analytics, and public-board reads converge it once to abandoned/ineligible and remove provisional score |
| Database | Mutate seed/route/plan/member/event/ledger directly | PostgreSQL constraints/triggers reject mutation and preserve score-ledger consistency |

## Command-sequence fuzzing

Run bounded generated core-command sequences with two active teams, two members per team, and three to five attempts for the primary team. Generate duplicate and reordered run creation, receipt replay/conflict, wrong/correct verification, cross-team actor, late-member, completion, and player-projection actions. Force every generated trace through structural-plan deck exhaustion and complete two runs for the second team. After every generated core step assert:

1. at most one open run per team;
2. every member-authored run event belongs to an authenticated run participant admitted according to the pinned roster policy, and fixed-scoring late participants have no contribution or recognition result;
3. immutable seed, plan key, route, variables, event rows, and ledger rows did not change;
4. official score equals the ranking ledger cache and excluded score equals the bonus cache;
5. only active, approved teams appear live; provisional rows derive from eligible open official runs, while completed/final/replay rows derive from eligible completed official runs;
6. no private field crosses the player or public projection;
7. rejected foreign-team and frozen-policy late-member actions leave no event, reservation, member, or success receipt, while accepted flexible joins remain idempotent and auditable.

Use deterministic action seeds and, on failure, print the hunt ID, action trace, request labels, run IDs, cryptographic run seeds, commitments, plan keys, and allocation cycles. The action seed reproduces selection and request payloads; the recorded allocation data is also required because production seeds are intentionally random, and a concurrency schedule may still need a targeted deterministic regression. Minimize every discovered failure into such a regression.

Do not imply the generated core model covers every subsystem. Focused deterministic barrier suites exercise duplicate/reordered photo upload and review, media reuse/reset, recognition votes, parallel lanes, lifecycle changes, approval/disqualification/restore, recovery, final-board snapshots, and lock ordering. Those suites assert immutable contributions, votes, media ownership, ticket/run/task epochs, and evidence digests where those records exist. Together these are bounded state-space and concurrency tests, not high-volume load tests.

## Manual red-team session

Use the real public HTTPS origin with at least one physical Android phone and one physical iPhone. Use separate normal/private browser profiles to represent multiple identities.

1. Start with registration open, create a team during live play, close registration, and retry. Confirm the first succeeds only under the chosen approval policy, the second is blocked atomically, and existing teams can still sign in. Reopen registration and verify the audited revision change.
2. Join an existing team after its run begins under each roster policy and attempt current-run GET, command, photo, recognition, and parallel actions. Frozen mode blocks access; flexible mode records contributions; fixed-scoring mode permits play and teammate kudos without letting the late participant receive credit, a vote, or a title. Team-wide limits must remain unchanged.
3. Share a QR, static answer, static code, and run-scoped code with a second team; confirm aggregate attempt controls, per-run variation, and the independent fresh-photo/organizer proof required for every shareable verifier.
4. Override/forge browser coordinates in GPS-only, photo, organizer, and strict modes. Confirm the server still applies the authored region/accuracy rule, and each stronger mode requires exactly the configured companion flow. Record GPS-only as a conscious casual-trust limitation rather than proof of physical presence.
5. Reuse the exact photo, a screenshot, a crop, and a recompressed copy. Exact reuse must block; visually similar variants must be clearly flagged as a remaining human-review limitation.
6. Deny then grant camera/location permission, refresh during upload/review, go offline during a command, return with the back button, and retry from two tabs.
7. Disqualify the test team while both devices are active. Confirm both sessions stop, boards update, and audit reason/actor are visible.
8. Complete two official attempts, then start practice and disqualify/restore the team. Confirm best-run ranking, time reveal, contribution privacy, story download, caption copy, and native share sheet; confirm official restart is rejected while another practice replay remains available.

Record device model, OS, browser version, network, event URL, release SHA, tester, date, and outcome. Emulation does not satisfy this gate.

## Release decision

Before merge or deployment, require all unit, type, lint, build, isolated PostgreSQL integration, and V3 Playwright checks to pass on the exact PR SHA. Then complete the physical-device/manual red-team session and a disposable backup/restore rehearsal. Any unresolved integrity finding remains a documented release blocker; it must not be relabeled as a stress-test limitation.
