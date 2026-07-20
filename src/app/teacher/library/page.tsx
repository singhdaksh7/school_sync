"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n/LanguageContext";

type Json = Record<string, unknown>;
type Tab = "catalogue" | "loans" | "reservations";

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  let data: unknown = null;
  try { data = await res.json(); } catch { /* */ }
  return { ok: res.ok, status: res.status, data };
}

type Book = { id: string; title: string; authors: string | null; category: string | null; availableCopies?: number };
type Loan = { id: string; bookTitle: string | null; dueAt: string; status: string; overdue: boolean; fineOutstanding: string };
type Reservation = { id: string; bookTitle: string | null; status: string; queuePosition: number | null; ready?: boolean };

export default function TeacherLibraryPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("catalogue");
  const tabs: Tab[] = ["catalogue", "loans", "reservations"];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2 border-b border-border">
        {tabs.map((tb) => (
          <button key={tb} onClick={() => setTab(tb)} className={`rounded-t-lg px-4 py-2 text-sm font-medium ${tab === tb ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            {tb === "catalogue" ? t("library.student.catalogue") : tb === "loans" ? t("library.loans.myLoans") : t("library.reservations.heading")}
          </button>
        ))}
      </div>
      {tab === "catalogue" && <TeacherCatalogue />}
      {tab === "loans" && <TeacherLoans />}
      {tab === "reservations" && <TeacherReservations />}
    </div>
  );
}

function TeacherCatalogue() {
  const { t } = useTranslation();
  const [books, setBooks] = useState<Book[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api(`/api/teacher/library/catalogue?q=${encodeURIComponent(q)}&limit=50`);
    if (r.ok) setBooks(((r.data as Json).data as Book[]) ?? []);
    setLoading(false);
  }, [q]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function reserve(bookId: string) {
    const r = await api(`/api/teacher/library/reservations`, { method: "POST", body: JSON.stringify({ bookId }) });
    setMsg(r.ok ? t("library.reservations.reserved") : t(`library.errors.${(r.data as Json)?.code ?? "generic"}`));
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("library.catalogue.searchPlaceholder")} className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <button onClick={load} className="rounded-lg border border-border px-3 py-2 text-sm">{t("library.common.search")}</button>
      </div>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
      {loading ? <p className="py-8 text-center text-sm text-muted-foreground">{t("library.common.loading")}</p> : books.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{t("library.catalogue.noBooks")}</p> : books.map((b) => (
        <div key={b.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-3 text-sm shadow-sm">
          <div><p className="font-medium text-foreground">{b.title}</p><p className="text-muted-foreground">{b.authors} · {b.availableCopies ?? 0} {t("library.catalogue.available")}</p></div>
          <button onClick={() => reserve(b.id)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-primary">{t("library.student.reserve")}</button>
        </div>
      ))}
    </div>
  );
}

function TeacherLoans() {
  const { t } = useTranslation();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api(`/api/teacher/library/loans?limit=100`).then((r) => { if (r.ok) setLoans(((r.data as Json).data as Loan[]) ?? []); setLoading(false); });
  }, []);
  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">{t("library.common.loading")}</p>;
  if (loans.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">{t("library.loans.noLoans")}</p>;
  return (
    <div className="space-y-2">
      {loans.map((l) => (
        <div key={l.id} className="rounded-xl border border-border bg-card p-3 text-sm shadow-sm">
          <p className="font-medium text-foreground">{l.bookTitle}</p>
          <p className="text-muted-foreground">{l.status} · {t("library.loans.dueAt")}: {new Date(l.dueAt).toLocaleDateString()} {l.overdue && <span className="text-destructive">{t("library.loans.overdue")}</span>} {Number(l.fineOutstanding) > 0 && `· ${t("library.loans.fine")}: ${l.fineOutstanding}`}</p>
        </div>
      ))}
    </div>
  );
}

function TeacherReservations() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const r = await api(`/api/teacher/library/reservations`);
    if (r.ok) setRows((r.data as Reservation[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function cancel(id: string) { const r = await api(`/api/teacher/library/reservations/${id}`, { method: "DELETE" }); if (r.ok) load(); }
  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">{t("library.common.loading")}</p>;
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">{t("library.reservations.noReservations")}</p>;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-3 text-sm shadow-sm">
          <div><p className="font-medium text-foreground">{r.bookTitle}</p><p className="text-muted-foreground">{r.status} {r.queuePosition && `· #${r.queuePosition}`} {r.ready && <span className="text-primary">{t("library.reservations.ready")}</span>}</p></div>
          {r.status === "PENDING" && <button onClick={() => cancel(r.id)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-destructive">{t("library.reservations.cancel")}</button>}
        </div>
      ))}
    </div>
  );
}
