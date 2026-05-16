import { Database } from "bun:sqlite";

const db = new Database(process.argv[2], { readonly: true });

console.log("--- graphiti-* part rows ---");
const grows = db
  .query("SELECT id, message_id, session_id, time_created, length(data) AS data_len FROM part WHERE id LIKE 'graphiti-%'")
  .all() as Record<string, unknown>[];
for (const r of grows) console.log("  " + JSON.stringify(r));

console.log("\n--- part_ (legacy non-prt_) sample ---");
const prows = db
  .query("SELECT id, message_id, session_id, time_created FROM part WHERE id NOT LIKE 'prt_%' AND id NOT LIKE 'graphiti-%' LIMIT 5")
  .all() as Record<string, unknown>[];
for (const r of prows) console.log("  " + JSON.stringify(r));

console.log("\n--- distinct session_ids that own graphiti-* parts ---");
const sess = db
  .query("SELECT DISTINCT session_id FROM part WHERE id LIKE 'graphiti-%'")
  .all() as { session_id: string }[];
for (const s of sess) console.log("  " + s.session_id);

console.log("\n--- session_message rows that contain a legacy id in JSON ---");
const sm = db
  .query(
    "SELECT id, session_id, type, length(data) AS data_len FROM session_message WHERE data LIKE '%graphiti-context-1778834514711%' OR data LIKE '%graphiti-nudge-%'"
  )
  .all() as Record<string, unknown>[];
console.log(`  count: ${sm.length}`);
for (const r of sm.slice(0, 5)) console.log("  " + JSON.stringify(r));
