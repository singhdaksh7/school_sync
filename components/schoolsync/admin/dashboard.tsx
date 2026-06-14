'use client'
// =============================================================================
// SchoolSync — #2 Admin Dashboard.
// Self-contained: fetches its own data via SchoolSyncAPI (swap with your real
// data layer). Pure UI components are imported from ../shared.
// =============================================================================

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { motion } from 'framer-motion'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer,
  XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from 'recharts'
import {
  Users, GraduationCap, Wallet, ClipboardCheck, Megaphone, CalendarDays,
  Plus, Upload, FileText,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader, KpiCard, SectionCard } from '../shared'
import { useSchool } from '../theme'
import { SchoolSyncAPI } from '@/lib/schoolsync/api'
import { CHART_COLORS } from '@/lib/schoolsync/constants'
import type { AdminDashboardData, Announcement, SchoolEvent } from '@/lib/schoolsync/types'

export function AdminDashboard() {
  const { school } = useSchool()
  const [data, setData] = useState<AdminDashboardData | null>(null)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [events, setEvents] = useState<SchoolEvent[]>([])

  useEffect(() => {
    SchoolSyncAPI.getAdminDashboard().then(setData).catch(() => {})
    SchoolSyncAPI.getAnnouncements().then(setAnnouncements).catch(() => {})
    SchoolSyncAPI.getEvents().then(setEvents).catch(() => {})
  }, [])

  if (!data) return <div className="py-20 text-center text-muted-foreground">Loading dashboard...</div>

  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <>
      <PageHeader
        title={`${greet}, Principal 👋`}
        subtitle={`Here's what's happening at ${school?.name ?? 'your school'} today.`}
        actions={<>
          <Button variant="outline" size="sm"><Upload className="size-4 mr-1.5" /> Import</Button>
          <Button size="sm"><Plus className="size-4 mr-1.5" /> Quick action</Button>
        </>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={GraduationCap}  label="Students"          value={data.kpis.students.toLocaleString()} delta={4.2}  hint="+42 admissions this term" />
        <KpiCard icon={Users}          label="Teachers"          value={data.kpis.teachers}                  delta={1.1}  hint="3 new hires this month" />
        <KpiCard icon={Wallet}         label="Fees collected"    value={`${data.kpis.feesCollectedPct}%`}     delta={-3.4} hint="₹ 24.8L pending" />
        <KpiCard icon={ClipboardCheck} label="Attendance today"  value={`${data.kpis.attendancePct}%`}        delta={2.1}  hint="1,182 of 1,284 present" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <SectionCard title="Attendance this week" description="Daily present vs absent (%)" className="lg:col-span-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.attendanceTrend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="hsl(var(--primary))" stopOpacity={0.4} />
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
                  {data.homeworkPie.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <RTooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-3 justify-center mt-2 text-xs">
            {data.homeworkPie.map((s, i) => (
              <div key={s.name} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: CHART_COLORS[i] }} />
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
                <Bar dataKey="pending"   stackId="a" fill="hsl(var(--muted))"   radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Upcoming events" description="Next 30 days" action={<Button variant="ghost" size="sm" className="text-xs">View all</Button>}>
          <div className="space-y-3">
            {events.slice(0, 4).map(e => (
              <div key={e.id} className="flex items-start gap-3">
                <div className="size-10 rounded-lg flex flex-col items-center justify-center text-[10px] font-semibold leading-none border"
                     style={{ borderColor: 'hsl(var(--primary))', color: 'hsl(var(--primary))' }}>
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
            {announcements.map(a => (
              <motion.div key={a.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-3 rounded-lg border hover:bg-muted/40 transition">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{a.title}</div>
                  <Badge variant="outline" className="text-[10px]">{a.category}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.body}</div>
                <div className="text-[10px] text-muted-foreground mt-1.5">{a.date} · {a.author}</div>
              </motion.div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Quick actions" description="Most used">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Add student',         icon: GraduationCap  },
              { label: 'Mark attendance',     icon: ClipboardCheck },
              { label: 'Collect fees',        icon: Wallet         },
              { label: 'Post announcement',   icon: Megaphone      },
              { label: 'New event',           icon: CalendarDays   },
              { label: 'Generate report',     icon: FileText       },
            ].map(q => {
              const Icon = q.icon
              return (
                <button key={q.label} onClick={() => toast.success(`${q.label} (demo)`)}
                  className="flex items-center gap-2 p-3 rounded-lg border hover:border-primary hover:bg-primary/5 transition text-sm">
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
