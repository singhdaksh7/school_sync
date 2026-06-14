'use client'
// =============================================================================
// SchoolSync — #3 Teacher Dashboard.
// =============================================================================

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Calendar, BookOpen, FileText, ArrowRightLeft, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader, KpiCard, SectionCard } from '../shared'
import { SchoolSyncAPI } from '@/lib/schoolsync/api'
import type { TeacherDashboardData } from '@/lib/schoolsync/types'

export function TeacherDashboard() {
  const [data, setData] = useState<TeacherDashboardData | null>(null)
  useEffect(() => { SchoolSyncAPI.getTeacherDashboard().then(setData).catch(() => {}) }, [])
  return (
    <>
      <PageHeader
        title="Good morning, Mrs. Sharma"
        subtitle="Here's your day at a glance."
        actions={<Button size="sm"><Plus className="size-4 mr-1.5" /> Assign homework</Button>}
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Calendar}        label="Today's classes"   value="6" hint="Next: 09:00 Math · 10A" />
        <KpiCard icon={BookOpen}        label="Pending homework"  value={data?.pendingHomework ?? '—'}     delta={-12} />
        <KpiCard icon={FileText}        label="To review"         value={data?.submissionsToReview ?? '—'} delta={8} />
        <KpiCard icon={ArrowRightLeft}  label="Arrangements"      value={data?.arrangements ?? '—'}        hint={`${data?.leaveRequests ?? 0} leave requests`} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <SectionCard title="Today's schedule" description="Monday · 7 periods" className="lg:col-span-2">
          <div className="space-y-2">
            {(data?.todayClasses || []).map(p => (
              <div key={p.p} className={`flex items-center gap-3 p-2.5 rounded-lg ${p.s === 'Break' ? 'bg-muted/40' : 'border hover:bg-muted/30'}`}>
                <div className="size-8 rounded-md bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">P{p.p}</div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{p.s || 'Break'}</div>
                  {p.r && <div className="text-xs text-muted-foreground">{p.r} · {p.t}</div>}
                </div>
                {p.s !== 'Break' && p.s !== '' && (
                  <Button variant="ghost" size="sm" className="text-xs">Mark attendance</Button>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Quick actions">
          <div className="space-y-2">
            {['Mark attendance', 'Post homework', 'Enter marks', 'Request arrangement', 'Approve leave'].map(q => (
              <button key={q} onClick={() => toast.success(`${q} (demo)`)}
                className="w-full text-left p-3 rounded-lg border hover:border-primary hover:bg-primary/5 text-sm transition">
                {q}
              </button>
            ))}
          </div>
        </SectionCard>
      </div>
    </>
  )
}
