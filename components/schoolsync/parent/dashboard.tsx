'use client'
// =============================================================================
// SchoolSync — #4 Parent Dashboard.
// Renders for a specific child. Use ParentPortal (in ./index) for the
// multi-child switcher experience.
// =============================================================================

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { CreditCard, BookOpen, ClipboardCheck, Calendar, Trophy, Megaphone } from 'lucide-react'
import {
  BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from 'recharts'
import { toast } from 'sonner'
import { KpiCard, SectionCard } from '../shared'
import { SchoolSyncAPI } from '@/lib/schoolsync/api'
import type { Child, MarkRow } from '@/lib/schoolsync/types'

interface ParentDashboardProps {
  child: Child | null
}

export function ParentDashboard({ child }: ParentDashboardProps) {
  const [marks, setMarks] = useState<MarkRow[]>([])
  useEffect(() => { SchoolSyncAPI.getMarks().then(setMarks).catch(() => {}) }, [])
  if (!child) return null
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={ClipboardCheck} label="Attendance" value={`${child.attendance}%`} hint="This month" delta={1.2} />
        <KpiCard icon={CreditCard}     label="Fees"       value={child.feeStatus}        hint={child.feeStatus === 'Pending' ? '₹ 12,500 due' : 'Up to date'} />
        <KpiCard icon={BookOpen}       label="Homework"   value="2 pending"               hint="Math, Science" />
        <KpiCard icon={Trophy}         label="Class rank" value="#3"                     delta={2} />
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
                <Bar dataKey="term2" fill="hsl(var(--primary))"          radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
        <SectionCard title="Quick actions">
          <div className="space-y-2">
            {[
              { l: 'Pay fees',         i: CreditCard },
              { l: 'View homework',    i: BookOpen },
              { l: 'Apply for leave',  i: Calendar },
              { l: 'Message teacher',  i: Megaphone },
            ].map(q => {
              const Icon = q.i
              return (
                <button key={q.l} onClick={() => toast.success(`${q.l} (demo)`)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border hover:border-primary hover:bg-primary/5 text-sm transition">
                  <Icon className="size-4 text-primary" /> {q.l}
                </button>
              )
            })}
          </div>
        </SectionCard>
      </div>
    </>
  )
}
