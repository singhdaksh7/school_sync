import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  GraduationCap, Users, BookOpen, ClipboardCheck,
  ArrowRight, School, UserCog, Briefcase, Lock,
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">

      {/* Navbar */}
      <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">SchoolSync</span>
          </div>
          <Link href="/register">
            <Button variant="outline" size="sm" className="gap-2">
              <School className="w-4 h-4" /> Register School
            </Button>
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 pt-20 pb-12 text-center">
        <div className="max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-700 text-sm font-medium px-4 py-1.5 rounded-full mb-6">
            <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
            School Management Platform
          </div>
          <h1 className="text-5xl font-bold text-gray-900 leading-tight mb-5">
            Welcome to<br />
            <span className="text-blue-600">SchoolSync</span>
          </h1>
          <p className="text-lg text-gray-500 leading-relaxed">
            One platform for teachers, students, and school administration.
            Attendance, timetables, results — all in one place.
          </p>
        </div>
      </section>

      {/* Main two-panel section */}
      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">

          {/* Left: Onboard a new school */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-br from-blue-600 to-blue-700 px-6 py-8 text-white">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mb-4">
                <School className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Register Your School</h2>
              <p className="text-blue-100 text-sm leading-relaxed">
                Set up your school&apos;s management system in minutes. Add classes, teachers, students, and go live immediately.
              </p>
            </div>
            <div className="px-6 py-6 space-y-4">
              {[
                { icon: Users, text: "Add teachers & assign classes" },
                { icon: BookOpen, text: "Manage students with CSV import" },
                { icon: ClipboardCheck, text: "Daily attendance & exam results" },
              ].map((item) => (
                <div key={item.text} className="flex items-center gap-3 text-sm text-gray-600">
                  <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
                    <item.icon className="w-4 h-4 text-blue-600" />
                  </div>
                  {item.text}
                </div>
              ))}
              <div className="pt-2">
                <Link href="/register">
                  <Button className="w-full gap-2 mt-1">
                    Get Started Free <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          {/* Right: Portal logins */}
          <div className="space-y-4">
            <div className="px-1">
              <h2 className="text-xl font-bold text-gray-900">Portal Login</h2>
              <p className="text-sm text-gray-500 mt-0.5">Sign in to your respective portal below</p>
            </div>

            {/* Admin Login */}
            <Link href="/login">
              <div className="group bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4 flex items-center gap-4 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer">
                <div className="w-11 h-11 bg-blue-100 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-blue-600 transition-colors">
                  <UserCog className="w-5 h-5 text-blue-600 group-hover:text-white transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">Admin Login</p>
                  <p className="text-xs text-gray-400 mt-0.5">School owners & administrators</p>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors shrink-0" />
              </div>
            </Link>

            {/* Principal / Vice Principal Login */}
            <Link href="/login">
              <div className="group bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4 flex items-center gap-4 hover:border-purple-400 hover:shadow-md transition-all cursor-pointer mt-3">
                <div className="w-11 h-11 bg-purple-100 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-purple-600 transition-colors">
                  <Briefcase className="w-5 h-5 text-purple-600 group-hover:text-white transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">Principal Login</p>
                  <p className="text-xs text-gray-400 mt-0.5">Principal & Vice Principal access</p>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-purple-500 transition-colors shrink-0" />
              </div>
            </Link>

            {/* Faculty Login */}
            <Link href="/login">
              <div className="group bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4 flex items-center gap-4 hover:border-green-400 hover:shadow-md transition-all cursor-pointer mt-3">
                <div className="w-11 h-11 bg-green-100 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-green-600 transition-colors">
                  <GraduationCap className="w-5 h-5 text-green-600 group-hover:text-white transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">Faculty Login</p>
                  <p className="text-xs text-gray-400 mt-0.5">Teachers & class mentors</p>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-green-500 transition-colors shrink-0" />
              </div>
            </Link>

            {/* Student Login — coming soon */}
            <div className="bg-gray-50 rounded-xl border border-dashed border-gray-200 px-5 py-4 flex items-center gap-4 opacity-70 mt-3 select-none">
              <div className="w-11 h-11 bg-gray-100 rounded-xl flex items-center justify-center shrink-0">
                <Lock className="w-5 h-5 text-gray-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-500 text-sm">Student Login</p>
                  <span className="text-xs bg-amber-100 text-amber-700 font-medium px-2 py-0.5 rounded-full">Coming Soon</span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">Student portal — results, attendance & more</p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white px-6 py-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-sm text-gray-400">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center">
              <GraduationCap className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-semibold text-gray-600">SchoolSync</span>
          </div>
          <p>School management platform</p>
        </div>
      </footer>

    </div>
  );
}
