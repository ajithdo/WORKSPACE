# Contribution Tracker: verified work, client money and profit split for a two-partner studio

## What it is

This PR adds a self-hosted web app (Next.js + SQLite, one data folder, Docker-ready) that implements `docs/spec/contribution-app-spec.md`. Partners use it to:

- plan each project from the 343-task library;
- record work with evidence that the other partner verifies;
- track invoices and payments (GST/TDS/MSME);
- settle disputes;
- lock a reproducible, hash-chained profit split at closure.

Interpretations of gaps in the spec are documented in `docs/DECISIONS.md` (D1–D17), along with the added features.

## Highlights

- **Contribution calculation:** ported from `reference_calc.py` and cross-checked against it on 200 random cases. The worked example gives ₹27,835 / ₹26,765.
- **Data integrity:**
  - Money is stored as integer paise.
  - Every write is audited in a hash chain.
  - SQLite triggers make the audit log, locked tasks, snapshots and closed projects immutable.
- **Verification rules:** nobody verifies their own work. Shared tasks use joint verification.
- **Inbox:** an inbox of everything waiting on you, and the rules config is versioned and approved by both partners.
- **India invoicing:**
  - FY numbering;
  - CGST/SGST vs IGST;
  - TDS receivable;
  - MSME 45-day due dates;
  - a printable GST tax invoice (rule 46 particulars, amount in words).
- **Preview tab:** view the site being built (localhost, staging or live) at phone, tablet or desktop size.
- **AI assistant (optional, `ANTHROPIC_API_KEY` in the server `.env`):**
  - a free automated site check mapped to task codes;
  - "What did we finish?", where Claude suggests which tasks look done;
  - niche research with web search.
  - Suggestions never verify; the other partner always does.

## Testing

- `npm test`: 162 unit and service tests pass.
- `npm run test:e2e`: Playwright runs setup → create project → both partners lock the plan → Preview and Assistant pages render, with no browser errors.
- `npm run build` passes, and the standalone server was run the same way the Docker image runs it.
- Not run here:
  - `docker build`, because there is no Docker daemon in the sandbox.
  - Live Claude calls, because there is no API key. These are covered with a fake client.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01U5aLjChpuu4r1WmFPNQ5Wp
