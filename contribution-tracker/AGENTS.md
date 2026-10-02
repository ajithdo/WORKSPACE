<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project notes

- Spec: `docs/spec/contribution-app-spec.md`. Interpretations and additions: `docs/DECISIONS.md`. Read both before changing rules.
- Layers:
  - `src/domain` holds pure rules with no I/O.
  - `src/server` services take `(ctx, input)`, run in one transaction and append to the audit log via `appendAudit`.
  - Pages and server actions sit in `src/app` and call services through `runAction`.
- Money is integer paise and shares are basis points (10000). Never use floats for stored amounts.
- Every number is config (`seed/seed_config.json` plus defaults in `src/domain/config.ts`). Don't hard-code caps or percentages.
- Schema changes:
  - Edit `src/db/schema.ts`, then run `npm run db:generate`.
  - Update the immutability triggers in `src/db/triggers.ts` when you add child tables of a project.
- Checks: `npm run typecheck && npm test && npm run build`. E2E: `npm run test:e2e` (set `PW_CHROMIUM` if Playwright's browser is missing).
- AI features (`src/server/assistant.ts`) use the Anthropic SDK and are optional. Tests inject a fake client via `setAiClientFactory`. Server-side fetches must go through `safeFetch` in `src/server/web.ts`.
