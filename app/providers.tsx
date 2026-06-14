'use client'
import type { ReactNode } from 'react'
import { ThemeProvider } from 'next-themes'
import { Toaster } from '@/components/ui/sonner'

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      {children}
      <Toaster position="top-right" richColors />
    </ThemeProvider>
  )
}
