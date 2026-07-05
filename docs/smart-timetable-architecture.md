# Smart Timetable Builder — Architecture

Deterministic backend for building, validating, auto-generating, and publishing
class/section timetables. No generative AI is used anywhere in the decision
path — every recommendation, score, and generated assignment is produced by
constraint validation, availability calculation, and deterministic
greedy/backtracking search over an in-memory generation context.

## Domain terminology

- **Live timetable** — the existing `TimetableSlot` table. Unchanged by this
  feature. Read by teacher schedules, attendance, substitutions, and
  arrangements exactly as before. Only `smart-timetable-publish.ts` ever
  writes to it, and only inside one transaction per publish.
- **Draft** (`TimetableDraft` + `TimetableDraftSlot`) — a generated or
  manually-built timetable for one class/section, not yet published. Never
  read by any operational consumer.
- **Subject requirement** (`TimetableSubjectRequirement`) — the number of
  weekly periods a subject needs for one class/section.
- **Teacher eligibility** (`TeacherSubjectEligibility`, falling back to the
  legacy single `Teacher.subject` field) — which teachers may teach a subject.
- **Workload rule** — maximum weekly/daily/consecutive periods and minimum
  free periods, resolved per teacher from `TeacherWorkloadOverride` →
  `School` defaults → a computed fallback (never one hardcoded number for
  every school).
- **Locked slot** — a `TimetableDraftSlot.locked = true` row the
  optimizer/generator will never move or overwrite.
- **Hard constraint** — a rule that can never be violated (H1-H12).
- **Soft constraint** — a rule that only influences ranking/score (S1-S8).

## Baseline audit (before building anything new)

The repository already had: `TimetableSlot` (live grid, `subject` as free
text — no global per-school Subject catalog), `custom-timetable` routes (a
basic manual-teacher-per-subject batch generator that writes directly to
`TimetableSlot`, kept fully intact and untouched), `teacher-ranking.ts` /
`timetable-recommendations.ts` (same-subject-string + fewest-periods
substitute ranking, still used by arrangements), `arrangements.ts` (day-specific
absence substitution — a different problem from weekly generation and
deliberately not touched or duplicated), and a `teachers/workload` read-only
report (no configured maximum existed before this feature). No
`SubjectTeacher` many-to-many model existed — eligibility was a single
free-text field per teacher. `TeacherSubjectEligibility` is new and additive;
a teacher with no explicit rows still works exactly as before via the
`Teacher.subject` fallback.

## Data model (additive migration `20260706000000_smart_timetable`)

`School` gained `timetableWorkingDays` (default 6, matching the existing
Mon-Sat `TimetableSlot.dayOfWeek` convention) and four nullable
`default*TeachingPeriods` workload-default columns. New tables:
`TeacherWorkloadOverride` (one row per teacher, every field independently
nullable/falls back), `TeacherSubjectEligibility`, `TimetableSubjectRequirement`,
`TimetableDraft`, `TimetableDraftSlot`. Nothing in `TimetableSlot` changed.

## Control flow

1. **Generation context** (`smart-timetable-context.ts`) is loaded ONCE per
   request/generation: school workload defaults, every teacher + their
   eligibility/overrides, and two occupancy maps — teacher occupancy (live
   `TimetableSlot` rows for the WHOLE SCHOOL, excluding the section(s) being
   generated, unioned with any explicitly-linked batch drafts' slots) and
   section occupancy (the target section's own batch-draft slots). All
   downstream engines operate purely in-memory against this context — no
   query inside any per-teacher or per-slot loop.
2. **Hard constraints** (`smart-timetable-constraints.ts`) check one candidate
   assignment against the context: H1 teacher double-booking, H2 class slot
   conflict, H4 eligibility, H5 max weekly, H6 min free, H7 max daily, H8 max
   consecutive. H3 (aggregate subject count) is checked at the draft level
   (`smart-timetable-drafts.ts` `validateDraft`), not per-assignment. H9
   (weekly availability) is deliberately NOT implemented — SchoolSync only
   has day-specific absence records (Attendance/LeaveRequest/
   TeacherEarlyLeaveRequest), which already drive the separate
   substitution/arrangement system; conflating a single sick day with a
   permanent schedule change would be wrong. H10 (locked slot) is enforced at
   the slot-mutation layer. H11 (fixed periods like assembly/lunch) has no
   schema concept and was not invented. H12 (tenant) is enforced by the route
   layer's `src/lib/tenant.ts` checks before any pure function runs.
3. **Soft scoring** (`smart-timetable-scoring.ts`) — named weight constants,
   S1-S8 (S3/S5 deliberately combined as one "daily balance" measure — they're
   the same underlying signal). Used by both the slot engine and the
   generator's per-subject teacher/slot choice.
4. **Recommendation + slot engines** (`smart-timetable-recommendations.ts`,
   `smart-timetable-slots.ts`) — ranked, explainable, code+message DTOs.
5. **Generator** (`smart-timetable-generator.ts`) — most-constrained-subject-
   first ordering (fewest eligible teachers, then fewest compatible slots,
   then highest remaining requirement), greedy best-slot placement per
   subject with bounded backtracking across ranked candidate teachers, no
   unbounded search. Supports `COMPLETE_REMAINING_ONLY` (preserves every
   existing slot, fills only the shortfall) and `REOPTIMIZE_UNLOCKED` (clears
   non-locked slots first). Failure produces structured
   `MISSING_REQUIRED_SUBJECT_PERIODS` / `NO_ELIGIBLE_TEACHER` diagnostics with
   deterministic, constraint-derived suggestions — never fabricated.
6. **Multi-section batch** (`smart-timetable-batch.ts`) — sections generated
   sequentially; each one's persisted draft slots become occupancy for every
   later section in the SAME batch call (via `batchDraftIds`). A draft from
   an unrelated, unlinked session is never included — an abandoned draft from
   months ago can never globally block a teacher. Above
   `SMART_TIMETABLE_SYNC_SECTION_LIMIT` (1) sections, the batch runs as a
   durable `SMART_TIMETABLE_GENERATION` job instead of one long HTTP request,
   reusing the exact same generation service and the existing job
   claim/heartbeat/lease infrastructure.
7. **Validation** (`validateDraft`) always re-derives from scratch — replays
   every slot (including locked ones) against live occupancy, checks H3
   aggregate counts, and re-checks eligibility. Never trusts a cached
   `status`.
8. **Quality score** (`smart-timetable-quality.ts`) only scores a VALID draft
   (`null` + `INVALID` otherwise — a hard conflict is never hidden behind a
   high soft score).
9. **Publish** (`smart-timetable-publish.ts`) always revalidates
   server-side, then inside one transaction: rechecks for a race (has another
   section's live timetable claimed one of these teacher/day/period slots
   since the last read?), deletes and recreates the target section's live
   `TimetableSlot` rows, marks the draft `PUBLISHED`, and writes an audit log
   entry. A true simultaneous double-write is still bounded by the existing
   `TimetableSlot_sectionId_dayOfWeek_period_key` database constraint even if
   the application-level recheck is beaten by a rare interleaving — this
   residual is documented, not papered over.

## Determinism

Every query that feeds the engine is explicitly ordered (`orderBy: id: "asc"`
on teacher loads, etc.), and every sort in the engine has a full tie-break
chain ending in an id/name comparison. The generator, recommendation engine,
and slot engine all produce byte-identical output for byte-identical input —
verified directly in both the unit test suite (`tests/wave-d-smart-timetable-
engine.test.ts`) and the pilot integration script (calling the generator twice
on the same draft and diffing the slot set).

## Known limitations

- Eligibility is name-based (matching the existing free-text convention),
  not a global per-school Subject catalog — a typo'd subject name will not
  match. This mirrors how `Teacher.subject` / `TimetableSlot.subject` already
  worked before this feature.
- No fixed-period concept (assembly/lunch) exists; H11 is a no-op until the
  schema gains one.
- The publish race-recheck is a best-effort application-level check, not a
  serializable transaction — the database's own unique constraint is the
  final backstop for a true simultaneous double-write.
