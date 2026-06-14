'use client'
// SchoolSync — App shell: sidebar + topbar + responsive sheet.
// Receives the active role's nav config and renders children inside the layout.

import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { useTheme } from 'next-themes'
import { Bell, Search, Menu, Moon, Sun, ChevronsUpDown, Check, LogOut, Settings, User } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSchool, SchoolLogo } from './theme'
import type { RoleConfig } from '@/lib/schoolsync/types'

interface AppShellProps {
  roleConfig: RoleConfig
  currentView: string
  setView: (id: string) => void
  onSignOut: () => void
  children: ReactNode
}

export function AppShell({ roleConfig, currentView, setView, onSignOut, children }: AppShellProps) {
  const { school, setSchool, schools } = useSchool()
  const { theme, setTheme } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)

  const NavList = (
    <nav className="flex flex-col gap-0.5 px-3">
      {roleConfig.nav.map(item => {
        const Icon = item.icon
        const active = currentView === item.id
        return (
          <button
            key={item.id}
            onClick={() => { setView(item.id); setMobileOpen(false) }}
            className={`flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-all ${active ? 'bg-primary text-primary-foreground font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
          >
            <Icon className="size-4 shrink-0" />
            <span>{item.label}</span>
            {item.badge != null && (
              <Badge variant={active ? 'secondary' : 'outline'} className="ml-auto text-[10px] h-5 px-1.5">{item.badge}</Badge>
            )}
          </button>
        )
      })}
    </nav>
  )

  const SidebarBody = (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="p-4 flex items-center gap-2">
        <SchoolLogo school={school} size={36} />
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{school?.short}</div>
          <div className="text-[11px] text-muted-foreground truncate">{school?.domain}</div>
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="mx-3 mb-3 flex items-center gap-2 px-2.5 py-2 rounded-lg border border-sidebar-border hover:bg-sidebar-accent text-sm">
            <SchoolLogo school={school} size={22} />
            <span className="flex-1 text-left truncate">{school?.name}</span>
            <ChevronsUpDown className="size-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72" align="start">
          <DropdownMenuLabel className="text-xs">Switch school (white-label demo)</DropdownMenuLabel>
          {schools.map(s => (
            <DropdownMenuItem key={s.id} onClick={() => setSchool(s)} className="gap-2 py-2">
              <SchoolLogo school={s} size={28} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{s.short}</div>
                <div className="text-[11px] text-muted-foreground truncate">{s.tagline}</div>
              </div>
              {school?.id === s.id && <Check className="size-4 text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="px-3 pb-1 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{roleConfig.label}</div>
      <div className="flex-1 overflow-y-auto no-scrollbar pt-1 pb-4">{NavList}</div>
      <div className="p-3 border-t border-sidebar-border">
        <div className="text-[10px] text-muted-foreground text-center">Powered by <span className="font-semibold text-foreground">SchoolSync</span></div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-background flex">
      <aside className="hidden lg:flex w-64 shrink-0 sticky top-0 h-screen">{SidebarBody}</aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur border-b border-border">
          <div className="flex items-center gap-3 px-4 lg:px-6 h-14">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden"><Menu className="size-5" /></Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-72">{SidebarBody}</SheetContent>
            </Sheet>
            <div className="hidden md:flex items-center gap-2 px-3 h-9 rounded-lg bg-muted text-muted-foreground text-sm flex-1 max-w-md">
              <Search className="size-4" />
              <span>Search students, classes, homework...</span>
              <kbd className="ml-auto text-[10px] bg-background border rounded px-1.5 py-0.5">⌘K</kbd>
            </div>
            <div className="flex-1 md:hidden" />
            <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="size-4" />
              <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 hover:bg-muted px-2 py-1 rounded-lg">
                  <Avatar className="size-7"><AvatarFallback className="text-[11px] bg-primary text-primary-foreground">{roleConfig.initials}</AvatarFallback></Avatar>
                  <div className="hidden md:block text-left">
                    <div className="text-xs font-medium leading-tight">{roleConfig.userName}</div>
                    <div className="text-[10px] text-muted-foreground leading-tight">{roleConfig.label}</div>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>{roleConfig.userName}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem><User className="size-4 mr-2" /> Profile</DropdownMenuItem>
                <DropdownMenuItem><Settings className="size-4 mr-2" /> Settings</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onSignOut} className="text-destructive"><LogOut className="size-4 mr-2" /> Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <AnimatePresence mode="wait">
          <motion.main
            key={currentView}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="p-4 lg:p-6 max-w-[1400px] mx-auto w-full"
          >
            {children}
          </motion.main>
        </AnimatePresence>
      </div>
    </div>
  )
}
