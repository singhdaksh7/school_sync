'use client'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { GraduationCap, Users, BookOpen, Sparkles, Shield, Building2, ArrowRight, CheckCircle2 } from 'lucide-react'
import { useSchool, SchoolLogo } from './theme'

const roleCards = [
  { id: 'admin', label: 'Admin / Owner', icon: Building2, desc: 'Full school control', color: 'from-violet-500 to-indigo-500' },
  { id: 'teacher', label: 'Teacher', icon: BookOpen, desc: 'Classes, marks, homework', color: 'from-sky-500 to-cyan-500' },
  { id: 'parent', label: 'Parent', icon: Users, desc: 'Track your children', color: 'from-emerald-500 to-teal-500' },
  { id: 'student', label: 'Student', icon: GraduationCap, desc: 'Your learning hub', color: 'from-orange-500 to-pink-500' },
]

export default function Landing({ onEnter }) {
  const { school, setSchool, schools } = useSchool()
  return (
    <div className="min-h-screen gradient-mesh">
      {/* Top nav */}
      <header className="flex items-center justify-between p-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl bg-foreground text-background flex items-center justify-center font-bold">S</div>
          <span className="font-bold text-lg tracking-tight">SchoolSync</span>
          <Badge variant="secondary" className="ml-2">Multi-tenant ERP</Badge>
        </div>
        <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
          <Shield className="size-4" /> Trusted by 500+ schools
        </div>
      </header>

      {/* Hero */}
      <main className="max-w-7xl mx-auto px-6 pt-10 pb-20">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <Badge className="mb-5" variant="outline"><Sparkles className="size-3 mr-1" /> One platform, every role</Badge>
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-[1.05]">
              The modern OS for schools.
            </h1>
            <p className="text-lg text-muted-foreground mt-5 max-w-lg">
              SchoolSync brings admins, teachers, parents, and students together with white-label branding, real-time analytics, and beautiful UX across web & mobile.
            </p>
            <ul className="mt-6 space-y-2 text-sm">
              {['Multi-tenant — each school its own world','White-label: logo, colors, domain','Web + Native mobile, single source of truth','Dark mode, mobile responsive, blazing fast'].map(f => (
                <li key={f} className="flex items-center gap-2 text-muted-foreground"><CheckCircle2 className="size-4 text-primary" /> {f}</li>
              ))}
            </ul>
          </motion.div>

          {/* School + Role picker */}
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1 }}>
            <Card className="p-6 shadow-xl border-border/60 backdrop-blur bg-card/80">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Choose your school</div>
                <Badge variant="outline" className="text-[10px]">DEMO</Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3">
                {schools?.map(s => (
                  <button key={s.id} onClick={() => setSchool(s)} className={`p-3 rounded-xl border text-left transition-all ${school?.id === s.id ? 'border-primary ring-2 ring-primary/20 bg-primary/5' : 'border-border hover:border-foreground/20'}`}>
                    <SchoolLogo school={s} size={32} />
                    <div className="mt-2 text-sm font-semibold leading-tight">{s.short}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{s.domain}</div>
                  </button>
                ))}
              </div>
              <div className="mt-6 text-xs uppercase tracking-widest text-muted-foreground font-semibold">Sign in as</div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                {roleCards.map(r => {
                  const Icon = r.icon
                  return (
                    <button key={r.id} onClick={() => onEnter(r.id)} className="group p-4 rounded-xl border border-border hover:border-foreground/20 hover:shadow-md transition-all text-left bg-card">
                      <div className={`size-9 rounded-lg bg-gradient-to-br ${r.color} text-white flex items-center justify-center shadow-sm`}>
                        <Icon className="size-4" />
                      </div>
                      <div className="mt-2.5 font-semibold text-sm">{r.label}</div>
                      <div className="text-xs text-muted-foreground">{r.desc}</div>
                      <div className="mt-2 text-xs text-primary opacity-0 group-hover:opacity-100 transition flex items-center gap-1">Continue <ArrowRight className="size-3" /></div>
                    </button>
                  )
                })}
              </div>
              <div className="mt-5 pt-4 border-t flex items-center justify-between text-xs text-muted-foreground">
                <span>Powered by <span className="font-semibold text-foreground">SchoolSync</span></span>
                <span>{school?.domain}</span>
              </div>
            </Card>
          </motion.div>
        </div>
      </main>
    </div>
  )
}
