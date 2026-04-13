import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GraduationCap, Users, BookOpen, ClipboardCheck, ArrowRight, CheckCircle } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Navbar */}
      <nav className="border-b border-gray-100 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">SchoolSync</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost">Log in</Button>
            </Link>
            <Link href="/register">
              <Button>Get Started Free</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 py-24 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 text-sm font-medium px-4 py-1.5 rounded-full mb-6">
            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
            School Management Made Simple
          </div>
          <h1 className="text-5xl font-bold text-gray-900 leading-tight mb-6">
            Your school, fully managed<br />
            <span className="text-blue-600">in one place</span>
          </h1>
          <p className="text-xl text-gray-500 mb-10 leading-relaxed">
            Set up your school&apos;s management app in minutes. Manage teachers, students,
            classes, and attendance — all from a single dashboard.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/register">
              <Button size="lg" className="gap-2">
                Create your school app <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline">Sign in</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-20 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">Everything your school needs</h2>
          <p className="text-center text-gray-500 mb-14 text-lg">One platform, complete control over your school operations.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: Users,
                title: "Teacher Management",
                desc: "Add teachers, assign subjects, and manage their profiles in one place.",
                color: "bg-purple-100 text-purple-600",
              },
              {
                icon: BookOpen,
                title: "Student Management",
                desc: "Manage students with class and section assignments, contact info, and parent details.",
                color: "bg-green-100 text-green-600",
              },
              {
                icon: ClipboardCheck,
                title: "Attendance Tracking",
                desc: "Mark daily attendance for both students and teachers. View reports instantly.",
                color: "bg-orange-100 text-orange-600",
              },
              {
                icon: GraduationCap,
                title: "Classes & Sections",
                desc: "Organize students into classes (e.g. Class 10) and sections (A, B, C).",
                color: "bg-blue-100 text-blue-600",
              },
            ].map((f) => (
              <div key={f.title} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                <div className={`w-12 h-12 rounded-lg ${f.color} flex items-center justify-center mb-4`}>
                  <f.icon className="w-6 h-6" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-14">Get started in 3 steps</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {[
              { step: "1", title: "Create your account", desc: "Sign up for free and create your SchoolSync account." },
              { step: "2", title: "Set up your school", desc: "Enter your school name, address, and basic details to launch your app." },
              { step: "3", title: "Start managing", desc: "Add teachers, students, and start marking attendance right away." },
            ].map((s) => (
              <div key={s.step} className="text-center">
                <div className="w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">
                  {s.step}
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{s.title}</h3>
                <p className="text-gray-500 text-sm">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-20 bg-blue-600">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-4">Ready to manage your school smarter?</h2>
          <p className="text-blue-100 mb-8 text-lg">Join schools already using SchoolSync to simplify their daily operations.</p>
          <div className="flex items-center justify-center gap-3 text-white text-sm mb-8">
            {["Free to get started", "No credit card required", "Set up in minutes"].map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4" /> {t}
              </span>
            ))}
          </div>
          <Link href="/register">
            <Button size="lg" variant="secondary" className="bg-white text-blue-600 hover:bg-blue-50">
              Create your free account
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 px-6 py-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center">
              <GraduationCap className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-semibold text-gray-700">SchoolSync</span>
          </div>
          <p>School management platform</p>
        </div>
      </footer>
    </div>
  );
}
