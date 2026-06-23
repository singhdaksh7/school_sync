import "dotenv/config";
import { PrismaClient } from "./src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const schools = await prisma.school.findMany({
    where: { OR: [{ slug: { startsWith: "qa-alpha-school-" } }, { slug: { startsWith: "qa-beta-school-" } }] },
    select: { id: true, slug: true, ownerId: true },
  });
  console.log(`Found ${schools.length} test schools to remove.`);

  for (const school of schools) {
    await prisma.school.delete({ where: { id: school.id } });
    await prisma.user.delete({ where: { id: school.ownerId } }).catch(() => {});
    console.log(`  removed ${school.slug}`);
  }

  const orphanOwners = await prisma.user.findMany({
    where: { email: { contains: "qa-owner-" } },
    select: { id: true, email: true },
  });
  for (const o of orphanOwners) {
    await prisma.user.delete({ where: { id: o.id } }).catch(() => {});
    console.log(`  removed orphan owner ${o.email}`);
  }

  await pool.end();
}
main();
