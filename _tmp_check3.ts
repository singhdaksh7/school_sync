import "dotenv/config";
import { PrismaClient } from "./src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const school = await prisma.school.findFirst({ where: { slug: "qa-alpha-school-1782199509561" }, include: { classes: { include: { sections: true } } } });
  console.log(JSON.stringify(school, null, 2));
  await pool.end();
}
main();
