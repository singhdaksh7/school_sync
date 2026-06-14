'use client'
// SchoolSync — reusable UI building blocks shared across all portals.

import type { ReactNode, ComponentType } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { motion } from 'framer-motion'
import { ArrowUpRight, ArrowDownRight, type LucideIcon } from 'lucide-react'
import type { Timetable } from '@/lib/schoolsync/types'

interface PageHeaderProps { title: string; subtitle?: string; actions?: ReactNode }
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

interface KpiCardProps {
  icon: LucideIcon
  label: string
  value: ReactNode
  hint?: string
  delta?: number
}
export function KpiCard({ icon: Icon, label, value, hint, delta }: KpiCardProps) {
  const up = delta != null && delta >= 0
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="p-5 hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between">
          <div className="size-9 rounded-lg flex items-center justify-center"
               style={{ backgroundColor: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))' }}>
            <Icon className="size-4" />
          </div>
          {delta != null && (
            <Badge variant={up ? 'default' : 'destructive'} className="gap-0.5 text-[10px] h-5">
              {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
              {Math.abs(delta)}%
            </Badge>
          )}
        </div>
        <div className="mt-3 text-2xl font-bold tracking-tight">{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
        {hint && <div className="text-[11px] text-muted-foreground mt-2">{hint}</div>}
      </Card>
    </motion.div>
  )
}

interface SectionCardProps {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}
export function SectionCard({ title, description, action, children, className = '' }: SectionCardProps) {
  return (
    <Card className={`p-5 ${className}`}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  )
}

export function StatRow({ label, value, percent }: { label: string; value: string; percent: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value}</span>
      </div>
      <Progress value={percent} className="h-1.5" />
    </div>
  )
}

export function EmptyState({ icon: Icon, title, desc }: { icon: ComponentType<{ className?: string }>; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-3">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <div className="font-medium text-sm">{title}</div>
      <div className="text-xs text-muted-foreground mt-1">{desc}</div>
    </div>
  )
}

export function TimetableGrid({ timetable }: { timetable: Timetable }) {
  const days = Object.keys(timetable)
  return (
    <Card className="p-2 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="text-left p-2 w-24">Day</th>
            {[1,2,3,4,5,6,7].map(p => <th key={p} className="p-2 text-left">P{p}</th>)}
          </tr>
        </thead>
        <tbody>
          {days.map(d => (
            <tr key={d} className="border-t">
              <td className="p-2 font-medium">{d}</td>
              {timetable[d].map(p => (
                <td key={p.p} className="p-1.5">
                  {p.s === 'Break' || !p.s
                    ? <div className="text-[11px] text-muted-foreground italic p-2">{p.s || '—'}</div>
                    : <div className="p-2 rounded-md bg-primary/5 border border-primary/10">
                        <div className="text-xs font-medium">{p.s}</div>
                        <div className="text-[10px] text-muted-foreground">{p.r}</div>
                      </div>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
