import { NextResponse } from 'next/server'

// ---------- MOCK DATA ----------
const SCHOOLS = [
  {
    id: 'greenwood',
    name: 'Greenwood International School',
    short: 'Greenwood',
    initials: 'GW',
    tagline: 'Nurture. Grow. Thrive.',
    domain: 'greenwood.schoolsync.app',
    primary: '152 76% 36%',
    accent: '152 76% 96%',
    address: '12 Greenwood Lane, Bengaluru',
    students: 1284,
    teachers: 96,
  },
  {
    id: 'riverside',
    name: 'Riverside Academy',
    short: 'Riverside',
    initials: 'RA',
    tagline: 'Where curiosity flows.',
    domain: 'riverside.schoolsync.app',
    primary: '217 91% 50%',
    accent: '217 91% 96%',
    address: '45 River Road, Pune',
    students: 842,
    teachers: 64,
  },
  {
    id: 'sunrise',
    name: 'Sunrise Public School',
    short: 'Sunrise',
    initials: 'SP',
    tagline: 'A new day, a new beginning.',
    domain: 'sunrise.schoolsync.app',
    primary: '25 95% 53%',
    accent: '25 95% 96%',
    address: '8 Sunrise Avenue, Mumbai',
    students: 1612,
    teachers: 112,
  },
]

const FIRST = ['Aarav','Ananya','Ishaan','Diya','Vihaan','Saanvi','Arjun','Myra','Kabir','Anaya','Reyansh','Aadhya','Vivaan','Pari','Rudra','Aanya','Ayaan','Riya','Krishna','Kiara']
const LAST = ['Sharma','Verma','Patel','Iyer','Reddy','Khan','Gupta','Singh','Nair','Mehta','Kapoor','Joshi','Rao','Das','Bose']
const GRADES = ['6A','6B','7A','7B','8A','8B','9A','9B','10A','10B']
const SUBJECTS = ['Mathematics','Science','English','Social Studies','Hindi','Computer Science','Art','Physical Education']

const seed = (n) => { let x = Math.sin(n) * 10000; return x - Math.floor(x) }

const makeStudents = () => Array.from({ length: 42 }).map((_, i) => {
  const r = seed(i + 1)
  const r2 = seed(i + 50)
  return {
    id: `STU-${1000 + i}`,
    name: `${FIRST[i % FIRST.length]} ${LAST[Math.floor(r * LAST.length)]}`,
    grade: GRADES[Math.floor(r2 * GRADES.length)],
    rollNo: 100 + i,
    gender: i % 2 === 0 ? 'M' : 'F',
    guardian: `${FIRST[(i + 3) % FIRST.length]} ${LAST[Math.floor(r * LAST.length)]}`,
    phone: `+91 9${Math.floor(r * 900000000 + 100000000)}`,
    attendance: Math.round(78 + r * 22),
    feeStatus: r > 0.7 ? 'Overdue' : r > 0.3 ? 'Paid' : 'Pending',
    feePaid: Math.round(r * 100),
    homeworkSubmitted: Math.round(60 + r * 40),
    avgMarks: Math.round(58 + r * 40),
    avatar: null,
  }
})

const makeTeachers = () => Array.from({ length: 18 }).map((_, i) => {
  const r = seed(i + 100)
  return {
    id: `TCH-${200 + i}`,
    name: `${FIRST[(i + 5) % FIRST.length]} ${LAST[Math.floor(r * LAST.length)]}`,
    subject: SUBJECTS[i % SUBJECTS.length],
    classes: [GRADES[i % GRADES.length], GRADES[(i + 3) % GRADES.length]],
    email: `teacher${i}@school.edu`,
    experience: 2 + Math.floor(r * 18),
  }
})

const ANNOUNCEMENTS = [
  { id: 'a1', title: 'Annual Sports Day', body: 'Annual Sports Day will be held on 22nd June at the main ground. All students must report by 8 AM.', date: '2025-06-15', category: 'Event', author: 'Principal' },
  { id: 'a2', title: 'Parent-Teacher Meeting', body: 'PTM scheduled for Saturday for grades 6-10. Please confirm your slot via the parent portal.', date: '2025-06-12', category: 'PTM', author: 'Admin' },
  { id: 'a3', title: 'Holiday Notice', body: 'School will remain closed on 18th June on account of Eid-ul-Adha.', date: '2025-06-10', category: 'Holiday', author: 'Admin' },
  { id: 'a4', title: 'Science Fair Submissions', body: 'Submit your science fair project proposals by 25th June.', date: '2025-06-08', category: 'Academic', author: 'Vice Principal' },
]

const EVENTS = [
  { id: 'e1', title: 'Annual Sports Day', date: '2025-06-22', time: '08:00', location: 'Main Ground', color: 'chart-1' },
  { id: 'e2', title: 'Parent-Teacher Meeting', date: '2025-06-21', time: '10:00', location: 'Assembly Hall', color: 'chart-2' },
  { id: 'e3', title: 'Science Fair', date: '2025-07-05', time: '09:00', location: 'Lab Block', color: 'chart-3' },
  { id: 'e4', title: 'Inter-School Debate', date: '2025-07-12', time: '14:00', location: 'Auditorium', color: 'chart-4' },
]

const HOMEWORK = [
  { id: 'h1', subject: 'Mathematics', title: 'Quadratic equations - Ex 4.3', dueDate: '2025-06-20', class: '10A', submitted: 28, total: 34, status: 'Active' },
  { id: 'h2', subject: 'Science', title: 'Photosynthesis lab report', dueDate: '2025-06-22', class: '9B', submitted: 18, total: 32, status: 'Active' },
  { id: 'h3', subject: 'English', title: 'Essay - My favourite book', dueDate: '2025-06-18', class: '8A', submitted: 30, total: 30, status: 'Completed' },
  { id: 'h4', subject: 'Social Studies', title: 'Map work - Indian rivers', dueDate: '2025-06-25', class: '7A', submitted: 5, total: 28, status: 'Active' },
  { id: 'h5', subject: 'Computer Science', title: 'Python loops worksheet', dueDate: '2025-06-19', class: '10B', submitted: 22, total: 30, status: 'Active' },
]

const TIMETABLE = {
  Monday:    [{p:1,s:'Mathematics',t:'Mrs. Sharma',r:'201'},{p:2,s:'English',t:'Mr. Verma',r:'202'},{p:3,s:'Science',t:'Ms. Iyer',r:'Lab 1'},{p:4,s:'Break',t:'',r:''},{p:5,s:'Social Studies',t:'Mr. Das',r:'203'},{p:6,s:'Hindi',t:'Mrs. Joshi',r:'201'},{p:7,s:'PE',t:'Coach Khan',r:'Ground'}],
  Tuesday:   [{p:1,s:'Science',t:'Ms. Iyer',r:'Lab 1'},{p:2,s:'Mathematics',t:'Mrs. Sharma',r:'201'},{p:3,s:'Computer Sc.',t:'Mr. Singh',r:'Lab 2'},{p:4,s:'Break',t:'',r:''},{p:5,s:'English',t:'Mr. Verma',r:'202'},{p:6,s:'Art',t:'Mrs. Kapoor',r:'Art Rm'},{p:7,s:'Hindi',t:'Mrs. Joshi',r:'201'}],
  Wednesday: [{p:1,s:'English',t:'Mr. Verma',r:'202'},{p:2,s:'Social Studies',t:'Mr. Das',r:'203'},{p:3,s:'Mathematics',t:'Mrs. Sharma',r:'201'},{p:4,s:'Break',t:'',r:''},{p:5,s:'Science',t:'Ms. Iyer',r:'Lab 1'},{p:6,s:'Computer Sc.',t:'Mr. Singh',r:'Lab 2'},{p:7,s:'Library',t:'',r:'Lib'}],
  Thursday:  [{p:1,s:'Hindi',t:'Mrs. Joshi',r:'201'},{p:2,s:'Mathematics',t:'Mrs. Sharma',r:'201'},{p:3,s:'English',t:'Mr. Verma',r:'202'},{p:4,s:'Break',t:'',r:''},{p:5,s:'Science',t:'Ms. Iyer',r:'Lab 1'},{p:6,s:'Social Studies',t:'Mr. Das',r:'203'},{p:7,s:'PE',t:'Coach Khan',r:'Ground'}],
  Friday:    [{p:1,s:'Mathematics',t:'Mrs. Sharma',r:'201'},{p:2,s:'Computer Sc.',t:'Mr. Singh',r:'Lab 2'},{p:3,s:'English',t:'Mr. Verma',r:'202'},{p:4,s:'Break',t:'',r:''},{p:5,s:'Hindi',t:'Mrs. Joshi',r:'201'},{p:6,s:'Art',t:'Mrs. Kapoor',r:'Art Rm'},{p:7,s:'Assembly',t:'',r:'Hall'}],
}

const ATTENDANCE_TREND = [
  { d: 'Mon', present: 92, absent: 8 },
  { d: 'Tue', present: 95, absent: 5 },
  { d: 'Wed', present: 89, absent: 11 },
  { d: 'Thu', present: 94, absent: 6 },
  { d: 'Fri', present: 91, absent: 9 },
  { d: 'Sat', present: 88, absent: 12 },
]

const FEES_TREND = [
  { m: 'Jan', collected: 82, pending: 18 },
  { m: 'Feb', collected: 88, pending: 12 },
  { m: 'Mar', collected: 76, pending: 24 },
  { m: 'Apr', collected: 92, pending: 8 },
  { m: 'May', collected: 85, pending: 15 },
  { m: 'Jun', collected: 71, pending: 29 },
]

const HOMEWORK_PIE = [
  { name: 'Submitted', value: 68 },
  { name: 'Pending', value: 22 },
  { name: 'Overdue', value: 10 },
]

const MARKS_SUBJECTS = [
  { subject: 'Math', term1: 78, term2: 84 },
  { subject: 'Science', term1: 82, term2: 88 },
  { subject: 'English', term1: 74, term2: 79 },
  { subject: 'Social', term1: 80, term2: 76 },
  { subject: 'Hindi', term1: 72, term2: 81 },
  { subject: 'CS', term1: 90, term2: 94 },
]

const REPORT_CARDS = [
  { term: 'Term 1 (2024-25)', percentage: 79.2, grade: 'A', rank: 7, status: 'Published' },
  { term: 'Mid-Term (2024-25)', percentage: 81.6, grade: 'A', rank: 5, status: 'Published' },
  { term: 'Term 2 (2024-25)', percentage: 84.3, grade: 'A+', rank: 3, status: 'Published' },
]

const ACHIEVEMENTS = [
  { id: 'ach1', title: 'Math Olympiad - Gold', date: '2025-03-12', icon: 'trophy' },
  { id: 'ach2', title: 'Best Speaker - Debate', date: '2025-02-04', icon: 'mic' },
  { id: 'ach3', title: '100% Attendance - Q1', date: '2025-01-30', icon: 'award' },
  { id: 'ach4', title: 'Inter-school Football Cup', date: '2024-12-18', icon: 'medal' },
]

const CHILDREN = [
  { id: 'STU-1003', name: 'Diya Sharma', grade: '8A', avatar: null, attendance: 94, feeStatus: 'Paid' },
  { id: 'STU-1007', name: 'Vihaan Sharma', grade: '5B', avatar: null, attendance: 88, feeStatus: 'Pending' },
]

// ---------- ROUTER ----------
async function handler(request, { params }) {
  const path = (params?.path || []).join('/')
  const method = request.method

  try {
    if (path === '' || path === 'health') return NextResponse.json({ ok: true, app: 'SchoolSync API', time: new Date().toISOString() })
    if (path === 'schools') return NextResponse.json({ schools: SCHOOLS })
    if (path === 'students') return NextResponse.json({ students: makeStudents() })
    if (path === 'teachers') return NextResponse.json({ teachers: makeTeachers() })
    if (path === 'announcements') return NextResponse.json({ announcements: ANNOUNCEMENTS })
    if (path === 'events') return NextResponse.json({ events: EVENTS })
    if (path === 'homework') return NextResponse.json({ homework: HOMEWORK })
    if (path === 'timetable') return NextResponse.json({ timetable: TIMETABLE })
    if (path === 'children') return NextResponse.json({ children: CHILDREN })
    if (path === 'achievements') return NextResponse.json({ achievements: ACHIEVEMENTS })
    if (path === 'report-cards') return NextResponse.json({ reportCards: REPORT_CARDS })
    if (path === 'marks') return NextResponse.json({ marks: MARKS_SUBJECTS })
    if (path === 'dashboard/admin') {
      return NextResponse.json({
        attendanceTrend: ATTENDANCE_TREND,
        feesTrend: FEES_TREND,
        homeworkPie: HOMEWORK_PIE,
        kpis: { students: 1284, teachers: 96, feesCollectedPct: 78, attendancePct: 92 },
      })
    }
    if (path === 'dashboard/teacher') {
      return NextResponse.json({
        todayClasses: TIMETABLE.Monday,
        pendingHomework: 14,
        submissionsToReview: 22,
        arrangements: 2,
        leaveRequests: 3,
      })
    }
    if (path === 'dashboard/parent') return NextResponse.json({ children: CHILDREN })
    if (path === 'dashboard/student') {
      return NextResponse.json({
        nextClass: { subject: 'Mathematics', teacher: 'Mrs. Sharma', room: '201', time: '09:00' },
        homeworkDue: 4,
        attendancePct: 94,
        avgMarks: 84,
        achievements: ACHIEVEMENTS.slice(0, 3),
      })
    }
    return NextResponse.json({ error: 'Not found', path }, { status: 404 })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const DELETE = handler
export const PATCH = handler
