export const TASK_STATUSES = ["proposed", "planned", "in_progress", "blocked", "submitted", "verified", "locked", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PHASES = [
  "presales",
  "discovery",
  "contract",
  "kickoff",
  "research",
  "content",
  "design",
  "development",
  "qa",
  "review",
  "launch",
  "handover",
  "closure",
  "maintenance",
  "studio",
  "throughout",
] as const;
export type Phase = (typeof PHASES)[number];

export type Strength = "strong" | "medium" | "weak";
export type ClientApprovalRequirement = "Yes" | "No" | "Optional";
export const CLIENT_APPROVAL_STATUSES = ["not_required", "pending", "approved", "changes_requested", "deemed_approved", "rejected"] as const;
export type ClientApprovalStatus = (typeof CLIENT_APPROVAL_STATUSES)[number];

export const PROJECT_TYPES = ["brochure", "cms", "ecommerce", "booking", "custom", "studio", "maintenance"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];
export type ProjectKind = "client" | "studio" | "maintenance";

export const OWNER_ROLES = ["Sales", "PM", "Design", "Content", "FE", "BE", "DevOps", "QA", "Either", "Client"] as const;
export type OwnerRole = (typeof OWNER_ROLES)[number];

export const PHASE_LABELS: Record<Phase, string> = {
  presales: "Pre-sales",
  discovery: "Discovery",
  contract: "Contract",
  kickoff: "Kickoff",
  research: "Research",
  content: "Content",
  design: "Design",
  development: "Development",
  qa: "QA",
  review: "Client review",
  launch: "Launch",
  handover: "Handover",
  closure: "Closure",
  maintenance: "Maintenance",
  studio: "Studio",
  throughout: "Throughout",
};
