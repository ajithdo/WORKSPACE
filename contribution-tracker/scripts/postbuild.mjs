// Makes .next/standalone a complete, runnable app (as the Docker image does):
// static assets, migrations and the seed library sit next to server.js.
import fs from "node:fs";
import path from "node:path";

const out = path.join(".next", "standalone");
if (!fs.existsSync(path.join(out, "server.js"))) process.exit(0);
const copy = (from, to) => fs.cpSync(from, path.join(out, to), { recursive: true });
copy(path.join(".next", "static"), path.join(".next", "static"));
copy("drizzle", "drizzle");
copy("seed", "seed");
console.log("standalone app ready in .next/standalone");
