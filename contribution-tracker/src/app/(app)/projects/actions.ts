"use server";

import { redirect } from "next/navigation";
import { errorMessage, type ActionState } from "@/lib/actions";
import { bool, optInt, optMoney, optStr, str } from "@/lib/form";
import { requestCtx } from "@/lib/session";
import { createProject } from "@/server/projects";
import type { ProjectKind, ProjectType } from "@/domain/types";

export async function createProjectAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let id: number;
  try {
    const ctx = await requestCtx();
    const type = str(fd, "project_type") as ProjectType;
    const kind: ProjectKind = type === "studio" ? "studio" : type === "maintenance" ? "maintenance" : "client";
    const clientChoice = str(fd, "client_id");
    const originated = str(fd, "originated_by");
    id = createProject(ctx, {
      name: str(fd, "name"),
      kind,
      projectType: type,
      multilingual: bool(fd, "multilingual"),
      clientId: clientChoice && clientChoice !== "new" ? Number(clientChoice) : null,
      newClient:
        kind === "client" && (!clientChoice || clientChoice === "new")
          ? { businessName: str(fd, "client_name"), stateCode: str(fd, "client_state"), gstin: str(fd, "client_gstin"), contactName: str(fd, "client_contact"), contactEmail: str(fd, "client_email"), contactPhone: str(fd, "client_phone"), address: str(fd, "client_address") }
          : null,
      originatedBy: originated ? Number(originated) : null,
      quotedAmountExGst: optMoney(fd, "quoted", "Quoted amount"),
      startDate: optStr(fd, "start_date"),
      targetLaunchDate: optStr(fd, "target_launch_date"),
      deemedAcceptanceClause: bool(fd, "deemed_clause"),
      deemedAcceptanceDays: optInt(fd, "deemed_days", "Deemed acceptance days"),
    }).projectId;
  } catch (e) {
    return { ok: false, error: errorMessage(e), at: Date.now() };
  }
  redirect(`/projects/${id}/plan`);
}
