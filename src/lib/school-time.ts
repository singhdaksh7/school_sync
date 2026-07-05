/**
 * School Operations Command Center — school-local date/time and period
 * resolution (PART 2/3). One central resolver so no service scatters its own
 * timezone/period-boundary math.
 *
 * TODAY is the school-local calendar date, derived from `School.timezone`
 * (IANA identifier, e.g. "Asia/Kolkata") via `Intl.DateTimeFormat` — never
 * server UTC, and never a blind `Asia/Kolkata` hardcode (the field exists
 * precisely so a school can override it; the default merely preserves the
 * product's existing implicit India-first assumption).
 *
 * Working-day convention (matches TimetableSlot.dayOfWeek / Arrangement.dayOfWeek
 * / arrangements.ts's jsToDbDay exactly): 1=Mon..6=Sat, Sunday is always closed,
 * and School.timetableWorkingDays caps which of days 1..6 are actually in use
 * (e.g. a 5-day school treats day 6 as non-working too).
 */

export const DEFAULT_SCHOOL_TIMEZONE = "Asia/Kolkata";

interface TimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function partsInTimezone(date: Date, timezone: string): TimeParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const rawHour = Number(get("hour"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    // Some locales render midnight as "24" under hour12:false.
    hour: rawHour === 24 ? 0 : rawHour,
    minute: Number(get("minute")),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export interface SchoolLocalNow {
  /** "YYYY-MM-DD" in the school's timezone. */
  dateKey: string;
  /** "HH:MM", zero-padded 24h, in the school's timezone. */
  timeOfDay: string;
  /** 0=Sun..6=Sat — the calendar weekday for dateKey (timezone-independent once dateKey is fixed). */
  jsWeekday: number;
}

/** Resolves "now" in the school's configured timezone. */
export function resolveSchoolLocalNow(timezone: string, now: Date = new Date()): SchoolLocalNow {
  const { year, month, day, hour, minute } = partsInTimezone(now, timezone);
  const dateKey = `${year}-${pad2(month)}-${pad2(day)}`;
  const timeOfDay = `${pad2(hour)}:${pad2(minute)}`;
  // Weekday depends only on the calendar Y/M/D, not on the timezone that
  // produced them — constructing at UTC avoids any local-machine-timezone
  // interference in this specific calculation.
  const jsWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { dateKey, timeOfDay, jsWeekday };
}

/** Maps a JS weekday (0=Sun..6=Sat) to the DB dayOfWeek convention (1=Mon..6=Sat), or null for Sunday (always closed). Mirrors arrangements.ts's jsToDbDay exactly. */
export function schoolDbDayOfWeek(jsWeekday: number): number | null {
  return jsWeekday === 0 ? null : jsWeekday;
}

/** True if `dbDay` is an actual working day for this school (not Sunday, and within the configured working-days count). */
export function isWorkingDay(dbDay: number | null, timetableWorkingDays: number): boolean {
  return dbDay !== null && dbDay <= timetableWorkingDays;
}

/**
 * Builds a date-only Date matching the exact convention already used
 * throughout the app for `@db.Date` columns (teacher-attendance.ts's
 * getTodayDateOnly, arrangements.ts's normalizeDate) — a LOCAL Date object
 * truncated to midnight. Constructed from the school-local Y/M/D so it
 * reflects the SCHOOL's calendar date rather than the server's, while
 * remaining byte-identical to prior behavior when the two coincide (the
 * common case for an India-first deployment with no server TZ override).
 */
export function schoolLocalDateOnly(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  d.setHours(0, 0, 0, 0);
  return d;
}

export type PeriodState = "BEFORE_SCHOOL" | "IN_PERIOD" | "BETWEEN_PERIODS" | "AFTER_SCHOOL" | "NON_WORKING_DAY" | "NOT_CONFIGURED";

export interface SchoolPeriodRow {
  periodNumber: number;
  label: string | null;
  startTime: string;
  endTime: string;
  isInstructional: boolean;
}

export interface CurrentPeriodResolution {
  status: PeriodState;
  currentPeriod: SchoolPeriodRow | null;
  nextPeriod: SchoolPeriodRow | null;
}

/**
 * Resolves the current/next instructional period from school-local time and
 * a school's configured `SchoolPeriodSchedule` rows (already ordered by
 * `periodNumber`, from the caller). `NOT_CONFIGURED` is returned — never one
 * of the other five honest states — when no period schedule exists at all;
 * fabricating a period state without real timing configuration would violate
 * the "no fabricated current period" requirement.
 *
 * Comparison is pure lexicographic string comparison of zero-padded "HH:MM"
 * values — correct and simpler than Date arithmetic for a same-day
 * time-of-day range check, and avoids any DST/timezone edge case entirely.
 */
export function resolveCurrentPeriod(args: {
  timeOfDay: string;
  dbDay: number | null;
  timetableWorkingDays: number;
  periods: SchoolPeriodRow[];
}): CurrentPeriodResolution {
  const { timeOfDay, dbDay, timetableWorkingDays, periods } = args;

  if (!isWorkingDay(dbDay, timetableWorkingDays)) {
    return { status: "NON_WORKING_DAY", currentPeriod: null, nextPeriod: null };
  }
  if (periods.length === 0) {
    return { status: "NOT_CONFIGURED", currentPeriod: null, nextPeriod: null };
  }

  const sorted = [...periods].sort((a, b) => a.periodNumber - b.periodNumber);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (timeOfDay < first.startTime) {
    return { status: "BEFORE_SCHOOL", currentPeriod: null, nextPeriod: first };
  }
  if (timeOfDay >= last.endTime) {
    return { status: "AFTER_SCHOOL", currentPeriod: null, nextPeriod: null };
  }

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (timeOfDay >= p.startTime && timeOfDay < p.endTime) {
      return { status: "IN_PERIOD", currentPeriod: p, nextPeriod: sorted[i + 1] ?? null };
    }
  }

  // Between two periods (a gap where startTime <= now < next.startTime but
  // no period's own range contains it — e.g. a break/lunch not modeled as
  // its own instructional row, or a scheduling gap).
  const next = sorted.find((p) => p.startTime > timeOfDay) ?? null;
  return { status: "BETWEEN_PERIODS", currentPeriod: null, nextPeriod: next };
}
