# Contribution-Tracking App — Build Specification (v1.0, 28 Sep 2026)

Audience: an AI coding agent (e.g., Google Antigravity) or a developer. This spec turns the studio SOP into software structures. Companion files:

- `seed_tasks.json` — 343 default tasks (67 categories) with points, dependencies, evidence expectations, classification, billing flags.
- `seed_config.json` — every enum, default parameter, milestone, checklist and rule in this spec as machine-readable data.
- `seed_tasks.csv` — the same tasks as a flat table.
- `reference_calc.py` — a runnable reference implementation of the calculation in section 10, with the acceptance tests. Port it and keep the tests passing.

Build the app so that **all numbers in this spec are configuration, not code**. The partners will recalibrate them.

---

## 0. Product principles (non-negotiable)

1. Two partners (extensible to N members). Every contribution is attributable to a member.
2. Points come from a library and a plan that both partners approved. Nobody types their own points.
3. A task earns points only when **Verified** by a member other than its contributor(s), with evidence attached.
4. Money is distributed by a deterministic, reproducible calculation from locked data.
5. Nothing is deleted or edited after lock. Corrections are new adjustment entries. Every write goes to an append-only audit log.
6. No secrets in the app. Evidence and files must never contain passwords, API keys or clients' customer data.

---

## 1. Categories

67 categories, codes `A`…`BO`, stored in `seed_config.json → categories`. Each has `code`, `name`, `phase`, `is_communication` (bool, for the communication cap), `is_sales` (bool, for the sales cap), `is_business_level` (bool).

Phases (ordered): `presales`, `discovery`, `contract`, `kickoff`, `research`, `content`, `design`, `development`, `qa`, `review`, `launch`, `handover`, `closure`, `maintenance`, `studio` (business-level).

Communication categories: `K`. Sales categories: `A`, `B`, `C`. Business-level: `BO` plus tasks whose phase starts with "Business-level".

## 2. Default tasks

Load `seed_tasks.json`. Fields per task template:

| Field | Type | Notes |
|---|---|---|
| id | string | e.g. `V-09`; immutable |
| category_code | string | FK categories |
| name, description, why | string | |
| phase | string | free text from library; map to phase enum on import |
| depends_on | string[] | task template IDs |
| default_owner_role | string | Sales, PM, Design, Content, FE, BE, DevOps, QA, Either |
| deliverable, evidence_expected | string | |
| client_approval | enum | Yes, No, Optional |
| classification | enum | MUST, REC, OPT, COND, POST |
| complexity | enum | Low, Medium, High |
| effort_range | string | e.g. "2–4 h" |
| default_points | int | per unit if per-page/per-item |
| risks, common_mistakes, if_skipped | string | shown as guidance |
| in_standard_project | enum | Yes, No, Cond |
| billable | enum | included, separate, conditional |
| post_launch_maintenance | bool | |

Library versioning: templates are versioned (`library_version`). A project snapshots the template values at plan time; later library edits never change existing projects.

## 3. Default points

- Formula used to create defaults: `round(midpoint_hours × complexity_factor)`, factors Low 1.0, Medium 1.25, High 1.5, minimum 1.
- Per-unit tasks (per page, per product, per template): `planned_points = default_points × quantity`.
- Project plan override: `adjustment_factor` in [0.5, 1.5], requires approval of the other member and a reason.
- Mid-project effort adjustment (hybrid rule): allowed when `actual_hours > 2 × estimate_hours_midpoint`; same bounds and approval.
- Calibration (quarterly): report planned vs verified points and hours per point by category; edits create a new library version.

## 4. Task dependencies

- `depends_on` are **soft** by default: the app warns if a task starts before its dependencies are Verified.
- **Hard gates** (block status change to `in_progress` for the dependent tasks):
  - Gate 1: `H-05` (contract executed) and `I-02` (advance received) block all tasks in phases kickoff → closure except `J-*` setup.
  - Gate 2: `U-04` (design sign-off) blocks `V-11`, `V-12`.
  - Gate 3: `BA-02` (final approval) blocks `BA-03`.
  - Gate 4: `BF-02` (final payment confirmed) blocks all `BG-*`.
- Cycles are forbidden; validate on import.

## 5. Evidence types

Enum with default strength (`seed_config.json → evidence_types`):

- strong: git_commit, pull_request, deployment, release_tag, client_approval, signed_document, email_sent, meeting_notes_sent, test_report, scan_report, invoice, bank_reference, dns_lookup, url_live
- medium: design_file_link, document_link, spreadsheet, meeting_record, bug_ticket, crawl_report, config_record, screen_recording
- weak: screenshot, document_file, receipt, other

Rules: tasks with planned points > 3 need ≥1 strong item; 1–3 points need ≥1 medium-or-strong. Evidence captured after the task is Submitted is ignored for that submission. Uploaded files are SHA-256 hashed. A mandatory checkbox "No secrets or customer personal data (or redacted)" before upload.

Evidence entity: `id, task_instance_id, submitted_by, submitted_at, type, strength, url?, file_id?, external_ref?, description (10–300 chars), captured_at, sha256?, contains_personal_data, redacted, verification_status (pending|accepted|rejected), verified_by?, verified_at?, rejection_reason?`.

## 6. Approval states

### 6.1 Task instance status (state machine)

```
planned ──start──▶ in_progress ──submit──▶ submitted ──verify──▶ verified ──project lock──▶ locked
   ▲                    │                       │
   │                    └──block──▶ blocked     └──reject──▶ in_progress (with reason)
proposed ──approve──▶ planned        (new tasks added after plan lock)
proposed ──reject──▶ cancelled
planned ──descope──▶ cancelled (requires both members)
```

Rules:
- `submit` requires evidence meeting the strength rule.
- `verify` must be performed by a member who is **not** a contributor on that task. In a two-person studio this is always "the other partner".
- `proposed` tasks auto-approve after `auto_approve_hours` (default 72) with no objection; the audit log records "approved by silence".
- Only `verified` tasks count toward points. `locked` is set for all tasks at project lock.

### 6.2 Client approval status (for tasks with client_approval = Yes)

`not_required | pending | approved | changes_requested | deemed_approved | rejected`. Store `approved_by_name`, `approved_at`, `channel (email|signed_pdf|in_app|whatsapp_confirmed_by_email)`, `evidence_id`. `deemed_approved` requires a contract clause flag on the project and elapsed `deemed_acceptance_days`.

### 6.3 Plan and adjustment approvals

- Project plan: `draft → awaiting_partner → locked` (both members approve).
- Adjustment request: `requested → approved | disputed`.
- Project close: `closing → awaiting_partner → closed_locked` (both approve snapshot).

## 7. Communication types

`seed_config.json → communication_types`. Each has `code, name, default_points, lead_points, second_attendee_points, required_fields, creates_followups`.

| code | name | default points (lead) | 2nd attendee (only if marked required) |
|---|---|---|---|
| initial_call | Initial phone call | 1 | 0 |
| discovery_call | Discovery call/meeting | 3 | 2 |
| video_meeting | General video meeting | 1 | 1 |
| design_discussion | Design presentation/discussion | 2 | 1 |
| requirements_clarification | Requirements clarification | 1 | 0 |
| progress_update | Weekly progress update | 1 | 0 |
| feedback_call | Feedback walkthrough | 2 | 1 |
| revision_discussion | Revision discussion | 1 | 0 |
| scope_change_discussion | Scope-change discussion | 2 | 1 |
| pricing_negotiation | Pricing negotiation | 2 | 1 |
| payment_followup | Payment follow-up (per escalation step) | 1 | 0 |
| deployment_discussion | Deployment/launch planning | 1 | 1 |
| final_approval | Final approval | 1 | 0 |
| handover_meeting | Handover meeting | 2 | 2 |
| support_contact | Post-launch support contact | 0 (points via ticket task) | 0 |

Communication entity: `id, project_id, type, occurred_at, channel (phone|email|whatsapp|video|in_person), duration_minutes, lead_member_id, attendee_member_ids[], client_attendees (names), summary, decisions[], action_items[] → creates task instances, notes_sent_to_client (bool), evidence_ids[]`.

Points only if `summary` non-empty AND (`decisions` non-empty OR `action_items` non-empty) AND a meeting_record or meeting_notes_sent evidence exists.

## 8. File categories

Folder/file taxonomy (also used for evidence): `01_contract` (proposal, quote, contract, SOW, assignment), `02_brief` (questionnaire, discovery summary, requirements, sitemap), `03_content` (text, images, licences), `04_design` (wireframes, UI, exports), `05_dev` (READMEs, API docs, configs without secrets), `06_qa` (test reports, scans), `07_launch` (checklists, DNS exports, deploy records), `08_handover` (registers, guides, confirmations), `09_finance` (invoices, receipts, TDS certs, bills), `10_comms` (meeting notes, approvals), `11_internal` (estimates, retros, contribution statements). Each file: `id, project_id, category, name, mime, size, sha256, uploaded_by, uploaded_at, visibility (internal|client_shared), retention_until`.

## 9. Milestones

| code | name | gate | typical payment link | completion condition |
|---|---|---|---|---|
| M0 | Lead qualified | – | – | C-02 verified with "go" |
| M1 | Requirements signed | – | – | E-07 verified with client approval |
| M2 | Contract & advance (Gate 1) | hard | advance invoice | H-05 and I-02 verified |
| M3 | Kickoff complete | – | – | J-07, J-08 verified; plan locked |
| M4 | Content complete | – | – | P-05 approved |
| M5 | Design approved (Gate 2) | hard | design milestone invoice (optional) | U-04 approved |
| M6 | Staging ready for review | – | – | AP-02, AP-05 verified |
| M7 | Final approval (Gate 3) | hard | – | BA-02 approved |
| M8 | Live | – | – | BA-03, BB-01, BB-02 verified |
| M9 | Final payment (Gate 4) | hard | final invoice | BF-02 verified |
| M10 | Ownership transferred | – | – | BG-09 verified with client approval |
| M11 | Project closed | – | – | BJ-02, BJ-03, BJ-04 verified; snapshot locked |
| M12 | Maintenance active | – | AMC invoices | BH-01 signed |

## 10. Contribution calculation rules

Parameters (`seed_config.json → calculation`):

```
reserve_pct = 0.10          # of (revenue − expenses)
base_share_pct = 0.20       # of distributable, split equally among active members
pool_pct = 0.80
communication_cap_pct = 0.20
sales_cap_pct = 0.10
micro_task_points_threshold = 1
micro_task_cap_pct = 0.25   # of a member's points on the project
origination_credit_pct = 0.05  # of project's planned points
adjustment_min = 0.5
adjustment_max = 1.5
own_defect_fix_points = 0
auto_approve_hours = 72
dispute_window_days = 7
```

Algorithm (deterministic; run on a project snapshot):

```
1. tasks = task_instances where status in (verified, locked)
2. for each task t, for each contributor c with share s (sum of shares = 1.0):
       raw[c] += t.planned_points × t.quantity × t.adjustment_factor × s
   (a bug-fix task flagged own_defect=true contributes own_defect_fix_points)
3. comms: for each qualifying communication, add lead_points to lead,
          second_attendee_points to a second attendee only if flagged required at planning
4. origination: add origination_credit_pct × total_planned_points to project.originated_by
5. caps (applied project-wide, then pro-rata to members):
     comm_total = points from categories with is_communication + communications
     if comm_total > cap × grand_total:
         target = cap × (grand_total − comm_total) / (1 − cap)   # makes comm exactly `cap` of the new total
         scale every member's communication points by target / comm_total
     same for sales categories (and origination credit) with sales_cap_pct
     per member: if 1-point-task points > micro_task_cap_pct × member_total:
         scale that member's 1-point-task points so they are exactly the cap share of that member's new total
   (recompute grand_total after each cap, apply caps in this order: communication, sales, micro)
6. share[c] = points[c] / Σ points
7. money waterfall on cash received:
     revenue_ex_gst = Σ payments received (excluding GST component)
     expenses = Σ approved project expenses
     reimbursements[c] = Σ expenses paid by c
     reserve = reserve_pct × (revenue_ex_gst − expenses)
     distributable = revenue_ex_gst − expenses − reserve
     base[c] = base_share_pct × distributable / member_count
     pool[c] = pool_pct × distributable × share[c]
     payout[c] = reimbursements[c] + base[c] + pool[c]
8. round money to the rupee; assign rounding remainder to the member with the largest fractional part; Σ must equal the total.
9. store the snapshot: inputs, parameters version, outputs, SHA-256 hash of the canonical JSON.
```

Also compute and display: equal-split comparison, hours per point per category, each member's % of points from communication, micro-tasks, adjustments.

TDS: amounts deducted by the client are recorded as `tds_receivable`, not cash; they are excluded from distribution until the CA advises (configurable flag `distribute_tds_credit = false`).

Acceptance tests (must pass):
- Worked example: revenue 60,000, expenses 6,000 paid by B, points A=130, B=90 (after caps) → payouts A=27,835, B=26,765 (B includes 6,000 reimbursement).
- A cannot verify a task where A is a contributor.
- Editing any field of a locked project fails; an adjustment entry in a later period succeeds only with both approvals.
- Communication cap: if communication points are 30% of total, they are scaled to exactly 20%.

## 11. Dispute rules

Dispute entity: `id, project_id, target_type (task_instance|communication|expense|adjustment|evidence|plan), target_id, raised_by, raised_at, reason_code, description, proposed_resolution, status (open|in_discussion|resolved|escalated), resolution, resolved_at, resolved_by_both (bool)`.

Reason codes: `not_done`, `insufficient_evidence`, `wrong_owner_share`, `points_inflated`, `duplicate_claim`, `quality_rework_needed`, `expense_not_business`, `outside_scope`, `other`.

Rules:
1. A dispute must be raised within `dispute_window_days` of verification, and always before project lock.
2. While open, the disputed item's points are held (excluded) from payout calculation; the rest of the project can be distributed if both agree.
3. Resolution options: accept as is; change shares; change adjustment factor within bounds; reject (0 points); split disputed points 50/50.
4. If not resolved in 14 days: default to 50/50 split of the disputed points, unless either partner invokes the external step in the partnership deed (e.g., CA or mediator).
5. Every dispute and resolution is visible to both, permanently, in the audit log.
6. Three or more disputes on one project triggers a mandatory retrospective item.

## 12. Financial fields

Project finance: `quoted_amount_ex_gst, gst_rate (default 0.18), gst_registered (bool), sac_code (default 998314), place_of_supply_state, payment_schedule[] (milestone_code, pct or amount, due_rule), currency (INR)`.

Invoice: `number, type (advance|milestone|final|change_request|amc), issue_date, due_date, amount_ex_gst, cgst, sgst, igst, total, tds_expected_rate (0.10|0.02|0), status (draft|sent|part_paid|paid|overdue|cancelled), file_id`.

Payment: `invoice_id, received_date, amount_received, tds_deducted, bank_reference, mode (bank|upi|card|cheque|cash), verified_by`.

Expense: `project_id?, date, vendor, description, amount, gst_paid, paid_by_member_id, reimbursable (bool), billable_to_client (bool), receipt_file_id, approved_by`.

Change request: `number, description, requested_by_client_name, requested_at, estimate_hours, price_ex_gst, timeline_impact_days, status (logged|assessed|quoted|approved|declined|done|invoiced), approval_evidence_id, invoice_id?`.

Distribution: `snapshot_id, member_id, reimbursement, base_share, pool_share, total, paid_on, bank_reference`.

Reserve ledger: `date, project_id?, amount, direction (in|out), purpose`.

Also: `msme_udyam_registered (bool)` and per invoice `msme_due_date` = min(agreed due date, acceptance + 45 days) when applicable; overdue flag.

## 13. Handover checklist (per project, generated)

Items (`seed_config.json → handover_items`): domain, dns, hosting, cloud_account, repository, source_code, database, database_credentials, storage, business_email, smtp, api_keys, third_party_services, analytics, search_console, business_profiles, cms, admin_accounts, payment_gateway, forms, backups, ssl, cdn, environment_variables, documentation, design_files, images_videos, fonts, licences, plugins_dependencies, certificates, renewals, subscriptions, maintenance_arrangement.

Each item instance: `status (not_applicable|pending|transferred|verified_by_client)`, `owner_confirmed (client name/account)`, `credentials_rotated (bool, date)`, `developer_access (removed|reduced_for_amc|retained_with_reason)`, `evidence_ids[]`, `notes`. Completion rule for M10: every applicable item is `verified_by_client`, `credentials_rotated` true where credentials exist, and developer_access is not `retained_with_reason` unless an AMC is active.

## 14. Project closure checklist

1. All tasks verified or cancelled with reason.
2. No open disputes.
3. All invoices paid or written off with reason; final settlement statement generated.
4. TDS certificates recorded or marked pending.
5. Expenses reimbursed.
6. Handover checklist complete (M10).
7. Retrospective notes recorded; calibration suggestions captured.
8. Contribution snapshot computed, reviewed and approved by both → locked with hash.
9. Distribution paid and recorded.
10. Files archived; retention dates set.
11. Testimonial/portfolio permission status recorded.
12. Internal vault items and temporary accounts removed.

## 15. Data model (minimum entities)

`Member, Project, Client (business name, GSTIN, contacts), CategoryTemplate, TaskTemplate (versioned), TaskInstance, TaskContribution (task_instance_id, member_id, share), Evidence, File, Communication, ActionItem, ClientApproval, ChangeRequest, Milestone, Invoice, Payment, Expense, ReserveLedger, AdjustmentRequest, Dispute, HandoverItem, ContributionSnapshot, Distribution, AuditLog (append-only: actor, action, entity, before, after, at, hash_prev)`.

AuditLog is hash-chained (`hash = sha256(prev_hash + canonical_json(entry))`) so tampering is detectable.

## 16. MVP screens

1. Projects list with milestone progress and gate status.
2. Project plan: import tasks from library by project type (brochure, CMS, e-commerce, booking), set quantities, owners, shares; both approve → lock.
3. Task board by phase with status, owner, points, evidence count.
4. Task detail: evidence upload (with no-secrets confirmation), submit, verify/reject, client approval record.
5. Communications log with auto-created action items.
6. Change requests.
7. Finance: invoices, payments, expenses, reserve, MSME due dates.
8. Handover checklist.
9. Contribution dashboard: live points, caps, equal-split comparison, disputes.
10. Closure wizard → snapshot → both approve → lock → distribution record.
11. Library admin (versioned templates, calibration report).
12. Audit log viewer.

Out of scope for MVP: client portal, automatic Git/Figma integrations (add later via webhooks to create evidence records automatically).
