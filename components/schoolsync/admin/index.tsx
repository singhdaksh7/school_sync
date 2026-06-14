// SchoolSync — Admin portal barrel export.
// Drop the entire /admin folder into your codebase and import what you need:
//   import { AdminDashboard, AdminStudentsPage } from '@/components/schoolsync/admin'

export { AdminDashboard } from './dashboard'
export {
  AdminStudentsPage,
  AdminTeachersPage,
  AdminFeesPage,
  AdminAttendancePage,
  AdminHomeworkPage,
  AdminReportCardsPage,
  AdminAnnouncementsPage,
} from './pages'

import { AdminDashboard } from './dashboard'
import {
  AdminStudentsPage, AdminTeachersPage, AdminFeesPage, AdminAttendancePage,
  AdminHomeworkPage, AdminReportCardsPage, AdminAnnouncementsPage,
} from './pages'
import type { ReactNode } from 'react'

/** Map a sidebar nav id to the admin view it should render. */
export const adminViewMap: Record<string, ReactNode> = {
  dashboard:      <AdminDashboard />,
  students:       <AdminStudentsPage />,
  teachers:       <AdminTeachersPage />,
  fees:           <AdminFeesPage />,
  attendance:     <AdminAttendancePage />,
  homework:       <AdminHomeworkPage />,
  reports:        <AdminReportCardsPage />,
  announcements:  <AdminAnnouncementsPage />,
}
