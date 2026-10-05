# Treasure Hunt Engine V3

A mobile-first engine for replayable, real-world team treasure hunts. V3 keeps a team as a stable identity and records every attempt as an immutable run with its own seed, route, variables, score, timing, contribution evidence, and result.

V3 is a clean runtime replacement for V2. The final V2 implementation remains available from the `v2-final` archive branch/tag; new production events use the private `hunt_v3` PostgreSQL schema and the `/v3` interfaces.

## What V3 includes

- Self-serve, organizer-assigned, and rostered registration with canonical team codes and visible crew rosters.
- Deterministic run seeds, replay policies, run-scoped variables, challenge pools, constrained routes, and publication-time score/duration fairness checks.
- Organizer-approved competition entry, frozen starting rosters, balanced non-repeating plan allocation, aggregate attempt budgets, and audited disqualification controls.
- Best-run scoreboards, an optional replay board, and an organizer-controlled public board that exposes team-level data only.
- Private, server-backed crew contributions and optional teammate recognition, with a named organizer audit and reasoned overrides.
- Parallel multi-member mechanics backed by authenticated member identities and idempotent commands.
- A live organizer console for lifecycle controls, rosters, team search, alerts, photo review, public-board snapshots, and run-aware analytics.
- Mobile result, replay, and share-card flows. Native Web Share is used where available, with image-download and caption-copy fallbacks.
- A versioned JSON Schema and external AI authoring kit. Imported content always remains an editable draft until it passes validation, preview, fairness checks, and organizer publication.

Private answers, seeds, unused variants, recognition votes, player names, and organizer configuration are redacted from player and public-board responses.

## Start locally

Use Node 22 and PostgreSQL 17. Copy `.env.example` to `.env`, then set `DATABASE_URL`, a unique `ORGANIZER_PASSWORD` of at least 12 characters, and `APP_ORIGIN=http://localhost:3000`.

```sh
npm ci
npm run db:migrate
npm run dev
```

Open the [player experience](http://localhost:3000/v3) or [organizer command centre](http://localhost:3000/v3/admin). A new database begins without a published hunt: sign in to the organizer console, download or copy the authoring kit, import `public/authoring/treasure-hunt-v3.starter.json`, preview it, and publish when validation passes.

For a self-contained local Docker installation:

```sh
docker compose up --build
```

PostgreSQL and private media use named persistent volumes. Normal phone browsers require a public HTTPS origin for camera, location, and share-sheet testing; localhost is suitable for desktop development only.

## Authoring

- [AI authoring kit](docs/v3-authoring-kit.md)
- [Versioned JSON Schema](public/authoring/treasure-hunt-v3.schema.json)
- [Starter hunt](public/authoring/treasure-hunt-v3.starter.json)
- [Annotated parallel-mechanics example](public/authoring/treasure-hunt-v3.annotated-example.json)
- [Adversarial integrity and release gate](docs/v3-adversarial-release-gate.md)

The kit is intentionally provider-independent. It never includes production seeds, QR secrets, or production-only identifiers.

## Verify changes

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Use a dedicated local test database for persistence and browser checks:

```sh
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/treasure_hunt_v3_test npm run db:migrate
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/treasure_hunt_v3_test npm run test:integration
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/treasure_hunt_v3_test npm run test:e2e
```

The default end-to-end command is deliberately scoped to the supported V3 player journey in Android Chrome and iPhone WebKit. Historical V2 browser specs remain only as archive evidence and are not part of the V3 release gate. Database tests reject remote/non-test targets and skip when `DATABASE_URL` is absent; a skipped suite is not persistence verification. Emulated browsers do not prove physical camera, GPS, or native share-sheet behavior, so Android and iPhone verification remains a separate release gate.

## Production operations

The container default runs `npm run start:cloud`, which validates the HTTPS origin and private media storage, applies the V3 schema, starts Next.js, and runs the bounded V3 media-retention worker. Render uses `/api/v3/health`; Vercel invokes `/api/v3/maintenance` with `CRON_SECRET`.

See the [V3 architecture and data contracts](docs/v3-architecture.md) and the [cutover, backup, restore, and rollback runbook](docs/v3-cutover.md). Before the first V3 cutover, take and verify a fresh database backup and a private-media backup. Do not treat a successful migration as a backup. Deployment must follow the branch, pull-request, external-review, and exact-SHA approval rules in [AGENTS.md](AGENTS.md).

Historical V2 architecture, hosting, and acceptance documentation remains under `docs/v2/` for archive reference only.
