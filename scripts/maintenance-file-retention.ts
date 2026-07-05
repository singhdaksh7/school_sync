/**
 * CLI equivalent of the internal maintenance endpoint (PART 21) — ensures
 * exactly one active FILE_RETENTION_CLEANUP job exists, then exits. Does NOT
 * run the job itself; the existing worker (scripts/worker.ts / the internal
 * worker endpoint) claims and processes it as usual.
 *
 *   npm run maintenance:file-retention
 */
import "dotenv/config";
import { ensureFileRetentionCleanupJob } from "../src/lib/file-retention";

async function main() {
  const { jobId, created } = await ensureFileRetentionCleanupJob("CLI");
  console.log(`[maintenance:file-retention] ${created ? "created" : "reused existing"} cleanup job ${jobId}`);
}

main().catch((err) => {
  console.error("[maintenance:file-retention] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
