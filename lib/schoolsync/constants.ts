// SchoolSync — UI constants. Safe to copy verbatim into your real codebase.

import {
  LayoutDashboard, Users, GraduationCap, Wallet, ClipboardCheck, BookOpen,
  FileText, Megaphone, Calendar, UserCheck, ArrowRightLeft, Award, Trophy, Settings,
} from 'lucide-react'
import type { RoleConfig, RoleId } from './types'

export const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
]

export const ROLE_CONFIGS: Record<RoleId, RoleConfig> = {
  admin: {
    label: 'Admin / Owner', initials: 'AD', userName: 'Anjali Mehta',
    nav: [
      { id: 'dashboard',     label: 'Dashboard',     icon: LayoutDashboard },
      { id: 'students',      label: 'Students',      icon: GraduationCap, badge: '1.2k' },
      { id: 'teachers',      label: 'Teachers',      icon: Users,         badge: 96 },
      { id: 'fees',          label: 'Fees',          icon: Wallet },
      { id: 'attendance',    label: 'Attendance',    icon: ClipboardCheck },
      { id: 'homework',      label: 'Homework',      icon: BookOpen },
      { id: 'reports',       label: 'Report cards',  icon: FileText },
      { id: 'announcements', label: 'Announcements', icon: Megaphone },
    ],
  },
  teacher: {
    label: 'Teacher', initials: 'TS', userName: 'Mrs. Sharma',
    nav: [
      { id: 'dashboard',    label: 'Dashboard',       icon: LayoutDashboard },
      { id: 'attendance',   label: 'Mark attendance', icon: ClipboardCheck },
      { id: 'timetable',    label: 'Timetable',       icon: Calendar },
      { id: 'homework',     label: 'Homework',        icon: BookOpen, badge: 5 },
      { id: 'marks',        label: 'Marks',           icon: Award },
      { id: 'arrangements', label: 'Arrangements',    icon: ArrowRightLeft, badge: 2 },
      { id: 'leaves',       label: 'Leave requests',  icon: UserCheck, badge: 3 },
      { id: 'reports',      label: 'Report cards',    icon: FileText },
      { id: 'profile',      label: 'Profile',         icon: Settings },
    ],
  },
  parent: {
    label: 'Parent', initials: 'RS', userName: 'Rohan Sharma',
    nav: [
      { id: 'dashboard',     label: 'Overview',      icon: LayoutDashboard },
      { id: 'attendance',    label: 'Attendance',    icon: ClipboardCheck },
      { id: 'fees',          label: 'Fees',          icon: Wallet, badge: '!' },
      { id: 'homework',      label: 'Homework',      icon: BookOpen },
      { id: 'timetable',     label: 'Timetable',     icon: Calendar },
      { id: 'marks',         label: 'Marks',         icon: Award },
      { id: 'reports',       label: 'Report cards',  icon: FileText },
      { id: 'announcements', label: 'Announcements', icon: Megaphone, badge: 4 },
    ],
  },
  student: {
    label: 'Student', initials: 'DS', userName: 'Diya Sharma',
    nav: [
      { id: 'dashboard',     label: 'Home',          icon: LayoutDashboard },
      { id: 'homework',      label: 'Homework',      icon: BookOpen, badge: 4 },
      { id: 'timetable',     label: 'Timetable',     icon: Calendar },
      { id: 'attendance',    label: 'Attendance',    icon: ClipboardCheck },
      { id: 'marks',         label: 'Marks',         icon: Award },
      { id: 'reports',       label: 'Report cards',  icon: FileText },
      { id: 'announcements', label: 'Announcements', icon: Megaphone },
      { id: 'achievements',  label: 'Achievements',  icon: Trophy },
    ],
  },
}
