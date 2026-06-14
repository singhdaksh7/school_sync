'use client'
import React, { createContext, useContext, useEffect, useState } from 'react'

const SchoolContext = createContext(null)

export function SchoolProvider({ children, schools }) {
  const [school, setSchool] = useState(schools?.[0] || null)

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

export const useSchool = () => useContext(SchoolContext)

export function SchoolLogo({ school, size = 40, className = '' }) {
  if (!school) return null
  return (
    <div
      className={`flex items-center justify-center rounded-xl font-bold text-white shadow-sm ${className}`}
      style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${school.primary}), hsl(${school.primary} / 0.7))`, fontSize: size * 0.4 }}
    >
      {school.initials}
    </div>
  )
}
