/**
 * CLI equivalent of the internal school-purge maintenance endpoint — ensures
 * exactly one active SCHOOL_DATA_PURGE job exists for every school whose
 * retention window has elapsed (or whose previous purge attempt failed).
 * Does NOT run the job itself; the existing worker (scripts/worker.ts / the
 * internal worker endpoint) claims and processes it as usual.
 *
 *   npm run maintenance:school-purge
 */
import "dotenv/config";
import { ensureDueSchoolPurgeJobs } from "../src/lib/school-deletion";

async function main() {
  const { schoolIds, created, reused } = await ensureDueSchoolPurgeJobs();
  console.log(`[maintenance:school-purge] due=${schoolIds.length} created=${created} reused=${reused}`);
}

main().catch((err) => {
  console.error("[maintenance:school-purge] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
