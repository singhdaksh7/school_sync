"use client";

import { useState } from "react";
import {
  Sparkles, AlertTriangle, CheckCircle2,
  TrendingUp, TrendingDown, Minus,
  Loader2, ChevronDown, ChevronUp, Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface Insights {
  summary: string;
  attendanceInsight: string;
  academicInsight: string;
  urgentActions: string[];
  positives: string[];
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  predictedAttendanceTrend: "IMPROVING" | "STABLE" | "DECLINING";
}

interface APIResponse {
  insights: Insights;
  generatedAt: string;
  cached: boolean;
  daysUntilRefresh: number;
}

const riskConfig = {
  LOW:    { color: "text-green-600",  bg: "bg-green-50",  border: "border-green-200",  label: "Low Risk" },
  MEDIUM: { color: "text-yellow-600", bg: "bg-yellow-50", border: "border-yellow-200", label: "Medium Risk" },
  HIGH:   { color: "text-red-600",    bg: "bg-red-50",    border: "border-red-200",    label: "High Risk" },
};

const trendConfig = {
  IMPROVING: { icon: TrendingUp,   color: "text-green-600", label: "Improving" },
  STABLE:    { icon: Minus,        color: "text-blue-600",  label: "Stable" },
  DECLINING: { icon: TrendingDown, color: "text-red-600",   label: "Declining" },
};

export default function AIInsightCard({ schoolId }: { schoolId: string }) {
  const [data, setData] = useState<APIResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId }),
      });
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e: any) {
      setError(e.message || "Failed to generate insights");
    } finally {
      setLoading(false);
    }
  }

  const insights = data?.insights ?? null;
  const risk  = insights ? riskConfig[insights.riskLevel] : null;
  const trend = insights ? trendConfig[insights.predictedAttendanceTrend] : null;
  const locked = data ? data.daysUntilRefresh > 0 && data.cached : false;

  return (
    <Card className="border-blue-100 bg-gradient-to-br from-blue-50/50 to-white">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            AI School Insights
            {insights && (
              <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full border", risk?.bg, risk?.color, risk?.border)}>
                {risk?.label}
              </span>
            )}
          </CardTitle>
          {insights && (
            <button onClick={() => setExpanded((e) => !e)} className="p-1 rounded text-gray-400 hover:text-gray-600">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* ── Initial state ── */}
        {!data && !loading && (
          <div className="flex flex-col items-center gap-3 py-6">
            <p className="text-sm text-gray-500 text-center max-w-sm">
              Generate an AI-powered analysis of your school&apos;s attendance, academic performance, and operational health.
              Results are cached for <span className="font-medium text-gray-700">30 days</span> to keep costs low.
            </p>
            <button
              onClick={generate}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              Generate Insights
            </button>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="flex items-center gap-3 py-8 justify-center">
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
            <p className="text-sm text-gray-500">Analyzing school data with AI...</p>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 rounded-lg border border-red-200">
            <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-red-700 font-medium">Failed to generate insights</p>
              <p className="text-xs text-red-500 mt-0.5">{error}</p>
              <button onClick={generate} className="text-xs text-red-600 underline mt-1 hover:text-red-800">Try again</button>
            </div>
          </div>
        )}

        {/* ── Results ── */}
        {insights && expanded && (
          <div className="space-y-4">
            {/* Cache notice */}
            {data && (
              <div className={cn(
                "flex items-center gap-2 text-xs px-3 py-2 rounded-lg",
                data.cached ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-green-50 text-green-700 border border-green-200"
              )}>
                <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                {data.cached
                  ? `Showing cached insights from ${format(new Date(data.generatedAt), "dd MMM yyyy")} · Refreshes in ${data.daysUntilRefresh} day${data.daysUntilRefresh !== 1 ? "s" : ""}`
                  : `Fresh insights generated on ${format(new Date(data.generatedAt), "dd MMM yyyy")} · Next refresh available in 30 days`
                }
              </div>
            )}

            {/* Summary */}
            <div className="p-3 bg-white rounded-lg border border-gray-100">
              <p className="text-sm text-gray-700 leading-relaxed">{insights.summary}</p>
            </div>

            {/* Trend + attendance */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 bg-white rounded-lg border border-gray-100 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  {trend && <trend.icon className={cn("w-4 h-4", trend.color)} />}
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Attendance Trend</p>
                  {trend && <span className={cn("text-xs font-medium", trend.color)}>{trend.label}</span>}
                </div>
                <p className="text-sm text-gray-600">{insights.attendanceInsight}</p>
              </div>
              <div className="p-3 bg-white rounded-lg border border-gray-100 space-y-1.5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Academic Performance</p>
                <p className="text-sm text-gray-600">{insights.academicInsight}</p>
              </div>
            </div>

            {/* Urgent actions */}
            {insights.urgentActions.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-orange-500" /> Urgent Actions
                </p>
                <ul className="space-y-1.5">
                  {insights.urgentActions.map((action, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="mt-0.5 w-5 h-5 bg-orange-100 text-orange-700 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                        {i + 1}
                      </span>
                      {action}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Positives */}
            {insights.positives.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> What&apos;s Going Well
                </p>
                <ul className="space-y-1.5">
                  {insights.positives.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Footer: locked or refresh */}
            <div className="flex justify-end pt-1">
              {locked ? (
                <span className="flex items-center gap-1.5 text-xs text-gray-400 cursor-not-allowed">
                  <Clock className="w-3 h-3" />
                  Refresh available in {data!.daysUntilRefresh} day{data!.daysUntilRefresh !== 1 ? "s" : ""}
                </span>
              ) : (
                <button
                  onClick={generate}
                  disabled={loading}
                  className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
                >
                  <Sparkles className="w-3 h-3" /> Regenerate
                </button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
