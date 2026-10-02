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
- Editable client and project details, with GSTIN checks.

**Building sites**
- **Preview tab:** view the site being built (localhost, staging or live) at phone, tablet or desktop size.
- **AI assistant** (optional, `ANTHROPIC_API_KEY` in the server `.env`):
  - a free automated site check mapped to task codes;
  - "What did we finish?", where Claude suggests which tasks look done;
  - niche research with web search.

  Suggestions never verify; the other partner always does. Claude requests are capped per day.

**Running it yourself**
- Docker image with a healthcheck.
- Automatic daily database copies and a consistent backup command.
- Audit-chain verification.
- Server-side password reset (the app sends no email).

## Testing

- `npm test`: 181 unit and service tests pass.
- `npm run test:e2e` (Playwright) covers:
  1. setup;
  2. creating a project;
  3. both partners lock the plan;
  4. a task done with evidence and verified by the other partner;
  5. a rejected form keeps its input;
  6. the client update, year summary, preview and assistant pages.
- Also passing or checked:
  - `npm run build`.
  - The GitHub Actions workflow runs all of the above on every push.
  - Every page has been checked at phone width.
- Not run here:
  - `docker build`, because there is no Docker daemon in the sandbox. The standalone server was run the same way the image runs it.
  - Live Claude calls, because there is no API key. These are covered with a fake client.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01U5aLjChpuu4r1WmFPNQ5Wp
