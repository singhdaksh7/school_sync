'use client'
// =============================================================================
// SchoolSync — DEMO entry page. Renders the white-label landing screen and,
// after the user picks a role, mounts the corresponding portal inside the
// shared AppShell. In your real codebase, replace this with real Next.js
// route segments (e.g. /admin/dashboard, /teacher/homework, etc.) and use
// NextAuth for the sign-in flow instead of the in-memory role state.
// =============================================================================

import { useEffect, useState } from 'react'
import { SchoolProvider } from '@/components/schoolsync/theme'
import { Landing } from '@/components/schoolsync/landing'
import { AppShell } from '@/components/schoolsync/app-shell'
import { adminViewMap } from '@/components/schoolsync/admin'
import { teacherViewMap } from '@/components/schoolsync/teacher'
import { ParentPortal } from '@/components/schoolsync/parent'
import { studentViewMap } from '@/components/schoolsync/student'
import { ROLE_CONFIGS } from '@/lib/schoolsync/constants'
import { SchoolSyncAPI } from '@/lib/schoolsync/api'
import type { RoleId, School } from '@/lib/schoolsync/types'

function Inner() {
  const [role, setRole] = useState<RoleId | null>(null)
  const [view, setView] = useState<string>('dashboard')

  if (!role) return <Landing onEnter={(r) => { setRole(r); setView('dashboard') }} />

  const cfg = ROLE_CONFIGS[role]
  const body =
    role === 'admin'   ? adminViewMap[view]   ?? adminViewMap.dashboard :
    role === 'teacher' ? teacherViewMap[view] ?? teacherViewMap.dashboard :
    role === 'student' ? studentViewMap[view] ?? studentViewMap.dashboard :
                         <ParentPortal view={view} />

  return (
    <AppShell
      roleConfig={cfg}
      currentView={view}
      setView={setView}
      onSignOut={() => { setRole(null); setView('dashboard') }}
    >
      {body}
    </AppShell>
  )
}

export default function Page() {
  const [schools, setSchools] = useState<School[] | null>(null)
  useEffect(() => { SchoolSyncAPI.getSchools().then(setSchools).catch(() => setSchools([])) }, [])
  if (!schools) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading SchoolSync...</div>
  return (
    <SchoolProvider schools={schools}>
      <Inner />
    </SchoolProvider>
  )
}
