import { Database } from "bun:sqlite";

const db = new Database(process.argv[2], { readonly: true });

console.log("--- tables ---");
const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
for (const t of tables) console.log("  " + t.name);

console.log("");
console.log("--- schemas ---");
const schemas = db
  .query("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all() as { name: string; sql: string }[];
for (const s of schemas) {
  console.log(`\n# ${s.name}`);
  console.log(s.sql);
}
