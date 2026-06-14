'use client'
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Users, GraduationCap, Wallet, ClipboardCheck, BookOpen, Megaphone, CalendarDays, TrendingUp, Plus, Upload, Search, Filter, FileText, Download, Eye } from 'lucide-react'
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid } from 'recharts'
import { PageHeader, KpiCard, SectionCard, StatRow, EmptyState } from './widgets'
import { useSchool } from './theme'
import { toast } from 'sonner'

const chartColors = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))']

function Dashboard() {
  const { school } = useSchool()
  const [data, setData] = useState(null)
  const [ann, setAnn] = useState([])
  const [events, setEvents] = useState([])
  useEffect(() => {
    fetch('/api/dashboard/admin').then(r => r.json()).then(setData)
    fetch('/api/announcements').then(r => r.json()).then(d => setAnn(d.announcements || []))
    fetch('/api/events').then(r => r.json()).then(d => setEvents(d.events || []))
  }, [])
  if (!data) return <div className="py-20 text-center text-muted-foreground">Loading dashboard...</div>
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  return (
    <>
      <PageHeader
        title={`${greet}, Principal 👋`}
        subtitle={`Here's what's happening at ${school?.name} today.`}
        actions={<><Button variant="outline" size="sm"><Upload className="size-4 mr-1.5" /> Import</Button><Button size="sm"><Plus className="size-4 mr-1.5" /> Quick action</Button></>}
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={GraduationCap} label="Students" value={data.kpis.students.toLocaleString()} delta={4.2} hint="+42 admissions this term" />
        <KpiCard icon={Users} label="Teachers" value={data.kpis.teachers} delta={1.1} hint="3 new hires this month" />
        <KpiCard icon={Wallet} label="Fees collected" value={data.kpis.feesCollectedPct + '%'} delta={-3.4} hint="₹ 24.8L pending" />
        <KpiCard icon={ClipboardCheck} label="Attendance today" value={data.kpis.attendancePct + '%'} delta={2.1} hint="1,182 of 1,284 present" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <SectionCard title="Attendance this week" description="Daily present vs absent (%)" className="lg:col-span-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.attendanceTrend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="d" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <RTooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="present" stroke="hsl(var(--primary))" fill="url(#gp)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
        <SectionCard title="Homework status" description="Across all classes">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.homeworkPie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {data.homeworkPie.map((_, i) => <Cell key={i} fill={chartColors[i % chartColors.length]} />)}
                </Pie>
                <RTooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-3 justify-center mt-2 text-xs">
            {data.homeworkPie.map((s, i) => (
              <div key={s.name} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: chartColors[i] }} />
                <span className="text-muted-foreground">{s.name}</span>
                <span className="font-medium">{s.value}%</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <SectionCard title="Fee collection" description="Last 6 months" className="lg:col-span-2">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.feesTrend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="m" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <RTooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="collected" stackId="a" fill="hsl(var(--primary))" radius={[4,4,0,0]} />
                <Bar dataKey="pending" stackId="a" fill="hsl(var(--muted))" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
        <SectionCard title="Upcoming events" description="Next 30 days" action={<Button variant="ghost" size="sm" className="text-xs">View all</Button>}>
          <div className="space-y-3">
            {events.slice(0,4).map(e => (
              <div key={e.id} className="flex items-start gap-3">
                <div className="size-10 rounded-lg flex flex-col items-center justify-center text-[10px] font-semibold leading-none border" style={{ borderColor: 'hsl(var(--primary))', color: 'hsl(var(--primary))' }}>
                  <span>{new Date(e.date).toLocaleString('en', { month: 'short' }).toUpperCase()}</span>
                  <span className="text-base mt-0.5 text-foreground">{new Date(e.date).getDate()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{e.title}</div>
                  <div className="text-xs text-muted-foreground">{e.time} · {e.location}</div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <SectionCard title="Announcements" description="Latest broadcasts" action={<Button variant="outline" size="sm"><Plus className="size-3.5 mr-1" /> New</Button>}>
          <div className="space-y-3">
            {ann.map(a => (
              <div key={a.id} className="p-3 rounded-lg border hover:bg-muted/40 transition">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{a.title}</div>
                  <Badge variant="outline" className="text-[10px]">{a.category}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.body}</div>
                <div className="text-[10px] text-muted-foreground mt-1.5">{a.date} · {a.author}</div>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Quick actions" description="Most used">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Add student', icon: GraduationCap },
              { label: 'Mark attendance', icon: ClipboardCheck },
              { label: 'Collect fees', icon: Wallet },
              { label: 'Post announcement', icon: Megaphone },
              { label: 'New event', icon: CalendarDays },
              { label: 'Generate report', icon: FileText },
            ].map(q => {
              const Icon = q.icon
              return (
                <button key={q.label} onClick={() => toast.success(q.label + ' (demo)')} className="flex items-center gap-2 p-3 rounded-lg border hover:border-primary hover:bg-primary/5 transition text-sm">
                  <Icon className="size-4 text-primary" /> {q.label}
                </button>
              )
            })}
          </div>
        </SectionCard>
      </div>
    </>
  )
}

function StudentsPage() {
  const [students, setStudents] = useState([])
  const [q, setQ] = useState('')
  const [grade, setGrade] = useState('all')
  const [feeStatus, setFeeStatus] = useState('all')
  const [selected, setSelected] = useState(null)
  useEffect(() => { fetch('/api/students').then(r => r.json()).then(d => setStudents(d.students || [])) }, [])
  const grades = Array.from(new Set(students.map(s => s.grade))).sort()
  const filtered = students.filter(s =>
    (q === '' || s.name.toLowerCase().includes(q.toLowerCase()) || s.id.toLowerCase().includes(q.toLowerCase())) &&
    (grade === 'all' || s.grade === grade) &&
    (feeStatus === 'all' || s.feeStatus === feeStatus)
  )
  return (
    <>
      <PageHeader title="Students" subtitle={`${students.length} enrolled · ${filtered.length} shown`}
        actions={<><Button variant="outline" size="sm" onClick={() => toast.message('Bulk import wizard (demo)')}><Upload className="size-4 mr-1.5" /> Bulk import</Button><Button size="sm"><Plus className="size-4 mr-1.5" /> Add student</Button></>} />
      <Card className="p-4">
        <div className="flex flex-col md:flex-row md:items-center gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="size-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input placeholder="Search by name or ID..." className="pl-8" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <Select value={grade} onValueChange={setGrade}><SelectTrigger className="w-[140px]"><SelectValue placeholder="Grade" /></SelectTrigger><SelectContent><SelectItem value="all">All grades</SelectItem>{grades.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent></Select>
          <Select value={feeStatus} onValueChange={setFeeStatus}><SelectTrigger className="w-[140px]"><SelectValue placeholder="Fees" /></SelectTrigger><SelectContent><SelectItem value="all">All fees</SelectItem><SelectItem value="Paid">Paid</SelectItem><SelectItem value="Pending">Pending</SelectItem><SelectItem value="Overdue">Overdue</SelectItem></SelectContent></Select>
          <Button variant="outline" size="sm"><Filter className="size-4 mr-1.5" /> More</Button>
        </div>
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader><TableRow><TableHead>Student</TableHead><TableHead>Grade</TableHead><TableHead>Guardian</TableHead><TableHead>Attendance</TableHead><TableHead>Fees</TableHead><TableHead>Marks</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.slice(0, 30).map(s => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => setSelected(s)}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="size-8"><AvatarFallback className="text-[11px] bg-muted">{s.name.split(' ').map(n => n[0]).slice(0,2).join('')}</AvatarFallback></Avatar>
                      <div><div className="text-sm font-medium">{s.name}</div><div className="text-[11px] text-muted-foreground">{s.id}</div></div>
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{s.grade}</Badge></TableCell>
                  <TableCell className="text-sm"><div>{s.guardian}</div><div className="text-[11px] text-muted-foreground">{s.phone}</div></TableCell>
                  <TableCell><div className="flex items-center gap-2 text-sm"><div className="w-14"><div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: s.attendance + '%' }} /></div></div>{s.attendance}%</div></TableCell>
                  <TableCell><Badge variant={s.feeStatus === 'Paid' ? 'default' : s.feeStatus === 'Overdue' ? 'destructive' : 'secondary'}>{s.feeStatus}</Badge></TableCell>
                  <TableCell className="text-sm font-medium">{s.avgMarks}%</TableCell>
                  <TableCell><Button variant="ghost" size="icon" className="size-7"><Eye className="size-3.5" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-3">
                  <Avatar className="size-14"><AvatarFallback className="bg-primary text-primary-foreground">{selected.name.split(' ').map(n=>n[0]).slice(0,2).join('')}</AvatarFallback></Avatar>
                  <div>
                    <SheetTitle className="text-left">{selected.name}</SheetTitle>
                    <div className="text-xs text-muted-foreground">{selected.id} · Grade {selected.grade} · Roll {selected.rollNo}</div>
                  </div>
                </div>
              </SheetHeader>
              <div className="mt-6">
                <Tabs defaultValue="overview">
                  <TabsList className="grid grid-cols-4 w-full">
                    <TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="attendance">Attend.</TabsTrigger><TabsTrigger value="fees">Fees</TabsTrigger><TabsTrigger value="marks">Marks</TabsTrigger>
                  </TabsList>
                  <TabsContent value="overview" className="space-y-4 mt-4">
                    <StatRow label="Attendance" value={selected.attendance + '%'} percent={selected.attendance} />
                    <StatRow label="Fees paid" value={selected.feePaid + '%'} percent={selected.feePaid} />
                    <StatRow label="Homework submitted" value={selected.homeworkSubmitted + '%'} percent={selected.homeworkSubmitted} />
                    <StatRow label="Average marks" value={selected.avgMarks + '%'} percent={selected.avgMarks} />
                  </TabsContent>
                  <TabsContent value="attendance" className="text-sm text-muted-foreground">Attendance log goes here — daily check-in records, monthly summary, leaves taken.</TabsContent>
                  <TabsContent value="fees" className="text-sm text-muted-foreground">Fee structure breakdown, paid invoices, pending dues, payment history.</TabsContent>
                  <TabsContent value="marks" className="text-sm text-muted-foreground">Subject-wise marks, term comparison, report cards.</TabsContent>
                </Tabs>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

function TeachersPage() {
  const [teachers, setTeachers] = useState([])
  useEffect(() => { fetch('/api/teachers').then(r => r.json()).then(d => setTeachers(d.teachers || [])) }, [])
  return (
    <>
      <PageHeader title="Teachers" subtitle={`${teachers.length} faculty members`} actions={<Button size="sm"><Plus className="size-4 mr-1.5" /> Add teacher</Button>} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {teachers.map(t => (
          <Card key={t.id} className="p-4 hover:shadow-md transition">
            <div className="flex items-center gap-3">
              <Avatar className="size-11"><AvatarFallback className="bg-primary/10 text-primary text-sm">{t.name.split(' ').map(n=>n[0]).slice(0,2).join('')}</AvatarFallback></Avatar>
              <div className="min-w-0"><div className="font-medium text-sm truncate">{t.name}</div><div className="text-xs text-muted-foreground truncate">{t.subject}</div></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1">{t.classes.map(c => <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>)}</div>
            <div className="mt-3 text-xs text-muted-foreground flex justify-between"><span>{t.experience} yrs exp.</span><span className="truncate">{t.email}</span></div>
          </Card>
        ))}
      </div>
    </>
  )
}

function FeesPage() {
  return (
    <>
      <PageHeader title="Fees" subtitle="Track collections, dues and invoices" actions={<Button size="sm"><Download className="size-4 mr-1.5" /> Export</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard icon={Wallet} label="Collected" value="₹ 86.2L" delta={5.4} />
        <KpiCard icon={Wallet} label="Pending" value="₹ 24.8L" delta={-2.1} />
        <KpiCard icon={Wallet} label="Overdue" value="₹ 9.1L" delta={-12.0} />
        <KpiCard icon={Wallet} label="This month" value="₹ 14.6L" delta={8.2} />
      </div>
      <SectionCard title="Recent transactions" description="Last 10 fee payments">
        <EmptyState icon={Wallet} title="Transactions table" desc="Wire to your fees API — columns: invoice, student, term, amount, mode, status." />
      </SectionCard>
    </>
  )
}

function AttendancePage() {
  const [data, setData] = useState(null)
  useEffect(() => { fetch('/api/dashboard/admin').then(r => r.json()).then(setData) }, [])
  return (
    <>
      <PageHeader title="Attendance" subtitle="School-wide attendance analytics" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard icon={ClipboardCheck} label="Today" value="92%" delta={2.1} />
        <KpiCard icon={ClipboardCheck} label="This week" value="91.5%" delta={0.4} />
        <KpiCard icon={ClipboardCheck} label="This month" value="89.7%" delta={-1.1} />
        <KpiCard icon={ClipboardCheck} label="Best class" value="10A" hint="98% avg." />
      </div>
      <SectionCard title="Trend" description="Daily attendance %">
        <div className="h-72">
          {data && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.attendanceTrend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="d" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <RTooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                <Area type="monotone" dataKey="present" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" strokeWidth={2} />
                <Area type="monotone" dataKey="absent" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive) / 0.2)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </SectionCard>
    </>
  )
}

function HomeworkPage() {
  const [hw, setHw] = useState([])
  useEffect(() => { fetch('/api/homework').then(r => r.json()).then(d => setHw(d.homework || [])) }, [])
  return (
    <>
      <PageHeader title="Homework" subtitle="School-wide homework activity" actions={<Button size="sm"><Plus className="size-4 mr-1.5" /> Assign</Button>} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {hw.map(h => (
          <Card key={h.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-muted-foreground">{h.subject} · {h.class}</div>
                <div className="font-medium text-sm mt-0.5">{h.title}</div>
              </div>
              <Badge variant={h.status === 'Completed' ? 'default' : 'outline'}>{h.status}</Badge>
            </div>
            <div className="mt-3"><div className="flex justify-between text-xs mb-1"><span className="text-muted-foreground">Submissions</span><span className="font-medium">{h.submitted}/{h.total}</span></div><div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-primary" style={{ width: (h.submitted/h.total*100) + '%' }} /></div></div>
            <div className="mt-2 text-[11px] text-muted-foreground">Due {h.dueDate}</div>
          </Card>
        ))}
      </div>
    </>
  )
}

function ReportCardsPage() {
  return (
    <>
      <PageHeader title="Report cards" subtitle="Generate, review and publish report cards" actions={<Button size="sm"><FileText className="size-4 mr-1.5" /> Generate batch</Button>} />
      <EmptyState icon={FileText} title="Report card workflow" desc="Hooks into your existing report-cards API. Status pipeline: draft → review → published." />
    </>
  )
}

function AnnouncementsPage() {
  const [ann, setAnn] = useState([])
  useEffect(() => { fetch('/api/announcements').then(r => r.json()).then(d => setAnn(d.announcements || [])) }, [])
  return (
    <>
      <PageHeader title="Announcements" subtitle="Send updates to staff, parents and students" actions={<Button size="sm"><Plus className="size-4 mr-1.5" /> New</Button>} />
      <div className="space-y-3">
        {ann.map(a => (
          <Card key={a.id} className="p-4"><div className="flex items-center justify-between"><div className="font-medium">{a.title}</div><Badge variant="outline">{a.category}</Badge></div><div className="text-sm text-muted-foreground mt-1">{a.body}</div><div className="text-xs text-muted-foreground mt-2">{a.date} · {a.author}</div></Card>
        ))}
      </div>
    </>
  )
}

export const AdminViews = {
  dashboard: <Dashboard />, students: <StudentsPage />, teachers: <TeachersPage />, fees: <FeesPage />, attendance: <AttendancePage />, homework: <HomeworkPage />, reports: <ReportCardsPage />, announcements: <AnnouncementsPage />,
}
