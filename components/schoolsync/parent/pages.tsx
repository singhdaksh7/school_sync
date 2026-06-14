'use client'
// SchoolSync — Parent secondary pages.

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CreditCard, BookOpen, FileText, Award, Upload, Download } from 'lucide-react'
import { toast } from 'sonner'
import { KpiCard, SectionCard, EmptyState, TimetableGrid } from '../shared'
import { SchoolSyncAPI } from '@/lib/schoolsync/api'
import type { Announcement, Child, Homework, Timetable } from '@/lib/schoolsync/types'

export function ParentFeesPage({ child: _child }: { child: Child | null }) {
  const invoices = [
    { inv: 'INV-1042', d: 'Tuition Q2', amt: 15000, st: 'Paid' },
    { inv: 'INV-1041', d: 'Bus fee Q2', amt: 6000,  st: 'Paid' },
    { inv: 'INV-1040', d: 'Lab fee',    amt: 3500,  st: 'Paid' },
    { inv: 'INV-1039', d: 'Tuition Q3', amt: 12500, st: 'Due' },
  ]
  return (<>
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
      <KpiCard icon={CreditCard} label="This term" value="₹ 42,500" />
      <KpiCard icon={CreditCard} label="Paid"      value="₹ 30,000" />
      <KpiCard icon={CreditCard} label="Due"       value="₹ 12,500" hint="Due 30 June" />
    </div>
    <SectionCard title="Invoices" description="Last 6 months" action={<Button size="sm" onClick={() => toast.success('Payment initiated (demo)')}><CreditCard className="size-4 mr-1.5" /> Pay now</Button>}>
      {invoices.map(i => (
        <div key={i.inv} className="flex items-center gap-3 py-3 border-b last:border-0">
          <div className="size-9 rounded-lg bg-muted flex items-center justify-center"><FileText className="size-4 text-muted-foreground" /></div>
          <div className="flex-1">
            <div className="text-sm font-medium">{i.d}</div>
            <div className="text-[11px] text-muted-foreground">{i.inv}</div>
          </div>
          <div className="text-sm font-medium">₹ {i.amt.toLocaleString()}</div>
          <Badge variant={i.st === 'Paid' ? 'default' : 'destructive'}>{i.st}</Badge>
          <Button variant="ghost" size="icon" className="size-7"><Download className="size-3.5" /></Button>
        </div>
      ))}
    </SectionCard>
  </>)
}

export function ParentHomeworkPage() {
  const [hw, setHw] = useState<Homework[]>([])
  useEffect(() => { SchoolSyncAPI.getHomework().then(setHw).catch(() => {}) }, [])
  return (
    <Tabs defaultValue="pending">
      <TabsList>
        <TabsTrigger value="pending">Pending</TabsTrigger>
        <TabsTrigger value="submitted">Submitted</TabsTrigger>
      </TabsList>
      <TabsContent value="pending" className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        {hw.slice(0, 3).map(h => (
          <Card key={h.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[11px] text-muted-foreground">{h.subject}</div>
                <div className="font-medium text-sm">{h.title}</div>
              </div>
              <Badge variant="outline">Due {h.dueDate}</Badge>
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" className="text-xs" onClick={() => toast.success('Submitted')}><Upload className="size-3.5 mr-1" /> Submit</Button>
              <Button size="sm" variant="outline" className="text-xs">View</Button>
            </div>
          </Card>
        ))}
      </TabsContent>
      <TabsContent value="submitted">
        <EmptyState icon={BookOpen} title="Submitted homework" desc="All submitted assignments with teacher feedback." />
      </TabsContent>
    </Tabs>
  )
}

export function ParentAttendancePage({ child }: { child: Child | null }) {
  // Deterministic mock heatmap — wire to real per-day attendance feed.
  const data = Array.from({ length: 30 }).map((_, i) => ({ d: i + 1, present: ((i * 7 + 3) % 11) !== 0 }))
  return (<>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <KpiCard icon={ClipboardCheck} label="This month" value={`${child?.attendance ?? 0}%`} />
      <KpiCard icon={ClipboardCheck} label="Year"        value="92%" />
      <KpiCard icon={ClipboardCheck} label="Absences"    value="3" />
      <KpiCard icon={ClipboardCheck} label="Leaves"      value="2" />
    </div>
    <SectionCard title="This month" description="Green = present, Red = absent">
      <div className="grid grid-cols-7 sm:grid-cols-10 md:grid-cols-15 gap-1.5">
        {data.map(d => (
          <div key={d.d} title={`Day ${d.d}`} className={`aspect-square rounded ${d.present ? 'bg-primary/70' : 'bg-destructive/60'} text-[9px] text-white flex items-center justify-center`}>{d.d}</div>
        ))}
      </div>
    </SectionCard>
  </>)
}

export function ParentTimetablePage() {
  const [tt, setTt] = useState<Timetable>({})
  useEffect(() => { SchoolSyncAPI.getTimetable().then(setTt).catch(() => {}) }, [])
  return <TimetableGrid timetable={tt} />
}

export function ParentMarksPage() {
  return <EmptyState icon={Award} title="Marks summary" desc="Subject-wise marks with comparison and download." />
}
export function ParentReportsPage() {
  return <EmptyState icon={FileText} title="Report cards" desc="Download published term report cards for your child." />
}

export function ParentAnnouncementsPage() {
  const [ann, setAnn] = useState<Announcement[]>([])
  useEffect(() => { SchoolSyncAPI.getAnnouncements().then(setAnn).catch(() => {}) }, [])
  return (
    <div className="space-y-3">
      {ann.map(a => (
        <Card key={a.id} className="p-4">
          <div className="flex items-center justify-between"><div className="font-medium">{a.title}</div><Badge variant="outline">{a.category}</Badge></div>
          <div className="text-sm text-muted-foreground mt-1">{a.body}</div>
          <div className="text-xs text-muted-foreground mt-2">{a.date}</div>
        </Card>
      ))}
    </div>
  )
}
