// SchoolSync — Teacher portal barrel export.

export { TeacherDashboard } from './dashboard'
export {
  TeacherMarkAttendancePage,
  TeacherTimetablePage,
  TeacherHomeworkPage,
  TeacherArrangementsPage,
  TeacherLeaveRequestsPage,
  TeacherMarksPage,
  TeacherReportsPage,
  TeacherProfilePage,
} from './pages'

import { TeacherDashboard } from './dashboard'
import {
  TeacherMarkAttendancePage, TeacherTimetablePage, TeacherHomeworkPage,
  TeacherArrangementsPage, TeacherLeaveRequestsPage, TeacherMarksPage,
  TeacherReportsPage, TeacherProfilePage,
} from './pages'
import type { ReactNode } from 'react'

export const teacherViewMap: Record<string, ReactNode> = {
  dashboard:    <TeacherDashboard />,
  attendance:   <TeacherMarkAttendancePage />,
  timetable:    <TeacherTimetablePage />,
  homework:     <TeacherHomeworkPage />,
  marks:        <TeacherMarksPage />,
  arrangements: <TeacherArrangementsPage />,
  leaves:       <TeacherLeaveRequestsPage />,
  reports:      <TeacherReportsPage />,
  profile:      <TeacherProfilePage />,
}
