"use client";

import { useCallback, useEffect, useState } from "react";
import { useParentFetch } from "@/lib/parent-web-auth";
import { useTranslation } from "@/lib/i18n/LanguageContext";

type Child = { id: string; name: string; section?: { name: string; class?: { name: string } } };
type Loan = { id: string; bookTitle: string | null; status: string; dueAt: string; overdue: boolean; fineOutstanding: string };
type Reservation = { id: string; bookTitle: string | null; status: string; queuePosition: number | null; ready?: boolean };
type ChildLibrary = { loans: Loan[]; reservations: Reservation[]; summary: { activeLoans: number; overdueLoans: number; outstandingFine: string } };

export default function ParentLibraryPage() {
  const { t } = useTranslation();
  const parentFetch = useParentFetch();
  const [children, setChildren] = useState<Child[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [data, setData] = useState<ChildLibrary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    parentFetch("/api/parent/children")
      .then((r) => r.json())
      .then((d) => {
        const kids: Child[] = d.children ?? [];
        setChildren(kids);
        if (kids.length > 0) setSelected(kids[0].id);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [parentFetch]);

  const loadChild = useCallback(
    async (studentId: string) => {
      setData(null);
      const res = await parentFetch(`/api/parent/library/${studentId}`);
      if (res.ok) setData(await res.json());
    },
    [parentFetch]
  );

  useEffect(() => {
    if (!selected) return;
    const timer = window.setTimeout(() => {
      void loadChild(selected);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selected, loadChild]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("library.parent.heading")}</h1>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("library.common.loading")}</p>
      ) : children.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("library.parent.noChild")}</p>
      ) : (
        <>
          {children.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {children.map((c) => (
                <button key={c.id} onClick={() => setSelected(c.id)} className={`rounded-lg px-3 py-1.5 text-sm ${selected === c.id ? "bg-primary text-primary-foreground" : "border border-border"}`}>
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {!data ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("library.common.loading")}</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Stat label={t("library.parent.activeLoans")} value={String(data.summary.activeLoans)} />
                <Stat label={t("library.parent.overdue")} value={String(data.summary.overdueLoans)} />
                <Stat label={t("library.parent.outstandingFine")} value={data.summary.outstandingFine} />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold text-foreground">{t("library.loans.myLoans")}</p>
                {data.loans.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("library.loans.noLoans")}</p>
                ) : (
                  data.loans.map((l) => (
                    <div key={l.id} className="rounded-xl border border-border bg-card p-3 text-sm shadow-sm">
                      <p className="font-medium text-foreground">{l.bookTitle}</p>
                      <p className="text-muted-foreground">{l.status} · {t("library.loans.dueAt")}: {new Date(l.dueAt).toLocaleDateString()} {l.overdue && <span className="text-destructive">{t("library.loans.overdue")}</span>} {Number(l.fineOutstanding) > 0 && `· ${t("library.loans.fine")}: ${l.fineOutstanding}`}</p>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold text-foreground">{t("library.reservations.heading")}</p>
                {data.reservations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("library.reservations.noReservations")}</p>
                ) : (
                  data.reservations.map((r) => (
                    <div key={r.id} className="rounded-xl border border-border bg-card p-3 text-sm shadow-sm">
                      <p className="font-medium text-foreground">{r.bookTitle}</p>
                      <p className="text-muted-foreground">{r.status} {r.queuePosition && `· #${r.queuePosition}`} {r.ready && <span className="text-primary">{t("library.reservations.ready")}</span>}</p>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}
