"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { OWNER_ROLES } from "@/domain/types";
import { errorMessage, type ActionState } from "@/lib/actions";
import { bool, str } from "@/lib/form";
import { cookieSecure, SESSION_COOKIE } from "@/lib/session";
import { login, logout, setupStudio } from "@/server/auth";

async function startSession(email: string, password: string) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
  const s = login(getDb(), new Date(), { email, password, ip, userAgent: h.get("user-agent") ?? undefined });
  (await cookies()).set(SESSION_COOKIE, s.token, { httpOnly: true, sameSite: "lax", secure: cookieSecure(), path: "/", expires: new Date(s.expiresAt) });
}

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await startSession(str(fd, "email"), String(fd.get("password") ?? ""));
  } catch (e) {
    return { ok: false, error: errorMessage(e), at: Date.now() };
  }
  const next = str(fd, "next");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logoutAction() {
  const jar = await cookies();
  logout(getDb(), jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

export async function setupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const partner = (n: 1 | 2) => ({
    name: str(fd, `p${n}_name`),
    email: str(fd, `p${n}_email`),
    password: String(fd.get(`p${n}_password`) ?? ""),
    roles: OWNER_ROLES.filter((r) => r !== "Either" && r !== "Client" && bool(fd, `p${n}_role_${r}`)),
  });
  const first = partner(1);
  try {
    setupStudio(getDb(), new Date(), {
      studio: {
        name: str(fd, "studio_name"),
        legalName: str(fd, "legal_name"),
        stateCode: str(fd, "state_code"),
        gstin: str(fd, "gstin"),
        gstRegistered: bool(fd, "gst_registered"),
        msmeRegistered: bool(fd, "msme_registered"),
      },
      members: [first, partner(2)],
    });
    await startSession(first.email, first.password);
  } catch (e) {
    return { ok: false, error: errorMessage(e), at: Date.now() };
  }
  redirect("/");
}
