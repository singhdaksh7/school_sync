import "dotenv/config";
import { PrismaClient } from "./src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const users = await prisma.user.findMany({ select: { id: true, email: true, role: true, schoolId: true, ownedSchool: { select: { slug: true } } }, take: 20 });
  console.log("USERS:", JSON.stringify(users, null, 2));

  const schools = await prisma.school.findMany({ select: { id: true, name: true, slug: true } });
  console.log("SCHOOLS:", JSON.stringify(schools, null, 2));

  const sections = await prisma.section.findMany({ select: { id: true, name: true, class: { select: { name: true, schoolId: true } } }, take: 10 });
  console.log("SECTIONS:", JSON.stringify(sections, null, 2));

  const students = await prisma.student.findMany({ select: { id: true, name: true, admissionNo: true, fatherPhone: true, motherPhone: true, schoolId: true }, take: 10 });
  console.log("STUDENTS:", JSON.stringify(students, null, 2));

  await pool.end();
}

main();
