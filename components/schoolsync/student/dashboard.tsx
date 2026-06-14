'use client'
// =============================================================================
// SchoolSync — #5 Student Dashboard.
// =============================================================================

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BookOpen, ClipboardCheck, Award, Trophy, Upload } from 'lucide-react'
import {
  BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from 'recharts'
import { toast } from 'sonner'
import { PageHeader, KpiCard, SectionCard } from '../shared'
import { SchoolSyncAPI } from '@/lib/schoolsync/api'
import type { Homework, MarkRow, StudentDashboardData } from '@/lib/schoolsync/types'

export function StudentDashboard() {
  const [data, setData] = useState<StudentDashboardData | null>(null)
  const [marks, setMarks] = useState<MarkRow[]>([])
  const [hw, setHw] = useState<Homework[]>([])

  useEffect(() => {
    SchoolSyncAPI.getStudentDashboard().then(setData).catch(() => {})
    SchoolSyncAPI.getMarks().then(setMarks).catch(() => {})
    SchoolSyncAPI.getHomework().then(setHw).catch(() => {})
  }, [])

  if (!data) return <div className="py-20 text-center text-muted-foreground">Loading...</div>

  return (
    <>
      <PageHeader title="Hi Diya 👋" subtitle="Let's check what's up today." />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4 bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
          <div className="text-[10px] uppercase tracking-wider opacity-80">Next class</div>
          <div className="text-lg font-bold mt-1">{data.nextClass.subject}</div>
          <div className="text-xs opacity-90">{data.nextClass.time} · Room {data.nextClass.room}</div>
          <div className="text-[11px] mt-2 opacity-80">{data.nextClass.teacher}</div>
        </Card>
        <KpiCard icon={BookOpen}        label="Homework due" value={data.homeworkDue}        hint="2 due tomorrow" />
        <KpiCard icon={ClipboardCheck}  label="Attendance"   value={`${data.attendancePct}%`} delta={2} />
        <KpiCard icon={Award}           label="Avg marks"    value={`${data.avgMarks}%`}      delta={4} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <SectionCard title="My marks" description="Term 2" className="lg:col-span-2">
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={marks} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="subject" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <RTooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="term2" fill="hsl(var(--primary))" radius={[6,6,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
        <SectionCard title="Recent achievements" description="Keep it up!">
          <div className="space-y-2">
            {data.achievements.map(a => (
              <div key={a.id} className="flex items-center gap-3 p-2.5 rounded-lg border">
                <div className="size-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center"><Trophy className="size-4" /></div>
                <div className="flex-1"><div className="text-sm font-medium">{a.title}</div><div className="text-[11px] text-muted-foreground">{a.date}</div></div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
      <SectionCard title="Upcoming homework" description="Don't miss the deadline" className="mt-4">
        <div className="space-y-2">
          {hw.slice(0, 4).map(h => (
            <div key={h.id} className="flex items-center gap-3 p-3 rounded-lg border">
              <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><BookOpen className="size-4" /></div>
              <div className="flex-1"><div className="text-sm font-medium">{h.title}</div><div className="text-[11px] text-muted-foreground">{h.subject} · Due {h.dueDate}</div></div>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => toast.success('Submission uploaded')}><Upload className="size-3.5 mr-1" /> Submit</Button>
            </div>
          ))}
        </div>
      </SectionCard>
    </>
  )
}
