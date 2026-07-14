import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Managed Postgres (Neon, RDS, etc.) always requires SSL and is never
// reachable at localhost/127.0.0.1 — but a genuinely local Postgres
// instance (local dev, disposable test DB) has no SSL listener at all, so
// forcing SSL unconditionally makes this client unusable against one.
//
// node-postgres parses sslmode/sslrootcert/etc. out of the connection
// string itself, and that parsed SSL configuration REPLACES (not merges
// with) whatever `ssl` option is passed to `new Pool()` — see
// https://node-postgres.com/features/ssl and pg-connection-string's
// parse(). So for the non-local case, this returns `undefined` (no `ssl`
// key at all): TLS behavior is controlled entirely by DATABASE_URL's own
// `sslmode=verify-full` (see infra/terraform/secrets.tf), which performs
// full certificate-chain AND hostname verification against the AWS RDS CA
// trusted via NODE_EXTRA_CA_CERTS (certs/aws-rds-global-bundle.pem). For
// localhost, the connection string has no sslmode param to conflict with,
// so the explicit `ssl: false` returned here is what actually takes effect.
export function resolveDatabaseSsl(connectionString: string): false | undefined {
  const isLocalHost = ["localhost", "127.0.0.1"].includes(new URL(connectionString).hostname);
  return isLocalHost ? false : undefined;
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const ssl = resolveDatabaseSsl(connectionString);
  const pool = new Pool({
    connectionString,
    ...(ssl === undefined ? {} : { ssl }),
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
