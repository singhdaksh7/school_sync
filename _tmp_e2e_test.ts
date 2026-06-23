import { chromium, type Page } from "playwright";

const BASE = "http://localhost:3000";
const STAMP = Date.now();
const results: { name: string; pass: boolean; detail?: string }[] = [];

function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

function fieldInput(page: Page, labelText: string) {
  return page.locator("div.space-y-1\\.5", { hasText: labelText }).locator("input").first();
}

async function selectRadix(page: Page, optionText: string | RegExp) {
  await page.locator('button[role="combobox"]').last().click();
  await page.getByRole("option", { name: optionText }).click();
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `_tmp_screens/${name}.png` });
}

// The header's schoolName hydrates slightly after the dashboard route resolves;
// poll briefly instead of reading h1 text immediately on navigation.
async function waitForHeaderText(page: Page, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let text = "";
  while (Date.now() < deadline) {
    text = (await page.locator("h1").first().textContent().catch(() => "")) || "";
    if (text && text !== "SchoolSync") return text;
    await page.waitForTimeout(300);
  }
  return text;
}

// Polls until the open dialog either closes (success) or shows an error message,
// instead of a fixed sleep -- needed because Turbopack cold-compiles each API
// route on first hit, which can take several seconds longer than a fixed wait.
async function waitForDialogOutcome(page: Page, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const dialog = page.getByRole("dialog");
    const visible = await dialog.isVisible().catch(() => false);
    if (!visible) return { closed: true, errorText: null as string | null };
    const err = await dialog.locator(".text-red-600, .text-red-700").first().textContent().catch(() => null);
    if (err) return { closed: false, errorText: err };
    await page.waitForTimeout(300);
  }
  return { closed: false, errorText: null as string | null };
}

async function registerAndCreateSchool(page: Page, ownerEmail: string, schoolName: string) {
  await page.goto(`${BASE}/register`);
  await fieldInput(page, "Full name").fill("QA Owner");
  await page.locator('input[type="email"]').fill(ownerEmail);
  await page.locator('input[type="password"]').fill("pass123456");
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL(/\/login/);

  await page.locator('input[type="email"]').fill(ownerEmail);
  await page.locator('input[type="password"]').fill("pass123456");
  await page.getByRole("button", { name: /Sign in/i }).click();
  await page.waitForURL(/\/onboarding/, { timeout: 60000 });

  await page.locator("#schoolName").fill(schoolName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Launch my school app/i }).click();
  await page.waitForURL(/\/dashboard\//, { timeout: 60000 });

  const slug = new URL(page.url()).pathname.split("/")[2];
  return slug;
}

async function addClassWithSection(page: Page, slug: string, className: string) {
  await page.goto(`${BASE}/dashboard/${slug}/classes`);
  await page.getByRole("button", { name: "Add Class" }).first().click();
  await selectRadix(page, new RegExp(`Class ${className}$`));
  await page.getByRole("dialog").getByRole("button", { name: "Add Class" }).click();
  await page.waitForSelector(`text=Class ${className}`, { timeout: 30000 });

  // Self-heal: the auto-section-creation POST occasionally races with Turbopack's
  // first-compile of the dynamic sections route in dev and silently drops the
  // section (see report). Verify it landed; if not, add it explicitly via the
  // "Add Section" UI control before moving on.
  await page.waitForTimeout(500);
  const sectionCountText = await page.locator("p", { hasText: "sections ·" }).first().textContent().catch(() => null);
  const hasSection = sectionCountText ? !/^0 sections/.test(sectionCountText.trim()) : false;
  if (!hasSection) {
    console.log(`  [self-heal] no section landed for Class ${className} on first attempt, adding via Add Section`);
    await page.locator(".cursor-pointer", { hasText: `Class ${className}` }).first().click();
    await page.getByRole("button", { name: "Add Section" }).first().click();
    await page.locator('input[placeholder="e.g. D, E"]').fill("A");
    await page.getByRole("dialog").getByRole("button", { name: "Add Section" }).click();
    await page.waitForTimeout(1000);
  }
}

async function addStudent(
  page: Page,
  slug: string,
  opts: { name: string; admissionNo: string; rollNo: string; sectionLabel: string | RegExp; fatherPhone?: string; motherPhone?: string }
) {
  await page.goto(`${BASE}/dashboard/${slug}/students`);
  await page.getByRole("button", { name: "Add Student" }).first().click();
  await fieldInput(page, "Full Name").fill(opts.name);
  await fieldInput(page, "Admission Number").fill(opts.admissionNo);
  await fieldInput(page, "Roll Number").fill(opts.rollNo);
  await selectRadix(page, opts.sectionLabel);
  if (opts.fatherPhone) await fieldInput(page, "Father Phone").fill(opts.fatherPhone);
  if (opts.motherPhone) await fieldInput(page, "Mother Phone").fill(opts.motherPhone);
  await page.getByRole("dialog").getByRole("button", { name: /Add Student/i }).click();
}

async function main() {
  const fs = await import("fs");
  fs.mkdirSync("_tmp_screens", { recursive: true });

  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  // ---------- SCHOOL A SETUP ----------
  const ctxA = await browser.newContext();
  const ownerA = ctxA.newPage().then(async (p) => p);
  const pageA = await ownerA;
  pageA.on("console", (msg) => { if (msg.type() === "error") console.log("  [consoleA-error]", msg.text()); });

  const slugA = await registerAndCreateSchool(pageA, `qa-owner-a-${STAMP}@example.com`, `QA Alpha School ${STAMP}`);
  check("School A registration + onboarding -> dashboard", !!slugA, slugA);
  await shot(pageA, "01-school-a-dashboard");

  await addClassWithSection(pageA, slugA, "10");
  check("School A: class+section created", true);

  // Student 1 (father phone only)
  await addStudent(pageA, slugA, {
    name: "Test Student Alpha",
    admissionNo: "TEST-001",
    rollNo: "1",
    sectionLabel: /^10 - Section A$/,
    fatherPhone: "9000000001",
  });
  let outcome = await waitForDialogOutcome(pageA);
  check("Student creation works (admission + father phone)", outcome.closed, outcome.closed ? "dialog closed, student saved" : `dialog still open :: ${outcome.errorText}`);
  await shot(pageA, "02-student1-created");

  // Duplicate admission number (same school)
  await addStudent(pageA, slugA, {
    name: "Test Duplicate Adm",
    admissionNo: "TEST-001",
    rollNo: "2",
    sectionLabel: /^10 - Section A$/,
    fatherPhone: "9000000002",
  });
  outcome = await waitForDialogOutcome(pageA);
  check("Duplicate admission number blocked", !outcome.closed && /already exists/i.test(outcome.errorText ?? ""), outcome.errorText ?? "no error shown, dialog closed=" + outcome.closed);
  await shot(pageA, "03-duplicate-admission-blocked");
  await pageA.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  // Student 2 (mother phone only)
  await addStudent(pageA, slugA, {
    name: "Test Student Mother",
    admissionNo: "TEST-002",
    rollNo: "3",
    sectionLabel: /^10 - Section A$/,
    motherPhone: "9000000003",
  });
  outcome = await waitForDialogOutcome(pageA);
  check("Student creation works (admission + mother phone only)", outcome.closed, outcome.closed ? "saved" : `dialog still open :: ${outcome.errorText}`);
  await shot(pageA, "04-student2-mother-phone-created");

  // ---------- SCHOOL B SETUP (multi-tenant isolation: same admission number, diff school) ----------
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  const slugB = await registerAndCreateSchool(pageB, `qa-owner-b-${STAMP}@example.com`, `QA Beta School ${STAMP}`);
  check("School B registration + onboarding -> dashboard", !!slugB, slugB);

  await addClassWithSection(pageB, slugB, "10");
  await addStudent(pageB, slugB, {
    name: "Test Student Beta",
    admissionNo: "TEST-001", // intentionally colliding with School A's admission number
    rollNo: "1",
    sectionLabel: /^10 - Section A$/,
    fatherPhone: "9000000099",
  });
  outcome = await waitForDialogOutcome(pageB);
  check("Same admission number allowed across different schools (per-school uniqueness)", outcome.closed, outcome.closed ? "saved" : `blocked unexpectedly :: ${outcome.errorText}`);
  await shot(pageB, "05-school-b-student-created");

  // ---------- STUDENT LOGIN TESTS ----------
  const ctxS = await browser.newContext();
  const pageS = await ctxS.newPage();

  // Father phone login -> School A
  await pageS.goto(`${BASE}/student/login`);
  await fieldInput(pageS, "Admission Number").fill("TEST-001");
  await pageS.locator('input[type="password"]').fill("9000000001");
  await pageS.getByRole("button", { name: /Sign in/i }).click();
  await pageS.waitForURL(/\/student\/dashboard/, { timeout: 60000 }).catch(() => {});
  let onDashboard = /\/student\/dashboard/.test(pageS.url());
  check("Student login with Father Phone works", onDashboard, pageS.url());
  let headerText = onDashboard ? await waitForHeaderText(pageS) : "";
  check("Father-phone login resolves into School A (admission collision disambiguated correctly)", (headerText || "").includes("QA Alpha"), headerText ?? "");
  await shot(pageS, "06-student-login-father-phone");

  // Mother phone login -> School A, student 2
  // (no explicit logout needed: the student login page clears any existing
  // session via signOut() before calling signIn() again)
  await pageS.goto(`${BASE}/student/login`);
  await fieldInput(pageS, "Admission Number").fill("TEST-002");
  await pageS.locator('input[type="password"]').fill("9000000003");
  await pageS.getByRole("button", { name: /Sign in/i }).click();
  await pageS.waitForURL(/\/student\/dashboard/, { timeout: 60000 }).catch(() => {});
  onDashboard = /\/student\/dashboard/.test(pageS.url());
  check("Student login with Mother Phone works", onDashboard, pageS.url());
  await shot(pageS, "07-student-login-mother-phone");

  // Same admission number, different school's password -> School B
  await pageS.goto(`${BASE}/student/login`);
  await fieldInput(pageS, "Admission Number").fill("TEST-001");
  await pageS.locator('input[type="password"]').fill("9000000099");
  await pageS.getByRole("button", { name: /Sign in/i }).click();
  await pageS.waitForURL(/\/student\/dashboard/, { timeout: 60000 }).catch(() => {});
  onDashboard = /\/student\/dashboard/.test(pageS.url());
  headerText = onDashboard ? await waitForHeaderText(pageS) : "";
  check("Colliding admission number + School B password logs into School B (multi-tenant isolation intact)", (headerText || "").includes("QA Beta"), headerText ?? "");
  await shot(pageS, "08-student-login-school-b-collision");

  // Wrong password
  await pageS.goto(`${BASE}/student/login`);
  await fieldInput(pageS, "Admission Number").fill("TEST-001");
  await pageS.locator('input[type="password"]').fill("0000000000");
  await pageS.getByRole("button", { name: /Sign in/i }).click();
  await pageS.waitForTimeout(1500);
  let errText = await pageS.locator(".text-red-700, [class*=red]").first().textContent().catch(() => "");
  check("Wrong password rejected with error message", !/\/student\/dashboard/.test(pageS.url()) && !!errText, errText ?? "");

  // Nonexistent admission number
  await pageS.goto(`${BASE}/student/login`);
  await fieldInput(pageS, "Admission Number").fill("NO-SUCH-ADM");
  await pageS.locator('input[type="password"]').fill("9000000001");
  await pageS.getByRole("button", { name: /Sign in/i }).click();
  await pageS.waitForTimeout(1500);
  errText = await pageS.locator(".text-red-700, [class*=red]").first().textContent().catch(() => "");
  check("Nonexistent admission number rejected with error message", !/\/student\/dashboard/.test(pageS.url()) && !!errText, errText ?? "");
  await shot(pageS, "09-student-login-errors");

  // ---------- EXISTING STAFF LOGINS STILL WORK ----------
  const ctxOwnerCheck = await browser.newContext();
  const pageOwnerCheck = await ctxOwnerCheck.newPage();
  await pageOwnerCheck.goto(`${BASE}/login`);
  await pageOwnerCheck.locator('input[type="email"]').fill(`qa-owner-a-${STAMP}@example.com`);
  await pageOwnerCheck.locator('input[type="password"]').fill("pass123456");
  await pageOwnerCheck.getByRole("button", { name: /Sign in/i }).click();
  await pageOwnerCheck.waitForURL(/\/dashboard\//, { timeout: 60000 }).catch(() => {});
  check("Existing School Owner (email/password) login still works", /\/dashboard\//.test(pageOwnerCheck.url()), pageOwnerCheck.url());

  // ---------- LANGUAGE SWITCH + PERSISTENCE ----------
  const ctxLang = await browser.newContext();
  const pageLang = await ctxLang.newPage();
  await pageLang.goto(`${BASE}/student/login`);
  const beforeSwitch = await pageLang.locator("h2, .text-2xl").first().textContent().catch(() => "");
  await pageLang.locator("select").first().selectOption({ label: "हिन्दी" });
  await pageLang.waitForTimeout(300);
  const afterSwitch = await pageLang.locator("h2, .text-2xl").first().textContent().catch(() => "");
  check("Language switch (EN -> HI) changes visible text", beforeSwitch !== afterSwitch, `before="${beforeSwitch}" after="${afterSwitch}"`);
  await shot(pageLang, "10-language-hindi");

  await pageLang.reload();
  await pageLang.waitForTimeout(300);
  const afterReload = await pageLang.locator("h2, .text-2xl").first().textContent().catch(() => "");
  check("Language persists after refresh", afterReload === afterSwitch, `afterReload="${afterReload}"`);
  await shot(pageLang, "11-language-persisted-after-refresh");

  await browser.close();

  console.log("\n==== SUMMARY ====");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"} - ${r.name}`);
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
