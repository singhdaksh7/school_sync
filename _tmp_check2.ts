import "dotenv/config";
import { PrismaClient } from "./src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const total = await prisma.student.count();
  const withAdm = await prisma.student.count({ where: { admissionNo: { not: null } } });
  const withFatherHash = await prisma.student.count({ where: { fatherPhoneHash: { not: null } } });
  const withMotherHash = await prisma.student.count({ where: { motherPhoneHash: { not: null } } });
  console.log({ total, withAdm, withFatherHash, withMotherHash });

  const sample = await prisma.student.findMany({ where: { admissionNo: { not: null } }, select: { id: true, name: true, admissionNo: true, fatherPhone: true, fatherPhoneHash: true, motherPhone: true, motherPhoneHash: true, schoolId: true, section: { select: { id: true, name: true, class: { select: { name: true } } } } }, take: 5 });
  console.log("WITH ADM:", JSON.stringify(sample, null, 2));

  await pool.end();
}
main();
