// npm start: runs the standalone server with DATA_DIR resolved against this folder
// (server.js changes into its own directory, so a relative ./data would land inside .next).
import path from "node:path";
import { pathToFileURL } from "node:url";

process.env.DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
process.env.PORT ??= "3000";
await import(pathToFileURL(path.resolve(".next/standalone/server.js")).href);
