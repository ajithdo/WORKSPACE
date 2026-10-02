/** Re-walks the hash-chained audit log and exits non-zero if any entry was altered. Usage: npm run verify:audit */
import { getDb } from "@/db";
import { verifyAuditChain } from "@/server/audit";

const check = verifyAuditChain(getDb());
if (check.ok) {
  console.log(`Audit log intact: ${check.count} entries.`);
} else {
  console.error(`Audit log BROKEN at entry ${check.firstBrokenId}: ${check.reason} (${check.count} entries).`);
  process.exit(1);
}
