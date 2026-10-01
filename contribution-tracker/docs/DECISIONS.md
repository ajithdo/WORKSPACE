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

## Screens

`/` inbox · `/projects` · `/projects/new` · `/projects/[id]` overview + milestones · `…/plan` · `…/board` · `…/tasks/[taskId]` · `…/communications` · `…/changes` · `…/finance` · `…/handover` · `…/contribution` · `…/disputes` · `…/files` · `…/closure` · `…/statement/[snapshotId]` · `/library` · `/settings` · `/audit` · `/login` · `/setup`.
