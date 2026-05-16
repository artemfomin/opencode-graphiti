import { Database } from "bun:sqlite";

const db = new Database(process.argv[2], { readonly: true });

console.log("--- part schema ---");
const partSql = db.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='part'").get() as { sql: string };
console.log(partSql.sql);

console.log("\n--- message schema ---");
const msgSql = db.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='message'").get() as { sql: string };
console.log(msgSql.sql);

console.log("\n--- part columns ---");
const partCols = db.query("PRAGMA table_info('part')").all() as { name: string; type: string }[];
for (const c of partCols) console.log(`  ${c.name}  ${c.type}`);

console.log("\n--- legacy part rows by id LIKE 'graphiti-%' ---");
const legacyParts = db
  .query("SELECT * FROM part WHERE id LIKE 'graphiti-%' OR id NOT LIKE 'prt_%' LIMIT 50")
  .all() as Record<string, unknown>[];
console.log(`  count: ${legacyParts.length}`);
for (const row of legacyParts.slice(0, 20)) {
  const summary: Record<string, unknown> = {};
  for (const k of Object.keys(row)) {
    const v = row[k];
    summary[k] = typeof v === "string" && v.length > 80 ? v.slice(0, 80) + "…" : v;
  }
  console.log("  " + JSON.stringify(summary));
}

console.log("\n--- count by id-prefix in part ---");
const prefixCounts = db
  .query(
    `SELECT
       CASE
         WHEN id LIKE 'prt_%' THEN 'prt_'
         WHEN id LIKE 'graphiti-nudge-%' THEN 'graphiti-nudge-'
         WHEN id LIKE 'graphiti-context-%' THEN 'graphiti-context-'
         WHEN id LIKE 'graphiti-%' THEN 'graphiti-other'
         ELSE 'other'
       END AS prefix,
       COUNT(*) AS n
     FROM part
     GROUP BY prefix
     ORDER BY n DESC`
  )
  .all();
for (const r of prefixCounts) console.log("  " + JSON.stringify(r));
