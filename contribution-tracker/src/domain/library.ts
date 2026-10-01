import type { StudioConfig } from "./config";
import type { ClientApprovalRequirement, OwnerRole, Phase, ProjectType } from "./types";

/** Raw task row as it appears in seed_tasks.json. */
export interface SeedTask {
  id: string;
  category_code: string;
  name: string;
  description: string;
  why: string;
  phase: string;
  depends_on: string[];
  prerequisites_text?: string;
  default_owner_role: string;
  deliverable: string;
  evidence_expected: string;
  client_approval: string;
  classification: string;
  complexity: string;
  effort_range: string;
  default_points: number;
  risks: string;
  common_mistakes: string;
  if_skipped: string;
  in_standard_project: string;
  billable: string;
  post_launch_maintenance: boolean;
}

export interface TaskTemplateData {
  code: string;
  categoryCode: string;
  name: string;
  description: string;
  why: string;
  phaseText: string;
  phase: Phase;
  dependsOn: string[];
  prerequisitesText: string;
  defaultOwnerRole: string;
  deliverable: string;
  evidenceExpected: string;
  clientApproval: ClientApprovalRequirement;
  classification: string;
  complexity: string;
  effortRange: string;
  effortMidHours: number | null;
  unit: string | null;
  defaultPoints: number;
  risks: string;
  commonMistakes: string;
  ifSkipped: string;
  inStandardProject: string;
  billable: string;
  postLaunchMaintenance: boolean;
  isBusinessLevel: boolean;
  sortOrder: number;
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const EFFORT_RE = new RegExp(String.raw`${NUM}\s*(?:[–-]\s*${NUM})?\s*(h|min)\b`, "i");
const UNIT_RE = /(?:\/\s*|\bper\s+)((?:\d+\s+)?[a-z]+)/i;

/** "2–4 h" → 3 hours; "15–30 min" → 0.375; "1–2 h/page" → per-unit "page"; "Varies" → null. */
export function parseEffort(text: string): { midHours: number | null; unit: string | null } {
  const m = EFFORT_RE.exec(text);
  if (!m) return { midHours: null, unit: null };
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  const mid = (lo + hi) / 2;
  const midHours = m[3]?.toLowerCase() === "min" ? mid / 60 : mid;
  const rest = text.slice((m.index ?? 0) + m[0].length);
  let unit: string | null = null;
  if (/^\s*each\b/i.test(rest)) unit = "each";
  else {
    const u = UNIT_RE.exec(rest);
    if (u && (u.index ?? 0) <= 2) unit = u[1]?.toLowerCase() ?? null;
  }
  return { midHours, unit };
}

const ROLE_ALIASES: Record<string, OwnerRole[]> = {
  sales: ["Sales"],
  pm: ["PM"],
  design: ["Design"],
  content: ["Content"],
  fe: ["FE"],
  be: ["BE"],
  devops: ["DevOps"],
  qa: ["QA"],
  either: ["Either"],
  client: ["Client"],
  dev: ["FE", "BE"],
};

export function parseOwnerRoles(text: string): { roles: OwnerRole[]; both: boolean } {
  const both = /\(both/i.test(text);
  const cleaned = text.replace(/\([^)]*\)/g, " ");
  const roles: OwnerRole[] = [];
  for (const token of cleaned.split(/[/+]|\band\b/i)) {
    const key = token.trim().toLowerCase();
    for (const role of ROLE_ALIASES[key] ?? []) if (!roles.includes(role)) roles.push(role);
  }
  return { roles, both };
}

export function isBusinessLevelTask(phaseText: string, categoryIsBusinessLevel: boolean): boolean {
  return categoryIsBusinessLevel || phaseText.trim().toLowerCase().startsWith("business-level");
}

function asApproval(v: string): ClientApprovalRequirement {
  return v === "Yes" || v === "Optional" ? v : "No";
}

export function normaliseSeedTasks(tasks: SeedTask[], config: StudioConfig): TaskTemplateData[] {
  const categories = new Map(config.categories.map((c) => [c.code, c]));
  return tasks.map((t, i) => {
    const cat = categories.get(t.category_code);
    if (!cat) throw new Error(`Task ${t.id} has unknown category ${t.category_code}`);
    const effort = parseEffort(t.effort_range);
    return {
      code: t.id,
      categoryCode: t.category_code,
      name: t.name,
      description: t.description,
      why: t.why,
      phaseText: t.phase,
      phase: cat.phase,
      dependsOn: [...t.depends_on],
      prerequisitesText: t.prerequisites_text ?? "",
      defaultOwnerRole: t.default_owner_role,
      deliverable: t.deliverable,
      evidenceExpected: t.evidence_expected,
      clientApproval: asApproval(t.client_approval),
      classification: t.classification,
      complexity: t.complexity,
      effortRange: t.effort_range,
      effortMidHours: effort.midHours,
      unit: effort.unit,
      defaultPoints: t.default_points,
      risks: t.risks,
      commonMistakes: t.common_mistakes,
      ifSkipped: t.if_skipped,
      inStandardProject: t.in_standard_project,
      billable: t.billable,
      postLaunchMaintenance: t.post_launch_maintenance,
      isBusinessLevel: isBusinessLevelTask(t.phase, cat.is_business_level),
      sortOrder: i,
    };
  });
}

type Selectable = Pick<TaskTemplateData, "code" | "categoryCode" | "inStandardProject" | "isBusinessLevel">;

/** Project types from seed_config.project_types: brochure = standard tasks; cms/ecommerce/booking add modules. */
export function selectTemplatesForType<T extends Selectable>(templates: T[], type: ProjectType, opts: { multilingual: boolean }): T[] {
  const cats = (...codes: string[]) => (t: T) => codes.includes(t.categoryCode);
  const standard = (t: T) => t.inStandardProject === "Yes";
  let include: (t: T) => boolean;
  switch (type) {
    case "brochure":
      include = standard;
      break;
    case "cms":
      include = (t) => standard(t) || cats("AD")(t);
      break;
    case "ecommerce":
      include = (t) => standard(t) || cats("AD", "AF", "AH")(t) || t.code === "BK-04";
      break;
    case "booking":
      include = (t) => standard(t) || cats("AG")(t);
      break;
    case "studio":
      include = (t) => t.isBusinessLevel;
      break;
    case "maintenance":
      include = cats("BH", "BI");
      break;
    case "custom":
      include = () => false;
      break;
  }
  const withAddons = (t: T) => include(t) || (opts.multilingual && type !== "studio" && type !== "maintenance" && t.categoryCode === "BM");
  return templates.filter(withAddons);
}

/** Returns the first dependency cycle found as [a, …, a], or null. */
export function findDependencyCycle(tasks: { code: string; dependsOn: string[] }[]): string[] | null {
  const graph = new Map(tasks.map((t) => [t.code, t.dependsOn]));
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (u: string): string[] | null => {
    state.set(u, 1);
    stack.push(u);
    for (const v of graph.get(u) ?? []) {
      if (!graph.has(v)) continue;
      if (state.get(v) === 1) return [...stack.slice(stack.indexOf(v)), v];
      if (!state.has(v)) {
        const found = visit(v);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(u, 2);
    return null;
  };
  for (const t of tasks) {
    if (!state.has(t.code)) {
      const found = visit(t.code);
      if (found) return found;
    }
  }
  return null;
}
