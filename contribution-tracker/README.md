# Contribution Tracker

A self-hosted web app for a two-partner web studio. It does five things:

- Plan each client project from the 343-task library.
- Record work with evidence, and have the other partner verify it.
- Track client money: GST, TDS, MSME due dates and expenses.
- Resolve disputes.
- Lock a reproducible, hash-chained profit split when the project closes.

It implements `docs/spec/contribution-app-spec.md`. Every place the spec was silent or ambiguous, and every feature added beyond it, is listed in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Run it on your own server (Docker)

```bash
cp .env.example .env          # edit COOKIE_SECURE / ANTHROPIC_API_KEY if needed
docker compose up -d --build  # http://your-server:3000
```

The container reports its health at `/health`, and Docker restarts it if the check fails. The first visit opens the setup wizard, where you enter the studio details and both partners' sign-ins. Everything the app keeps is in `./data`: the database `app.db` and uploaded evidence in `files/`. Back that folder up.

Put the app behind HTTPS (for example Caddy or nginx with Let's Encrypt), then set `COOKIE_SECURE=true`.

## Run it without Docker

Requires Node 22+.

```bash
npm ci
npm run build
DATA_DIR=./data npm start     # http://localhost:3000
```

To get a demo studio to click around:

```bash
DATA_DIR=./demo-data npm run seed:demo
DATA_DIR=./demo-data npm run dev
```

Sign in as `asha@studio.test` / `demo password one`, or as `bala@studio.test` / `demo password two`.

## Backups and integrity

| What | How |
|---|---|
| Automatic daily copy | Made in `DATA_DIR/backups` on the first page view each day. The newest 14 are kept (`AUTO_BACKUP_DAYS`). It protects against mistakes, not disk loss, so still copy the folder off the server. |
| Database copy (safe while running) and JSON export | Settings → Backups, or `DATA_DIR=… npm run backup [-- dest]` |
| Uploaded evidence | Copy `DATA_DIR/files`. Files are never changed or deleted, only added. |
| Audit chain check | Audit log → "Check integrity", or `DATA_DIR=… npm run verify:audit` (non-zero exit if tampered) |
| Forgotten password | `DATA_DIR=… npm run reset-password -- partner@example.com` prints a one-time password and signs that partner out everywhere. They are asked to choose a new password after signing in. |

The `npm run` scripts need the source checkout. With Docker, run them on the host and point `DATA_DIR` at `./data`, or use the Settings page.

## AI features (optional)

Each project has two extra tabs.

**Preview** embeds the site being built (localhost, staging or live) at phone, tablet or desktop width. Your browser loads the site, so a `localhost` address works when the app and the site run on the same machine.

**AI assistant** has three tools:

1. **Site check** is free, needs no key, and runs on the server. It checks HTTPS, the http→https redirect, mixed content, security headers, title/description, headings, canonical, sitemap, robots.txt, structured data, Open Graph, analytics, `lang`, image alt text, the privacy policy link and the 404 page. Each finding is mapped to its library task code.
2. **What did we finish?** runs after a build session. Claude reads the site check and your notes, then lists the open tasks that look done, with its reasons.
3. **Research the niche** searches the web for the best sites of the same kind (for example "bakery, Hyderabad"). It suggests what to add or improve and maps each suggestion to a library task, or proposes a new one. The research can be saved as evidence.

The assistant only suggests. Accepting a suggestion adds evidence and submits the task in your name, and the other partner still verifies it before any points count.

Claude features need an Anthropic API key. Create one at https://console.anthropic.com, put it in `.env` as `ANTHROPIC_API_KEY=…` on the server only, and restart the app. Never put the key in the app, in evidence, or in chat. You can tune the assistant with `AI_MODEL` and `AI_EFFORT` (`low` / `medium` / `high`). `AI_DAILY_LIMIT` (default 20) caps Claude requests per day, so a busy day can't run up an unexpected bill.

The server refuses to fetch loopback, link-local (cloud metadata) and multicast addresses, so the site check works on staging and live addresses, not on `localhost`.

## Development

```bash
npm run dev          # http://localhost:3000, data in ./data
npm run typecheck
npm test             # unit and service tests (Vitest), including a cross-check against reference_calc.py
npm run test:e2e     # Playwright: setup → project → both partners lock the plan → preview/assistant
```

If Playwright's bundled Chromium is missing, set `PW_CHROMIUM=/path/to/chrome`.

Layout:

| Path | Contents |
|---|---|
| `src/domain/` | Pure rules (money, GST/TDS, contribution calculation, gates, task rules, secret scan, site rules). No I/O; unit-tested. |
| `src/db/` | Drizzle schema, migrations (`drizzle/`), and SQLite triggers that make the audit log, locked tasks, snapshots and closed projects immutable. |
| `src/server/` | One function per operation: `fn(ctx, input)`. Each runs in a single transaction and appends a hash-chained audit entry. |
| `src/app/` | Next.js App Router pages and server actions. |
| `seed/` | Task library and studio config, imported on first run. |
