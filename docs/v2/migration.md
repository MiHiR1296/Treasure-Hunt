# Migration and compatibility

## Timed-team additive upgrade

The timed-team release extends `database/v2.sql` with draft generation, nullable session/member association, lifecycle revision/pause metadata and private append-only activity. It does not rewrite existing published definitions, team state, scores, hints or receipts. Timers and improved route distribution are opt-in for existing drafts/future publications; active teams stay on their pinned version. Legacy session associations remain nullable.

Apply the additive schema before enabling new authoring, with a backup and no active event. Deploy the compatibility-capable application to **treasure-hunt-v2**, keep authoring stopped during mixed-version deployment, then reload older organizer tabs. Do not assume an old binary is rollback-safe after new fields have been authored: strict older validators may reject them. Prefer a reviewed forward fix or a coordinated backup/recovery procedure. See [release safeguards](timed-teams.md#migration-and-release-safeguards).

The disposable existing-data fixture uses `tests/migration-fixture.ts`: install the pre-upgrade `database/v2.sql` in a separate local test database, run `node --import tsx tests/migration-fixture.ts seed`, apply the new schema, then run the same script with `verify`. It checks old definitions, draft revision/generation, state, hints, ledger, receipt and nullable legacy session, plus repeat migration and immediate-start behavior for another team on the old definition. Never seed this fixture into production.

## Moving content from V1

V2 owns the private `hunt_v2` schema. Its startup migration does not change existing public Supabase tables. Legacy pages are disabled unless an operator explicitly sets `ENABLE_LEGACY_V1=true` in an environment with the old Supabase configuration.

Export the old database before retiring it. For content conversion, provide a JSON object with `hunts` and `checkpoints` arrays and optional `puzzle_steps`, `puzzle_hints`, and `progress` arrays. Preserve the original row fields and IDs. The authenticated organizer's **Import V1 export** reads this format; the CLI produces the same review report without contacting a database:

```sh
npm run import:v1 -- /path/legacy-export.json /path/new-review.json optional-hunt-id
```

The result contains `definition`, configuration `issues`, and conversion `warnings`. Review the definition in the builder, fix every issue, save a draft, preview, then publish. Imported IDs are prefixed with `import-`, so existing events are not overwritten. QR/code secrets, checkpoint ordering, points, and individual hint slots are preserved. Dud markers become independent dud entries. Structured compatible puzzles are converted; old image-only or client-validated puzzle configurations must be rebuilt from their source artwork using the new puzzle editor. Invalid puzzle configurations block publication instead of silently becoming solved puzzles.

The importer never copies teams, PINs, sessions, arbitrary scores, client puzzle completion flags, or progress into live V2 state. A legacy `hints_used = 1` count cannot establish which hint was bought. The report explicitly flags this ambiguity; keep old event results as an archive or reconcile them manually with documented organizer adjustments. Starting a new V2 event avoids inventing history.

Disabling old pages does not revoke access to an existing Supabase API. After backup/export and deliberate retirement of V1, run [retire-v1.sql](../../database/retire-v1.sql) against **the old database** using its owner account. It revokes public, `anon`, and `authenticated` access to the known prototype tables and leaves privileged owners able to migrate data. It is intentionally separate from the V2 startup migration and has not been executed against a remote database by this implementation. Audit custom tables, storage buckets, functions, and deployed older clients in that installation as well.

The archived prototype SQL and troubleshooting guides are historical material, not instructions for a V2 deployment.
