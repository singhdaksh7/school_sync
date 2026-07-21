"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n/LanguageContext";

type Tab = "overview" | "catalogue" | "circulation" | "reservations" | "policy" | "reports";

type Json = Record<string, unknown>;

async function api(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  return { ok: res.ok, status: res.status, data };
}

function Spinner({ label }: { label: string }) {
  return <div className="py-10 text-center text-sm text-muted-foreground">{label}</div>;
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-card p-4 shadow-sm">{children}</div>;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}

export default function LibraryDashboardClient({ schoolId }: { schoolId: string }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("overview");
  const base = `/api/schools/${schoolId}/library`;

  const tabs: Tab[] = ["overview", "catalogue", "circulation", "reservations", "policy", "reports"];

  const errText = useCallback(
    (code: unknown) => {
      const key = typeof code === "string" ? `library.errors.${code}` : "library.errors.generic";
      const msg = t(key);
      return msg === key ? t("library.errors.generic") : msg;
    },
    [t]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("library.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("library.subtitle")}</p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border">
        {tabs.map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === tb ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(`library.nav.${tb}`)}
          </button>
        ))}
      </div>

      {tab === "overview" && <Overview base={base} onGo={setTab} />}
      {tab === "catalogue" && <Catalogue base={base} errText={errText} />}
      {tab === "circulation" && <Circulation base={base} errText={errText} />}
      {tab === "reservations" && <Reservations base={base} errText={errText} />}
      {tab === "policy" && <Policy base={base} />}
      {tab === "reports" && <Reports base={base} />}
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────
function Overview({ base, onGo }: { base: string; onGo: (t: Tab) => void }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Json | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api(`${base}/reports`).then((r) => {
      if (r.ok) setData(r.data as Json);
      setLoading(false);
    });
  }, [base]);

  if (loading) return <Spinner label={t("library.common.loading")} />;
  if (!data) return <Card>{t("library.common.error")}</Card>;

  const titles = data.titles as Json;
  const copies = data.copies as Json;
  const loans = data.loans as Json;
  const fines = data.fines as Json;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("library.overview.titles")} value={String(titles.total)} />
        <Stat label={t("library.overview.copies")} value={String(copies.total)} />
        <Stat label={t("library.overview.available")} value={String(copies.available)} />
        <Stat label={t("library.overview.issued")} value={String(copies.issued)} />
        <Stat label={t("library.overview.activeLoans")} value={String(loans.active)} />
        <Stat label={t("library.overview.overdue")} value={String(loans.overdue)} />
        <Stat label={t("library.overview.outstandingFines")} value={String(fines.outstandingTotal)} />
      </div>
      <Card>
        <p className="mb-3 text-sm font-semibold text-foreground">{t("library.overview.quickActions")}</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onGo("catalogue")} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">{t("library.overview.openCatalogue")}</button>
          <button onClick={() => onGo("circulation")} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">{t("library.overview.openCirculation")}</button>
          <button onClick={() => onGo("reports")} className="rounded-lg border border-border px-3 py-2 text-sm font-medium">{t("library.overview.viewReports")}</button>
          <button onClick={() => onGo("policy")} className="rounded-lg border border-border px-3 py-2 text-sm font-medium">{t("library.overview.editPolicy")}</button>
        </div>
      </Card>
    </div>
  );
}

// ── Catalogue ───────────────────────────────────────────────────────────────
type Book = { id: string; title: string; authors: string | null; isbn13: string | null; category: string | null; status: string; totalCopies: number };
type Copy = { id: string; accessionNumber: string; barcode: string; shelfLocation: string | null; status: string };

function Catalogue({ base, errText }: { base: string; errText: (c: unknown) => string }) {
  const { t } = useTranslation();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState("");
  const [isbn13, setIsbn13] = useState("");
  const [category, setCategory] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api(`${base}/books?q=${encodeURIComponent(q)}&limit=50`);
    if (r.ok) setBooks(((r.data as Json).data as Book[]) ?? []);
    setLoading(false);
  }, [base, q]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function addBook() {
    setMsg(null);
    const r = await api(`${base}/books`, { method: "POST", body: JSON.stringify({ title, authors: authors || undefined, isbn13: isbn13 || undefined, category: category || undefined }) });
    if (r.ok) {
      setMsg(t("library.catalogue.bookCreated"));
      setTitle(""); setAuthors(""); setIsbn13(""); setCategory(""); setShowAdd(false);
      load();
    } else {
      setMsg(errText((r.data as Json)?.code) || t("library.common.error"));
    }
  }

  async function archive(id: string) {
    if (!confirm(t("library.catalogue.archiveConfirm"))) return;
    const r = await api(`${base}/books/${id}`, { method: "DELETE" });
    if (r.ok) load();
    else setMsg(errText((r.data as Json)?.code));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("library.catalogue.searchPlaceholder")} className="min-w-64 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <button onClick={load} className="rounded-lg border border-border px-3 py-2 text-sm">{t("library.common.search")}</button>
        <button onClick={() => setShowAdd((v) => !v)} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">{t("library.catalogue.addBook")}</button>
      </div>

      {msg && <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">{msg}</div>}

      {showAdd && (
        <Card>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-sm">{t("library.catalogue.bookTitle")}<input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
            <label className="text-sm">{t("library.catalogue.authors")}<input value={authors} onChange={(e) => setAuthors(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
            <label className="text-sm">{t("library.catalogue.isbn13")}<input value={isbn13} onChange={(e) => setIsbn13(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
            <label className="text-sm">{t("library.catalogue.category")}<input value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={addBook} disabled={!title.trim()} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{t("library.common.save")}</button>
            <button onClick={() => setShowAdd(false)} className="rounded-lg border border-border px-3 py-2 text-sm">{t("library.common.cancel")}</button>
          </div>
        </Card>
      )}

      {loading ? (
        <Spinner label={t("library.common.loading")} />
      ) : books.length === 0 ? (
        <Card>{t("library.catalogue.noBooks")}</Card>
      ) : (
        <div className="space-y-2">
          {books.map((b) => (
            <div key={b.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-foreground">{b.title} {b.status === "ARCHIVED" && <span className="ml-2 rounded bg-muted px-2 py-0.5 text-xs">{t("library.catalogue.archived")}</span>}</p>
                  <p className="text-sm text-muted-foreground">{b.authors} · {b.category} · {b.totalCopies} {t("library.catalogue.copies")}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setExpanded(expanded === b.id ? null : b.id)} className="rounded-lg border border-border px-3 py-1.5 text-sm">{t("library.catalogue.copies")}</button>
                  {b.status === "ACTIVE" && <button onClick={() => archive(b.id)} className="rounded-lg border border-border px-3 py-1.5 text-sm text-destructive">{t("library.catalogue.archive")}</button>}
                </div>
              </div>
              {expanded === b.id && <CopiesPanel base={base} bookId={b.id} errText={errText} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CopiesPanel({ base, bookId, errText }: { base: string; bookId: string; errText: (c: unknown) => string }) {
  const { t } = useTranslation();
  const [copies, setCopies] = useState<Copy[]>([]);
  const [loading, setLoading] = useState(true);
  const [acc, setAcc] = useState("");
  const [bar, setBar] = useState("");
  const [shelf, setShelf] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api(`${base}/books/${bookId}/copies`);
    if (r.ok) setCopies((r.data as Copy[]) ?? []);
    setLoading(false);
  }, [base, bookId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function addCopy() {
    setMsg(null);
    const r = await api(`${base}/books/${bookId}/copies`, { method: "POST", body: JSON.stringify({ copies: [{ accessionNumber: acc, barcode: bar, shelfLocation: shelf || undefined }] }) });
    if (r.ok) {
      setAcc(""); setBar(""); setShelf("");
      load();
    } else {
      setMsg(errText((r.data as Json)?.code));
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      {loading ? (
        <Spinner label={t("library.common.loading")} />
      ) : (
        <div className="space-y-1">
          {copies.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-1.5 text-sm">
              <span>{c.accessionNumber} · {c.barcode} · {c.shelfLocation ?? "—"}</span>
              <span className="rounded bg-background px-2 py-0.5 text-xs">{c.status}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <input value={acc} onChange={(e) => setAcc(e.target.value)} placeholder={t("library.catalogue.accessionNumber")} className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
        <input value={bar} onChange={(e) => setBar(e.target.value)} placeholder={t("library.catalogue.barcode")} className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
        <input value={shelf} onChange={(e) => setShelf(e.target.value)} placeholder={t("library.catalogue.shelf")} className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
        <button onClick={addCopy} disabled={!acc.trim() || !bar.trim()} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{t("library.catalogue.addCopies")}</button>
      </div>
      {msg && <p className="mt-2 text-sm text-destructive">{msg}</p>}
    </div>
  );
}

// ── Circulation ───────────────────────────────────────────────────────────────
type Loan = { id: string; bookTitle: string | null; accessionNumber: string | null; borrowerType: string; borrowerId: string | null; dueAt: string; overdue: boolean; fineOutstanding: string; renewalCount: number };

function Circulation({ base, errText }: { base: string; errText: (c: unknown) => string }) {
  const { t } = useTranslation();
  const scanRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [borrowerType, setBorrowerType] = useState("STUDENT");
  const [borrowerId, setBorrowerId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLoans = useCallback(async () => {
    setLoading(true);
    const r = await api(`${base}/loans?status=ACTIVE&limit=100`);
    if (r.ok) setLoans(((r.data as Json).data as Loan[]) ?? []);
    setLoading(false);
  }, [base]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadLoans(); }, 0);
    scanRef.current?.focus();
    return () => window.clearTimeout(timer);
  }, [loadLoans]);

  async function issue() {
    setMsg(null);
    const r = await api(`${base}/issue`, { method: "POST", body: JSON.stringify({ barcode: code, borrowerType, borrowerId }) });
    if (r.ok) {
      setMsg(t("library.circulation.issued"));
      setCode(""); setBorrowerId("");
      scanRef.current?.focus();
      loadLoans();
    } else {
      setMsg(errText((r.data as Json)?.code));
    }
  }

  async function doReturn(id: string, copyOutcome?: string) {
    const r = await api(`${base}/loans/${id}/return`, { method: "POST", body: JSON.stringify(copyOutcome ? { copyOutcome } : {}) });
    if (r.ok) { setMsg(t("library.circulation.returned")); loadLoans(); }
    else setMsg(errText((r.data as Json)?.code));
  }
  async function renew(id: string) {
    const r = await api(`${base}/loans/${id}/renew`, { method: "POST" });
    if (r.ok) { setMsg(t("library.circulation.renewed")); loadLoans(); }
    else setMsg(errText((r.data as Json)?.code));
  }
  async function waive(id: string) {
    const reason = prompt(t("library.circulation.waiveReason"));
    if (!reason) return;
    const r = await api(`${base}/loans/${id}/waive-fine`, { method: "POST", body: JSON.stringify({ reason }) });
    if (r.ok) { setMsg(t("library.circulation.waived")); loadLoans(); }
    else setMsg(errText((r.data as Json)?.code));
  }

  return (
    <div className="space-y-4">
      <Card>
        <p className="mb-3 text-sm font-semibold text-foreground">{t("library.circulation.issue")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">{t("library.circulation.scanPlaceholder")}
            <input ref={scanRef} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && borrowerId && issue()} className="mt-1 block w-72 rounded-lg border border-border bg-background px-3 py-2" />
          </label>
          <label className="text-sm">{t("library.circulation.borrowerType")}
            <select value={borrowerType} onChange={(e) => setBorrowerType(e.target.value)} className="mt-1 block rounded-lg border border-border bg-background px-3 py-2">
              <option value="STUDENT">{t("library.circulation.student")}</option>
              <option value="TEACHER">{t("library.circulation.teacher")}</option>
            </select>
          </label>
          <label className="text-sm">{t("library.circulation.borrowerId")}
            <input value={borrowerId} onChange={(e) => setBorrowerId(e.target.value)} className="mt-1 block w-56 rounded-lg border border-border bg-background px-3 py-2" />
          </label>
          <button onClick={issue} disabled={!code.trim() || !borrowerId.trim()} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{t("library.circulation.issue")}</button>
        </div>
        {msg && <p className="mt-2 text-sm text-foreground">{msg}</p>}
      </Card>

      <div>
        <p className="mb-2 text-sm font-semibold text-foreground">{t("library.circulation.activeLoans")}</p>
        {loading ? (
          <Spinner label={t("library.common.loading")} />
        ) : loans.length === 0 ? (
          <Card>{t("library.circulation.noLoans")}</Card>
        ) : (
          <div className="space-y-2">
            {loans.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
                <div className="text-sm">
                  <p className="font-medium text-foreground">{l.bookTitle} <span className="text-muted-foreground">({l.accessionNumber})</span></p>
                  <p className="text-muted-foreground">{l.borrowerType} · {l.borrowerId} · {t("library.circulation.dueAt")}: {new Date(l.dueAt).toLocaleDateString()} {l.overdue && <span className="ml-1 text-destructive">{t("library.circulation.overdue")}</span>} {Number(l.fineOutstanding) > 0 && <span className="ml-1">· {t("library.circulation.fine")}: {l.fineOutstanding}</span>}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => doReturn(l.id)} className="rounded-lg border border-border px-2.5 py-1.5 text-xs">{t("library.circulation.returnNormal")}</button>
                  <button onClick={() => doReturn(l.id, "LOST")} className="rounded-lg border border-border px-2.5 py-1.5 text-xs">{t("library.circulation.markLost")}</button>
                  <button onClick={() => renew(l.id)} className="rounded-lg border border-border px-2.5 py-1.5 text-xs">{t("library.circulation.renew")}</button>
                  {Number(l.fineOutstanding) > 0 && <button onClick={() => waive(l.id)} className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-primary">{t("library.circulation.waive")}</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reservations ──────────────────────────────────────────────────────────────
type Reservation = { id: string; bookTitle: string | null; status: string; queuePosition: number | null; borrowerType?: string; borrowerId?: string | null; ready?: boolean };

function Reservations({ base, errText }: { base: string; errText: (c: unknown) => string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api(`${base}/reservations?status=PENDING&limit=100`);
    if (r.ok) setRows(((r.data as Json).data as Reservation[]) ?? []);
    setLoading(false);
  }, [base]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function cancel(id: string) {
    const r = await api(`${base}/reservations/${id}`, { method: "DELETE", body: JSON.stringify({ reason: "Staff cancelled" }) });
    if (r.ok) { setMsg(t("library.reservations.cancelled")); load(); }
    else setMsg(errText((r.data as Json)?.code));
  }

  if (loading) return <Spinner label={t("library.common.loading")} />;
  return (
    <div className="space-y-2">
      {msg && <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">{msg}</div>}
      {rows.length === 0 ? (
        <Card>{t("library.reservations.noReservations")}</Card>
      ) : (
        rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-3 text-sm shadow-sm">
            <div>
              <p className="font-medium text-foreground">{r.bookTitle}</p>
              <p className="text-muted-foreground">{r.borrowerType} · {r.borrowerId} · #{r.queuePosition} {r.ready && <span className="ml-1 text-primary">{t("library.reservations.ready")}</span>}</p>
            </div>
            <button onClick={() => cancel(r.id)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-destructive">{t("library.reservations.cancel")}</button>
          </div>
        ))
      )}
    </div>
  );
}

// ── Policy ────────────────────────────────────────────────────────────────────
function Policy({ base }: { base: string }) {
  const { t } = useTranslation();
  const [p, setP] = useState<Json | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api(`${base}/policy`).then((r) => r.ok && setP(r.data as Json));
  }, [base]);

  if (!p) return <Spinner label={t("library.common.loading")} />;

  const numFields = ["studentBorrowLimit", "teacherBorrowLimit", "studentLoanDurationDays", "teacherLoanDurationDays", "maxRenewals", "graceDays", "reservationHoldDurationDays"];

  async function save() {
    setMsg(null);
    const body: Json = {};
    for (const f of numFields) body[f] = Number(p![f]);
    body.finePerOverdueDay = Number(p!.finePerOverdueDay);
    body.reservationsEnabled = Boolean(p!.reservationsEnabled);
    body.blockBorrowingIfOverdue = Boolean(p!.blockBorrowingIfOverdue);
    const r = await api(`${base}/policy`, { method: "PUT", body: JSON.stringify(body) });
    if (r.ok) { setP(r.data as Json); setMsg(t("library.policy.saved")); }
  }

  return (
    <Card>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {numFields.map((f) => (
          <label key={f} className="text-sm">{t(`library.policy.${f}`)}
            <input type="number" value={String(p[f])} onChange={(e) => setP({ ...p, [f]: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" />
          </label>
        ))}
        <label className="text-sm">{t("library.policy.finePerOverdueDay")}
          <input type="number" step="0.01" value={String(p.finePerOverdueDay)} onChange={(e) => setP({ ...p, finePerOverdueDay: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" />
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(p.reservationsEnabled)} onChange={(e) => setP({ ...p, reservationsEnabled: e.target.checked })} />{t("library.policy.reservationsEnabled")}</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(p.blockBorrowingIfOverdue)} onChange={(e) => setP({ ...p, blockBorrowingIfOverdue: e.target.checked })} />{t("library.policy.blockBorrowingIfOverdue")}</label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{t("library.common.save")}</button>
        {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
      </div>
    </Card>
  );
}

// ── Reports ───────────────────────────────────────────────────────────────────
function Reports({ base }: { base: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Json | null>(null);

  useEffect(() => {
    api(`${base}/reports`).then((r) => r.ok && setData(r.data as Json));
  }, [base]);

  if (!data) return <Spinner label={t("library.common.loading")} />;
  const copies = data.copies as Json;
  const loans = data.loans as Json;
  const fines = data.fines as Json;
  const mostBorrowed = (data.mostBorrowed as { bookId: string; title: string; count: number }[]) ?? [];
  const byClass = (data.borrowingByClass as { className: string; sectionName: string; count: number }[]) ?? [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("library.reports.available")} value={String(copies.available)} />
        <Stat label={t("library.reports.issued")} value={String(copies.issued)} />
        <Stat label={t("library.reports.lost")} value={String(copies.lost)} />
        <Stat label={t("library.reports.damaged")} value={String(copies.damaged)} />
        <Stat label={t("library.reports.underRepair")} value={String(copies.underRepair)} />
        <Stat label={t("library.reports.withdrawn")} value={String(copies.withdrawn)} />
        <Stat label={t("library.reports.overdueLoans")} value={String(loans.overdue)} />
        <Stat label={t("library.reports.outstandingFines")} value={String(fines.outstandingTotal)} />
      </div>
      <Card>
        <p className="mb-2 text-sm font-semibold text-foreground">{t("library.reports.mostBorrowed")}</p>
        {mostBorrowed.length === 0 ? <p className="text-sm text-muted-foreground">{t("library.reports.noData")}</p> : mostBorrowed.map((m) => (
          <div key={m.bookId} className="flex justify-between border-b border-border py-1 text-sm last:border-0"><span>{m.title}</span><span className="text-muted-foreground">{m.count} {t("library.reports.borrows")}</span></div>
        ))}
      </Card>
      <Card>
        <p className="mb-2 text-sm font-semibold text-foreground">{t("library.reports.borrowingByClass")}</p>
        {byClass.length === 0 ? <p className="text-sm text-muted-foreground">{t("library.reports.noData")}</p> : byClass.map((c, i) => (
          <div key={i} className="flex justify-between border-b border-border py-1 text-sm last:border-0"><span>{c.className} · {c.sectionName}</span><span className="text-muted-foreground">{c.count}</span></div>
        ))}
      </Card>
    </div>
  );
}
