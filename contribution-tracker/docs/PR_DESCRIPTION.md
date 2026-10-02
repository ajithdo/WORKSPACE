## What it is

This PR adds a self-hosted web app in `contribution-tracker/` (Next.js + SQLite, one data folder, Docker-ready) that implements `contribution-tracker/docs/spec/contribution-app-spec.md`. Partners use it to:

- plan each project from the 343-task library;
- record work with evidence that the other partner verifies;
- track invoices and payments (GST, TDS, MSME);
- settle disputes;
- lock a reproducible, hash-chained profit split at closure.

Interpretations of gaps in the spec, and every added feature, are listed in `contribution-tracker/docs/DECISIONS.md`. Setup is in `contribution-tracker/README.md`.

## Highlights

**The spec**
- **Contribution calculation:** ported from `reference_calc.py` and cross-checked against it on 200 random cases. The worked example gives ₹27,835 / ₹26,765, also when computed from real database rows.
- **Data integrity:**
  - Money is stored as integer paise.
  - Every write goes to a hash-chained audit log.
  - SQLite triggers make the audit log, locked tasks, snapshots, closed projects and issued invoices immutable.
- **Verification rules:** nobody verifies their own work, and shared tasks use joint verification. An inbox lists everything waiting on you. Rules and the task library are versioned and approved by both partners.

**India: billing and accounts**
- **Invoices:** FY numbering, CGST/SGST vs IGST from the place of supply, TDS receivable and MSME 45-day due dates.
- **Printable GST tax invoice:** includes the rule 46 particulars and the amount in words. When issued, it keeps a copy of the seller's and buyer's details.
- **Printable quotation:** built from the plan, with scope by phase, GST, the payment schedule and a validity date.
- **Reminders and exports:**
  - Payment reminders for overdue invoices, opening in WhatsApp or email.
  - Accountant CSV exports for GSTR-1 and Form 26AS.
  - A "Year at a glance" view per financial year.

**Clients**
- A weekly client update (printable, or as WhatsApp/email text) with internal work left out.
- Editable client and project details. GSTINs are validated for format, the check character and the state.

**Daily use**
- "My work": each partner's own tasks, grouped by what to do next.
- Search: projects, clients, invoice numbers, UTRs and tasks.
- "How it works": the rules in plain words, with your live numbers.
- Reminders to collect Form 16A, which can still be recorded after a project closes.

**Building sites**
- **Preview tab:** view the site being built (localhost, staging or live) at phone, tablet or desktop size.
- **AI assistant** (optional, `ANTHROPIC_API_KEY` in the server `.env`):
  - a free automated site check mapped to task codes;
  - "What did we finish?", where Claude suggests which tasks look done;
  - niche research with web search.

  Suggestions never verify; the other partner always does. Claude requests are capped per day.
- **GitHub webhook:** commits that name a task code ("AI-05: add sitemap") become strong evidence for the matching partner. The webhook is signed, secret-scanned and idempotent.

**Running it yourself**
- Docker image with a healthcheck. The data-folder ownership is fixed at start-up, then the app drops root.
- `npm start` runs the same standalone server.
- Automatic daily database copies and a consistent backup command.
- Audit-chain verification.
- Server-side password reset (the app sends no email), and signing out other devices.
- Dates and times follow IST whatever the server timezone.

## Bugs found and fixed while hardening

- **Production builds pre-rendered the sign-in pages as "redirect to setup"** (better-sqlite3 is synchronous), so nobody could sign in on a real deployment. Every page now waits for the request, and CI runs the browser flow against the production build and the Docker container.
- React 19 cleared forms when the server rejected them. Input is now kept.
- Meeting times were read in the server's timezone (UTC in Docker), and "today" used the UTC date, which put 1 AM IST on 1 April invoices in the previous financial year.
- Docker could not write a bind-mounted data folder created by root.
- Issued invoices reprinted with later-edited client details. They now store their parties, and a trigger freezes them.

## Testing

- `npm test`: 195 unit and service tests pass.
- `npm run test:e2e` (Playwright) covers:
  1. setup;
  2. creating a project;
  3. both partners lock the plan;
  4. a task done with evidence and verified by the other partner;
  5. a rejected form keeps its input;
  6. the client update, year summary, preview and assistant pages.
- GitHub Actions runs on every push:
  - typecheck, unit tests and the build;
  - the browser flow against the dev server and against the production build;
  - a Docker job that builds the image, starts it on a fresh root-owned bind mount, checks `/health` and runs the browser flow against the container.
- Every page has been checked at phone width and for unlabeled form fields.
- Claude features were exercised end to end in the production build against a local stand-in for the Anthropic API. The completion check and the web-search research both ran, with the right model, fallback and structured-output betas, and the reports rendered. They have not been run against the real API (no key here).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01U5aLjChpuu4r1WmFPNQ5Wp
