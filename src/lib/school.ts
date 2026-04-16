import { cache } from "react";
import { prisma } from "./prisma";

// cache() deduplicates DB calls within a single request.
// When layout and page both call getSchoolBySlug with the same slug,
// Prisma only runs the query once — the second call returns the cached promise.
export const getSchoolBySlug = cache(async (slug: string) => {
  return prisma.school.findUnique({
    where: { slug },
    include: { owner: true, admins: { select: { id: true } } },
  });
});
