'use client'
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CreditCard, BookOpen, ClipboardCheck, Calendar, FileText, Megaphone, Award, Upload, Download, Trophy, Bell } from 'lucide-react'
import { BarChart, Bar, LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid } from 'recharts'
import { PageHeader, KpiCard, SectionCard, StatRow, EmptyState } from './widgets'
import { toast } from 'sonner'

function ChildSwitcher({ items, current, onChange }) {
  return (
    <div className="flex gap-2 mb-6">
      {items.map(c => (
        <button key={c.id} onClick={() => onChange(c)} className={`flex items-center gap-3 p-2.5 pr-4 rounded-xl border transition ${current?.id === c.id ? 'border-primary bg-primary/5 ring-2 ring-primary/10' : 'hover:border-foreground/20'}`}>
          <Avatar className="size-9"><AvatarFallback className="bg-primary text-primary-foreground text-xs">{c.name.split(' ').map(n=>n[0]).slice(0,2).join('')}</AvatarFallback></Avatar>
          <div className="text-left"><div className="text-sm font-semibold leading-tight">{c.name}</div><div className="text-[11px] text-muted-foreground">Grade {c.grade}</div></div>
        </button>
      ))}
    </div>
  )
}

function ParentDashboard({ child }) {
  const [marks, setMarks] = useState([])
  useEffect(() => { fetch('/api/marks').then(r => r.json()).then(d => setMarks(d.marks || [])) }, [])
  if (!child) return null
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={ClipboardCheck} label="Attendance" value={child.attendance + '%'} hint="This month" delta={1.2} />
        <KpiCard icon={CreditCard} label="Fees" value={child.feeStatus} hint={child.feeStatus === 'Pending' ? '₹ 12,500 due' : 'Up to date'} />
        <KpiCard icon={BookOpen} label="Homework" value="2 pending" hint="Math, Science" />
        <KpiCard icon={Trophy} label="Class rank" value="#3" delta={2} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <SectionCard title="Marks across subjects" description="Term 1 vs Term 2" className="lg:col-span-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={marks} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="subject" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <RTooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="term1" fill="hsl(var(--muted-foreground))" radius={[4,4,0,0]} />
                <Bar dataKey="term2" fill="hsl(var(--primary))" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
        <SectionCard title="Quick actions">
          <div className="space-y-2">
            {[{l:'Pay fees',i:CreditCard},{l:'View homework',i:BookOpen},{l:'Apply for leave',i:Calendar},{l:'Message teacher',i:Megaphone}].map(q => {
              const Icon = q.i
              return (<button key={q.l} onClick={() => toast.success(q.l + ' (demo)')} className="w-full flex items-center gap-3 p-3 rounded-lg border hover:border-primary hover:bg-primary/5 text-sm transition"><Icon className="size-4 text-primary" /> {q.l}</button>)
            })}
          </div>
        </SectionCard>
      </div>
    </>
  )
}

function ParentFeesPage({ child }) {
  return (<>
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
      <KpiCard icon={CreditCard} label="This term" value="₹ 42,500" />
      <KpiCard icon={CreditCard} label="Paid" value="₹ 30,000" />
      <KpiCard icon={CreditCard} label="Due" value="₹ 12,500" hint="Due 30 June" />
    </div>
    <SectionCard title="Invoices" description="Last 6 months" action={<Button size="sm" onClick={() => toast.success('Payment initiated (demo)')}><CreditCard className="size-4 mr-1.5" /> Pay now</Button>}>
      {[{inv:'INV-1042',d:'Tuition Q2',amt:15000,st:'Paid'},{inv:'INV-1041',d:'Bus fee Q2',amt:6000,st:'Paid'},{inv:'INV-1040',d:'Lab fee',amt:3500,st:'Paid'},{inv:'INV-1039',d:'Tuition Q3',amt:12500,st:'Due'}].map(i => (
        <div key={i.inv} className="flex items-center gap-3 py-3 border-b last:border-0"><div className="size-9 rounded-lg bg-muted flex items-center justify-center"><FileText className="size-4 text-muted-foreground" /></div><div className="flex-1"><div className="text-sm font-medium">{i.d}</div><div className="text-[11px] text-muted-foreground">{i.inv}</div></div><div className="text-sm font-medium">₹ {i.amt.toLocaleString()}</div><Badge variant={i.st === 'Paid' ? 'default' : 'destructive'}>{i.st}</Badge><Button variant="ghost" size="icon" className="size-7"><Download className="size-3.5" /></Button></div>
      ))}
    </SectionCard>
  </>)
}

function ParentHomeworkPage() {
  const [hw, setHw] = useState([])
  useEffect(() => { fetch('/api/homework').then(r => r.json()).then(d => setHw(d.homework || [])) }, [])
  return (
    <Tabs defaultValue="pending"><TabsList><TabsTrigger value="pending">Pending</TabsTrigger><TabsTrigger value="submitted">Submitted</TabsTrigger></TabsList>
      <TabsContent value="pending" className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        {hw.slice(0,3).map(h => (
          <Card key={h.id} className="p-4"><div className="flex items-start justify-between"><div><div className="text-[11px] text-muted-foreground">{h.subject}</div><div className="font-medium text-sm">{h.title}</div></div><Badge variant="outline">Due {h.dueDate}</Badge></div><div className="mt-3 flex gap-2"><Button size="sm" className="text-xs" onClick={() => toast.success('Submitted')}><Upload className="size-3.5 mr-1" /> Submit</Button><Button size="sm" variant="outline" className="text-xs">View</Button></div></Card>
        ))}
      </TabsContent>
      <TabsContent value="submitted"><EmptyState icon={BookOpen} title="Submitted homework" desc="All submitted assignments with teacher feedback." /></TabsContent>
    </Tabs>
  )
}

function ParentAttendancePage({ child }) {
  const data = Array.from({ length: 30 }).map((_, i) => ({ d: i+1, present: ((i * 7 + 3) % 11) !== 0 }))
  return (<>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4"><KpiCard icon={ClipboardCheck} label="This month" value={child?.attendance + '%'} /><KpiCard icon={ClipboardCheck} label="Year" value="92%" /><KpiCard icon={ClipboardCheck} label="Absences" value="3" /><KpiCard icon={ClipboardCheck} label="Leaves" value="2" /></div>
    <SectionCard title="This month" description="Green = present, Red = absent">
      <div className="grid grid-cols-7 sm:grid-cols-10 md:grid-cols-15 gap-1.5">
        {data.map((d) => (<div key={d.d} title={`Day ${d.d}`} className={`aspect-square rounded ${d.present ? 'bg-primary/70' : 'bg-destructive/60'} text-[9px] text-white flex items-center justify-center`}>{d.d}</div>))}
      </div>
    </SectionCard>
  </>)
}

function ParentTimetable() { return <TimetableShared /> }
function ParentMarks() { return (<><EmptyState icon={Award} title="Marks summary" desc="Subject-wise marks with comparison and download." /></>) }
function ParentReports() { return (<><EmptyState icon={FileText} title="Report cards" desc="Download published term report cards for your child." /></>) }
function ParentAnnouncements() {
  const [ann, setAnn] = useState([])
  useEffect(() => { fetch('/api/announcements').then(r => r.json()).then(d => setAnn(d.announcements || [])) }, [])
  return (<div className="space-y-3">{ann.map(a => (<Card key={a.id} className="p-4"><div className="flex items-center justify-between"><div className="font-medium">{a.title}</div><Badge variant="outline">{a.category}</Badge></div><div className="text-sm text-muted-foreground mt-1">{a.body}</div><div className="text-xs text-muted-foreground mt-2">{a.date}</div></Card>))}</div>)
}

export function TimetableShared() {
  const [tt, setTt] = useState({})
  useEffect(() => { fetch('/api/timetable').then(r => r.json()).then(d => setTt(d.timetable || {})) }, [])
  return (
    <Card className="p-2 overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-muted-foreground"><th className="text-left p-2 w-24">Day</th>{[1,2,3,4,5,6,7].map(p => <th key={p} className="p-2 text-left">P{p}</th>)}</tr></thead>
        <tbody>
          {Object.keys(tt).map(d => (
            <tr key={d} className="border-t"><td className="p-2 font-medium">{d}</td>
              {tt[d].map(p => (<td key={p.p} className="p-1.5">{p.s === 'Break' || !p.s ? <div className="text-[11px] text-muted-foreground italic p-2">{p.s || '—'}</div> : <div className="p-2 rounded-md bg-primary/5 border border-primary/10"><div className="text-xs font-medium">{p.s}</div><div className="text-[10px] text-muted-foreground">{p.r}</div></div>}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

export function ParentPortalRoot({ view }) {
  const [children, setChildren] = useState([])
  const [current, setCurrent] = useState(null)
  useEffect(() => { fetch('/api/children').then(r => r.json()).then(d => { setChildren(d.children || []); setCurrent((d.children || [])[0] || null) }) }, [])
  const titleMap = { dashboard: 'Overview', fees: 'Fees', homework: 'Homework', attendance: 'Attendance', timetable: 'Timetable', marks: 'Marks', reports: 'Report cards', announcements: 'Announcements' }
  return (
    <>
      <PageHeader title={titleMap[view] || 'Parent portal'} subtitle={current ? `${current.name} · Grade ${current.grade}` : 'Loading...'} />
      {children.length > 0 && <ChildSwitcher items={children} current={current} onChange={setCurrent} />}
      {view === 'dashboard' && <ParentDashboard child={current} />}
      {view === 'fees' && <ParentFeesPage child={current} />}
      {view === 'homework' && <ParentHomeworkPage />}
      {view === 'attendance' && <ParentAttendancePage child={current} />}
      {view === 'timetable' && <ParentTimetable />}
      {view === 'marks' && <ParentMarks />}
      {view === 'reports' && <ParentReports />}
      {view === 'announcements' && <ParentAnnouncements />}
    </>
  )
}
