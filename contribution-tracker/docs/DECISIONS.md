# Design decisions and spec improvements

The spec (`docs/spec/contribution-app-spec.md`) is followed as written. This file records every place where the spec was silent, ambiguous or self-contradictory, what the app does there, and the features added because a two-partner studio cannot run without them. Every numeric choice below is configuration (Settings → Rules), not code.

## Interpretations of the spec

**D1 · Shared tasks (joint verification).** A task must be verified by a member who is not a contributor. When every project member is a contributor (for example J-08 "Either (both confirm)" or a 50/50 handover meeting), no such member exists. In that case the app switches to *joint verification*: every contributor other than the submitter must confirm. In a two-partner studio that is simply "the other partner confirms". The submitter can never verify their own submission.

**D2 · Communications are verified too.** Principle 3 says points count only after the other partner checks the evidence. The same check applies to communication points: a logged communication earns points only after a member who does not benefit from it (or, per D1, the other beneficiary) verifies it.

**D3 · "Second attendee required at planning".** A communication can be *planned* (scheduled) before it happens. The second-attendee-required flag can be set only while it is still planned. A communication logged directly after the fact gives the second attendee no points. This makes "flagged at planning" literal and stops after-the-fact point claims.

**D4 · Payments count only after the other partner verifies them.** Revenue in the money waterfall is the sum of *verified* payments. The partner who recorded a payment cannot verify it.

**D5 · GST and TDS on part payments.** For each payment, the GST share is removed pro rata: `gst_component = (amount_received + tds_deducted) × invoice_gst / invoice_total`. Revenue ex-GST in cash is `amount_received − gst_component`. TDS deducted is a receivable. It joins distributable revenue only when `distribute_tds_credit` is true (default false, per spec).

**D6 · Money in paise, payouts in rupees.** Amounts are stored as integer paise. Each member's payout is rounded to the rupee by the largest-remainder method; ties go to the member listed first. The total paid out is `round(revenue − reserve)` to the rupee, and the reserve absorbs the sub-rupee difference, so `Σ payouts + reserve = revenue` exactly. This matches the reference implementation's worked example (₹27,835 / ₹26,765).

**D7 · Loss-making projects.** If approved expenses exceed revenue received, there is no reserve and no base or pool share. Revenue repays expenses pro rata to whoever paid them, and each member's unreimbursed *shortfall* is reported. The spec's formula would otherwise produce a negative reserve.

**D8 · No verified points yet.** If the total points after caps are zero, the contribution pool is split equally instead of dividing by zero.

**D9 · Hard-gate tasks that were descoped.** If a gate task (for example U-04) is cancelled with both partners' approval, that gate shows as **waived** rather than blocking the project forever.

**D10 · Pre-sales work before plan lock.** The plan is locked at kickoff (J-08), but sales, discovery and contract tasks happen before it. Tasks can be worked and verified while the plan is still a draft. Once a task is submitted, its owner, shares, quantity and factor are frozen whatever the plan status, so a draft plan cannot be used to rewrite finished work.

**D11 · Descoping in-progress work.** The spec allows only `planned → cancelled`. The app also allows `in_progress → cancelled` and `blocked → cancelled`, with the same both-partners approval, because work does get abandoned mid-way. (Added to the seeded config's `task_transitions`; editable.)

**D12 · Disputes defaulting to 50/50.** "Split 50/50 of the disputed points" is applied literally: the disputed points are shared equally between the dispute's parties (the person who raised it and the item's contributors). For expenses it means half the amount is accepted; for adjustment requests, the midpoint between the old and requested value. Either partner can escalate (the "external step" in the deed), which stops the automatic default. The mode is configurable (`dispute_default_split_mode`: `share_between_parties` or `halve_points`).

**D13 · Closure order.** The checklist is applied literally: every task must be verified or cancelled before the closure snapshot is computed. Closure tasks BJ-02/03/04 are done from the live contribution preview, then verified, *then* the snapshot is computed and approved. Recording the bank transfer of each distribution, archiving files and confirming vault removal happen after the lock. These are new records, not edits.

**D14 · Business-level work.** BO tasks and other business-level tasks (A-01, A-04, BO-02) go into a **Studio** project. A studio project's "revenue" is the reserve money both partners release to it (a reserve-ledger *out* entry). No reserve is taken from it again. That implements the SOP's "split that quarter's reserve surplus by those points".

**D15 · AMC work.** Maintenance contracts are their own project kind (**Maintenance**: BH and BI tasks, AMC invoices). Maintenance income after closure therefore never reopens a locked delivery project.

**D16 · Config is pinned per project.** A project pins the config version (caps, percentages, points per communication) when it is created. Both partners can re-pin it while the plan is still a draft. Later config edits never change a locked project.

**D17 · Hybrid effort rule.** After plan lock, an adjustment factor above 1.0 can be requested only when the hours logged on the task exceed `effort_adjustment_trigger_multiple` (default 2) × the estimated midpoint hours. Lowering a factor needs no trigger. Both directions need the other partner's approval and a reason.

**D18 · Milestones are derived, not stored.** Spec section 15 lists Milestone as an entity. The app computes each milestone's state from its definition in the pinned rules version and the live task states, instead of keeping a table. Its date is the latest verification or client-approval time among its required tasks. This way a milestone can never disagree with the work it summarises, and a descoped gate task shows the milestone as *waived* (D9).

## Added must-have features

1. **Sign-in for each partner** (scrypt-hashed passwords, httpOnly session cookies, login throttling) and a first-run **setup wizard**. The spec assumes identities but never defines them.
2. **"Needs your action" inbox.** Every approval in the app waits on the *other* partner. The home page lists everything waiting on you: submissions to verify, proposals, plan and snapshot approvals, adjustment requests, disputes, payments and expenses to check, overdue invoices.
3. **Audit integrity check.** A button re-walks the hash chain and reports the first broken entry. Database triggers block UPDATE/DELETE on the audit log, on locked tasks and snapshots, and on child rows of a closed project.
4. **Secret guard.** Evidence descriptions, URLs, external refs and small text uploads are scanned for API keys, private keys, tokens, `.env`-style assignments and passwords in URLs, and are refused if found (principle 6).
5. **Automatic owner suggestions.** Each member lists the roles they usually take (FE, BE, Design…). New plans pre-assign owners by matching the library's default owner role, balancing points between partners. "Either (both)" tasks start at 50/50.
6. **India-specific invoicing.** Financial-year invoice numbering (`INV/26-27/001`), CGST+SGST for intra-state vs IGST for inter-state from the place of supply, MSME 45-day due dates and overdue flags.
7. **Printable statements.** A contribution statement per snapshot (for the CA and the deed) and a final settlement statement per project, both printable to PDF from the browser.
8. **Backups.** Downloadable database snapshot (consistent online backup) and full JSON export from Settings, plus `npm run backup` for the server. The whole app lives in one `DATA_DIR`.
9. **Calibration report.** Planned vs verified points and hours per point by category across projects. Categories more than 30% off are flagged for the quarterly BO-02 review.
10. **Snapshot re-verification.** Any locked snapshot can be recomputed from its stored inputs and parameters, and the hash compared.
11. **Time log.** Minutes per task per member feed the hours-per-point report and the D17 trigger. Time never affects pay directly.
12. **Site preview.** Each project stores its local, staging and live addresses. The Preview tab embeds the site (sandboxed frame) at phone, tablet and desktop widths. It is loaded by the partner's own browser, so `localhost` works.
13. **Automated site check.** Free and needs no API key. It fetches the staging or live site and checks HTTPS, the redirect, mixed content, security headers, SEO basics, sitemap and robots.txt, structured data, Open Graph, analytics, `lang`, alt text, the privacy policy link and the 404 page. Each finding names its library task code. Server fetches refuse loopback, link-local and multicast addresses, re-check every redirect, and are size- and time-limited.
14. **"What did we finish?" (Claude).** After a build session, Claude reads the site check and the partner's notes and lists the open tasks that look done, with confidence and reasons. Accepting a suggestion adds evidence and submits the task in the accepting partner's name. It **never verifies**: the other partner still checks it (principle 3). Every AI report is stored with its model and inputs.
15. **Niche research (Claude with web search).** Claude searches for the best sites in the client's niche and location and suggests what to add or improve. Each suggestion is mapped to a library task, or proposed as a new task (which goes through normal proposal approval). Sources are kept, and the research can be saved as evidence (for example for discovery task I-02).

16. **Printable GST tax invoice.** Each invoice opens as a print-ready page (save as PDF from the browser). It carries the particulars rule 46 of the CGST Rules asks for: supplier and recipient names, addresses and GSTINs, serial number, date, place of supply, SAC 998314, taxable value, CGST+SGST or IGST with rates, total, amount in words (Indian lakh/crore system), reverse-charge status and a signature block. It also includes a TDS certificate request and the MSME 45-day notice. Drafts are watermarked and have no number, so the GST series stays gapless.

17. **Payment reminders.** An overdue invoice shows a ready-to-send reminder, with links that open WhatsApp (Indian numbers get +91) or email. The partner sends it from their own phone or mail, and the app sends nothing itself. The tone is gentle in the first week, firm up to 30 days, and final after that. For Udyam-registered studios, the firm and final reminders cite MSMED Act section 16 interest, and the final one mentions the MSME Samadhaan portal.
18. **Accountant export.** Settings → "For your accountant" downloads CSVs per financial year:
    - Issued invoices, in number order, with GSTIN, place of supply, SAC, taxable value and CGST/SGST/IGST, for GSTR-1.
    - Payments received, with TDS and certificate status, for matching against Form 26AS.

    Cells that start with spreadsheet formula characters are neutralised.

19. **Self-hosting safety:**
    - Automatic daily database copies, with 14 kept.
    - A `/health` endpoint with a Docker healthcheck.
    - A daily cap on Claude requests (`AI_DAILY_LIMIT`).
    - A server-side password reset (`npm run reset-password`), because the app sends no email. The member must replace the one-time password after signing in.

20. **Year at a glance.** One financial year across all projects:
    - Each partner's payouts from locked snapshots (reimbursed, base, pool, paid, still to pay).
    - The studio's invoicing, cash, GST, TDS, expenses and reserve movement.

21. **Client update.** A weekly progress report per project (the SOP's progress update). It is printable, and an editable message opens in WhatsApp or email. It shows:
    - client-facing milestones;
    - work signed off in the chosen dates;
    - work in progress;
    - what waits on the client: approvals of finished deliverables and unpaid invoices.

    Sales, partner-admin and other internal tasks and milestones are never included.

22. **Quotation (SOP G-04).** A printable quote built from the plan:
    - Scope by phase, with the quoted price split across phases by planned points, in whole rupees that add up exactly.
    - GST treatment from the place of supply.
    - The payment schedule.
    - A validity date (default 15 days).
    - The quote number (`QUO/<project>/<date>`) is kept separate from the GST invoice series, as the SOP requires.

    The invoice page now uses the project's place of supply, the same one the GST maths uses.

23. **Client details and frozen invoices.** Client name, billing address, state, GSTIN and contacts can be edited from the project overview. GSTINs are checked for format and must match the client's state.
    - When an invoice is issued, it stores a copy of the seller's and buyer's details, so editing them later never changes an issued invoice.
    - A database trigger refuses any change to an issued invoice's number, date, amounts or parties, and refuses to delete it. Only its payment status moves; corrections are a cancellation plus a new invoice.
24. **Forms keep their input on errors.** React 19 clears a form after every submit. The app's forms keep what was typed when the server rejects it, and early clicks before the page is interactive still work.

25. **How it works.** An in-app guide to the rules in plain words: planning, evidence, how points become money, disputes and closing. The numbers (reserve, caps, windows) are read from the active rules version, so the guide never goes out of date.

26. **TDS certificate follow-up.** If a payment had TDS deducted and no Form 16A is recorded 60 days later, the inbox asks the partners to chase the client. Without the certificate the studio cannot claim the credit.
    - Certificates often arrive after a project closes. Recording one (pending → received, plus the certificate file) is therefore the single change the database allows on a closed project's payment. Every other column stays frozen by trigger.

27. **Times and dates are India time.** Meeting times typed into the app are read as IST (UTC+05:30, no daylight saving) and shown in IST, whatever timezone the server runs in. Docker containers run in UTC, which used to shift times by 5½ hours. The "when did it happen" field defaults to now.
    - "Today" is also the India date everywhere: default invoice dates, overdue checks, backups and financial years. An invoice raised at 1 AM IST on 1 April belongs to the new financial year, not the old one.

28. **Search.** A search box in the sidebar finds projects, clients (name, GSTIN, contact), invoice numbers, payment references (UTR) and tasks, limited to projects you are on. LIKE wildcards are matched literally.

29. **Copy an invoice.** For recurring AMC or care-plan billing, any issued invoice can be copied into a new draft. The draft keeps the type, amount, TDS rate and notes, is dated today, and keeps the same number of days to pay. It gets a number only when issued.
30. **Sign out other devices.** Changing your password signs out every other session. A button in Settings does the same on demand, for a lost phone or a shared computer.

31. **GSTIN check character.** Every GSTIN entered (studio or client) is checked for format, its mod-36 check character and its state code. A typo on an invoice would cost the client their input tax credit, so it is caught before it is saved.

AI features are optional and switched on only by `ANTHROPIC_API_KEY` in the server's `.env`. Without a key, everything except features 14 and 15 works.

## Screens

`/` inbox · `/projects` · `/projects/new` · `/projects/[id]` overview + milestones · `…/plan` · `…/board` · `…/tasks/[taskId]` · `…/communications` · `…/report` · `…/changes` · `…/finance` · `…/handover` · `…/contribution` · `…/disputes` · `…/files` · `…/closure` · `…/statement/[snapshotId]` · `…/preview` · `…/invoice/[invoiceId]` · `…/quote` · `…/assistant` · `/summary` · `/guide` · `/search` · `/library` · `/settings` · `/audit` · `/login` · `/setup`.
