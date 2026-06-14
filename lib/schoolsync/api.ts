// SchoolSync — typed API client.
// Default implementation calls the demo Next.js route handlers at /api/*.
// In your real SchoolSync codebase, replace these with your existing fetchers
// (server actions, React Query hooks, tRPC, Axios instance, etc.) — the
// component layer only depends on the SchoolSyncAPI surface, so swapping is safe.

import type {
  School, Student, Teacher, Announcement, SchoolEvent, Homework, Timetable,
  MarkRow, ReportCard, Achievement, Child,
  AdminDashboardData, TeacherDashboardData, StudentDashboardData,
} from './types'

const getJson = async <T>(path: string): Promise<T> => {
  const res = await fetch(`/api/${path}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`)
  return res.json() as Promise<T>
}

export const SchoolSyncAPI = {
  getSchools:        () => getJson<{ schools: School[] }>('schools').then(d => d.schools),
  getStudents:       () => getJson<{ students: Student[] }>('students').then(d => d.students),
  getTeachers:       () => getJson<{ teachers: Teacher[] }>('teachers').then(d => d.teachers),
  getAnnouncements:  () => getJson<{ announcements: Announcement[] }>('announcements').then(d => d.announcements),
  getEvents:         () => getJson<{ events: SchoolEvent[] }>('events').then(d => d.events),
  getHomework:       () => getJson<{ homework: Homework[] }>('homework').then(d => d.homework),
  getTimetable:      () => getJson<{ timetable: Timetable }>('timetable').then(d => d.timetable),
  getChildren:       () => getJson<{ children: Child[] }>('children').then(d => d.children),
  getAchievements:   () => getJson<{ achievements: Achievement[] }>('achievements').then(d => d.achievements),
  getReportCards:    () => getJson<{ reportCards: ReportCard[] }>('report-cards').then(d => d.reportCards),
  getMarks:          () => getJson<{ marks: MarkRow[] }>('marks').then(d => d.marks),
  getAdminDashboard:   () => getJson<AdminDashboardData>('dashboard/admin'),
  getTeacherDashboard: () => getJson<TeacherDashboardData>('dashboard/teacher'),
  getStudentDashboard: () => getJson<StudentDashboardData>('dashboard/student'),
}

export type SchoolSyncAPIType = typeof SchoolSyncAPI
