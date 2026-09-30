# Treasure Hunt Engine

A configurable, web-first engine for real-world treasure hunts. Organizers design checkpoints from reusable actions; participants open a link, join a team, and see one task at a time.

**Hosted demo:** [Play](https://hunt.mrbtstudio.com/v2) · [Organizer console](https://hunt.mrbtstudio.com/v2/admin). The demo runs independently of the organizer's computer in its own Vercel Hobby project, with the existing Supabase Free database and private media storage. The custom domain's DNS, HTTPS, gameplay and uploads were verified on 2026-09-19; the earlier Render service is suspended. The portfolio remains separate, with no navigation links between the two applications. See [Vercel hosting and domain setup](docs/v2/vercel-hosting.md).

V2 supports:

- Direct node-and-socket checkpoint flow editing, reusable templates, incomplete drafts, visual validation, immutable published versions and isolated player previews.
- QR and backup codes, answers, approximate GPS areas, maps, camera guidance, private photo uploads with organizer review, and live recovery paths.
- Ten puzzle modules: jigsaw, Sudoku, word search, crossword, rotation, text, multiple choice, threshold quiz, matching and sequence. The same modules can unlock hints.
- Independent text/image/audio/video/map/camera/puzzle hints with costs, availability rules, and optional step/word/crossword-answer targeting that stops offering obsolete hints.
- Sequential, open and prerequisite-based hunts; choices, conditions, variables, deterministic weighted routes, scoring rules and optional checkpoints.
- Shared team progress, revisioned puzzle saves, optional organizer-only answer-attempt history, safe request retries, score ledger, authenticated organizer controls, help requests, activity, analytics and configurable leaderboard.
- Optional roster lobbies and personal timers, pause-aware deadlines and reasoned extensions; legacy hunts retain their existing immediate-start behavior.
- Preassigned independently distributed routes for new hunts, forced-route isolated previews, sticky answer-aware hint expiry, and private paginated Results/review/export tools.
- Controlled branding: colors, logo, cover/background images, typography, button shapes, checkpoint badges and reduced-motion-aware success effects.
- Feedback beside answers, floating progress/points confirmations and optional success sound, with quiet puzzle saves and reloads.
- Standard Node/PostgreSQL hosting, Docker, persistent media, optional HTTPS reverse proxy, backup/restore tools and V1 content import.

Photo verification currently uses an organizer's judgement, optionally preceded by GPS. Camera guidance provides reference overlays and direction; automated landmark recognition remains an extension described in the [product plan](docs/v2/product-plan.md).

## Start locally

Use Node 22 and PostgreSQL 17. Copy `.env.example` to `.env`; configure `DATABASE_URL`, a unique `ORGANIZER_PASSWORD` of at least 12 characters, and `APP_ORIGIN=http://localhost:3000`.

```sh
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

Open [the six-checkpoint demo](http://localhost:3000/v2?hunt=kalyan-demo) or [the organizer console](http://localhost:3000/v2/admin). The organizer signs in with the password you configured. See the [showcase walkthrough](docs/v2/showcase.md) for answers, QR materials, remote testing and landmark setup. Existing demo installations can publish the expanded showcase with `npm run db:seed -- --upgrade`; active teams keep their existing version.

For a self-contained Docker server, set `POSTGRES_PASSWORD`, `ORGANIZER_PASSWORD`, and `APP_ORIGIN` in `.env`, then:

```sh
docker compose up --build
```

Publish the example or a template from the organizer console, or run `docker compose exec web npm run db:seed` for the six-checkpoint demo. PostgreSQL and uploaded media use persistent volumes. Phones need an HTTPS URL for browser camera/location; a localhost desktop link is not public phone access. Follow [self-hosting](docs/v2/self-hosting.md) for a tunnel, domain HTTPS, generic cloud, backups and restoration.

## Verify changes

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Use a dedicated test database for transactional and browser checks:

```sh
npx playwright install chrome webkit
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/hunt_test npm run db:migrate
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/hunt_test npm run test:integration
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/hunt_test npm run test:e2e
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/hunt_test STRESS_ROUNDS=60 npm run test:stress
```

Database tests explicitly skip without `DATABASE_URL`; a skipped suite does not verify persistence. Test guards reject remote/non-test database targets. Browser tests start their own server at `127.0.0.1:3100`; keep that port free. The default matrix runs Chrome with Android emulation, Playwright WebKit with iPhone emulation, and organizer/timed-team tests in desktop Chrome. Select one with `npm run test:e2e -- --project=android-chrome`, `--project=iphone-webkit` or `--project=desktop-chrome`, using the same test database environment. On Linux, add `--with-deps` to browser installation when system libraries are missing. Stress results measure the local service/PostgreSQL workload, not physical phones or production HTTP latency.

The browser suite covers shared progress, retries, keyboard puzzle entry, narrow/landscape layouts, custom theme contrast, reduced-motion preference, camera cleanup and isolated printable QR sheets. The virtual QR camera fixture runs only in Chrome. Emulated browsers and simulated camera frames do not prove physical phone sensors or public-network access; those results are recorded separately in the [acceptance register](docs/v2/acceptance.md).

## Project guide

- [Architecture and data contracts](docs/v2/architecture.md)
- [Timed teams, route preview, hints, draft cleanup and Results guide](docs/v2/timed-teams.md)
- [Creating action, puzzle, verification and hint modules](docs/v2/extensions.md)
- [Self-hosting and operations](docs/v2/self-hosting.md)
- [Vercel demo and MRBT subdomain](docs/v2/vercel-hosting.md)
- [Earlier Render hosting and cloud migration](docs/v2/cloud-hosting.md)
- [Demo and templates](docs/v2/showcase.md)
- [Lokgram pilot hunt content brief](docs/v2/lokgram-pilot.md)
- [V1 import and retirement](docs/v2/migration.md)
- [All 92 product requirements and success evidence](docs/v2/acceptance.md)

V1 routes and direct browser Supabase integration are disabled by default. Historical troubleshooting documents are archived under `docs/legacy`; their permissive SQL is not a V2 setup guide. V2 uses its private `hunt_v2` schema. Disabling legacy routes does not change an existing remote V1 database's permissions; see the migration guide before retiring it.
