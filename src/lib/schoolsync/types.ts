// SchoolSync — shared TypeScript interfaces.
// Drop this file into your real codebase as a single source of truth for UI prop shapes.

import type { LucideIcon } from 'lucide-react'

export type RoleId = 'admin' | 'teacher' | 'parent' | 'student'
export type FeeStatus = 'Paid' | 'Pending' | 'Overdue'
export type HomeworkStatus = 'Active' | 'Completed'

export interface School {
  id: string
  name: string
  short: string
  initials: string
  tagline: string
  domain: string
  /** HSL components, e.g. "152 76% 36%" — injected as the dynamic --primary CSS variable. */
  primary: string
  accent?: string
  address?: string
  students?: number
  teachers?: number
}

export interface Student {
  id: string
  name: string
  grade: string
  rollNo: number
  gender: 'M' | 'F'
  guardian: string
  phone: string
  attendance: number
  feeStatus: FeeStatus
  feePaid: number
  homeworkSubmitted: number
  avgMarks: number
  avatar?: string | null
}

export interface Teacher {
  id: string
  name: string
  subject: string
  classes: string[]
  email: string
  experience: number
}

export interface Announcement {
  id: string
  title: string
  body: string
  date: string
  category: string
  author: string
}

export interface SchoolEvent {
  id: string
  title: string
  date: string
  time: string
  location: string
  color?: string
}

export interface Homework {
  id: string
  subject: string
  title: string
  dueDate: string
  class: string
  submitted: number
  total: number
  status: HomeworkStatus
}

export interface TimetablePeriod {
  p: number
  s: string
  t: string
  r: string
}
export type Timetable = Record<string, TimetablePeriod[]>

export interface MarkRow {
  subject: string
  term1: number
  term2: number
}

export interface ReportCard {
  term: string
  percentage: number
  grade: string
  rank: number
  status: string
}

export interface Achievement {
  id: string
  title: string
  date: string
  icon?: string
}

export interface Child {
  id: string
  name: string
  grade: string
  avatar?: string | null
  attendance: number
  feeStatus: FeeStatus
}

export interface AdminDashboardData {
  attendanceTrend: { d: string; present: number; absent: number }[]
  feesTrend: { m: string; collected: number; pending: number }[]
  homeworkPie: { name: string; value: number }[]
  kpis: { students: number; teachers: number; feesCollectedPct: number; attendancePct: number }
}

export interface TeacherDashboardData {
  todayClasses: TimetablePeriod[]
  pendingHomework: number
  submissionsToReview: number
  arrangements: number
  leaveRequests: number
}

export interface StudentDashboardData {
  nextClass: { subject: string; teacher: string; room: string; time: string }
  homeworkDue: number
  attendancePct: number
  avgMarks: number
  achievements: Achievement[]
}

export interface RoleNavItem {
  id: string
  label: string
  icon: LucideIcon
  badge?: string | number
}

export interface RoleConfig {
  label: string
  initials: string
  userName: string
  nav: RoleNavItem[]
}
