'use client'
import { useEffect, useState } from 'react'
import { LayoutDashboard, Users, GraduationCap, Wallet, ClipboardCheck, BookOpen, FileText, Megaphone, Calendar, UserCheck, ArrowRightLeft, Award, Trophy, Bell, Settings } from 'lucide-react'
import { SchoolProvider } from '@/components/schoolsync/theme'
import Landing from '@/components/schoolsync/landing'
import { AppShell } from '@/components/schoolsync/shell'
import { AdminViews } from '@/components/schoolsync/portal-admin'
import { TeacherViews } from '@/components/schoolsync/portal-teacher'
import { ParentPortalRoot } from '@/components/schoolsync/portal-parent'
import { StudentViews } from '@/components/schoolsync/portal-student'

const ROLE_CONFIGS = {
  admin: {
    label: 'Admin / Owner', initials: 'AD', userName: 'Anjali Mehta',
    nav: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'students', label: 'Students', icon: GraduationCap, badge: '1.2k' },
      { id: 'teachers', label: 'Teachers', icon: Users, badge: 96 },
      { id: 'fees', label: 'Fees', icon: Wallet },
      { id: 'attendance', label: 'Attendance', icon: ClipboardCheck },
      { id: 'homework', label: 'Homework', icon: BookOpen },
      { id: 'reports', label: 'Report cards', icon: FileText },
      { id: 'announcements', label: 'Announcements', icon: Megaphone },
    ],
  },
  teacher: {
    label: 'Teacher', initials: 'TS', userName: 'Mrs. Sharma',
    nav: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'attendance', label: 'Mark attendance', icon: ClipboardCheck },
      { id: 'timetable', label: 'Timetable', icon: Calendar },
      { id: 'homework', label: 'Homework', icon: BookOpen, badge: 5 },
      { id: 'marks', label: 'Marks', icon: Award },
      { id: 'arrangements', label: 'Arrangements', icon: ArrowRightLeft, badge: 2 },
      { id: 'leaves', label: 'Leave requests', icon: UserCheck, badge: 3 },
      { id: 'reports', label: 'Report cards', icon: FileText },
      { id: 'profile', label: 'Profile', icon: Settings },
    ],
  },
  parent: {
    label: 'Parent', initials: 'RS', userName: 'Rohan Sharma',
    nav: [
      { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
      { id: 'attendance', label: 'Attendance', icon: ClipboardCheck },
      { id: 'fees', label: 'Fees', icon: Wallet, badge: '!' },
      { id: 'homework', label: 'Homework', icon: BookOpen },
      { id: 'timetable', label: 'Timetable', icon: Calendar },
      { id: 'marks', label: 'Marks', icon: Award },
      { id: 'reports', label: 'Report cards', icon: FileText },
      { id: 'announcements', label: 'Announcements', icon: Megaphone, badge: 4 },
    ],
  },
  student: {
    label: 'Student', initials: 'DS', userName: 'Diya Sharma',
    nav: [
      { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
      { id: 'homework', label: 'Homework', icon: BookOpen, badge: 4 },
      { id: 'timetable', label: 'Timetable', icon: Calendar },
      { id: 'attendance', label: 'Attendance', icon: ClipboardCheck },
      { id: 'marks', label: 'Marks', icon: Award },
      { id: 'reports', label: 'Report cards', icon: FileText },
      { id: 'announcements', label: 'Announcements', icon: Megaphone },
      { id: 'achievements', label: 'Achievements', icon: Trophy },
    ],
  },
}

const Inner = () => {
  const [role, setRole] = useState(null) // null = landing
  const [view, setView] = useState('dashboard')

  const enter = (r) => { setRole(r); setView('dashboard') }
  const signOut = () => { setRole(null); setView('dashboard') }

  if (!role) return <Landing onEnter={enter} />

  const cfg = ROLE_CONFIGS[role]

  let viewNode = null
  if (role === 'admin') viewNode = AdminViews[view] || AdminViews.dashboard
  else if (role === 'teacher') viewNode = TeacherViews[view] || TeacherViews.dashboard
  else if (role === 'student') viewNode = StudentViews[view] || StudentViews.dashboard
  else if (role === 'parent') viewNode = <ParentPortalRoot view={view} />

  return (
    <AppShell role={role} roleConfig={cfg} currentView={view} setView={setView} onSignOut={signOut}>
      {viewNode}
    </AppShell>
  )
}

const Page = () => {
  const [schools, setSchools] = useState(null)
  useEffect(() => { fetch('/api/schools').then(r => r.json()).then(d => setSchools(d.schools || [])) }, [])
  if (!schools) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading SchoolSync...</div>
  return (
    <SchoolProvider schools={schools}>
      <Inner />
    </SchoolProvider>
  )
}

export default Page
