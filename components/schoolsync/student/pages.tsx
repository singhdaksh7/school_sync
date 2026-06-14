'use client'
// SchoolSync — Student secondary pages.

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from 'recharts'
import { FileText, Upload, Medal } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader, TimetableGrid } from '../shared'
import { SchoolSyncAPI } from '@/lib/schoolsync/api'
import type { Achievement, Announcement, Homework, MarkRow, ReportCard, Timetable } from '@/lib/schoolsync/types'

export function StudentHomeworkPage() {
  const [hw, setHw] = useState<Homework[]>([])
  useEffect(() => { SchoolSyncAPI.getHomework().then(setHw).catch(() => {}) }, [])
  return (<>
    <PageHeader title="Homework" subtitle="Your assignments" />
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {hw.map(h => (
        <Card key={h.id} className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[11px] text-muted-foreground">{h.subject}</div>
              <div className="font-medium text-sm">{h.title}</div>
            </div>
            <Badge variant={h.status === 'Completed' ? 'default' : 'outline'}>Due {h.dueDate}</Badge>
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" className="text-xs" onClick={() => toast.success('Uploaded')}><Upload className="size-3.5 mr-1" /> Submit</Button>
            <Button size="sm" variant="outline" className="text-xs">View brief</Button>
          </div>
        </Card>
      ))}
    </div>
  </>)
}

export function StudentTimetablePage() {
  const [tt, setTt] = useState<Timetable>({})
  useEffect(() => { SchoolSyncAPI.getTimetable().then(setTt).catch(() => {}) }, [])
  return (<><PageHeader title="Timetable" subtitle="Your weekly schedule" /><TimetableGrid timetable={tt} /></>)
}

export function StudentAttendancePage() {
  const data = Array.from({ length: 30 }).map((_, i) => ({ d: i + 1, present: ((i * 5 + 2) % 13) !== 0 }))
  return (<>
    <PageHeader title="Attendance" subtitle="94% this month — keep it up!" />
    <Card className="p-5">
      <div className="grid grid-cols-7 sm:grid-cols-10 md:grid-cols-15 gap-1.5 mb-4">
        {data.map(d => (
          <div key={d.d} className={`aspect-square rounded ${d.present ? 'bg-primary/70' : 'bg-destructive/60'} text-[9px] text-white flex items-center justify-center font-medium`}>{d.d}</div>
        ))}
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5"><span className="size-3 rounded bg-primary/70" /> Present</div>
        <div className="flex items-center gap-1.5"><span className="size-3 rounded bg-destructive/60" /> Absent</div>
      </div>
    </Card>
  </>)
}

export function StudentMarksPage() {
  const [marks, setMarks] = useState<MarkRow[]>([])
  useEffect(() => { SchoolSyncAPI.getMarks().then(setMarks).catch(() => {}) }, [])
  return (<>
    <PageHeader title="Marks" subtitle="Subject-wise performance" />
    <Card className="p-5">
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={marks} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="subject" stroke="hsl(var(--muted-foreground))" fontSize={11} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
            <RTooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
            <Bar dataKey="term1" fill="hsl(var(--muted-foreground))" radius={[4,4,0,0]} />
            <Bar dataKey="term2" fill="hsl(var(--primary))"          radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  </>)
}

export function StudentReportsPage() {
  const [reports, setReports] = useState<ReportCard[]>([])
  useEffect(() => { SchoolSyncAPI.getReportCards().then(setReports).catch(() => {}) }, [])
  return (<>
    <PageHeader title="Report cards" />
    <div className="space-y-3">
      {reports.map((r, i) => (
        <Card key={i} className="p-4 flex items-center gap-4">
          <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><FileText className="size-4" /></div>
          <div className="flex-1">
            <div className="font-medium text-sm">{r.term}</div>
            <div className="text-xs text-muted-foreground">{r.percentage}% · Grade {r.grade} · Rank #{r.rank}</div>
          </div>
          <Badge>{r.status}</Badge>
          <Button variant="outline" size="sm">Download</Button>
        </Card>
      ))}
    </div>
  </>)
}

export function StudentAnnouncementsPage() {
  const [ann, setAnn] = useState<Announcement[]>([])
  useEffect(() => { SchoolSyncAPI.getAnnouncements().then(setAnn).catch(() => {}) }, [])
  return (<>
    <PageHeader title="Announcements" />
    <div className="space-y-3">
      {ann.map(a => (
        <Card key={a.id} className="p-4">
          <div className="flex items-center justify-between"><div className="font-medium">{a.title}</div><Badge variant="outline">{a.category}</Badge></div>
          <div className="text-sm text-muted-foreground mt-1">{a.body}</div>
          <div className="text-xs text-muted-foreground mt-2">{a.date}</div>
        </Card>
      ))}
    </div>
  </>)
}

export function StudentAchievementsPage() {
  const [list, setList] = useState<Achievement[]>([])
  useEffect(() => { SchoolSyncAPI.getAchievements().then(setList).catch(() => {}) }, [])
  return (<>
    <PageHeader title="Achievements" subtitle="Your trophy shelf 🏆" />
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {list.map(x => (
        <Card key={x.id} className="p-5 text-center">
          <div className="size-14 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-3"><Medal className="size-7" /></div>
          <div className="text-sm font-semibold">{x.title}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{x.date}</div>
        </Card>
      ))}
    </div>
  </>)
}
