#!/usr/bin/env node
/**
 * Export the store-metrics tables as loadable .sql files, one per table.
 *
 * For handing the data to somebody who wants it in their own Postgres rather
 * than through the dashboard. Written against @supabase/supabase-js because
 * the project already depends on it, which means this runs without installing
 * pg_dump or the Supabase CLI.
 *
 * Three things it does on purpose:
 *
 * Filenames are numbered, and the number is the load order rather than
 * decoration. Every table here keys to apps by app_id, so apps must land
 * first; running the files in name order is the whole instruction, and there
 * is nothing else to get right.
 *
 * Each file stands alone, wrapped in its own transaction. One table failing to
 * load leaves the others untouched and the failed one empty rather than half
 * written, which is what makes it safe to retry a single file.
 *
 * The table list is explicit rather than "everything in public". A blanket
 * dump of this database would also hand over revenue_daily, which is the
 * company's takings, and the tutor_* tables, which belong to another team.
 * Deciding what to share should be a line in a file somebody can read, not a
 * flag somebody forgot.
 *
 * Usage:
 *   node scripts/export-sql.mjs                  # every table below
 *   node scripts/export-sql.mjs chart_ranks apps # only these
 *   OUT_DIR=share node scripts/export-sql.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Load order, which is also foreign-key order: apps before anything that points at it. */
const TABLES = [
  "apps",
  "ios_downloads_daily",
  "ios_discovery_daily",
  "metric_snapshots",
  "social_snapshots",
  "chart_ranks",
  "chart_apps",
  "keyword_ranks",
  "active_users_daily",
  "app_engagement_daily",
];

/** Supabase caps a single response; anything larger has to be walked. */
const PAGE = 1000;

function env() {
  // Read the file rather than the process environment: this is a standalone
  // script, not something Next has already loaded .env.local for.
  const raw = readFileSync(".env.local", "utf8");
  const read = (key) =>
    raw
      .split("\n")
      .find((line) => line.startsWith(`${key}=`))
      ?.slice(key.length + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

  const url = read("NEXT_PUBLIC_SUPABASE_URL");
  const key = read("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in .env.local");
  }
  return { url, key };
}

/**
 * One value, as Postgres will read it back.
 *
 * Everything non-null is emitted as a quoted literal and left to Postgres to
 * cast on the way in, which is what keeps this short: a column knows its own
 * type, and '42' lands in an integer column as 42. Objects and arrays are
 * serialised as JSON, which is the literal form jsonb and text[] both accept.
 *
 * The apostrophe doubling is the line that matters. Several tracked keywords
 * are Uzbek words spelled with one, and without this every row carrying a
 * ta'lim would end the string early and take the statement with it.
 */
function literal(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";

  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `'${text.replace(/'/g, "''")}'`;
}

async function dump(client, table) {
  const lines = [];
  let from = 0;
  let columns = null;
  let total = 0;

  for (;;) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;

    columns ??= Object.keys(data[0]);

    for (const row of data) {
      const values = columns.map((column) => literal(row[column])).join(", ");
      lines.push(`INSERT INTO public.${table} (${columns.join(", ")}) VALUES (${values});`);
    }

    total += data.length;
    from += PAGE;
    if (data.length < PAGE) break;
  }

  return { lines, total };
}

const only = process.argv.slice(2);
const wanted = only.length > 0 ? TABLES.filter((t) => only.includes(t)) : TABLES;
if (wanted.length === 0) {
  console.error(`No known table in: ${only.join(", ")}\nKnown: ${TABLES.join(", ")}`);
  process.exit(1);
}

const { url, key } = env();
const client = createClient(url, key, { auth: { persistSession: false } });

const dir = process.env.OUT_DIR ?? "exports";
mkdirSync(dir, { recursive: true });

const written = [];
let grand = 0;

for (const table of wanted) {
  // Numbered by position in the canonical list, not in the requested subset,
  // so a partial export still carries numbers that agree with a full one.
  const order = String(TABLES.indexOf(table) + 1).padStart(2, "0");
  const name = `${order}_${table}.sql`;

  process.stderr.write(`${name} ... `);
  const { lines, total } = await dump(client, table);
  grand += total;

  const body = [
    `-- ${table}: ${total} rows`,
    "--",
    "-- Data only. The table must already exist; the schema lives in",
    "-- supabase/migrations. Load these files in filename order, because every",
    "-- table here references apps by app_id.",
    "",
    "BEGIN;",
    "",
    ...lines,
    "",
    "COMMIT;",
    "",
  ].join("\n");

  writeFileSync(join(dir, name), body, "utf8");
  written.push({ name, total });
  process.stderr.write(`${total} rows\n`);
}

// A loader, so nobody has to work out the order from the numbers.
const runner = [
  "-- Loads every table in this directory, in foreign-key order.",
  "-- Run from inside the directory:  psql \"$DB_URL\" -f load-all.sql",
  "",
  ...written.map((file) => `\\i ${file.name}`),
  "",
].join("\n");
writeFileSync(join(dir, "load-all.sql"), runner, "utf8");

process.stderr.write(`\n${dir}/\n`);
for (const file of written) {
  process.stderr.write(`  ${file.name.padEnd(32)} ${String(file.total).padStart(6)} rows\n`);
}
process.stderr.write(`  load-all.sql\n\n${grand} rows across ${written.length} files\n`);
