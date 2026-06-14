// SchoolSync — Student portal barrel export.

export { StudentDashboard } from './dashboard'
export {
  StudentHomeworkPage,
  StudentTimetablePage,
  StudentAttendancePage,
  StudentMarksPage,
  StudentReportsPage,
  StudentAnnouncementsPage,
  StudentAchievementsPage,
} from './pages'

import { StudentDashboard } from './dashboard'
import {
  StudentHomeworkPage, StudentTimetablePage, StudentAttendancePage, StudentMarksPage,
  StudentReportsPage, StudentAnnouncementsPage, StudentAchievementsPage,
} from './pages'
import type { ReactNode } from 'react'

export const studentViewMap: Record<string, ReactNode> = {
  dashboard:     <StudentDashboard />,
  homework:      <StudentHomeworkPage />,
  timetable:     <StudentTimetablePage />,
  attendance:    <StudentAttendancePage />,
  marks:         <StudentMarksPage />,
  reports:       <StudentReportsPage />,
  announcements: <StudentAnnouncementsPage />,
  achievements:  <StudentAchievementsPage />,
}
