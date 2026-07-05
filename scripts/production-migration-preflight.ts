/**
 * Read-only preflight check for a production (or production-like) database,
 * to be run manually immediately before `npx prisma migrate deploy` against
 * a real target — see docs/production-database-migration-readiness.md §4.
 *
 * This script NEVER runs DDL, NEVER runs `migrate deploy`/`db push`, and
 * NEVER embeds a connection string. It prints counts, booleans, and
 * enum-like values only — never row content, connection strings, or
 * credentials.
 *
 * DELIBERATELY DOES NOT `import "dotenv/config"`. Every other script in this
 * repository auto-loads `.env` for convenience; this one does not, on
 * purpose — its entire point is to run against a REAL target the operator
 * explicitly chose, and silently falling back to whatever `.env` happens to
 * contain (which in this repository is live Neon) is exactly the failure
 * mode this script exists to prevent. It reads ONLY `process.env` as set by
 * the invoking shell.
 *
 * Requires explicit env vars, not just "a DATABASE_URL happens to be set":
 *   DATABASE_URL, DIRECT_URL       — both required, no fallback between them
 *   CONFIRM_PRODUCTION_TARGET=true — explicit human confirmation this is the
 *                                    intended real target (mirrors the
 *                                    ALLOW_PILOT_SEED pattern in reverse)
 *
 *   DATABASE_URL="<real pooled url>" DIRECT_URL="<real direct url>" CONFIRM_PRODUCTION_TARGET=true npx tsx scripts/production-migration-preflight.ts
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readdirSync } from "node:fs";
import { join } from "node:path";

function requireExplicitTarget(): { databaseUrl: string; directUrl: string } {
  if (process.env.CONFIRM_PRODUCTION_TARGET !== "true") {
    throw new Error(
      "Refusing to run: set CONFIRM_PRODUCTION_TARGET=true to explicitly confirm you have chosen this target on purpose. " +
        "This script does not read .env — DATABASE_URL/DIRECT_URL must be exported explicitly in the same command."
    );
  }
  const databaseUrl = process.env.DATABASE_URL;
  const directUrl = process.env.DIRECT_URL;
  if (!databaseUrl) throw new Error("Refusing to run: DATABASE_URL is not set (this script does not read .env — export it explicitly).");
  if (!directUrl) throw new Error("Refusing to run: DIRECT_URL is not set (this script does not read .env — export it explicitly).");

  let dbHost: string, directHost: string;
  try {
    dbHost = new URL(databaseUrl).hostname.toLowerCase();
    directHost = new URL(directUrl).hostname.toLowerCase();
  } catch {
    throw new Error("DATABASE_URL or DIRECT_URL is not a valid connection URL.");
  }
  console.log(`Target confirmed by operator — DATABASE_URL host: ${dbHost}, DIRECT_URL host: ${directHost}`);
  return { databaseUrl, directUrl };
}

function localMigrationNames(): string[] {
  const dir = join(process.cwd(), "prisma", "migrations");
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

async function main() {
  const { directUrl } = requireExplicitTarget();

  const pool = new Pool({ connectionString: directUrl, ssl: { rejectUnauthorized: false } });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    console.log("=== Production migration preflight (read-only) ===");

    const applied = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name
    `.catch(() => {
      console.log("(no _prisma_migrations table found — this looks like a never-migrated database)");
      return [] as Array<{ migration_name: string }>;
    });
    const appliedNames = new Set(applied.map((r) => r.migration_name));
    const local = localMigrationNames();
    const pending = local.filter((name) => !appliedNames.has(name));

    console.log(`Local migrations on disk: ${local.length}`);
    console.log(`Applied on target: ${appliedNames.size}`);
    console.log(`Pending (would be applied by "migrate deploy"): ${pending.length}`);
    if (pending.length > 0) {
      console.log("  " + pending.join("\n  "));
    }

    const unknownOnTarget = [...appliedNames].filter((name) => !local.includes(name));
    if (unknownOnTarget.length > 0) {
      console.log(
        `WARNING: target has ${unknownOnTarget.length} applied migration(s) not present in this checkout's prisma/migrations/ folder — you may be on the wrong branch/commit:`
      );
      console.log("  " + unknownOnTarget.join("\n  "));
    }

    const dedupIndex = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_indexes WHERE tablename = 'BackgroundJob' AND indexname = 'BackgroundJob_active_dedup_key'
      ) AS exists
    `;
    console.log(`BackgroundJob_active_dedup_key partial unique index present: ${dedupIndex[0]?.exists ?? false}`);

    const [schoolCount, studentCount, teacherCount] = await Promise.all([
      prisma.school.count().catch(() => null),
      prisma.student.count().catch(() => null),
      prisma.teacher.count().catch(() => null),
    ]);
    console.log(`Row counts — School: ${schoolCount ?? "N/A"}, Student: ${studentCount ?? "N/A"}, Teacher: ${teacherCount ?? "N/A"}`);

    if (pending.length === 0 && unknownOnTarget.length === 0) {
      console.log("\nRESULT: target is fully up to date with this checkout's migration history.");
    } else {
      console.log("\nRESULT: review the pending/unknown migrations above before running `prisma migrate deploy`.");
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[production-migration-preflight] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
