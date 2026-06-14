'use client'
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { BookOpen, Calendar, ClipboardCheck, Award, Trophy, FileText, Megaphone, Upload, Clock, Sparkles, Medal } from 'lucide-react'
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid, RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts'
import { PageHeader, KpiCard, SectionCard, EmptyState } from './widgets'
import { TimetableShared } from './portal-parent'
import { toast } from 'sonner'

function StudentDashboard() {
  const [data, setData] = useState(null)
  const [marks, setMarks] = useState([])
  const [hw, setHw] = useState([])
  useEffect(() => {
    fetch('/api/dashboard/student').then(r => r.json()).then(setData)
    fetch('/api/marks').then(r => r.json()).then(d => setMarks(d.marks || []))
    fetch('/api/homework').then(r => r.json()).then(d => setHw(d.homework || []))
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
        <KpiCard icon={BookOpen} label="Homework due" value={data.homeworkDue} hint="2 due tomorrow" />
        <KpiCard icon={ClipboardCheck} label="Attendance" value={data.attendancePct + '%'} delta={2} />
        <KpiCard icon={Award} label="Avg marks" value={data.avgMarks + '%'} delta={4} />
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
              <div key={a.id} className="flex items-center gap-3 p-2.5 rounded-lg border"><div className="size-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center"><Trophy className="size-4" /></div><div className="flex-1"><div className="text-sm font-medium">{a.title}</div><div className="text-[11px] text-muted-foreground">{a.date}</div></div></div>
            ))}
          </div>
        </SectionCard>
      </div>
      <SectionCard title="Upcoming homework" description="Don't miss the deadline" className="mt-4">
        <div className="space-y-2">
          {hw.slice(0,4).map(h => (
            <div key={h.id} className="flex items-center gap-3 p-3 rounded-lg border"><div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><BookOpen className="size-4" /></div><div className="flex-1"><div className="text-sm font-medium">{h.title}</div><div className="text-[11px] text-muted-foreground">{h.subject} · Due {h.dueDate}</div></div><Button size="sm" variant="outline" className="text-xs" onClick={() => toast.success('Submission uploaded')}><Upload className="size-3.5 mr-1" /> Submit</Button></div>
          ))}
        </div>
      </SectionCard>
    </>
  )
}

function StudentHomework() {
  const [hw, setHw] = useState([])
  useEffect(() => { fetch('/api/homework').then(r => r.json()).then(d => setHw(d.homework || [])) }, [])
  return (<><PageHeader title="Homework" subtitle="Your assignments" />
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {hw.map(h => (<Card key={h.id} className="p-4"><div className="flex items-start justify-between"><div><div className="text-[11px] text-muted-foreground">{h.subject}</div><div className="font-medium text-sm">{h.title}</div></div><Badge variant={h.status === 'Completed' ? 'default' : 'outline'}>Due {h.dueDate}</Badge></div><div className="mt-3 flex gap-2"><Button size="sm" className="text-xs" onClick={() => toast.success('Uploaded')}><Upload className="size-3.5 mr-1" /> Submit</Button><Button size="sm" variant="outline" className="text-xs">View brief</Button></div></Card>))}
    </div></>)
}

function StudentTimetable() { return (<><PageHeader title="Timetable" subtitle="Your weekly schedule" /><TimetableShared /></>) }

function StudentAttendance() {
  const data = Array.from({ length: 30 }).map((_, i) => ({ d: i+1, present: ((i * 5 + 2) % 13) !== 0 }))
  return (<><PageHeader title="Attendance" subtitle="94% this month — keep it up!" />
    <Card className="p-5"><div className="grid grid-cols-7 sm:grid-cols-10 md:grid-cols-15 gap-1.5 mb-4">
      {data.map((d) => (<div key={d.d} className={`aspect-square rounded ${d.present ? 'bg-primary/70' : 'bg-destructive/60'} text-[9px] text-white flex items-center justify-center font-medium`}>{d.d}</div>))}
    </div><div className="flex gap-4 text-xs text-muted-foreground"><div className="flex items-center gap-1.5"><span className="size-3 rounded bg-primary/70" /> Present</div><div className="flex items-center gap-1.5"><span className="size-3 rounded bg-destructive/60" /> Absent</div></div></Card></>)
}

function StudentMarks() {
  const [marks, setMarks] = useState([])
  useEffect(() => { fetch('/api/marks').then(r => r.json()).then(d => setMarks(d.marks || [])) }, [])
  return (<><PageHeader title="Marks" subtitle="Subject-wise performance" />
    <Card className="p-5"><div className="h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={marks} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="subject" stroke="hsl(var(--muted-foreground))" fontSize={11} /><YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} /><RTooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} /><Bar dataKey="term1" fill="hsl(var(--muted-foreground))" radius={[4,4,0,0]} /><Bar dataKey="term2" fill="hsl(var(--primary))" radius={[4,4,0,0]} /></BarChart></ResponsiveContainer></div></Card></>)
}

function StudentReports() {
  const [reports, setReports] = useState([])
  useEffect(() => { fetch('/api/report-cards').then(r => r.json()).then(d => setReports(d.reportCards || [])) }, [])
  return (<><PageHeader title="Report cards" />
    <div className="space-y-3">{reports.map((r,i) => (<Card key={i} className="p-4 flex items-center gap-4"><div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><FileText className="size-4" /></div><div className="flex-1"><div className="font-medium text-sm">{r.term}</div><div className="text-xs text-muted-foreground">{r.percentage}% · Grade {r.grade} · Rank #{r.rank}</div></div><Badge>{r.status}</Badge><Button variant="outline" size="sm">Download</Button></Card>))}</div></>)
}

function StudentAnnouncements() {
  const [ann, setAnn] = useState([])
  useEffect(() => { fetch('/api/announcements').then(r => r.json()).then(d => setAnn(d.announcements || [])) }, [])
  return (<><PageHeader title="Announcements" /><div className="space-y-3">{ann.map(a => (<Card key={a.id} className="p-4"><div className="flex items-center justify-between"><div className="font-medium">{a.title}</div><Badge variant="outline">{a.category}</Badge></div><div className="text-sm text-muted-foreground mt-1">{a.body}</div><div className="text-xs text-muted-foreground mt-2">{a.date}</div></Card>))}</div></>)
}

function StudentAchievements() {
  const [a, setA] = useState([])
  useEffect(() => { fetch('/api/achievements').then(r => r.json()).then(d => setA(d.achievements || [])) }, [])
  return (<><PageHeader title="Achievements" subtitle="Your trophy shelf 🏆" />
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">{a.map(x => (<Card key={x.id} className="p-5 text-center"><div className="size-14 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-3"><Medal className="size-7" /></div><div className="text-sm font-semibold">{x.title}</div><div className="text-[11px] text-muted-foreground mt-1">{x.date}</div></Card>))}</div></>)
}

export const StudentViews = {
  dashboard: <StudentDashboard />, homework: <StudentHomework />, timetable: <StudentTimetable />, attendance: <StudentAttendance />, marks: <StudentMarks />, reports: <StudentReports />, announcements: <StudentAnnouncements />, achievements: <StudentAchievements />,
}
