import type Database from "better-sqlite3";

/*
 * Database-level guarantees for principle 5 ("nothing is deleted or edited after lock").
 * The service layer already checks these rules; the triggers make them hold even for a
 * buggy code path or someone editing the SQLite file by hand.
 */

const CLOSED = (projectExpr: string) => `(SELECT close_status FROM projects WHERE id = ${projectExpr}) = 'closed_locked'`;
const abort = (msg: string) => `BEGIN SELECT RAISE(ABORT, '${msg}'); END`;

/** Tables whose rows belong to a project directly (project_id) and freeze when it closes. */
const DIRECT = [
  "task_instances",
  "evidence",
  "communications",
  "change_requests",
  "invoices",
  "payments",
  "expenses",
  "disputes",
  "adjustment_requests",
  "handover_items",
];

/** Tables that reach their project through a parent row. */
const VIA_PARENT: { table: string; project: (row: "NEW" | "OLD") => string }[] = [
  { table: "task_contributions", project: (r) => `(SELECT project_id FROM task_instances WHERE id = ${r}.task_instance_id)` },
  { table: "client_approvals", project: (r) => `(SELECT project_id FROM task_instances WHERE id = ${r}.task_instance_id)` },
  { table: "time_entries", project: (r) => `(SELECT project_id FROM task_instances WHERE id = ${r}.task_instance_id)` },
  { table: "action_items", project: (r) => `(SELECT project_id FROM communications WHERE id = ${r}.communication_id)` },
  { table: "dispute_comments", project: (r) => `(SELECT project_id FROM disputes WHERE id = ${r}.dispute_id)` },
];

export function triggerStatements(): string[] {
  const s: string[] = [
    `CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log ${abort("audit_log is append-only")}`,
    `CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log ${abort("audit_log is append-only")}`,
    `CREATE TRIGGER IF NOT EXISTS task_locked_no_update BEFORE UPDATE ON task_instances WHEN OLD.status = 'locked' ${abort("a locked task cannot be changed")}`,
    `CREATE TRIGGER IF NOT EXISTS task_delete_only_draft BEFORE DELETE ON task_instances WHEN OLD.status <> 'planned' OR (SELECT plan_status FROM projects WHERE id = OLD.project_id) = 'locked' ${abort("tasks can only be removed from a draft plan")}`,
    `CREATE TRIGGER IF NOT EXISTS snapshot_locked_no_update BEFORE UPDATE ON contribution_snapshots WHEN OLD.status = 'locked' ${abort("a locked snapshot cannot be changed")}`,
    `CREATE TRIGGER IF NOT EXISTS snapshot_no_delete BEFORE DELETE ON contribution_snapshots ${abort("snapshots cannot be deleted")}`,
    `CREATE TRIGGER IF NOT EXISTS evidence_no_delete BEFORE DELETE ON evidence ${abort("evidence cannot be deleted")}`,
    `CREATE TRIGGER IF NOT EXISTS evidence_content_frozen BEFORE UPDATE OF type, url, file_id, external_ref, description, sha256, captured_at, submission_round, subject_type, subject_id ON evidence ${abort("evidence content cannot be edited; add a new item instead")}`,
    `CREATE TRIGGER IF NOT EXISTS distribution_no_delete BEFORE DELETE ON distributions ${abort("distributions cannot be deleted")}`,
    `CREATE TRIGGER IF NOT EXISTS project_no_delete BEFORE DELETE ON projects ${abort("projects cannot be deleted")}`,
    `CREATE TRIGGER IF NOT EXISTS project_locked_no_update BEFORE UPDATE ON projects WHEN OLD.close_status = 'closed_locked' ${abort("project is closed and locked")}`,
  ];
  for (const t of DIRECT) {
    s.push(`CREATE TRIGGER IF NOT EXISTS ${t}_closed_no_insert BEFORE INSERT ON ${t} WHEN ${CLOSED("NEW.project_id")} ${abort("project is closed and locked")}`);
    s.push(`CREATE TRIGGER IF NOT EXISTS ${t}_closed_no_update BEFORE UPDATE ON ${t} WHEN ${CLOSED("OLD.project_id")} ${abort("project is closed and locked")}`);
    s.push(`CREATE TRIGGER IF NOT EXISTS ${t}_closed_no_delete BEFORE DELETE ON ${t} WHEN ${CLOSED("OLD.project_id")} ${abort("project is closed and locked")}`);
  }
  for (const { table, project } of VIA_PARENT) {
    s.push(`CREATE TRIGGER IF NOT EXISTS ${table}_closed_no_insert BEFORE INSERT ON ${table} WHEN ${CLOSED(project("NEW"))} ${abort("project is closed and locked")}`);
    s.push(`CREATE TRIGGER IF NOT EXISTS ${table}_closed_no_update BEFORE UPDATE ON ${table} WHEN ${CLOSED(project("OLD"))} ${abort("project is closed and locked")}`);
    s.push(`CREATE TRIGGER IF NOT EXISTS ${table}_closed_no_delete BEFORE DELETE ON ${table} WHEN ${CLOSED(project("OLD"))} ${abort("project is closed and locked")}`);
  }
  return s;
}

export function ensureTriggers(sqlite: Database.Database): void {
  sqlite.transaction(() => {
    for (const stmt of triggerStatements()) sqlite.exec(stmt);
  })();
}
