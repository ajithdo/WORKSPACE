import { z } from "zod";
import { PHASES, TASK_STATUSES } from "./types";

const pct = z.number().min(0).max(1);
const capPct = z.number().min(0).lt(1);

export const calculationSchema = z
  .object({
    reserve_pct: pct,
    base_share_pct: pct,
    pool_pct: pct,
    communication_cap_pct: capPct,
    sales_cap_pct: capPct,
    micro_task_points_threshold: z.number().min(0),
    micro_task_cap_pct: capPct,
    origination_credit_pct: pct,
    adjustment_min: z.number().positive(),
    adjustment_max: z.number().positive(),
    own_defect_fix_points: z.number().min(0),
    auto_approve_hours: z.number().positive(),
    dispute_window_days: z.number().positive(),
    dispute_default_resolution_days: z.number().positive(),
    distribute_tds_credit: z.boolean(),
    complexity_factor: z.record(z.string(), z.number().positive()),
    evidence_rule: z.object({
      strong_required_above_points: z.number().min(0),
      min_strength_otherwise: z.enum(["strong", "medium", "weak"]),
    }),
    // Added by this app (see docs/DECISIONS.md); defaults keep the original seed file valid.
    effort_adjustment_trigger_multiple: z.number().positive().default(2),
    dispute_default_split_mode: z.enum(["share_between_parties", "halve_points"]).default("share_between_parties"),
    dispute_retro_threshold: z.number().int().positive().default(3),
    msme_payment_days: z.number().int().positive().default(45),
    calibration_flag_pct: z.number().positive().default(0.3),
  })
  .refine((c) => Math.abs(c.base_share_pct + c.pool_pct - 1) < 1e-9, { message: "base_share_pct + pool_pct must equal 1 (100%)" })
  .refine((c) => c.adjustment_min <= 1 && c.adjustment_max >= 1 && c.adjustment_min < c.adjustment_max, {
    message: "adjustment_min must be ≤ 1 ≤ adjustment_max",
  });

export type CalcParams = z.infer<typeof calculationSchema>;

const milestoneSchema = z.object({
  code: z.string(),
  name: z.string(),
  hard_gate: z.boolean(),
  complete_when: z.array(z.string()),
  payment: z.string().optional(),
  blocks_phases: z.array(z.string()).optional(),
  blocks_tasks: z.array(z.string()).optional(),
  blocks_categories: z.array(z.string()).optional(),
});
export type MilestoneConfig = z.infer<typeof milestoneSchema>;

const communicationTypeSchema = z.object({
  code: z.string(),
  name: z.string(),
  lead_points: z.number().min(0),
  second_attendee_points: z.number().min(0),
  required_fields: z.array(z.string()).default([]),
  points_condition: z.string().optional(),
});
export type CommunicationTypeConfig = z.infer<typeof communicationTypeSchema>;

export const studioConfigSchema = z.object({
  version: z.string(),
  generated: z.string().optional(),
  categories: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      phase: z.enum(PHASES),
      is_communication: z.boolean(),
      is_sales: z.boolean(),
      is_business_level: z.boolean(),
    }),
  ),
  phases: z.array(z.enum(PHASES)),
  task_status: z.array(z.enum(TASK_STATUSES)),
  task_transitions: z.array(z.tuple([z.enum(TASK_STATUSES), z.enum(TASK_STATUSES)])),
  client_approval_status: z.array(z.string()),
  approval_channels: z.array(z.string()),
  plan_status: z.array(z.string()),
  adjustment_status: z.array(z.string()),
  project_close_status: z.array(z.string()),
  evidence_types: z.array(z.object({ code: z.string(), strength: z.enum(["strong", "medium", "weak"]) })),
  communication_types: z.array(communicationTypeSchema),
  communication_channels: z.array(z.string()),
  file_categories: z.array(z.object({ code: z.string(), contents: z.string() })),
  milestones: z.array(milestoneSchema),
  calculation: calculationSchema,
  dispute_reason_codes: z.array(z.string()),
  dispute_status: z.array(z.string()),
  dispute_resolutions: z.array(z.string()),
  invoice_types: z.array(z.string()),
  invoice_status: z.array(z.string()),
  payment_modes: z.array(z.string()),
  tds_rates: z.record(z.string(), pct),
  gst_defaults: z.object({ rate: pct, sac: z.string() }),
  change_request_status: z.array(z.string()),
  handover_item_status: z.array(z.string()),
  developer_access_values: z.array(z.string()),
  handover_items: z.array(z.object({ code: z.string(), should_own: z.string(), transfer: z.string() })),
  closure_checklist: z.array(z.string()),
  owner_roles: z.array(z.string()),
  project_types: z.record(z.string(), z.string()),
  retention: z.object({ finance_years: z.number().int().positive(), delivery_years_after_closure: z.number().int().positive() }).default({
    finance_years: 8,
    delivery_years_after_closure: 3,
  }),
});

export type StudioConfig = z.infer<typeof studioConfigSchema>;

export function parseStudioConfig(json: unknown): StudioConfig {
  return studioConfigSchema.parse(json);
}

/** App-level additions applied when a config is first imported (decision D11). Idempotent. */
export function withAppDefaults(cfg: StudioConfig): StudioConfig {
  const transitions = [...cfg.task_transitions];
  for (const extra of [
    ["in_progress", "cancelled"],
    ["blocked", "cancelled"],
  ] as const) {
    if (!transitions.some(([a, b]) => a === extra[0] && b === extra[1])) transitions.push([extra[0], extra[1]]);
  }
  return { ...cfg, task_transitions: transitions };
}

export function evidenceStrength(cfg: StudioConfig, type: string): "strong" | "medium" | "weak" {
  return cfg.evidence_types.find((e) => e.code === type)?.strength ?? "weak";
}
