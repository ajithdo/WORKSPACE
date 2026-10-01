"""Builds seed_config.json and runs a reference contribution calculation (acceptance test)."""
import json, hashlib

tasks = json.load(open("/home/claude/app/seed_tasks.json", encoding="utf-8"))
cats = tasks["categories"]

PHASE = {}
for codes, ph in [("A B C", "presales"), ("D E", "discovery"), ("F G H I", "contract"), ("J", "kickoff"),
                  ("K", "throughout"), ("L M", "research"), ("N O P BK", "content"), ("Q R S T U", "design"),
                  ("V W X Y Z AA AB AC AD AE AF AG AH AI AJ AK AL AM BM", "development"),
                  ("AN AO AP AQ", "qa"), ("AR AS AT", "review"),
                  ("AU AV AW AX AY AZ BA BB BL", "launch"), ("BC BD BE BF BG", "handover"),
                  ("BJ BN", "closure"), ("BH BI", "maintenance"), ("BO", "studio")]:
    for c in codes.split():
        PHASE[c] = ph
categories = [{"code": c["code"], "name": c["name"], "phase": PHASE[c["code"]],
               "is_communication": c["code"] == "K", "is_sales": c["code"] in ("A", "B", "C"),
               "is_business_level": c["code"] == "BO"} for c in cats]
assert all(c["code"] in PHASE for c in cats)

strong = "git_commit pull_request deployment release_tag client_approval signed_document email_sent meeting_notes_sent test_report scan_report invoice bank_reference dns_lookup url_live".split()
medium = "design_file_link document_link spreadsheet meeting_record bug_ticket crawl_report config_record screen_recording".split()
weak = "screenshot document_file receipt other".split()
evidence_types = [{"code": t, "strength": s} for s, lst in (("strong", strong), ("medium", medium), ("weak", weak)) for t in lst]

comm = [("initial_call", "Initial phone call", 1, 0), ("discovery_call", "Discovery call/meeting", 3, 2),
        ("video_meeting", "General video meeting", 1, 1), ("design_discussion", "Design presentation/discussion", 2, 1),
        ("requirements_clarification", "Requirements clarification", 1, 0), ("progress_update", "Weekly progress update", 1, 0),
        ("feedback_call", "Feedback walkthrough", 2, 1), ("revision_discussion", "Revision discussion", 1, 0),
        ("scope_change_discussion", "Scope-change discussion", 2, 1), ("pricing_negotiation", "Pricing negotiation", 2, 1),
        ("payment_followup", "Payment follow-up (per escalation step)", 1, 0), ("deployment_discussion", "Deployment/launch planning", 1, 1),
        ("final_approval", "Final approval", 1, 0), ("handover_meeting", "Handover meeting", 2, 2),
        ("support_contact", "Post-launch support contact", 0, 0)]
communication_types = [{"code": c, "name": n, "lead_points": lp, "second_attendee_points": sp,
                        "required_fields": ["occurred_at", "channel", "lead_member_id", "summary"],
                        "points_condition": "summary AND (decisions OR action_items) AND evidence(meeting_record|meeting_notes_sent)"}
                       for c, n, lp, sp in comm]

file_categories = [{"code": c, "contents": d} for c, d in [
    ("01_contract", "proposal, quotation, contract, SOW, assignment deed"),
    ("02_brief", "questionnaire, discovery summary, requirements, sitemap"),
    ("03_content", "text, images, videos, media rights and licences"),
    ("04_design", "wireframes, UI files and exports, design approvals"),
    ("05_dev", "README, API docs, configs without secrets"),
    ("06_qa", "test reports, scans, bug exports"),
    ("07_launch", "launch checklists, DNS exports, deploy records"),
    ("08_handover", "account register, licence register, guides, confirmations"),
    ("09_finance", "invoices, receipts, bills, TDS certificates"),
    ("10_comms", "meeting notes, approvals, change requests"),
    ("11_internal", "estimates, retrospectives, contribution statements")]]

milestones = [
    {"code": "M0", "name": "Lead qualified", "hard_gate": False, "complete_when": ["C-02"]},
    {"code": "M1", "name": "Requirements signed", "hard_gate": False, "complete_when": ["E-07"]},
    {"code": "M2", "name": "Contract and advance (Gate 1)", "hard_gate": True, "complete_when": ["H-05", "I-02"], "payment": "advance",
     "blocks_phases": ["research", "content", "design", "development", "qa", "review", "launch", "handover", "closure"]},
    {"code": "M3", "name": "Kickoff complete", "hard_gate": False, "complete_when": ["J-07", "J-08"]},
    {"code": "M4", "name": "Content complete", "hard_gate": False, "complete_when": ["P-05"]},
    {"code": "M5", "name": "Design approved (Gate 2)", "hard_gate": True, "complete_when": ["U-04"], "payment": "design_milestone_optional", "blocks_tasks": ["V-11", "V-12"]},
    {"code": "M6", "name": "Staging ready for review", "hard_gate": False, "complete_when": ["AP-02", "AP-05"]},
    {"code": "M7", "name": "Final approval (Gate 3)", "hard_gate": True, "complete_when": ["BA-02"], "blocks_tasks": ["BA-03"]},
    {"code": "M8", "name": "Live", "hard_gate": False, "complete_when": ["BA-03", "BB-01", "BB-02"]},
    {"code": "M9", "name": "Final payment (Gate 4)", "hard_gate": True, "complete_when": ["BF-02"], "payment": "final", "blocks_categories": ["BG"]},
    {"code": "M10", "name": "Ownership transferred", "hard_gate": False, "complete_when": ["BG-09"]},
    {"code": "M11", "name": "Project closed", "hard_gate": False, "complete_when": ["BJ-02", "BJ-03", "BJ-04"]},
    {"code": "M12", "name": "Maintenance active", "hard_gate": False, "complete_when": ["BH-01"], "payment": "amc"}]
ids = {t["id"] for t in tasks["tasks"]}
for m in milestones:
    for t in m["complete_when"] + m.get("blocks_tasks", []):
        assert t in ids, t

handover_items = [{"code": c, "should_own": o, "transfer": tr} for c, o, tr in [
    ("domain", "client (registrant, own registrar account)", "register in client account or push/transfer with auth code; MFA, lock, auto-renew"),
    ("dns", "client", "zone in client-owned account; export before/after"),
    ("hosting", "client (account + billing)", "transfer ownership; remove or downgrade studio"),
    ("cloud_account", "client organisation", "transfer projects/billing; delete studio IAM users"),
    ("repository", "client org/account", "transfer; remove studio collaborators; rotate deploy keys/secrets"),
    ("source_code", "client (bespoke, by assignment)", "tagged release + archive"),
    ("database", "client hosting/cloud", "stays in client account; backup copy"),
    ("database_credentials", "client", "rotate all; host secret store"),
    ("storage", "client", "private buckets; rotate keys"),
    ("business_email", "client tenant", "client super-admin; remove studio"),
    ("smtp", "client account", "rotate API key; verify domain"),
    ("api_keys", "client accounts", "recreate/rotate; restrict"),
    ("third_party_services", "client", "transfer ownership and billing"),
    ("analytics", "client (Administrator)", "move property if needed; remove/downgrade studio"),
    ("search_console", "client (verified owner)", "remove studio verification tokens"),
    ("business_profiles", "client (primary owner)", "transfer primary ownership"),
    ("cms", "client admin", "named admins; delete shared/seed admins"),
    ("admin_accounts", "client", "named accounts; delete seed admin"),
    ("payment_gateway", "client (merchant KYC)", "remove studio team member; rotate keys if seen"),
    ("forms", "client inbox/CRM", "confirm destinations"),
    ("backups", "client storage", "backup job + off-site copy in client account"),
    ("ssl", "host/CDN in client account", "auto-renew verified"),
    ("cdn", "client account", "transfer; rotate tokens"),
    ("environment_variables", "host secret store", "rotate values studio knew; names in README"),
    ("documentation", "client", "README, user guide, registers delivered"),
    ("design_files", "client", "transfer file or deliver source + exports"),
    ("images_videos", "client", "originals + optimised delivered"),
    ("fonts", "licensee per licence (usually client)", "licence in client name where required"),
    ("licences", "client", "themes/plugins/stock licensed to client"),
    ("plugins_dependencies", "part of code", "lockfile + plugin list"),
    ("certificates", "client", "re-issue in client name if needed"),
    ("renewals", "client", "renewal register delivered"),
    ("subscriptions", "client billing", "move all recurring charges to client"),
    ("maintenance_arrangement", "written AMC or written no-AMC", "signed")]]

closure_checklist = [
    "All tasks verified or cancelled with reason", "No open disputes",
    "All invoices paid or written off with reason; final settlement statement generated",
    "TDS certificates recorded or marked pending", "Expenses reimbursed",
    "Handover checklist complete (M10)", "Retrospective recorded; calibration suggestions captured",
    "Contribution snapshot approved by both and locked with hash", "Distribution paid and recorded",
    "Files archived with retention dates", "Testimonial/portfolio permission status recorded",
    "Internal vault items and temporary accounts removed"]

calculation = {"reserve_pct": 0.10, "base_share_pct": 0.20, "pool_pct": 0.80, "communication_cap_pct": 0.20,
               "sales_cap_pct": 0.10, "micro_task_points_threshold": 1, "micro_task_cap_pct": 0.25,
               "origination_credit_pct": 0.05, "adjustment_min": 0.5, "adjustment_max": 1.5,
               "own_defect_fix_points": 0, "auto_approve_hours": 72, "dispute_window_days": 7,
               "dispute_default_resolution_days": 14, "distribute_tds_credit": False,
               "complexity_factor": {"Low": 1.0, "Medium": 1.25, "High": 1.5},
               "evidence_rule": {"strong_required_above_points": 3, "min_strength_otherwise": "medium"}}

config = {
    "version": "1.0", "generated": "2026-09-28",
    "categories": categories,
    "phases": ["presales", "discovery", "contract", "kickoff", "research", "content", "design", "development",
               "qa", "review", "launch", "handover", "closure", "maintenance", "studio", "throughout"],
    "task_status": ["proposed", "planned", "in_progress", "blocked", "submitted", "verified", "locked", "cancelled"],
    "task_transitions": [["proposed", "planned"], ["proposed", "cancelled"], ["planned", "in_progress"],
                         ["planned", "cancelled"], ["in_progress", "blocked"], ["blocked", "in_progress"],
                         ["in_progress", "submitted"], ["submitted", "verified"], ["submitted", "in_progress"],
                         ["verified", "locked"]],
    "client_approval_status": ["not_required", "pending", "approved", "changes_requested", "deemed_approved", "rejected"],
    "approval_channels": ["email", "signed_pdf", "in_app", "whatsapp_confirmed_by_email"],
    "plan_status": ["draft", "awaiting_partner", "locked"],
    "adjustment_status": ["requested", "approved", "disputed"],
    "project_close_status": ["open", "closing", "awaiting_partner", "closed_locked"],
    "evidence_types": evidence_types,
    "communication_types": communication_types,
    "communication_channels": ["phone", "email", "whatsapp", "video", "in_person"],
    "file_categories": file_categories,
    "milestones": milestones,
    "calculation": calculation,
    "dispute_reason_codes": ["not_done", "insufficient_evidence", "wrong_owner_share", "points_inflated",
                             "duplicate_claim", "quality_rework_needed", "expense_not_business", "outside_scope", "other"],
    "dispute_status": ["open", "in_discussion", "resolved", "escalated"],
    "dispute_resolutions": ["accept", "change_shares", "change_adjustment", "reject_zero", "split_50_50"],
    "invoice_types": ["advance", "milestone", "final", "change_request", "amc"],
    "invoice_status": ["draft", "sent", "part_paid", "paid", "overdue", "cancelled"],
    "payment_modes": ["bank", "upi", "card", "cheque", "cash"],
    "tds_rates": {"professional": 0.10, "technical": 0.02, "none": 0.0},
    "gst_defaults": {"rate": 0.18, "sac": "998314"},
    "change_request_status": ["logged", "assessed", "quoted", "approved", "declined", "done", "invoiced"],
    "handover_item_status": ["not_applicable", "pending", "transferred", "verified_by_client"],
    "developer_access_values": ["removed", "reduced_for_amc", "retained_with_reason"],
    "handover_items": handover_items,
    "closure_checklist": closure_checklist,
    "owner_roles": ["Sales", "PM", "Design", "Content", "FE", "BE", "DevOps", "QA", "Either"],
    "project_types": {"brochure": "tasks where in_standard_project == 'Yes'",
                      "cms": "brochure + AD-*", "ecommerce": "cms + AF-*, AH-*, BK-04",
                      "booking": "brochure + AG-*", "multilingual_addon": "BM-*"},
}
json.dump(config, open("/home/claude/app/seed_config.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)


# ---------- reference calculation (acceptance test) ----------
def calculate(tasks_done, comms, members, finance, p, planned_total=None, originated_by=None):
    pts = {m: {"comm": 0.0, "sales": 0.0, "micro": 0.0, "other": 0.0} for m in members}
    for t in tasks_done:
        base = (p["own_defect_fix_points"] if t.get("own_defect") else t["points"]) * t.get("qty", 1) * t.get("adj", 1.0)
        for m, s in t["shares"].items():
            v = base * s
            kind = "comm" if t["cat"] == "K" else "sales" if t["cat"] in ("A", "B", "C") else \
                   "micro" if t["points"] <= p["micro_task_points_threshold"] else "other"
            pts[m][kind] += v
    for c in comms:
        pts[c["lead"]]["comm"] += c["lead_points"]
        if c.get("second") and c.get("second_required"):
            pts[c["second"]]["comm"] += c["second_points"]
    if originated_by and planned_total:
        pts[originated_by]["sales"] += p["origination_credit_pct"] * planned_total

    def total():
        return sum(sum(v.values()) for v in pts.values())
    for kind, cap in (("comm", p["communication_cap_pct"]), ("sales", p["sales_cap_pct"])):
        kt, gt = sum(v[kind] for v in pts.values()), total()
        if gt and kt > cap * gt:
            # scale so that kind == cap share of the new total: k' = cap*(gt - kt + k')  => k' = cap*(gt-kt)/(1-cap)
            target = cap * (gt - kt) / (1 - cap)
            for v in pts.values():
                v[kind] *= target / kt
    for m, v in pts.items():
        mt = sum(v.values())
        if mt and v["micro"] > p["micro_task_cap_pct"] * mt:
            v["micro"] = p["micro_task_cap_pct"] * (mt - v["micro"]) / (1 - p["micro_task_cap_pct"])
    member_pts = {m: sum(v.values()) for m, v in pts.items()}
    gt = sum(member_pts.values())
    share = {m: member_pts[m] / gt for m in members}
    rev, exp = finance["revenue_ex_gst"], sum(e["amount"] for e in finance["expenses"])
    reserve = p["reserve_pct"] * (rev - exp)
    dist = rev - exp - reserve
    out = {}
    for m in members:
        reimb = sum(e["amount"] for e in finance["expenses"] if e["paid_by"] == m)
        out[m] = {"points": round(member_pts[m], 2), "share": share[m], "reimbursement": reimb,
                  "base": p["base_share_pct"] * dist / len(members), "pool": p["pool_pct"] * dist * share[m]}
    # rupee rounding with remainder to largest fractional part
    raw = {m: o["reimbursement"] + o["base"] + o["pool"] for m, o in out.items()}
    target_total = round(rev - reserve)
    floored = {m: int(v) for m, v in raw.items()}
    rem = target_total - sum(floored.values())
    for m in sorted(raw, key=lambda k: raw[k] - int(raw[k]), reverse=True)[:rem]:
        floored[m] += 1
    for m in members:
        out[m]["payout"] = floored[m]
    snap = json.dumps({"out": out, "params": p}, sort_keys=True, default=str)
    return out, reserve, dist, hashlib.sha256(snap.encode()).hexdigest()


if __name__ == "__main__":
    p = calculation
    tasks_done = [{"cat": "V", "points": 130, "shares": {"A": 1.0}}, {"cat": "S", "points": 90, "shares": {"B": 1.0}}]
    fin = {"revenue_ex_gst": 60000, "expenses": [{"amount": 6000, "paid_by": "B"}]}
    out, reserve, dist, h = calculate(tasks_done, [], ["A", "B"], fin, p)
    print("reserve", reserve, "distributable", dist)
    for m, o in out.items():
        print(m, {k: (round(v, 2) if isinstance(v, float) else v) for k, v in o.items()})
    assert out["A"]["payout"] == 27835 and out["B"]["payout"] == 26765, out
    # communication cap test: 30% comm → scaled to 20%
    t2 = [{"cat": "V", "points": 70, "shares": {"A": 1.0}}, {"cat": "K", "points": 30, "shares": {"B": 1.0}}]
    o2, *_ = calculate(t2, [], ["A", "B"], {"revenue_ex_gst": 10000, "expenses": []}, p)
    comm_share = o2["B"]["points"] / (o2["A"]["points"] + o2["B"]["points"])
    print("comm share after cap", round(comm_share, 4))
    assert abs(comm_share - 0.20) < 1e-6
    print("acceptance tests passed")
