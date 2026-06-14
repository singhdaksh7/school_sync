// =============================================================================
// DEMO-ONLY route handler. Returns mock data for the SchoolSync UI demo.
// Delete this file when integrating components into your real codebase.
// =============================================================================

import { NextResponse, type NextRequest } from 'next/server'
import {
  SCHOOLS, STUDENTS, TEACHERS, ANNOUNCEMENTS, EVENTS, HOMEWORK, TIMETABLE,
  CHILDREN, ACHIEVEMENTS, REPORT_CARDS, MARKS_SUBJECTS,
  ADMIN_DASHBOARD, TEACHER_DASHBOARD, STUDENT_DASHBOARD,
} from '@/lib/schoolsync/mock-data'

async function handler(_req: NextRequest, ctx: { params: { path?: string[] } }) {
  const path = (ctx.params?.path || []).join('/')
  try {
    if (path === '' || path === 'health')          return NextResponse.json({ ok: true, app: 'SchoolSync demo API', time: new Date().toISOString() })
    if (path === 'schools')                         return NextResponse.json({ schools: SCHOOLS })
    if (path === 'students')                        return NextResponse.json({ students: STUDENTS })
    if (path === 'teachers')                        return NextResponse.json({ teachers: TEACHERS })
    if (path === 'announcements')                   return NextResponse.json({ announcements: ANNOUNCEMENTS })
    if (path === 'events')                          return NextResponse.json({ events: EVENTS })
    if (path === 'homework')                        return NextResponse.json({ homework: HOMEWORK })
    if (path === 'timetable')                       return NextResponse.json({ timetable: TIMETABLE })
    if (path === 'children')                        return NextResponse.json({ children: CHILDREN })
    if (path === 'achievements')                    return NextResponse.json({ achievements: ACHIEVEMENTS })
    if (path === 'report-cards')                    return NextResponse.json({ reportCards: REPORT_CARDS })
    if (path === 'marks')                           return NextResponse.json({ marks: MARKS_SUBJECTS })
    if (path === 'dashboard/admin')                 return NextResponse.json(ADMIN_DASHBOARD)
    if (path === 'dashboard/teacher')               return NextResponse.json(TEACHER_DASHBOARD)
    if (path === 'dashboard/parent')                return NextResponse.json({ children: CHILDREN })
    if (path === 'dashboard/student')               return NextResponse.json(STUDENT_DASHBOARD)
    return NextResponse.json({ error: 'Not found', path }, { status: 404 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}

export const GET    = handler
export const POST   = handler
export const PUT    = handler
export const DELETE = handler
export const PATCH  = handler
