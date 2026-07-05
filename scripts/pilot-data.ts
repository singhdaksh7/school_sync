/**
 * Deterministic pilot dataset generator — pure functions, no DB/IO. Used by
 * scripts/seed-pilot.ts. Kept separate and dependency-free so it's testable
 * in isolation and so the seed script stays a thin orchestration layer.
 *
 * Determinism: a fixed seed (mulberry32, a small deterministic PRNG) means
 * re-running the generator with the same seed and sizes always produces the
 * same names/values — required for repeatable dev/test fixtures.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}

// Fictional Indian-style given/family name pools — not real people.
export const FIRST_NAMES = [
  "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Krishna", "Ishaan", "Kabir",
  "Aanya", "Diya", "Saanvi", "Ananya", "Myra", "Aadhya", "Kiara", "Anika", "Navya", "Riya",
  "Rohan", "Karthik", "Nikhil", "Rahul", "Aryan", "Dev", "Yash", "Siddharth", "Varun", "Aman",
  "Priya", "Neha", "Pooja", "Sneha", "Kavya", "Meera", "Isha", "Tanvi", "Ritu", "Divya",
] as const;

export const LAST_NAMES = [
  "Sharma", "Verma", "Gupta", "Iyer", "Nair", "Reddy", "Rao", "Patel", "Mehta", "Joshi",
  "Kumar", "Singh", "Das", "Chatterjee", "Banerjee", "Mukherjee", "Pillai", "Menon", "Kulkarni", "Desai",
] as const;

export const SUBJECT_POOL = ["Mathematics", "Science", "English", "Social Studies", "Hindi", "Computer Science", "Physical Education"] as const;

export function fullName(rand: () => number): string {
  return `${pick(rand, FIRST_NAMES)} ${pick(rand, LAST_NAMES)}`;
}

export type PilotSizeConfig = {
  schoolName: string;
  schoolSlug: string;
  studentCount: number;
  teacherCount: number;
  classNames: string[];
  sectionsPerClass: number;
  attendanceDays: number;
};

export const SCHOOL_A_CONFIG: PilotSizeConfig = {
  schoolName: "Green Valley Public School",
  schoolSlug: "green-valley-pilot",
  studentCount: 2000,
  teacherCount: 100,
  classNames: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
  sectionsPerClass: 4,
  attendanceDays: 30,
};

export const SCHOOL_B_CONFIG: PilotSizeConfig = {
  schoolName: "Sunrise Academy",
  schoolSlug: "sunrise-academy-pilot",
  studentCount: 500,
  teacherCount: 35,
  classNames: ["1", "2", "3", "4", "5", "6", "7", "8"],
  sectionsPerClass: 2,
  attendanceDays: 30,
};

/** Deterministically distributes `count` students across `sectionIds` as evenly as possible. */
export function distributeAcrossSections<T>(items: T[], sectionIds: string[]): Map<string, T[]> {
  const map = new Map<string, T[]>(sectionIds.map((id) => [id, []]));
  items.forEach((item, i) => {
    const sectionId = sectionIds[i % sectionIds.length];
    map.get(sectionId)!.push(item);
  });
  return map;
}
