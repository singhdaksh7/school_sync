'use client'
// SchoolSync — White-label theme provider.
// Injects the active school's primary HSL into CSS custom properties so the
// entire shadcn/Tailwind palette re-themes instantly across the tree.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { School } from '@/lib/schoolsync/types'

interface SchoolContextValue {
  school: School | null
  setSchool: (s: School) => void
  schools: School[]
}

const SchoolContext = createContext<SchoolContextValue | null>(null)

export function SchoolProvider({ schools, initialSchoolId, children }: { schools: School[]; initialSchoolId?: string; children: ReactNode }) {
  const initial = (initialSchoolId && schools.find(s => s.id === initialSchoolId)) || schools[0] || null
  const [school, setSchool] = useState<School | null>(initial)

  useEffect(() => {
    if (!school) return
    const root = document.documentElement
    root.style.setProperty('--primary', school.primary)
    root.style.setProperty('--ring', school.primary)
    root.style.setProperty('--sidebar-primary', school.primary)
    root.style.setProperty('--sidebar-ring', school.primary)
    root.style.setProperty('--chart-1', school.primary)
  }, [school])

  return (
    <SchoolContext.Provider value={{ school, setSchool, schools }}>
      {children}
    </SchoolContext.Provider>
  )
}

export const useSchool = (): SchoolContextValue => {
  const ctx = useContext(SchoolContext)
  if (!ctx) throw new Error('useSchool must be used within <SchoolProvider />')
  return ctx
}

interface SchoolLogoProps {
  school: School | null
  size?: number
  className?: string
}

export function SchoolLogo({ school, size = 40, className = '' }: SchoolLogoProps) {
  if (!school) return null
  return (
    <div
      className={`flex items-center justify-center rounded-xl font-bold text-white shadow-sm ${className}`}
      style={{
        width: size, height: size,
        background: `linear-gradient(135deg, hsl(${school.primary}), hsl(${school.primary} / 0.7))`,
        fontSize: size * 0.4,
      }}
    >
      {school.initials}
    </div>
  )
}
