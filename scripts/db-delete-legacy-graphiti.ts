/**
 * Delete legacy `graphiti-*` rows from opencode.db `part` table.
 *
 * Safe by design:
 *   - SELECT first, log every row that will be deleted (id + session_id + ts).
 *   - DELETE only rows whose id LIKE 'graphiti-%'. Never touches `prt_*` or
 *     the historical `part_*` rows.
 *   - Refuses to run unless --apply is passed (dry-run by default).
 *   - Uses bun:sqlite in default (read-write) mode, which opens the DB with
 *     WAL allowed, so this can coexist with a running opencode process.
 *
 * Usage:
 *   bun run scripts/db-delete-legacy-graphiti.ts <db-path>            # dry-run
 *   bun run scripts/db-delete-legacy-graphiti.ts <db-path> --apply    # delete
 */
import { Database } from "bun:sqlite";

const dbPath = process.argv[2];
const apply = process.argv.includes("--apply");

if (!dbPath) {
  console.error("usage: bun run db-delete-legacy-graphiti.ts <db-path> [--apply]");
  process.exit(2);
}

const db = new Database(dbPath);
// Best-effort: ensure WAL mode and reasonable busy timeout so we can write
// alongside a running opencode (which keeps the DB open in WAL).
try {
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");
} catch (e) {
  console.warn("PRAGMA setup failed (continuing):", e);
}

const targets = db
  .query(
    "SELECT id, message_id, session_id, time_created FROM part WHERE id LIKE 'graphiti-%'"
  )
  .all() as { id: string; message_id: string; session_id: string; time_created: number }[];

console.log(`Found ${targets.length} legacy graphiti-* part row(s):`);
for (const t of targets) {
  console.log(
    `  id=${t.id}  msg=${t.message_id}  session=${t.session_id}  ts=${new Date(t.time_created).toISOString()}`
  );
}

if (targets.length === 0) {
  console.log("Nothing to delete. Exiting.");
  process.exit(0);
}

// Safety guard: detect any unexpected id shapes before deletion.
for (const t of targets) {
  if (!t.id.startsWith("graphiti-")) {
    console.error(`ABORT: target row id ${t.id} does not start with 'graphiti-' — refusing to delete`);
    process.exit(1);
  }
}

if (!apply) {
  console.log("");
  console.log("Dry-run. Re-run with --apply to actually delete the rows.");
  process.exit(0);
}

console.log("\nDeleting...");
const stmt = db.prepare("DELETE FROM part WHERE id = ?");
const tx = db.transaction((rows: typeof targets) => {
  let n = 0;
  for (const r of rows) {
    const info = stmt.run(r.id);
    n += info.changes;
  }
  return n;
});

try {
  const deleted = tx(targets);
  console.log(`Deleted ${deleted} row(s).`);
} catch (e) {
  console.error("DELETE failed:", e);
  process.exit(1);
}

// Verify
const remaining = db
  .query("SELECT COUNT(*) AS n FROM part WHERE id LIKE 'graphiti-%'")
  .get() as { n: number };
console.log(`Remaining graphiti-* rows: ${remaining.n}`);
