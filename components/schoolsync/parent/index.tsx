'use client'
// SchoolSync — Parent portal: wraps the dashboard + sub-pages with a child
// switcher. Drop ParentPortal into your codebase to get the full parent
// experience; the underlying ParentDashboard / pages are also exported
// individually so you can use them standalone.

import { useEffect, useState } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { PageHeader } from '../shared'
import { SchoolSyncAPI } from '@/lib/schoolsync/api'
import type { Child } from '@/lib/schoolsync/types'
import { ParentDashboard } from './dashboard'
import {
  ParentFeesPage, ParentHomeworkPage, ParentAttendancePage,
  ParentTimetablePage, ParentMarksPage, ParentReportsPage, ParentAnnouncementsPage,
} from './pages'

export { ParentDashboard } from './dashboard'
export {
  ParentFeesPage, ParentHomeworkPage, ParentAttendancePage,
  ParentTimetablePage, ParentMarksPage, ParentReportsPage, ParentAnnouncementsPage,
}

function ChildSwitcher({ items, current, onChange }: { items: Child[]; current: Child | null; onChange: (c: Child) => void }) {
  return (
    <div className="flex gap-2 mb-6 flex-wrap">
      {items.map(c => (
        <button key={c.id} onClick={() => onChange(c)}
          className={`flex items-center gap-3 p-2.5 pr-4 rounded-xl border transition ${current?.id === c.id ? 'border-primary bg-primary/5 ring-2 ring-primary/10' : 'hover:border-foreground/20'}`}>
          <Avatar className="size-9"><AvatarFallback className="bg-primary text-primary-foreground text-xs">{c.name.split(' ').map(n=>n[0]).slice(0,2).join('')}</AvatarFallback></Avatar>
          <div className="text-left">
            <div className="text-sm font-semibold leading-tight">{c.name}</div>
            <div className="text-[11px] text-muted-foreground">Grade {c.grade}</div>
          </div>
        </button>
      ))}
    </div>
  )
}

const TITLES: Record<string, string> = {
  dashboard: 'Overview', fees: 'Fees', homework: 'Homework', attendance: 'Attendance',
  timetable: 'Timetable', marks: 'Marks', reports: 'Report cards', announcements: 'Announcements',
}

export interface ParentPortalProps {
  view: string
}

export function ParentPortal({ view }: ParentPortalProps) {
  const [children, setChildren] = useState<Child[]>([])
  const [current, setCurrent] = useState<Child | null>(null)

  useEffect(() => {
    SchoolSyncAPI.getChildren().then(list => {
      setChildren(list)
      setCurrent(list[0] ?? null)
    }).catch(() => {})
  }, [])

  return (
    <>
      <PageHeader title={TITLES[view] || 'Parent portal'} subtitle={current ? `${current.name} · Grade ${current.grade}` : 'Loading...'} />
      {children.length > 0 && <ChildSwitcher items={children} current={current} onChange={setCurrent} />}
      {view === 'dashboard'     && <ParentDashboard       child={current} />}
      {view === 'fees'          && <ParentFeesPage        child={current} />}
      {view === 'homework'      && <ParentHomeworkPage    />}
      {view === 'attendance'    && <ParentAttendancePage  child={current} />}
      {view === 'timetable'     && <ParentTimetablePage   />}
      {view === 'marks'         && <ParentMarksPage       />}
      {view === 'reports'       && <ParentReportsPage     />}
      {view === 'announcements' && <ParentAnnouncementsPage />}
    </>
  )
}
