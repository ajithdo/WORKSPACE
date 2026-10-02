# Contribution Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hosted web app where two studio partners plan projects from the 343-task library, record verified work with evidence, track client money (GST/TDS/MSME), resolve disputes, and lock a reproducible, hash-chained profit split at closure.

**Architecture:** Next.js App Router (server components + server actions) over a service layer that runs every write in one SQLite transaction together with a hash-chained audit entry. All rules that decide points or money live in a pure `src/domain` layer with no I/O, so the calculation is deterministic and unit-tested against the reference implementation. Every number in the spec comes from a versioned config record seeded from `seed_config.json`.

**Tech Stack:** Node 22, Next.js 16, React 19, TypeScript 5.9 (strict), Tailwind CSS 4, Drizzle ORM + better-sqlite3, zod 4, Vitest, Playwright, Docker.

**Spec:** `contribution-tracker/docs/spec/contribution-app-spec.md` (plus `website-project-sop-india.md`, `seed_tasks.json`, `seed_config.json`, `reference_calc.py`). Interpretations and additions: `contribution-tracker/docs/DECISIONS.md`.

**Execution note:** the user is away and asked for no further questions; this plan is executed natively in this session (no subagents), committing and pushing after every task. Progress is tracked in the checklist at the end.

## Global Constraints

- All numbers are configuration, not code: read them from the project's pinned config version (`seed_config.json` + defaults in `src/domain/config.ts`).
- Money is stored as integer paise; payouts are rounded to whole rupees; rupee totals must reconcile exactly.
- Points count only for tasks in `verified` or `locked` status, verified by a member who is not a contributor (joint rule in DECISIONS.md D1).
- Nothing is deleted or edited after lock; corrections are new entries. SQLite triggers enforce this for audit_log, locked tasks, locked snapshots and closed projects.
- Every write appends to `audit_log` with `hash = sha256(prev_hash + canonical_json(entry))`.
- Evidence: tasks with planned points > 3 need ≥1 strong item; 1–3 points need ≥1 medium-or-strong; uploads are SHA-256 hashed; the "no secrets or customer personal data" box is mandatory.
- Acceptance: revenue ₹60,000, expenses ₹6,000 paid by B, points A=130/B=90 → payouts A=₹27,835, B=₹26,765; communication at 30% → scaled to exactly 20%.
- Runs on the partners' own server: one `DATA_DIR` holds `app.db` and `files/`.

## Review Focus

- Both partners are contributors on one task (shared task, "Either (both)") → verification must still be possible: the other contributor confirms (joint verification), never the submitter. Test: `tasks.test.ts › joint verification when every member contributed`.
- Revenue received is less than approved expenses → no negative reserve, reimbursements paid pro rata, shortfall reported, no NaN. Test: `calc.test.ts › loss: reimbursements pro rata`.
- Every point is communication, or no points are verified yet → no division by zero; pool splits equally. Test: `calc.test.ts › zero points splits pool equally`.
- Partial payment with TDS deducted on a GST invoice → revenue ex-GST and TDS receivable are exact to the paisa. Test: `money.test.ts › partial payment with TDS`.
- Evidence added while a task is already submitted → ignored for that submission, counted for the next one. Test: `tasks.test.ts › evidence after submit belongs to next round`.

---

### Task 1: Scaffold

**Files:** `contribution-tracker/{package.json,tsconfig.json,next.config.ts,postcss.config.mjs,vitest.config.ts,drizzle.config.ts,.gitignore,.env.example}`, `src/app/{layout.tsx,globals.css,page.tsx}`

- [ ] Install deps; `npm run typecheck`, `npm test` (empty), `npm run build` succeed.
- [ ] Commit `chore: scaffold contribution tracker`.

### Task 2: Domain layer (pure, no I/O)

**Files:** `src/domain/{canonical.ts,money.ts,config.ts,library.ts,calc.ts,taskRules.ts,gates.ts,secrets.ts,communication.ts,types.ts}`; tests in `tests/domain/*.test.ts`; `scripts/reference_calc_harness.py`

**Interfaces (produced):**
- `canonicalJson(value: unknown): string`; `sha256Hex(data: string | Uint8Array): string`
- `toPaise(rupees: number): number`; `formatINR(paise: number): string`
- `splitGst(amountExGst: number, rateBp: number, intraState: boolean): { cgst; sgst; igst; total }`
- `paymentRevenue(p: { amountReceived; tdsDeducted }, inv: { total; gstTotal }): { gstComponent; revenueExGst; grossSettled }`
- `msmeDueDate(agreedDue: string, acceptance: string, days: number): string`
- `financialYearLabel(isoDate: string): string` (`"26-27"`); `formatInvoiceNumber(prefix, fy, seq): string`
- `parseStudioConfig(json: unknown): StudioConfig` (zod, defaults for added keys)
- `parseEffort(text: string): { midHours: number | null; unit: string | null }`; `phaseFromCategory`, `parseOwnerRoles(text): { roles: OwnerRole[]; both: boolean }`
- `selectTemplatesForType(templates, type: ProjectType, opts: { multilingual: boolean }): TaskTemplateLike[]`
- `findDependencyCycle(tasks: { code: string; dependsOn: string[] }[]): string[] | null`
- `calculateContribution(input: CalcInput, params: CalcParams): CalcResult`
- `nextStatus(from: TaskStatus, action: TaskAction, transitions: [string,string][]): TaskStatus` (throws on illegal)
- `evidenceCheck(plannedPoints: number, items: { strength: Strength }[], rule): { ok: boolean; reason?: string }`
- `verifierEligibility(memberIds: number[], contributorIds: number[], submitterId: number): { mode: 'independent' | 'joint'; eligible: number[] }`
- `evaluateMilestones(configs, tasks: GateTaskState[], extras): MilestoneState[]`; `gateBlockFor(task, milestoneStates, configs): GateBlock | null`
- `findSecrets(text: string): SecretHit[]`
- `communicationAwards(c, type, members): { memberId: number; points: number }[]`

**Tests (key):** `calc.test.ts › worked example 27,835 / 26,765`, `› communication 30% scaled to exactly 20%`, `› sales cap includes origination`, `› micro cap per member`, `› own defect earns 0`, `› loss: reimbursements pro rata`, `› zero points splits pool equally`, `› rounding remainder to largest fraction, ties by member order`, `› matches python reference on 200 random cases`; `money.test.ts › intra-state CGST+SGST`, `› inter-state IGST`, `› partial payment with TDS`, `› MSME due is min(agreed, acceptance+45)`, `› FY label Apr–Mar`; `library.test.ts › seed has no cycles`, `› brochure selects 225 tasks`, `› parses '1–2 h/page' as per-unit`; `taskRules.test.ts › illegal transition throws`, `› >3 points needs strong`; `gates.test.ts › gate 1 blocks design before H-05+I-02`, `› J-* not blocked`, `› descoped gate task shows waived`; `secrets.test.ts › detects AWS key, private key, password URL`.

- [ ] Write tests, run (fail), implement, run (pass), commit `feat(domain): ...`.

### Task 3: Database

**Files:** `src/db/{schema.ts,index.ts,triggers.ts}`, `drizzle/*`, `src/server/seedImport.ts`; test `tests/server/db.test.ts`

**Interfaces:** `openDb(file: string): AppDb` (migrations + triggers + pragmas); `getDb(): AppDb` (singleton from `DATA_DIR`); `importSeedLibrary(db, actor, now): { libraryVersionId; configVersionId }`.

**Tests:** `db.test.ts › audit_log rejects UPDATE and DELETE`, `› locked task rejects UPDATE`, `› closed project rejects new task rows`, `› seed import creates 67 categories and 343 templates`.

### Task 4: Services

**Files:** `src/server/{context.ts,audit.ts,auth.ts,approvals.ts,projects.ts,plan.ts,tasks.ts,evidence.ts,files.ts,communications.ts,changeRequests.ts,finance.ts,disputes.ts,adjustments.ts,handover.ts,contribution.ts,closure.ts,inbox.ts,jobs.ts,library.ts,settings.ts,backup.ts}`; tests `tests/server/*.test.ts`

**Interfaces:** every mutating function is `fn(ctx: Ctx, input) => result` where `Ctx = { db: AppDb; actorId: number | null; now: Date }`, runs in one transaction, appends audit, and throws `DomainError(code, message)`.

**Tests (key):** `tasks.test.ts › A cannot verify a task where A is a contributor`, `› joint verification when every member contributed`, `› submit blocked without sufficient evidence`, `› start blocked by gate 1`, `› evidence after submit belongs to next round`, `› proposed task auto-approves after 72h (approved by silence)`; `closure.test.ts › editing a locked project fails`, `› post-lock adjustment needs both approvals`, `› end-to-end worked example from DB rows gives 27,835 / 26,765`, `› snapshot hash re-verifies`; `disputes.test.ts › open dispute holds points`, `› default 50/50 after 14 days`, `› third dispute creates retro item`; `audit.test.ts › chain verifies and detects tampering`; `finance.test.ts › payment needs other partner verification to count`.

### Task 5: UI

**Files:** `src/app/**` (routes listed in DECISIONS.md "Screens"), `src/components/**`, `src/lib/{session.ts,actions.ts}`.

- [ ] Each screen renders against seeded demo data; `npm run build` passes; commit per screen group.

### Task 6: E2E, QA, packaging

**Files:** `tests/e2e/flow.spec.ts`, `playwright.config.ts`, `Dockerfile`, `docker-compose.yml`, `README.md`, `scripts/seed-demo.ts`, `scripts/backup.ts`.

**Tests:** `flow.spec.ts › setup → create project → lock plan with both partners → submit/verify task → dashboard shows points`.

### Task 7: Review and PR

- [ ] Whole-branch review, security review, fix findings, push, open PR.

---

## Progress

- [x] Plan written
- [x] Task 1 Scaffold
- [x] Task 2 Domain (calc cross-checked against reference_calc.py on 200 random cases)
- [x] Task 3 Database (immutability triggers, hash-chained audit)
- [x] Task 4 Services
- [x] Task 5 UI (all screens in DECISIONS.md, mobile checked at 390px)
- [x] Task 6 E2E/QA/packaging (Playwright flow, Dockerfile + compose, backup/verify-audit/seed-demo scripts, README)
- [x] Extra: site Preview tab, automated site check, Claude completion check, Claude niche research with web search
- [x] Extra: printable GST tax invoice
- [x] Task 7 Review (authorization, SSRF guard, print checks); fixes pushed
- [x] PR opened: https://github.com/ajithdo/WORKSPACE/pull/1 (base `main` created at the first commit, with the user's approval)
- [x] CI on GitHub Actions: typecheck, unit/service tests, build, Playwright e2e, and a Docker job that builds the image, starts it on a fresh bind mount and checks `/health`. All green.
- [x] Extras on day 2:
  - Billing and accounts: payment reminders (WhatsApp/email), accountant CSV exports, Year at a glance, quotation, copy invoice for AMC.
  - Clients: client progress update, editable project and client details.
  - Data integrity: frozen issued invoices (stored parties and a trigger), GSTIN check-character and Udyam validation, late Form 16A after closure, TDS inbox follow-up.
  - Self-hosting: daily auto backups, health check, password reset, sign out other devices, daily AI cap.
  - Usability: search, "How it works" guide, GitHub commits as evidence.
- [x] Bugs found and fixed on day 2:
  - React 19 wiped form input on server errors.
  - Times were stored in UTC instead of IST, and "today" used the UTC date (wrong FY around midnight).
  - Docker data folder ownership.
  - An exported helper in a server-action file.
  - A missing membership check on project edits.
  - Low-contrast faint text.
- [x] Hardening on day 2 (afternoon):
  - Production builds pre-rendered sign-in pages as redirects to setup. Fixed; CI now runs the browser flow against the production build and the Docker container.
  - `npm start` runs the standalone server; GitHub commits become evidence through a signed webhook.
  - My work, search, and an automatic database copy before upgrades.
  - Browser QA of payments, communications, change requests, disputes, closure (₹27,835 / ₹26,765), rules change and post-lock correction.
  - AI flows exercised in the production build against a stand-in Anthropic API.
  - 197 unit and service tests pass; all CI jobs green.
- [ ] Not verified here: live Claude calls (no API key in the sandbox; covered by tests with a fake client). Set `ANTHROPIC_API_KEY` on the server to use them.
