import "dotenv/config";
import { PrismaClient } from "./src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const schools = await prisma.school.findMany({
    where: { slug: { in: ["qa-alpha-school-1782199794272", "qa-beta-school-1782199794272"] } },
    include: { students: { select: { id: true, name: true, admissionNo: true, rollNo: true, fatherPhone: true, motherPhone: true } } },
  });
  console.log(JSON.stringify(schools, null, 2));
  await pool.end();
}
main();
