import fs from "node:fs";
import { getDb } from "@/db";
import { currentMember } from "@/lib/session";
import { isProjectMember } from "@/server/queries";
import { fileRow, storedFilePath } from "@/server/files";

const INLINE = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/;

export async function GET(_req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const member = await currentMember();
  if (!member) return new Response("Sign in first", { status: 401 });
  const db = getDb();
  let f;
  try {
    f = fileRow(db, Number((await params).fileId));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (f.projectId !== null && !isProjectMember(db, f.projectId, member.id)) return new Response("Not allowed", { status: 403 });
  let path: string;
  try {
    path = storedFilePath(f);
  } catch {
    return new Response("The stored file is missing", { status: 410 });
  }
  const body = fs.readFileSync(path);
  const disposition = INLINE.test(f.mime) ? "inline" : "attachment";
  return new Response(body, {
    headers: {
      "Content-Type": INLINE.test(f.mime) ? f.mime : "application/octet-stream",
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, max-age=0, no-store",
      "X-File-SHA256": f.sha256,
    },
  });
}
