import { parseOwnerRoles } from "./library";

export interface Assignment {
  ownerMemberId: number;
  sharesBp: Record<number, number>;
}

/** Splits 10000 basis points equally; the remainder goes to the first members so the sum is exact. */
export function equalSharesBp(memberIds: number[]): Record<number, number> {
  const base = Math.floor(10000 / memberIds.length);
  let rem = 10000 - base * memberIds.length;
  const out: Record<number, number> = {};
  for (const id of memberIds) {
    out[id] = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem -= 1;
  }
  return out;
}

/**
 * Suggests an owner for each task from the library's default owner role and each member's roles,
 * balancing points so neither partner gets every unmatched task. "(both)" tasks are split equally.
 */
export function suggestAssignments(
  tasks: { code: string; defaultOwnerRole: string; points: number }[],
  members: { id: number; roles: string[] }[],
): Map<string, Assignment> {
  const out = new Map<string, Assignment>();
  if (members.length === 0) return out;
  const load = new Map(members.map((m) => [m.id, 0]));
  const least = (candidates: { id: number }[]) =>
    candidates.reduce((best, m) => ((load.get(m.id) ?? 0) < (load.get(best.id) ?? 0) ? m : best), candidates[0] as { id: number });

  for (const t of tasks) {
    const { roles, both } = parseOwnerRoles(t.defaultOwnerRole);
    if (both) {
      const ids = members.map((m) => m.id);
      for (const id of ids) load.set(id, (load.get(id) ?? 0) + t.points / ids.length);
      out.set(t.code, { ownerMemberId: ids[0] as number, sharesBp: equalSharesBp(ids) });
      continue;
    }
    let candidates: { id: number }[] = [];
    for (const role of roles) {
      if (role === "Client" || role === "Either") continue;
      candidates = members.filter((m) => m.roles.includes(role));
      if (candidates.length > 0) break;
    }
    if (candidates.length === 0) candidates = members;
    const owner = least(candidates);
    load.set(owner.id, (load.get(owner.id) ?? 0) + t.points);
    out.set(t.code, { ownerMemberId: owner.id, sharesBp: { [owner.id]: 10000 } });
  }
  return out;
}
