'use client'
// SchoolSync — Admin secondary pages (students, teachers, fees, attendance,
// homework, report cards, announcements). Each is exported individually so
// you can copy them into your real codebase one by one.

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
import {
  AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from 'recharts'
import {
  Wallet, ClipboardCheck, Plus, Upload, Search, Filter, FileText, Download, Eye,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader, KpiCard, SectionCard, StatRow, EmptyState } from '../shared'
import { SchoolSyncAPI } from '@/lib/schoolsync/api'
import type {
  Student, Teacher, Homework, Announcement, AdminDashboardData,
} from '@/lib/schoolsync/types'

// ----- Students -----------------------------------------------------------
export function AdminStudentsPage() {
  const [students, setStudents] = useState<Student[]>([])
  const [q, setQ] = useState('')
  const [grade, setGrade] = useState('all')
  const [feeStatus, setFeeStatus] = useState('all')
  const [selected, setSelected] = useState<Student | null>(null)

  useEffect(() => { SchoolSyncAPI.getStudents().then(setStudents).catch(() => {}) }, [])

  const grades = Array.from(new Set(students.map(s => s.grade))).sort()
  const filtered = students.filter(s =>
    (q === '' || s.name.toLowerCase().includes(q.toLowerCase()) || s.id.toLowerCase().includes(q.toLowerCase())) &&
    (grade === 'all' || s.grade === grade) &&
    (feeStatus === 'all' || s.feeStatus === feeStatus)
  )

  return (
    <>
      <PageHeader
        title="Students"
        subtitle={`${students.length} enrolled · ${filtered.length} shown`}
        actions={<>
          <Button variant="outline" size="sm" onClick={() => toast.message('Bulk import wizard (demo)')}><Upload className="size-4 mr-1.5" /> Bulk import</Button>
          <Button size="sm"><Plus className="size-4 mr-1.5" /> Add student</Button>
        </>}
      />
      <Card className="p-4">
        <div className="flex flex-col md:flex-row md:items-center gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="size-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input placeholder="Search by name or ID..." className="pl-8" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <Select value={grade} onValueChange={setGrade}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Grade" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All grades</SelectItem>
              {grades.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={feeStatus} onValueChange={setFeeStatus}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Fees" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All fees</SelectItem>
              <SelectItem value="Paid">Paid</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
              <SelectItem value="Overdue">Overdue</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm"><Filter className="size-4 mr-1.5" /> More</Button>
        </div>

        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead><TableHead>Grade</TableHead><TableHead>Guardian</TableHead>
                <TableHead>Attendance</TableHead><TableHead>Fees</TableHead><TableHead>Marks</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
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
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm">
                      <div className="w-14"><div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${s.attendance}%` }} /></div></div>
                      {s.attendance}%
                    </div>
                  </TableCell>
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
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="attendance">Attend.</TabsTrigger>
                    <TabsTrigger value="fees">Fees</TabsTrigger>
                    <TabsTrigger value="marks">Marks</TabsTrigger>
                  </TabsList>
                  <TabsContent value="overview" className="space-y-4 mt-4">
                    <StatRow label="Attendance"         value={`${selected.attendance}%`}        percent={selected.attendance} />
                    <StatRow label="Fees paid"          value={`${selected.feePaid}%`}           percent={selected.feePaid} />
                    <StatRow label="Homework submitted" value={`${selected.homeworkSubmitted}%`} percent={selected.homeworkSubmitted} />
                    <StatRow label="Average marks"      value={`${selected.avgMarks}%`}          percent={selected.avgMarks} />
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

// ----- Teachers -----------------------------------------------------------
export function AdminTeachersPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([])
  useEffect(() => { SchoolSyncAPI.getTeachers().then(setTeachers).catch(() => {}) }, [])
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

// ----- Fees ---------------------------------------------------------------
export function AdminFeesPage() {
  return (
    <>
      <PageHeader title="Fees" subtitle="Track collections, dues and invoices" actions={<Button size="sm"><Download className="size-4 mr-1.5" /> Export</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard icon={Wallet} label="Collected"  value="₹ 86.2L" delta={5.4} />
        <KpiCard icon={Wallet} label="Pending"    value="₹ 24.8L" delta={-2.1} />
        <KpiCard icon={Wallet} label="Overdue"    value="₹ 9.1L"  delta={-12.0} />
        <KpiCard icon={Wallet} label="This month" value="₹ 14.6L" delta={8.2} />
      </div>
      <SectionCard title="Recent transactions" description="Last 10 fee payments">
        <EmptyState icon={Wallet} title="Transactions table" desc="Wire to your fees API — columns: invoice, student, term, amount, mode, status." />
      </SectionCard>
    </>
  )
}

// ----- Attendance ---------------------------------------------------------
export function AdminAttendancePage() {
  const [data, setData] = useState<AdminDashboardData | null>(null)
  useEffect(() => { SchoolSyncAPI.getAdminDashboard().then(setData).catch(() => {}) }, [])
  return (
    <>
      <PageHeader title="Attendance" subtitle="School-wide attendance analytics" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard icon={ClipboardCheck} label="Today"      value="92%"   delta={2.1} />
        <KpiCard icon={ClipboardCheck} label="This week"  value="91.5%" delta={0.4} />
        <KpiCard icon={ClipboardCheck} label="This month" value="89.7%" delta={-1.1} />
        <KpiCard icon={ClipboardCheck} label="Best class" value="10A"   hint="98% avg." />
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
                <Area type="monotone" dataKey="present" stroke="hsl(var(--primary))"     fill="hsl(var(--primary) / 0.2)"     strokeWidth={2} />
                <Area type="monotone" dataKey="absent"  stroke="hsl(var(--destructive))" fill="hsl(var(--destructive) / 0.2)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </SectionCard>
    </>
  )
}

// ----- Homework -----------------------------------------------------------
export function AdminHomeworkPage() {
  const [hw, setHw] = useState<Homework[]>([])
  useEffect(() => { SchoolSyncAPI.getHomework().then(setHw).catch(() => {}) }, [])
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
            <div className="mt-3">
              <div className="flex justify-between text-xs mb-1"><span className="text-muted-foreground">Submissions</span><span className="font-medium">{h.submitted}/{h.total}</span></div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-primary" style={{ width: `${(h.submitted / h.total) * 100}%` }} /></div>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">Due {h.dueDate}</div>
          </Card>
        ))}
      </div>
    </>
  )
}

// ----- Report cards -------------------------------------------------------
export function AdminReportCardsPage() {
  return (
    <>
      <PageHeader title="Report cards" subtitle="Generate, review and publish report cards" actions={<Button size="sm"><FileText className="size-4 mr-1.5" /> Generate batch</Button>} />
      <EmptyState icon={FileText} title="Report card workflow" desc="Hooks into your existing report-cards API. Status pipeline: draft → review → published." />
    </>
  )
}

// ----- Announcements ------------------------------------------------------
export function AdminAnnouncementsPage() {
  const [ann, setAnn] = useState<Announcement[]>([])
  useEffect(() => { SchoolSyncAPI.getAnnouncements().then(setAnn).catch(() => {}) }, [])
  return (
    <>
      <PageHeader title="Announcements" subtitle="Send updates to staff, parents and students" actions={<Button size="sm"><Plus className="size-4 mr-1.5" /> New</Button>} />
      <div className="space-y-3">
        {ann.map(a => (
          <Card key={a.id} className="p-4">
            <div className="flex items-center justify-between"><div className="font-medium">{a.title}</div><Badge variant="outline">{a.category}</Badge></div>
            <div className="text-sm text-muted-foreground mt-1">{a.body}</div>
            <div className="text-xs text-muted-foreground mt-2">{a.date} · {a.author}</div>
          </Card>
        ))}
      </div>
    </>
  )
}
