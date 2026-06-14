'use client'
// SchoolSync — Teacher secondary pages.

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import { ArrowRightLeft, FileText, UserCheck, Plus, Send, Check, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader, EmptyState, TimetableGrid } from '../shared'
import { SchoolSyncAPI } from '@/lib/schoolsync/api'
import type { Homework, Student, Timetable } from '@/lib/schoolsync/types'

// ----- Mark attendance ----------------------------------------------------
export function TeacherMarkAttendancePage() {
  const [students, setStudents] = useState<Student[]>([])
  const [present, setPresent] = useState<Record<string, boolean>>({})

  useEffect(() => {
    SchoolSyncAPI.getStudents().then(list => {
      const slice = list.slice(0, 28)
      setStudents(slice)
      const init: Record<string, boolean> = {}
      slice.forEach(s => { init[s.id] = true })
      setPresent(init)
    }).catch(() => {})
  }, [])

  const presentCount = Object.values(present).filter(Boolean).length
  const total = students.length

  return (
    <>
      <PageHeader
        title="Mark attendance · 10A"
        subtitle="Monday, Period 1 · Mathematics"
        actions={<>
          <Button variant="outline" size="sm" onClick={() => {
            const all: Record<string, boolean> = {}
            students.forEach(s => { all[s.id] = true })
            setPresent(all)
          }}>Mark all present</Button>
          <Button size="sm" onClick={() => toast.success('Attendance saved')}><Check className="size-4 mr-1.5" /> Save</Button>
        </>}
      />
      <Card className="p-2">
        <div className="flex items-center justify-between p-3">
          <div className="text-sm"><span className="font-semibold">{presentCount}</span> / {total} present</div>
          <Badge variant="outline">{Math.round(presentCount / Math.max(total, 1) * 100)}%</Badge>
        </div>
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

// ----- Timetable ---------------------------------------------------------
export function TeacherTimetablePage() {
  const [tt, setTt] = useState<Timetable>({})
  useEffect(() => { SchoolSyncAPI.getTimetable().then(setTt).catch(() => {}) }, [])
  return (<><PageHeader title="Timetable" subtitle="Weekly schedule" /><TimetableGrid timetable={tt} /></>)
}

// ----- Homework ----------------------------------------------------------
export function TeacherHomeworkPage() {
  const [hw, setHw] = useState<Homework[]>([])
  useEffect(() => { SchoolSyncAPI.getHomework().then(setHw).catch(() => {}) }, [])
  return (
    <>
      <PageHeader title="Homework" subtitle="Assignments you've posted" actions={<Button size="sm"><Plus className="size-4 mr-1.5" /> Assign new</Button>} />
      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="review">To review</TabsTrigger>
          <TabsTrigger value="done">Completed</TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
          {hw.filter(h => h.status === 'Active').map(h => (
            <Card key={h.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">{h.subject} · {h.class}</div>
                  <div className="font-medium text-sm mt-0.5">{h.title}</div>
                </div>
                <Badge variant="outline">{h.status}</Badge>
              </div>
              <div className="mt-3 text-xs flex justify-between">
                <span className="text-muted-foreground">{h.submitted}/{h.total} submitted</span>
                <span className="text-muted-foreground">Due {h.dueDate}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1.5">
                <div className="h-full bg-primary" style={{ width: `${(h.submitted / h.total) * 100}%` }} />
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" className="text-xs">View submissions</Button>
                <Button size="sm" variant="ghost"   className="text-xs">Edit</Button>
              </div>
            </Card>
          ))}
        </TabsContent>
        <TabsContent value="review"><EmptyState icon={FileText} title="22 submissions waiting" desc="Open any homework to grade individual submissions." /></TabsContent>
        <TabsContent value="done" className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
          {hw.filter(h => h.status === 'Completed').map(h => (
            <Card key={h.id} className="p-4 opacity-80">
              <div className="font-medium text-sm">{h.title}</div>
              <div className="text-xs text-muted-foreground">{h.subject} · {h.class} · {h.submitted}/{h.total}</div>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </>
  )
}

// ----- Arrangements / Leaves / Misc -------------------------------------
export function TeacherArrangementsPage() {
  const items = [
    { d: 'Tomorrow', p: 'P3', s: 'Science', c: '9B',  sub: 'Mrs. Sharma' },
    { d: 'Fri 20',   p: 'P5', s: 'English', c: '10A', sub: 'Mr. Verma' },
  ]
  return (
    <>
      <PageHeader title="Class arrangements" subtitle="Substitute teacher assignments" actions={<Button size="sm"><Plus className="size-4 mr-1.5" /> Request arrangement</Button>} />
      <div className="space-y-3">
        {items.map((a, i) => (
          <Card key={i} className="p-4 flex items-center gap-4">
            <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><ArrowRightLeft className="size-4" /></div>
            <div className="flex-1">
              <div className="text-sm font-medium">{a.s} · {a.c}</div>
              <div className="text-xs text-muted-foreground">{a.d} · {a.p} · Cover by {a.sub}</div>
            </div>
            <Badge>Approved</Badge>
          </Card>
        ))}
      </div>
    </>
  )
}

export function TeacherLeaveRequestsPage() {
  const requests = [
    { n: 'Ananya Patel', c: '8A',  r: 'Medical appointment', t: '13:00' },
    { n: 'Rudra Mehta',  c: '10B', r: 'Family function',     t: '14:30' },
    { n: 'Aanya Iyer',   c: '7A',  r: 'Doctor visit',        t: '12:00' },
  ]
  return (
    <>
      <PageHeader title="Early leave requests" subtitle="Student early-leave approvals" />
      <div className="space-y-3">
        {requests.map((l, i) => (
          <Card key={i} className="p-4 flex items-center gap-3">
            <Avatar><AvatarFallback>{l.n.split(' ').map(n => n[0]).slice(0, 2).join('')}</AvatarFallback></Avatar>
            <div className="flex-1">
              <div className="text-sm font-medium">{l.n} · <span className="text-muted-foreground">{l.c}</span></div>
              <div className="text-xs text-muted-foreground">{l.r} · leave at {l.t}</div>
            </div>
            <Button variant="outline" size="sm" onClick={() => toast.error('Denied')}>Deny</Button>
            <Button size="sm" onClick={() => toast.success('Approved')}>Approve</Button>
          </Card>
        ))}
      </div>
    </>
  )
}

export function TeacherMarksPage() {
  return (<>
    <PageHeader title="Marks" subtitle="Enter and publish student marks" actions={<Button size="sm"><Send className="size-4 mr-1.5" /> Publish</Button>} />
    <EmptyState icon={FileText} title="Marks entry" desc="Choose a class and exam to start entering marks." />
  </>)
}

export function TeacherReportsPage() {
  return (<><PageHeader title="Report cards" /><EmptyState icon={FileText} title="Generate report cards" desc="Compile term reports for your assigned classes." /></>)
}

export function TeacherProfilePage() {
  return (<><PageHeader title="Profile" /><EmptyState icon={UserCheck} title="Your profile" desc="Personal info, qualifications, classes, schedule." /></>)
}
