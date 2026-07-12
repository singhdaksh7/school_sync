"use client";

import Link from "next/link";
import {
  GraduationCap, Users, BookOpen, ClipboardCheck,
  ArrowRight, School, LogIn,
} from "lucide-react";
import LanguageSwitcher from "@/components/shared/LanguageSwitcher";
import { useTranslation } from "@/lib/i18n/LanguageContext";

export default function LandingPage() {
  const { t } = useTranslation();
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
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 pt-20 pb-12 text-center">
        <div className="max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-700 text-sm font-medium px-4 py-1.5 rounded-full mb-6">
            <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
            {t("landing.badge")}
          </div>
          <h1 className="text-5xl font-bold text-gray-900 leading-tight mb-5">
            {t("landing.title1")}<br />
            <span className="text-blue-600">{t("landing.title2")}</span>
          </h1>
          <p className="text-lg text-gray-500 leading-relaxed">
            {t("landing.subtitle")}
          </p>
        </div>
      </section>

      {/* Main two-panel section */}
      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">

          {/* Left: Platform highlights */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-br from-blue-600 to-blue-700 px-6 py-8 text-white">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mb-4">
                <School className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-2xl font-bold mb-2">{t("landing.registerYourSchool")}</h2>
              <p className="text-blue-100 text-sm leading-relaxed">
                {t("landing.registerDescription")}
              </p>
            </div>
            <div className="px-6 py-6 space-y-4">
              {[
                { icon: Users, text: t("landing.featureTeachers") },
                { icon: BookOpen, text: t("landing.featureStudents") },
                { icon: ClipboardCheck, text: t("landing.featureAttendance") },
              ].map((item) => (
                <div key={item.text} className="flex items-center gap-3 text-sm text-gray-600">
                  <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
                    <item.icon className="w-4 h-4 text-blue-600" />
                  </div>
                  {item.text}
                </div>
              ))}
            </div>
          </div>

          {/* Right: Sign in */}
          <div className="space-y-4">
            <div className="px-1">
              <h2 className="text-xl font-bold text-gray-900">{t("landing.portalLogin")}</h2>
              <p className="text-sm text-gray-500 mt-0.5">{t("landing.portalLoginSubtitle")}</p>
            </div>

            {/* Single unified school-user sign in — the backend resolves
                role (Owner/Admin/VP/Teacher/Student) from the account
                itself after authentication. There is no role choice here. */}
            <Link href="/login">
              <div className="group bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-5 flex items-center gap-4 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer">
                <div className="w-11 h-11 bg-blue-100 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-blue-600 transition-colors">
                  <LogIn className="w-5 h-5 text-blue-600 group-hover:text-white transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">{t("landing.signIn")}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{t("landing.signInDesc")}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors shrink-0" />
              </div>
            </Link>

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
          <div className="flex items-center gap-4">
            <p>{t("landing.footerTagline")}</p>
            {/* Deliberately small and secondary — not a peer option next to
                the school sign-in card above. */}
            <Link href="/founder/login" className="text-gray-300 hover:text-gray-500 transition-colors">
              {t("landing.founderLogin")}
            </Link>
          </div>
        </div>
      </footer>

    </div>
  );
}
