'use client'
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import { ClipboardCheck, Calendar, BookOpen, FileText, UserCheck, ArrowRightLeft, Clock, Plus, Send, Check } from 'lucide-react'
import { PageHeader, KpiCard, SectionCard, EmptyState } from './widgets'
import { toast } from 'sonner'

function TeacherDashboard() {
  const [data, setData] = useState(null)
  useEffect(() => { fetch('/api/dashboard/teacher').then(r => r.json()).then(setData) }, [])
  return (
    <>
      <PageHeader title="Good morning, Mrs. Sharma" subtitle="Here's your day at a glance." actions={<Button size="sm"><Plus className="size-4 mr-1.5" /> Assign homework</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Calendar} label="Today's classes" value="6" hint="Next: 09:00 Math · 10A" />
        <KpiCard icon={BookOpen} label="Pending homework" value={data?.pendingHomework ?? '—'} delta={-12} />
        <KpiCard icon={FileText} label="To review" value={data?.submissionsToReview ?? '—'} delta={8} />
        <KpiCard icon={ArrowRightLeft} label="Arrangements" value={data?.arrangements ?? '—'} hint={`${data?.leaveRequests ?? 0} leave requests`} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <SectionCard title="Today's schedule" description="Monday · 7 periods" className="lg:col-span-2">
          <div className="space-y-2">
            {(data?.todayClasses || []).map(p => (
              <div key={p.p} className={`flex items-center gap-3 p-2.5 rounded-lg ${p.s === 'Break' ? 'bg-muted/40' : 'border hover:bg-muted/30'}`}>
                <div className="size-8 rounded-md bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">P{p.p}</div>
                <div className="flex-1"><div className="text-sm font-medium">{p.s || 'Break'}</div>{p.r && <div className="text-xs text-muted-foreground">{p.r} · {p.t}</div>}</div>
                {p.s !== 'Break' && p.s !== '' && <Button variant="ghost" size="sm" className="text-xs">Mark attendance</Button>}
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Quick actions">
          <div className="space-y-2">
            {['Mark attendance','Post homework','Enter marks','Request arrangement','Approve leave'].map(q => (
              <button key={q} onClick={() => toast.success(q + ' (demo)')} className="w-full text-left p-3 rounded-lg border hover:border-primary hover:bg-primary/5 text-sm transition">{q}</button>
            ))}
          </div>
        </SectionCard>
      </div>
    </>
  )
}

function MarkAttendancePage() {
  const [students, setStudents] = useState([])
  const [present, setPresent] = useState({})
  useEffect(() => { fetch('/api/students').then(r => r.json()).then(d => { const list = (d.students || []).slice(0, 28); setStudents(list); const init = {}; list.forEach(s => init[s.id] = true); setPresent(init) }) }, [])
  const presentCount = Object.values(present).filter(Boolean).length
  return (
    <>
      <PageHeader title="Mark attendance · 10A" subtitle="Monday, Period 1 · Mathematics" actions={<><Button variant="outline" size="sm" onClick={() => { const all = {}; students.forEach(s => all[s.id] = true); setPresent(all) }}>Mark all present</Button><Button size="sm" onClick={() => toast.success('Attendance saved')}><Check className="size-4 mr-1.5" /> Save</Button></>} />
      <Card className="p-2">
        <div className="flex items-center justify-between p-3"><div className="text-sm"><span className="font-semibold">{presentCount}</span> / {students.length} present</div><Badge variant="outline">{Math.round(presentCount/Math.max(students.length,1)*100)}%</Badge></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 p-2">
          {students.map(s => (
            <label key={s.id} className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition ${present[s.id] ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-muted/40'}`}>
              <Checkbox checked={!!present[s.id]} onCheckedChange={(v) => setPresent({ ...present, [s.id]: !!v })} />
              <Avatar className="size-7"><AvatarFallback className="text-[10px]">{s.name.split(' ').map(n=>n[0]).slice(0,2).join('')}</AvatarFallback></Avatar>
              <div className="flex-1"><div className="text-sm font-medium">{s.name}</div><div className="text-[11px] text-muted-foreground">Roll {s.rollNo}</div></div>
              <Badge variant={present[s.id] ? 'default' : 'destructive'} className="text-[10px]">{present[s.id] ? 'Present' : 'Absent'}</Badge>
            </label>
          ))}
        </div>
      </Card>
    </>
  )
}

function TimetableView() {
  const [tt, setTt] = useState({})
  useEffect(() => { fetch('/api/timetable').then(r => r.json()).then(d => setTt(d.timetable || {})) }, [])
  const days = Object.keys(tt)
  return (
    <>
      <PageHeader title="Timetable" subtitle="Weekly schedule" />
      <Card className="p-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-muted-foreground"><th className="text-left p-2 w-24">Day</th>{[1,2,3,4,5,6,7].map(p => <th key={p} className="p-2 text-left">P{p}</th>)}</tr></thead>
          <tbody>
            {days.map(d => (
              <tr key={d} className="border-t">
                <td className="p-2 font-medium">{d}</td>
                {tt[d].map(p => (
                  <td key={p.p} className="p-1.5">
                    {p.s === 'Break' || !p.s ? <div className="text-[11px] text-muted-foreground italic p-2">{p.s || '—'}</div> :
                      <div className="p-2 rounded-md bg-primary/5 border border-primary/10"><div className="text-xs font-medium">{p.s}</div><div className="text-[10px] text-muted-foreground">{p.r}</div></div>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  )
}

function TeacherHomeworkPage() {
  const [hw, setHw] = useState([])
  useEffect(() => { fetch('/api/homework').then(r => r.json()).then(d => setHw(d.homework || [])) }, [])
  return (
    <>
      <PageHeader title="Homework" subtitle="Assignments you've posted" actions={<Button size="sm"><Plus className="size-4 mr-1.5" /> Assign new</Button>} />
      <Tabs defaultValue="active"><TabsList><TabsTrigger value="active">Active</TabsTrigger><TabsTrigger value="review">To review</TabsTrigger><TabsTrigger value="done">Completed</TabsTrigger></TabsList>
        <TabsContent value="active" className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
          {hw.filter(h => h.status === 'Active').map(h => (
            <Card key={h.id} className="p-4"><div className="flex items-start justify-between"><div><div className="text-xs text-muted-foreground">{h.subject} · {h.class}</div><div className="font-medium text-sm mt-0.5">{h.title}</div></div><Badge variant="outline">{h.status}</Badge></div><div className="mt-3 text-xs flex justify-between"><span className="text-muted-foreground">{h.submitted}/{h.total} submitted</span><span className="text-muted-foreground">Due {h.dueDate}</span></div><div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1.5"><div className="h-full bg-primary" style={{ width: (h.submitted/h.total*100) + '%' }} /></div><div className="mt-3 flex gap-2"><Button size="sm" variant="outline" className="text-xs">View submissions</Button><Button size="sm" variant="ghost" className="text-xs">Edit</Button></div></Card>
          ))}
        </TabsContent>
        <TabsContent value="review"><EmptyState icon={FileText} title="22 submissions waiting" desc="Open any homework to grade individual submissions." /></TabsContent>
        <TabsContent value="done" className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
          {hw.filter(h => h.status === 'Completed').map(h => (
            <Card key={h.id} className="p-4 opacity-80"><div className="font-medium text-sm">{h.title}</div><div className="text-xs text-muted-foreground">{h.subject} · {h.class} · {h.submitted}/{h.total}</div></Card>
          ))}
        </TabsContent>
      </Tabs>
    </>
  )
}

function ArrangementsPage() {
  return (<>
    <PageHeader title="Class arrangements" subtitle="Substitute teacher assignments" actions={<Button size="sm"><Plus className="size-4 mr-1.5" /> Request arrangement</Button>} />
    <div className="space-y-3">
      {[{d:'Tomorrow',p:'P3',s:'Science',c:'9B',sub:'Mrs. Sharma'},{d:'Fri 20',p:'P5',s:'English',c:'10A',sub:'Mr. Verma'}].map((a,i) => (
        <Card key={i} className="p-4 flex items-center gap-4"><div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><ArrowRightLeft className="size-4" /></div><div className="flex-1"><div className="text-sm font-medium">{a.s} · {a.c}</div><div className="text-xs text-muted-foreground">{a.d} · {a.p} · Cover by {a.sub}</div></div><Badge>Approved</Badge></Card>
      ))}
    </div>
  </>)
}

function LeaveRequestsPage() {
  return (<>
    <PageHeader title="Early leave requests" subtitle="Student early-leave approvals" />
    <div className="space-y-3">
      {[{n:'Ananya Patel',c:'8A',r:'Medical appointment',t:'13:00'},{n:'Rudra Mehta',c:'10B',r:'Family function',t:'14:30'},{n:'Aanya Iyer',c:'7A',r:'Doctor visit',t:'12:00'}].map((l,i) => (
        <Card key={i} className="p-4 flex items-center gap-3"><Avatar><AvatarFallback>{l.n.split(' ').map(n=>n[0]).slice(0,2).join('')}</AvatarFallback></Avatar><div className="flex-1"><div className="text-sm font-medium">{l.n} · <span className="text-muted-foreground">{l.c}</span></div><div className="text-xs text-muted-foreground">{l.r} · leave at {l.t}</div></div><Button variant="outline" size="sm" onClick={() => toast.error('Denied')}>Deny</Button><Button size="sm" onClick={() => toast.success('Approved')}>Approve</Button></Card>
      ))}
    </div>
  </>)
}

function TeacherMarksPage() {
  return (<><PageHeader title="Marks" subtitle="Enter and publish student marks" actions={<Button size="sm"><Send className="size-4 mr-1.5" /> Publish</Button>} /><EmptyState icon={FileText} title="Marks entry" desc="Choose a class and exam to start entering marks." /></>)
}
function TeacherReportsPage() { return (<><PageHeader title="Report cards" /><EmptyState icon={FileText} title="Generate report cards" desc="Compile term reports for your assigned classes." /></>) }
function TeacherProfilePage() { return (<><PageHeader title="Profile" /><EmptyState icon={UserCheck} title="Your profile" desc="Personal info, qualifications, classes, schedule." /></>) }

export const TeacherViews = {
  dashboard: <TeacherDashboard />, attendance: <MarkAttendancePage />, timetable: <TimetableView />, homework: <TeacherHomeworkPage />, marks: <TeacherMarksPage />, arrangements: <ArrangementsPage />, leaves: <LeaveRequestsPage />, reports: <TeacherReportsPage />, profile: <TeacherProfilePage />,
}
