import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { moneyToNumber } from "@/lib/money";
import Anthropic from "@anthropic-ai/sdk";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { schoolLifecycleGate } from "@/lib/school-access";
import { enforceActorRateLimit, enforceSchoolRateLimit } from "@/lib/api-cost-guard";
import { subDays, startOfDay, format, differenceInDays } from "date-fns";

const CACHE_DAYS = 30;

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? new Anthropic({ apiKey }) : null;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { schoolId } = await req.json();
  if (!schoolId) return NextResponse.json({ error: "Missing schoolId" }, { status: 400 });

  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) return NextResponse.json({ error: "School not found" }, { status: 404 });

  const isOwner = school.ownerId === session.user.id;
  const isAdmin = await prisma.user.findFirst({ where: { id: session.user.id, schoolId } });
  if (!isOwner && !isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const blocked = await schoolLifecycleGate(schoolId);
  if (blocked) return blocked;
  const featureDenied = await requireSchoolFeature(schoolId, "AI_FEATURES");
  if (featureDenied) return featureDenied;

  // The school's plan may have AI_FEATURES enabled even though the platform
  // provider key isn't configured (e.g. a fresh dev/staging environment) —
  // fail clean rather than crashing on the first Anthropic API call.
  const client = getAnthropicClient();
  if (!client) {
    return NextResponse.json({ error: "AI features are not configured on this deployment" }, { status: 503 });
  }

  // Return cached result if still within 30 days
  const cached = await prisma.aIInsightCache.findUnique({ where: { schoolId } });
  if (cached) {
    const age = differenceInDays(new Date(), cached.generatedAt);
    if (age < CACHE_DAYS) {
      return NextResponse.json({
        insights: JSON.parse(cached.insights),
        generatedAt: cached.generatedAt,
        cached: true,
        daysUntilRefresh: CACHE_DAYS - age,
      });
    }
  }

  // AI quota is checked here — AFTER the cache-hit early-return above (a
  // cache hit is a cheap DB read, not a provider call, and must not consume
  // quota) but BEFORE the actual Anthropic invocation below (PART 27: rate
  // limit occurs before the expensive/billable provider call; a request that
  // reaches this point always counts, whether or not the provider call itself
  // later succeeds).
  const actorDenied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "AI_ACTOR");
  if (actorDenied) return actorDenied;
  const schoolDenied = await enforceSchoolRateLimit(schoolId, "AI_SCHOOL");
  if (schoolDenied) return schoolDenied;

  // Build context for Claude
  const today = startOfDay(new Date());
  const thirtyDaysAgo = subDays(today, 30);
  const sevenDaysAgo = subDays(today, 6);

  const [
    totalStudents,
    totalTeachers,
    last30Attendance,
    last7Attendance,
    allExamResults,
    pendingLeaves,
    feePayments,
    announcements,
  ] = await Promise.all([
    prisma.student.count({ where: { schoolId } }),
    prisma.teacher.count({ where: { schoolId } }),
    prisma.attendance.findMany({
      where: { schoolId, type: "STUDENT", date: { gte: thirtyDaysAgo, lte: today } },
      select: { date: true, status: true, sectionId: true, student: { select: { id: true, section: { select: { name: true, class: { select: { name: true } } } } } } },
    }),
    prisma.attendance.findMany({
      where: { schoolId, type: "STUDENT", date: { gte: sevenDaysAgo, lte: today } },
      select: { date: true, status: true },
    }),
    prisma.examResult.findMany({
      where: { exam: { scheme: { schoolId } } },
      select: { marks: true, exam: { select: { maxMarks: true } }, student: { select: { id: true } } },
    }),
    prisma.leaveRequest.count({ where: { schoolId, status: "PENDING" } }),
    prisma.feePayment.findMany({
      where: { schoolId, status: "PAID", paidAt: { gte: thirtyDaysAgo } },
      select: { amount: true },
    }),
    prisma.announcement.count({ where: { schoolId, publishedAt: { gte: sevenDaysAgo } } }),
  ]);

  const totalAtt = last30Attendance.length;
  const presentAtt = last30Attendance.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
  const overallAttRate = totalAtt > 0 ? Math.round((presentAtt / totalAtt) * 100) : null;

  const dailyRates: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = subDays(today, i);
    const dayStr = format(d, "yyyy-MM-dd");
    const dayRecs = last7Attendance.filter((a) => format(new Date(a.date), "yyyy-MM-dd") === dayStr);
    if (dayRecs.length > 0) {
      const p = dayRecs.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
      dailyRates.push(Math.round((p / dayRecs.length) * 100));
    }
  }

  const studentMap = new Map<string, { present: number; total: number }>();
  for (const rec of last30Attendance) {
    if (!rec.student?.id) continue;
    const e = studentMap.get(rec.student.id) || { present: 0, total: 0 };
    e.total++;
    if (rec.status === "PRESENT" || rec.status === "LATE") e.present++;
    studentMap.set(rec.student.id, e);
  }
  const atRiskCount = Array.from(studentMap.values()).filter((e) => e.total >= 5 && e.present / e.total < 0.75).length;

  const sectionMap = new Map<string, { present: number; total: number; name: string; className: string }>();
  for (const rec of last30Attendance) {
    if (!rec.sectionId || !rec.student?.section) continue;
    const e = sectionMap.get(rec.sectionId) || { present: 0, total: 0, name: rec.student.section.name, className: rec.student.section.class.name };
    e.total++;
    if (rec.status === "PRESENT" || rec.status === "LATE") e.present++;
    sectionMap.set(rec.sectionId, e);
  }
  const sectionStats = Array.from(sectionMap.values())
    .filter((s) => s.total >= 5)
    .map((s) => ({ label: `${s.className}-${s.name}`, rate: Math.round((s.present / s.total) * 100) }))
    .sort((a, b) => a.rate - b.rate);

  const avgScore = allExamResults.length > 0
    ? Math.round(allExamResults.reduce((sum, r) => sum + (r.exam.maxMarks ? (r.marks / r.exam.maxMarks) * 100 : 0), 0) / allExamResults.length)
    : null;

  const collected = feePayments.reduce((s, p) => s + moneyToNumber(p.amount), 0);

  const context = {
    school: school.name,
    totalStudents,
    totalTeachers,
    overallAttendanceRate30d: overallAttRate,
    attendanceTrend7d: dailyRates,
    atRiskStudents: atRiskCount,
    worstSections: sectionStats.slice(0, 3),
    bestSections: sectionStats.slice(-3).reverse(),
    examAvgScore: avgScore,
    totalExamEntries: allExamResults.length,
    pendingLeaveRequests: pendingLeaves,
    feeCollectedLast30Days: collected,
    announcementsLast7Days: announcements,
  };

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are an AI assistant for a school management system. Analyze the following school data and provide actionable insights in JSON format.

School Data:
${JSON.stringify(context, null, 2)}

Respond ONLY with a valid JSON object (no markdown, no explanation) with this exact structure:
{
  "summary": "2-3 sentence overall health summary of the school",
  "attendanceInsight": "1-2 sentences about attendance trends and predictions",
  "academicInsight": "1-2 sentences about exam performance",
  "urgentActions": ["action1", "action2", "action3"],
  "positives": ["positive1", "positive2"],
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "predictedAttendanceTrend": "IMPROVING" | "STABLE" | "DECLINING"
}`,
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  let insights;
  try {
    insights = JSON.parse(text);
  } catch {
    insights = { summary: text, urgentActions: [], positives: [], riskLevel: "MEDIUM", predictedAttendanceTrend: "STABLE" };
  }

  // Upsert cache
  const saved = await prisma.aIInsightCache.upsert({
    where: { schoolId },
    create: { schoolId, insights: JSON.stringify(insights) },
    update: { insights: JSON.stringify(insights), generatedAt: new Date() },
  });

  return NextResponse.json({
    insights,
    generatedAt: saved.generatedAt,
    cached: false,
    daysUntilRefresh: CACHE_DAYS,
  });
}
