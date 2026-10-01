import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { StudioConfig } from "@/domain/config";

/*
 * Conventions: money is integer paise; shares are integer basis points (10000 = 100%);
 * timestamps are ISO-8601 UTC strings; dates are YYYY-MM-DD. Rows are never deleted once
 * they matter — status columns record cancellation, rejection and locking.
 */

const id = () => integer("id").primaryKey({ autoIncrement: true });
const bool = (name: string) => integer(name, { mode: "boolean" });
const createdAt = () => text("created_at").notNull();

export const members = sqliteTable("members", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  roles: text("roles", { mode: "json" }).$type<string[]>().notNull(),
  active: bool("active").notNull().default(true),
  mustChangePassword: bool("must_change_password").notNull().default(false),
  createdAt: createdAt(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256 of the cookie token
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id),
    createdAt: createdAt(),
    expiresAt: text("expires_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_member_idx").on(t.memberId)],
);

export const studio = sqliteTable("studio", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  legalName: text("legal_name").notNull().default(""),
  gstin: text("gstin").notNull().default(""),
  stateCode: text("state_code").notNull().default(""),
  gstRegistered: bool("gst_registered").notNull().default(false),
  msmeRegistered: bool("msme_registered").notNull().default(false),
  udyamNumber: text("udyam_number").notNull().default(""),
  address: text("address").notNull().default(""),
  invoicePrefix: text("invoice_prefix").notNull().default("INV"),
  createdAt: createdAt(),
  updatedAt: text("updated_at").notNull(),
});

export const configVersions = sqliteTable("config_versions", {
  id: id(),
  version: integer("version").notNull().unique(),
  status: text("status").$type<"draft" | "pending" | "active" | "superseded">().notNull(),
  round: integer("round").notNull().default(1),
  data: text("data", { mode: "json" }).$type<StudioConfig>().notNull(),
  note: text("note").notNull().default(""),
  createdBy: integer("created_by").references(() => members.id),
  createdAt: createdAt(),
  activatedAt: text("activated_at"),
});

export const libraryVersions = sqliteTable("library_versions", {
  id: id(),
  version: integer("version").notNull().unique(),
  status: text("status").$type<"draft" | "pending" | "active" | "superseded">().notNull(),
  round: integer("round").notNull().default(1),
  note: text("note").notNull().default(""),
  source: text("source").notNull(),
  createdBy: integer("created_by").references(() => members.id),
  createdAt: createdAt(),
  activatedAt: text("activated_at"),
});

export const categoryTemplates = sqliteTable(
  "category_templates",
  {
    id: id(),
    libraryVersionId: integer("library_version_id")
      .notNull()
      .references(() => libraryVersions.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    phase: text("phase").notNull(),
    isCommunication: bool("is_communication").notNull(),
    isSales: bool("is_sales").notNull(),
    isBusinessLevel: bool("is_business_level").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [uniqueIndex("category_templates_version_code").on(t.libraryVersionId, t.code)],
);

export const taskTemplates = sqliteTable(
  "task_templates",
  {
    id: id(),
    libraryVersionId: integer("library_version_id")
      .notNull()
      .references(() => libraryVersions.id),
    code: text("code").notNull(),
    categoryCode: text("category_code").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    why: text("why").notNull(),
    phaseText: text("phase_text").notNull(),
    phase: text("phase").notNull(),
    dependsOn: text("depends_on", { mode: "json" }).$type<string[]>().notNull(),
    prerequisitesText: text("prerequisites_text").notNull(),
    defaultOwnerRole: text("default_owner_role").notNull(),
    deliverable: text("deliverable").notNull(),
    evidenceExpected: text("evidence_expected").notNull(),
    clientApproval: text("client_approval").notNull(),
    classification: text("classification").notNull(),
    complexity: text("complexity").notNull(),
    effortRange: text("effort_range").notNull(),
    effortMidHours: real("effort_mid_hours"),
    unit: text("unit"),
    defaultPoints: integer("default_points").notNull(),
    risks: text("risks").notNull(),
    commonMistakes: text("common_mistakes").notNull(),
    ifSkipped: text("if_skipped").notNull(),
    inStandardProject: text("in_standard_project").notNull(),
    billable: text("billable").notNull(),
    postLaunchMaintenance: bool("post_launch_maintenance").notNull(),
    isBusinessLevel: bool("is_business_level").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [uniqueIndex("task_templates_version_code").on(t.libraryVersionId, t.code)],
);

export const clients = sqliteTable("clients", {
  id: id(),
  businessName: text("business_name").notNull(),
  gstin: text("gstin").notNull().default(""),
  stateCode: text("state_code").notNull().default(""),
  contactName: text("contact_name").notNull().default(""),
  contactEmail: text("contact_email").notNull().default(""),
  contactPhone: text("contact_phone").notNull().default(""),
  address: text("address").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdBy: integer("created_by").references(() => members.id),
  createdAt: createdAt(),
});

export interface PaymentScheduleEntry {
  milestoneCode: string;
  pct: number;
  note: string;
}

export const projects = sqliteTable("projects", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind").$type<"client" | "studio" | "maintenance">().notNull(),
  projectType: text("project_type").notNull(),
  multilingual: bool("multilingual").notNull().default(false),
  clientId: integer("client_id").references(() => clients.id),
  originatedBy: integer("originated_by").references(() => members.id),
  libraryVersionId: integer("library_version_id")
    .notNull()
    .references(() => libraryVersions.id),
  configVersionId: integer("config_version_id")
    .notNull()
    .references(() => configVersions.id),
  planStatus: text("plan_status").$type<"draft" | "awaiting_partner" | "locked">().notNull(),
  planRound: integer("plan_round").notNull().default(1),
  planSubmittedBy: integer("plan_submitted_by").references(() => members.id),
  planLockedAt: text("plan_locked_at"),
  closeStatus: text("close_status").$type<"open" | "closing" | "awaiting_partner" | "closed_locked">().notNull(),
  closedAt: text("closed_at"),
  startDate: text("start_date"),
  targetLaunchDate: text("target_launch_date"),
  quotedAmountExGst: integer("quoted_amount_ex_gst").notNull().default(0),
  gstRegistered: bool("gst_registered").notNull().default(false),
  gstRateBp: integer("gst_rate_bp").notNull().default(1800),
  sacCode: text("sac_code").notNull().default("998314"),
  placeOfSupplyState: text("place_of_supply_state").notNull().default(""),
  msmeApplicable: bool("msme_applicable").notNull().default(false),
  deemedAcceptanceClause: bool("deemed_acceptance_clause").notNull().default(false),
  deemedAcceptanceDays: integer("deemed_acceptance_days"),
  paymentSchedule: text("payment_schedule", { mode: "json" }).$type<PaymentScheduleEntry[]>().notNull(),
  notes: text("notes").notNull().default(""),
  createdBy: integer("created_by").references(() => members.id),
  createdAt: createdAt(),
  updatedAt: text("updated_at").notNull(),
});

export const projectMembers = sqliteTable(
  "project_members",
  {
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id),
    active: bool("active").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.memberId] })],
);

export const taskInstances = sqliteTable(
  "task_instances",
  {
    id: id(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    templateId: integer("template_id").references(() => taskTemplates.id),
    code: text("code").notNull(),
    categoryCode: text("category_code").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    phase: text("phase").notNull(),
    dependsOn: text("depends_on", { mode: "json" }).$type<string[]>().notNull(),
    classification: text("classification").notNull().default("REC"),
    complexity: text("complexity").notNull().default("Low"),
    clientApproval: text("client_approval").notNull().default("No"),
    deliverable: text("deliverable").notNull().default(""),
    evidenceExpected: text("evidence_expected").notNull().default(""),
    defaultPoints: real("default_points").notNull(),
    unit: text("unit"),
    quantity: real("quantity").notNull().default(1),
    adjustmentFactor: real("adjustment_factor").notNull().default(1),
    multiplier: real("multiplier").notNull().default(1),
    effortMidHours: real("effort_mid_hours"),
    isCommunication: bool("is_communication").notNull().default(false),
    isSales: bool("is_sales").notNull().default(false),
    isBusinessLevel: bool("is_business_level").notNull().default(false),
    ownDefect: bool("own_defect").notNull().default(false),
    defectOfTaskId: integer("defect_of_task_id"),
    status: text("status").notNull(),
    origin: text("origin").notNull().default("plan"),
    proposedBy: integer("proposed_by").references(() => members.id),
    proposedAt: text("proposed_at"),
    autoApproveAt: text("auto_approve_at"),
    ownerMemberId: integer("owner_member_id").references(() => members.id),
    startedAt: text("started_at"),
    submittedAt: text("submitted_at"),
    submittedBy: integer("submitted_by").references(() => members.id),
    submissionRound: integer("submission_round").notNull().default(0),
    verifiedBy: integer("verified_by").references(() => members.id),
    verifiedAt: text("verified_at"),
    rejectionReason: text("rejection_reason"),
    blockedReason: text("blocked_reason"),
    cancelReason: text("cancel_reason"),
    cancelledAt: text("cancelled_at"),
    changeRequestId: integer("change_request_id"),
    communicationId: integer("communication_id"),
    notes: text("notes").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: integer("created_by").references(() => members.id),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
    lockedAt: text("locked_at"),
  },
  (t) => [uniqueIndex("task_instances_project_code").on(t.projectId, t.code), index("task_instances_project_status").on(t.projectId, t.status)],
);

export const taskContributions = sqliteTable(
  "task_contributions",
  {
    taskInstanceId: integer("task_instance_id")
      .notNull()
      .references(() => taskInstances.id),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id),
    shareBp: integer("share_bp").notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskInstanceId, t.memberId] })],
);

export const clientApprovals = sqliteTable("client_approvals", {
  id: id(),
  taskInstanceId: integer("task_instance_id")
    .notNull()
    .unique()
    .references(() => taskInstances.id),
  status: text("status").notNull(),
  requestedAt: text("requested_at"),
  approvedByName: text("approved_by_name").notNull().default(""),
  approvedAt: text("approved_at"),
  channel: text("channel"),
  evidenceId: integer("evidence_id"),
  notes: text("notes").notNull().default(""),
  updatedBy: integer("updated_by").references(() => members.id),
  updatedAt: text("updated_at").notNull(),
});

export const timeEntries = sqliteTable(
  "time_entries",
  {
    id: id(),
    taskInstanceId: integer("task_instance_id")
      .notNull()
      .references(() => taskInstances.id),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id),
    workDate: text("work_date").notNull(),
    minutes: integer("minutes").notNull(),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("time_entries_task").on(t.taskInstanceId)],
);

export const files = sqliteTable(
  "files",
  {
    id: id(),
    projectId: integer("project_id").references(() => projects.id),
    category: text("category").notNull(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    uploadedBy: integer("uploaded_by")
      .notNull()
      .references(() => members.id),
    uploadedAt: text("uploaded_at").notNull(),
    visibility: text("visibility").$type<"internal" | "client_shared">().notNull().default("internal"),
    retentionUntil: text("retention_until"),
    archived: bool("archived").notNull().default(false),
  },
  (t) => [index("files_project").on(t.projectId)],
);

export const evidence = sqliteTable(
  "evidence",
  {
    id: id(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    subjectType: text("subject_type").$type<"task" | "communication" | "change_request" | "handover_item">().notNull(),
    subjectId: integer("subject_id").notNull(),
    submissionRound: integer("submission_round").notNull().default(1),
    submittedBy: integer("submitted_by")
      .notNull()
      .references(() => members.id),
    submittedAt: text("submitted_at").notNull(),
    type: text("type").notNull(),
    strength: text("strength").$type<"strong" | "medium" | "weak">().notNull(),
    url: text("url"),
    fileId: integer("file_id").references(() => files.id),
    externalRef: text("external_ref"),
    description: text("description").notNull(),
    capturedAt: text("captured_at"),
    sha256: text("sha256"),
    containsPersonalData: bool("contains_personal_data").notNull().default(false),
    redacted: bool("redacted").notNull().default(false),
    noSecretsConfirmed: bool("no_secrets_confirmed").notNull(),
    verificationStatus: text("verification_status").$type<"pending" | "accepted" | "rejected">().notNull().default("pending"),
    verifiedBy: integer("verified_by").references(() => members.id),
    verifiedAt: text("verified_at"),
    rejectionReason: text("rejection_reason"),
  },
  (t) => [index("evidence_subject").on(t.subjectType, t.subjectId)],
);

export const communications = sqliteTable(
  "communications",
  {
    id: id(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    type: text("type").notNull(),
    status: text("status").$type<"planned" | "logged" | "verified" | "rejected" | "cancelled">().notNull(),
    scheduledFor: text("scheduled_for"),
    occurredAt: text("occurred_at"),
    channel: text("channel"),
    durationMinutes: integer("duration_minutes"),
    leadMemberId: integer("lead_member_id")
      .notNull()
      .references(() => members.id),
    secondMemberId: integer("second_member_id").references(() => members.id),
    secondRequired: bool("second_required").notNull().default(false),
    attendeeMemberIds: text("attendee_member_ids", { mode: "json" }).$type<number[]>().notNull(),
    clientAttendees: text("client_attendees").notNull().default(""),
    summary: text("summary").notNull().default(""),
    decisions: text("decisions", { mode: "json" }).$type<string[]>().notNull(),
    notesSentToClient: bool("notes_sent_to_client").notNull().default(false),
    multiplier: real("multiplier").notNull().default(1),
    splitParties: text("split_parties", { mode: "json" }).$type<number[] | null>(),
    loggedBy: integer("logged_by").references(() => members.id),
    loggedAt: text("logged_at"),
    verifiedBy: integer("verified_by").references(() => members.id),
    verifiedAt: text("verified_at"),
    rejectionReason: text("rejection_reason"),
    createdBy: integer("created_by").references(() => members.id),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("communications_project").on(t.projectId)],
);

export const actionItems = sqliteTable("action_items", {
  id: id(),
  communicationId: integer("communication_id")
    .notNull()
    .references(() => communications.id),
  text: text("text").notNull(),
  ownerMemberId: integer("owner_member_id").references(() => members.id),
  dueDate: text("due_date"),
  taskInstanceId: integer("task_instance_id").references(() => taskInstances.id),
  createdAt: createdAt(),
});

export const changeRequests = sqliteTable(
  "change_requests",
  {
    id: id(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    number: text("number").notNull(),
    description: text("description").notNull(),
    requestedByClientName: text("requested_by_client_name").notNull().default(""),
    requestedAt: text("requested_at").notNull(),
    classification: text("classification").$type<"bug" | "revision" | "change">().notNull().default("change"),
    estimateHours: real("estimate_hours"),
    priceExGst: integer("price_ex_gst").notNull().default(0),
    timelineImpactDays: integer("timeline_impact_days").notNull().default(0),
    noCharge: bool("no_charge").notNull().default(false),
    status: text("status").notNull(),
    assessedBy: integer("assessed_by").references(() => members.id),
    approvalEvidenceId: integer("approval_evidence_id"),
    invoiceId: integer("invoice_id"),
    declineReason: text("decline_reason"),
    createdBy: integer("created_by").references(() => members.id),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("change_requests_project_number").on(t.projectId, t.number)],
);

export const invoices = sqliteTable(
  "invoices",
  {
    id: id(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    number: text("number").notNull().unique(),
    fyLabel: text("fy_label").notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    issueDate: text("issue_date").notNull(),
    dueDate: text("due_date").notNull(),
    acceptanceDate: text("acceptance_date").notNull(),
    amountExGst: integer("amount_ex_gst").notNull(),
    gstRateBp: integer("gst_rate_bp").notNull(),
    cgst: integer("cgst").notNull(),
    sgst: integer("sgst").notNull(),
    igst: integer("igst").notNull(),
    total: integer("total").notNull(),
    tdsExpectedRateBp: integer("tds_expected_rate_bp").notNull().default(0),
    status: text("status").notNull(),
    msmeDueDate: text("msme_due_date"),
    fileId: integer("file_id").references(() => files.id),
    changeRequestId: integer("change_request_id"),
    milestoneCode: text("milestone_code"),
    notes: text("notes").notNull().default(""),
    writtenOffReason: text("written_off_reason"),
    cancelledReason: text("cancelled_reason"),
    sentAt: text("sent_at"),
    createdBy: integer("created_by").references(() => members.id),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("invoices_fy_seq").on(t.fyLabel, t.seq), index("invoices_project").on(t.projectId)],
);

export const payments = sqliteTable(
  "payments",
  {
    id: id(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    receivedDate: text("received_date").notNull(),
    amountReceived: integer("amount_received").notNull(),
    tdsDeducted: integer("tds_deducted").notNull().default(0),
    gstComponent: integer("gst_component").notNull(),
    revenueExGst: integer("revenue_ex_gst").notNull(),
    bankReference: text("bank_reference").notNull(),
    mode: text("mode").notNull(),
    recordedBy: integer("recorded_by")
      .notNull()
      .references(() => members.id),
    recordedAt: text("recorded_at").notNull(),
    verifiedBy: integer("verified_by").references(() => members.id),
    verifiedAt: text("verified_at"),
    tdsCertificateStatus: text("tds_certificate_status").$type<"not_applicable" | "pending" | "received">().notNull(),
    tdsCertificateFileId: integer("tds_certificate_file_id").references(() => files.id),
    notes: text("notes").notNull().default(""),
  },
  (t) => [index("payments_invoice").on(t.invoiceId), index("payments_project").on(t.projectId)],
);

export const expenses = sqliteTable(
  "expenses",
  {
    id: id(),
    projectId: integer("project_id").references(() => projects.id),
    expenseDate: text("expense_date").notNull(),
    vendor: text("vendor").notNull(),
    description: text("description").notNull(),
    amount: integer("amount").notNull(),
    gstPaid: integer("gst_paid").notNull().default(0),
    paidByMemberId: integer("paid_by_member_id").references(() => members.id),
    reimbursable: bool("reimbursable").notNull().default(true),
    billableToClient: bool("billable_to_client").notNull().default(false),
    receiptFileId: integer("receipt_file_id").references(() => files.id),
    status: text("status").$type<"pending" | "approved" | "rejected">().notNull(),
    approvedBy: integer("approved_by").references(() => members.id),
    approvedAt: text("approved_at"),
    rejectionReason: text("rejection_reason"),
    acceptedAmount: integer("accepted_amount"),
    createdBy: integer("created_by")
      .notNull()
      .references(() => members.id),
    createdAt: createdAt(),
  },
  (t) => [index("expenses_project").on(t.projectId)],
);

export const contributionSnapshots = sqliteTable(
  "contribution_snapshots",
  {
    id: id(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    kind: text("kind").$type<"closure" | "adjustment">().notNull(),
    seq: integer("seq").notNull(),
    period: text("period").notNull(),
    status: text("status").$type<"awaiting_partner" | "locked" | "rejected">().notNull(),
    round: integer("round").notNull().default(1),
    inputs: text("inputs", { mode: "json" }).notNull(),
    params: text("params", { mode: "json" }).notNull(),
    outputs: text("outputs", { mode: "json" }).notNull(),
    hash: text("hash").notNull(),
    calcVersion: integer("calc_version").notNull(),
    configVersionId: integer("config_version_id")
      .notNull()
      .references(() => configVersions.id),
    previousSnapshotId: integer("previous_snapshot_id"),
    postLockAdjustmentId: integer("post_lock_adjustment_id"),
    createdBy: integer("created_by").references(() => members.id),
    createdAt: createdAt(),
    lockedAt: text("locked_at"),
    rejectedReason: text("rejected_reason"),
  },
  (t) => [uniqueIndex("snapshots_project_seq").on(t.projectId, t.seq)],
);

export const reserveLedger = sqliteTable("reserve_ledger", {
  id: id(),
  entryDate: text("entry_date").notNull(),
  projectId: integer("project_id").references(() => projects.id),
  amount: integer("amount").notNull(),
  direction: text("direction").$type<"in" | "out">().notNull(),
  purpose: text("purpose").notNull(),
  snapshotId: integer("snapshot_id").references(() => contributionSnapshots.id),
  status: text("status").$type<"pending" | "approved" | "rejected">().notNull(),
  createdBy: integer("created_by").references(() => members.id),
  approvedBy: integer("approved_by").references(() => members.id),
  createdAt: createdAt(),
});

export const distributions = sqliteTable("distributions", {
  id: id(),
  snapshotId: integer("snapshot_id")
    .notNull()
    .references(() => contributionSnapshots.id),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  memberId: integer("member_id")
    .notNull()
    .references(() => members.id),
  reimbursement: integer("reimbursement").notNull(),
  baseShare: integer("base_share").notNull(),
  poolShare: integer("pool_share").notNull(),
  total: integer("total").notNull(),
  shortfall: integer("shortfall").notNull().default(0),
  paidOn: text("paid_on"),
  bankReference: text("bank_reference"),
  recordedBy: integer("recorded_by").references(() => members.id),
  recordedAt: text("recorded_at"),
});

export const postLockAdjustments = sqliteTable("post_lock_adjustments", {
  id: id(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  period: text("period").notNull(),
  reason: text("reason").notNull(),
  payload: text("payload", { mode: "json" })
    .$type<{
      revenueDeltaPaise: number;
      expenses: { amountPaise: number; paidBy: number | null; description: string }[];
      points: { memberId: number; points: number; note: string }[];
    }>()
    .notNull(),
  status: text("status").$type<"requested" | "approved" | "rejected">().notNull(),
  round: integer("round").notNull().default(1),
  requestedBy: integer("requested_by")
    .notNull()
    .references(() => members.id),
  requestedAt: text("requested_at").notNull(),
  decidedAt: text("decided_at"),
  snapshotId: integer("snapshot_id"),
});

export const disputes = sqliteTable(
  "disputes",
  {
    id: id(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    targetType: text("target_type").$type<"task_instance" | "communication" | "expense" | "adjustment" | "evidence" | "plan">().notNull(),
    targetId: integer("target_id").notNull(),
    raisedBy: integer("raised_by")
      .notNull()
      .references(() => members.id),
    raisedAt: text("raised_at").notNull(),
    reasonCode: text("reason_code").notNull(),
    description: text("description").notNull(),
    proposedResolution: text("proposed_resolution"),
    proposedPayload: text("proposed_payload", { mode: "json" }).$type<Record<string, unknown> | null>(),
    proposedBy: integer("proposed_by").references(() => members.id),
    proposedAt: text("proposed_at"),
    status: text("status").$type<"open" | "in_discussion" | "resolved" | "escalated">().notNull(),
    resolution: text("resolution"),
    resolutionPayload: text("resolution_payload", { mode: "json" }).$type<Record<string, unknown> | null>(),
    resolutionNote: text("resolution_note"),
    resolvedAt: text("resolved_at"),
    resolvedByBoth: bool("resolved_by_both").notNull().default(false),
    defaultDueAt: text("default_due_at").notNull(),
    escalatedAt: text("escalated_at"),
    escalatedBy: integer("escalated_by").references(() => members.id),
    escalationNote: text("escalation_note"),
  },
  (t) => [index("disputes_project_status").on(t.projectId, t.status), index("disputes_target").on(t.targetType, t.targetId)],
);

export const disputeComments = sqliteTable("dispute_comments", {
  id: id(),
  disputeId: integer("dispute_id")
    .notNull()
    .references(() => disputes.id),
  memberId: integer("member_id")
    .notNull()
    .references(() => members.id),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

export const adjustmentRequests = sqliteTable(
  "adjustment_requests",
  {
    id: id(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    taskInstanceId: integer("task_instance_id").references(() => taskInstances.id),
    kind: text("kind").$type<"factor" | "quantity" | "shares" | "descope">().notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    reason: text("reason").notNull(),
    requestedBy: integer("requested_by")
      .notNull()
      .references(() => members.id),
    requestedAt: text("requested_at").notNull(),
    status: text("status").$type<"requested" | "approved" | "disputed" | "withdrawn">().notNull(),
    decidedBy: integer("decided_by").references(() => members.id),
    decidedAt: text("decided_at"),
    decisionNote: text("decision_note"),
    disputeId: integer("dispute_id"),
  },
  (t) => [index("adjustments_project").on(t.projectId)],
);

export const approvalVotes = sqliteTable(
  "approval_votes",
  {
    id: id(),
    subjectType: text("subject_type").notNull(),
    subjectId: integer("subject_id").notNull(),
    round: integer("round").notNull(),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id),
    decision: text("decision").$type<"approve" | "reject">().notNull(),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("approval_votes_unique").on(t.subjectType, t.subjectId, t.round, t.memberId)],
);

export const handoverItems = sqliteTable(
  "handover_items",
  {
    id: id(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    code: text("code").notNull(),
    status: text("status").notNull(),
    ownerConfirmed: text("owner_confirmed").notNull().default(""),
    credentialsExist: bool("credentials_exist").notNull().default(false),
    credentialsRotated: bool("credentials_rotated").notNull().default(false),
    rotatedOn: text("rotated_on"),
    developerAccess: text("developer_access"),
    retainedReason: text("retained_reason"),
    notes: text("notes").notNull().default(""),
    updatedBy: integer("updated_by").references(() => members.id),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("handover_project_code").on(t.projectId, t.code)],
);

export const closureItems = sqliteTable(
  "closure_items",
  {
    id: id(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    itemIndex: integer("item_index").notNull(),
    done: bool("done").notNull().default(false),
    note: text("note").notNull().default(""),
    doneBy: integer("done_by").references(() => members.id),
    doneAt: text("done_at"),
  },
  (t) => [uniqueIndex("closure_items_project_index").on(t.projectId, t.itemIndex)],
);

export const retroItems = sqliteTable("retro_items", {
  id: id(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  text: text("text").notNull(),
  source: text("source").$type<"manual" | "dispute_threshold" | "calibration">().notNull(),
  createdBy: integer("created_by").references(() => members.id),
  createdAt: createdAt(),
  addressed: bool("addressed").notNull().default(false),
  addressedNote: text("addressed_note"),
});

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey(),
    at: text("at").notNull(),
    actorMemberId: integer("actor_member_id"),
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    projectId: integer("project_id"),
    before: text("before"),
    after: text("after"),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [index("audit_project").on(t.projectId), index("audit_entity").on(t.entityType, t.entityId)],
);
