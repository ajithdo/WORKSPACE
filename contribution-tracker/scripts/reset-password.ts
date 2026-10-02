/**
 * Forgotten password: run on the server, then hand the printed one-time password to the partner.
 * Usage: DATA_DIR=./data npm run reset-password -- partner@example.com
 * With Docker, run it on the host from this folder; ./data is the same folder the container uses.
 */
import { getDb } from "@/db";
import { resetPassword } from "@/server/auth";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run reset-password -- <email>");
  process.exit(1);
}
const { name, temporaryPassword } = resetPassword(getDb(), new Date(), email);
console.log(`${name} can now sign in with this one-time password and will be asked to change it:\n\n  ${temporaryPassword}\n`);
console.log("All of their sessions were signed out. The reset is recorded in the audit log.");
