"use server";

import { runAction, type ActionState } from "@/lib/actions";
import { bool, money, optInt, str } from "@/lib/form";
import { DomainError } from "@/server/errors";
import { updateProjectDetails } from "@/server/projects";

const isoDate = (v: string, label: string) => {
  if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new DomainError("invalid", `${label} must be a date`);
  return v || null;
};

export async function updateDetailsAction(projectId: number, canChangeOrigin: boolean, _p: ActionState, fd: FormData) {
  return runAction((ctx) => {
    const schedule = [];
    for (let i = 0; i < 6; i++) {
      const pct = str(fd, `pct_${i}`);
      if (!pct) continue;
      const n = Number(pct);
      if (!Number.isFinite(n) || n <= 0 || n > 100) throw new DomainError("invalid", `Payment ${i + 1}: percentage must be between 0 and 100`);
      schedule.push({ milestoneCode: str(fd, `ms_${i}`), pct: n, note: str(fd, `note_${i}`) });
    }
    const origin = str(fd, "originated_by");
    updateProjectDetails(ctx, projectId, {
      name: str(fd, "name"),
      startDate: isoDate(str(fd, "start_date"), "Start date"),
      targetLaunchDate: isoDate(str(fd, "target_launch_date"), "Target launch"),
      placeOfSupplyState: str(fd, "place_of_supply"),
      quotedAmountExGst: money(fd, "quoted", "Quoted amount"),
      msmeApplicable: bool(fd, "msme"),
      deemedAcceptanceClause: bool(fd, "deemed_clause"),
      deemedAcceptanceDays: optInt(fd, "deemed_days", "Deemed acceptance days"),
      notes: str(fd, "notes"),
      ...(canChangeOrigin ? { originatedBy: origin ? Number(origin) : null } : {}),
      paymentSchedule: schedule,
    });
  }, "Project details saved");
}
