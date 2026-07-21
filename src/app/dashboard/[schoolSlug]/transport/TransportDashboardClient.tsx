"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n/LanguageContext";

type Tab = "routes" | "vehicles" | "drivers";
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

export default function TransportDashboardClient({ schoolId }: { schoolId: string }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("routes");
  const base = `/api/schools/${schoolId}/transport`;

  const tabs: Tab[] = ["routes", "vehicles", "drivers"];

  const errText = useCallback(
    (code: unknown) => {
      const key = typeof code === "string" ? `transport.errors.${code}` : "transport.errors.generic";
      const msg = t(key);
      return msg === key ? t("transport.errors.generic") : msg;
    },
    [t]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("transport.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("transport.subtitle")}</p>
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
            {t(`transport.nav.${tb}`)}
          </button>
        ))}
      </div>

      {tab === "routes" && <Routes base={base} schoolId={schoolId} errText={errText} />}
      {tab === "vehicles" && <Vehicles base={base} errText={errText} />}
      {tab === "drivers" && <Drivers base={base} errText={errText} />}
    </div>
  );
}

// ── Routes ──────────────────────────────────────────────────────────────────
type RouteSummary = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  vehicle: { id: string; registrationNumber: string } | null;
  driver: { id: string; name: string; phone: string } | null;
  _count: { stops: number; studentAssignments: number };
};

function Routes({ base, schoolId, errText }: { base: string; schoolId: string; errText: (c: unknown) => string }) {
  const { t } = useTranslation();
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api(`${base}/routes`);
    if (r.ok) setRoutes((r.data as RouteSummary[]) ?? []);
    setLoading(false);
  }, [base]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function addRoute() {
    setMsg(null);
    const r = await api(`${base}/routes`, { method: "POST", body: JSON.stringify({ name, description: description || undefined }) });
    if (r.ok) {
      setMsg(t("transport.routes.routeCreated"));
      setName("");
      setDescription("");
      setShowAdd(false);
      load();
    } else {
      setMsg((r.data as Json)?.error as string || errText((r.data as Json)?.code));
    }
  }

  async function removeRoute(id: string) {
    if (!confirm(t("transport.routes.deleteConfirm"))) return;
    const r = await api(`${base}/routes/${id}`, { method: "DELETE" });
    if (r.ok) load();
    else setMsg(errText((r.data as Json)?.code));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setShowAdd((v) => !v)} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
          {t("transport.routes.addRoute")}
        </button>
      </div>

      {msg && <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">{msg}</div>}

      {showAdd && (
        <Card>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-sm">
              {t("transport.routes.name")}
              <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>
            <label className="text-sm">
              {t("transport.routes.description")}
              <input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={addRoute} disabled={!name.trim()} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {t("transport.common.save")}
            </button>
            <button onClick={() => setShowAdd(false)} className="rounded-lg border border-border px-3 py-2 text-sm">
              {t("transport.common.cancel")}
            </button>
          </div>
        </Card>
      )}

      {loading ? (
        <Spinner label={t("transport.common.loading")} />
      ) : routes.length === 0 ? (
        <Card>{t("transport.routes.noRoutes")}</Card>
      ) : (
        <div className="space-y-2">
          {routes.map((rt) => (
            <div key={rt.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-foreground">
                    {rt.name}{" "}
                    {!rt.isActive && <span className="ml-2 rounded bg-muted px-2 py-0.5 text-xs">{t("transport.common.inactive")}</span>}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {rt.vehicle?.registrationNumber ?? t("transport.routes.none")} · {rt.driver?.name ?? t("transport.routes.none")} · {rt._count.stops} {t("transport.routes.stops").toLowerCase()} ·{" "}
                    {rt._count.studentAssignments} {t("transport.routes.students").toLowerCase()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setExpanded(expanded === rt.id ? null : rt.id)} className="rounded-lg border border-border px-3 py-1.5 text-sm">
                    {t("transport.common.edit")}
                  </button>
                  <button onClick={() => removeRoute(rt.id)} className="rounded-lg border border-border px-3 py-1.5 text-sm text-destructive">
                    {t("transport.common.delete")}
                  </button>
                </div>
              </div>
              {expanded === rt.id && <RouteDetailPanel base={base} schoolId={schoolId} routeId={rt.id} errText={errText} onChanged={load} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type StopRow = { id: string; name: string; sequence: number };
type StudentAssignment = {
  id: string;
  student: { id: string; name: string; rollNo: string };
  stop: { id: string; name: string } | null;
};
type RouteDetail = {
  id: string;
  vehicleId: string | null;
  driverId: string | null;
  stops: StopRow[];
  studentAssignments: StudentAssignment[];
};
type VehicleOption = { id: string; registrationNumber: string };
type DriverOption = { id: string; name: string; phone: string };
type StudentOption = { id: string; name: string; rollNo: string };

function RouteDetailPanel({
  base,
  schoolId,
  routeId,
  errText,
  onChanged,
}: {
  base: string;
  schoolId: string;
  routeId: string;
  errText: (c: unknown) => string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<RouteDetail | null>(null);
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [stopName, setStopName] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [stopId, setStopId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [routeRes, vehiclesRes, driversRes, studentsRes] = await Promise.all([
      api(`${base}/routes/${routeId}`),
      api(`${base}/vehicles`),
      api(`${base}/drivers`),
      fetch(`/api/schools/${schoolId}/students?limit=500`).then((r) => r.json()),
    ]);
    if (routeRes.ok) {
      const d = routeRes.data as RouteDetail;
      setDetail(d);
      setVehicleId(d.vehicleId ?? "");
      setDriverId(d.driverId ?? "");
    }
    if (vehiclesRes.ok) setVehicles((vehiclesRes.data as VehicleOption[]) ?? []);
    if (driversRes.ok) setDrivers((driversRes.data as DriverOption[]) ?? []);
    const studentList = Array.isArray(studentsRes) ? studentsRes : studentsRes?.data;
    setStudents(Array.isArray(studentList) ? studentList : []);
    setLoading(false);
  }, [base, schoolId, routeId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function addStop() {
    setMsg(null);
    const r = await api(`${base}/routes/${routeId}/stops`, { method: "POST", body: JSON.stringify({ name: stopName }) });
    if (r.ok) {
      setMsg(t("transport.routes.stopAdded"));
      setStopName("");
      load();
      onChanged();
    } else {
      setMsg((r.data as Json)?.error as string || errText((r.data as Json)?.code));
    }
  }

  async function saveAssignment() {
    setMsg(null);
    const r = await api(`${base}/routes/${routeId}/assign`, {
      method: "POST",
      body: JSON.stringify({ vehicleId: vehicleId || null, driverId: driverId || null }),
    });
    if (r.ok) {
      setMsg(t("transport.routes.assignmentUpdated"));
      load();
      onChanged();
    } else {
      setMsg((r.data as Json)?.error as string || errText((r.data as Json)?.code));
    }
  }

  async function assignStudent() {
    setMsg(null);
    const r = await api(`${base}/routes/${routeId}/students`, {
      method: "POST",
      body: JSON.stringify({ studentId, stopId: stopId || undefined }),
    });
    if (r.ok) {
      setStudentId("");
      setStopId("");
      load();
      onChanged();
    } else {
      setMsg((r.data as Json)?.error as string || errText((r.data as Json)?.code));
    }
  }

  async function unassignStudent(sid: string) {
    const r = await api(`${base}/routes/${routeId}/students`, { method: "DELETE", body: JSON.stringify({ studentId: sid }) });
    if (r.ok) {
      load();
      onChanged();
    } else {
      setMsg(errText((r.data as Json)?.code));
    }
  }

  if (loading || !detail) return <Spinner label={t("transport.common.loading")} />;

  return (
    <div className="mt-3 space-y-4 border-t border-border pt-3">
      {msg && <p className="text-sm text-destructive">{msg}</p>}

      <div>
        <p className="mb-2 text-sm font-semibold text-foreground">{t("transport.routes.assign")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            {t("transport.routes.vehicle")}
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className="mt-1 block rounded-lg border border-border bg-background px-3 py-2">
              <option value="">{t("transport.routes.none")}</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registrationNumber}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            {t("transport.routes.driver")}
            <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className="mt-1 block rounded-lg border border-border bg-background px-3 py-2">
              <option value="">{t("transport.routes.none")}</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <button onClick={saveAssignment} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            {t("transport.common.save")}
          </button>
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-foreground">{t("transport.routes.stops")}</p>
        <div className="space-y-1">
          {detail.stops.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-1.5 text-sm">
              <span>
                #{s.sequence} · {s.name}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            value={stopName}
            onChange={(e) => setStopName(e.target.value)}
            placeholder={t("transport.routes.stopName")}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
          />
          <button onClick={addStop} disabled={!stopName.trim()} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {t("transport.routes.addStop")}
          </button>
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-foreground">{t("transport.routes.students")}</p>
        <div className="space-y-1">
          {detail.studentAssignments.map((sa) => (
            <div key={sa.id} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-1.5 text-sm">
              <span>
                {sa.student.name} ({sa.student.rollNo}) {sa.stop ? `· ${sa.stop.name}` : ""}
              </span>
              <button onClick={() => unassignStudent(sa.student.id)} className="text-xs text-destructive">
                {t("transport.routes.unassignStudent")}
              </button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            {t("transport.routes.selectStudent")}
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className="mt-1 block rounded-lg border border-border bg-background px-3 py-2">
              <option value="">—</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.rollNo})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            {t("transport.routes.selectStop")}
            <select value={stopId} onChange={(e) => setStopId(e.target.value)} className="mt-1 block rounded-lg border border-border bg-background px-3 py-2">
              <option value="">{t("transport.routes.none")}</option>
              {detail.stops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button onClick={assignStudent} disabled={!studentId} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {t("transport.routes.assignStudent")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Vehicles ──────────────────────────────────────────────────────────────────
type Vehicle = { id: string; registrationNumber: string; capacity: number | null; model: string | null; isActive: boolean; _count: { routes: number } };

function Vehicles({ base, errText }: { base: string; errText: (c: unknown) => string }) {
  const { t } = useTranslation();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [capacity, setCapacity] = useState("");
  const [model, setModel] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api(`${base}/vehicles`);
    if (r.ok) setVehicles((r.data as Vehicle[]) ?? []);
    setLoading(false);
  }, [base]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function addVehicle() {
    setMsg(null);
    const r = await api(`${base}/vehicles`, {
      method: "POST",
      body: JSON.stringify({ registrationNumber, capacity: capacity ? Number(capacity) : undefined, model: model || undefined }),
    });
    if (r.ok) {
      setMsg(t("transport.vehicles.vehicleCreated"));
      setRegistrationNumber("");
      setCapacity("");
      setModel("");
      setShowAdd(false);
      load();
    } else {
      setMsg((r.data as Json)?.error as string || errText((r.data as Json)?.code));
    }
  }

  async function remove(id: string) {
    if (!confirm(t("transport.vehicles.deleteConfirm"))) return;
    const r = await api(`${base}/vehicles/${id}`, { method: "DELETE" });
    if (r.ok) load();
    else setMsg((r.data as Json)?.error as string || errText((r.data as Json)?.code));
  }

  return (
    <div className="space-y-4">
      <button onClick={() => setShowAdd((v) => !v)} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
        {t("transport.vehicles.addVehicle")}
      </button>

      {msg && <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">{msg}</div>}

      {showAdd && (
        <Card>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="text-sm">
              {t("transport.vehicles.registrationNumber")}
              <input value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>
            <label className="text-sm">
              {t("transport.vehicles.capacity")}
              <input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>
            <label className="text-sm">
              {t("transport.vehicles.model")}
              <input value={model} onChange={(e) => setModel(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={addVehicle} disabled={!registrationNumber.trim()} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {t("transport.common.save")}
            </button>
            <button onClick={() => setShowAdd(false)} className="rounded-lg border border-border px-3 py-2 text-sm">
              {t("transport.common.cancel")}
            </button>
          </div>
        </Card>
      )}

      {loading ? (
        <Spinner label={t("transport.common.loading")} />
      ) : vehicles.length === 0 ? (
        <Card>{t("transport.vehicles.noVehicles")}</Card>
      ) : (
        <div className="space-y-2">
          {vehicles.map((v) => (
            <div key={v.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-4 shadow-sm">
              <div>
                <p className="font-medium text-foreground">
                  {v.registrationNumber} {!v.isActive && <span className="ml-2 rounded bg-muted px-2 py-0.5 text-xs">{t("transport.common.inactive")}</span>}
                </p>
                <p className="text-sm text-muted-foreground">
                  {v.model ?? "—"} · {v.capacity ?? "—"} seats · {v._count.routes} routes
                </p>
              </div>
              <button onClick={() => remove(v.id)} className="rounded-lg border border-border px-3 py-1.5 text-sm text-destructive">
                {t("transport.common.delete")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Drivers ───────────────────────────────────────────────────────────────────
type Driver = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  licenseNumber: string | null;
  isActive: boolean;
  hasPassword: boolean;
  _count: { routes: number };
};

function Drivers({ base, errText }: { base: string; errText: (c: unknown) => string }) {
  const { t } = useTranslation();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api(`${base}/drivers`);
    if (r.ok) setDrivers((r.data as Driver[]) ?? []);
    setLoading(false);
  }, [base]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function addDriver() {
    setMsg(null);
    const r = await api(`${base}/drivers`, {
      method: "POST",
      body: JSON.stringify({
        name,
        phone,
        email: email || undefined,
        licenseNumber: licenseNumber || undefined,
        password: password || undefined,
      }),
    });
    if (r.ok) {
      setMsg(t("transport.drivers.driverCreated"));
      setName("");
      setPhone("");
      setEmail("");
      setLicenseNumber("");
      setPassword("");
      setShowAdd(false);
      load();
    } else {
      setMsg((r.data as Json)?.error as string || errText((r.data as Json)?.code));
    }
  }

  async function remove(id: string) {
    if (!confirm(t("transport.drivers.deleteConfirm"))) return;
    const r = await api(`${base}/drivers/${id}`, { method: "DELETE" });
    if (r.ok) load();
    else setMsg((r.data as Json)?.error as string || errText((r.data as Json)?.code));
  }

  return (
    <div className="space-y-4">
      <button onClick={() => setShowAdd((v) => !v)} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
        {t("transport.drivers.addDriver")}
      </button>

      {msg && <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">{msg}</div>}

      {showAdd && (
        <Card>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-sm">
              {t("transport.drivers.name")}
              <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>
            <label className="text-sm">
              {t("transport.drivers.phone")}
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>
            <label className="text-sm">
              {t("transport.drivers.email")}
              <input value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>
            <label className="text-sm">
              {t("transport.drivers.licenseNumber")}
              <input value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>
            <label className="text-sm md:col-span-2">
              {t("transport.drivers.password")}
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" />
              <span className="mt-1 block text-xs text-muted-foreground">{t("transport.drivers.passwordHint")}</span>
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={addDriver} disabled={!name.trim() || !phone.trim()} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {t("transport.common.save")}
            </button>
            <button onClick={() => setShowAdd(false)} className="rounded-lg border border-border px-3 py-2 text-sm">
              {t("transport.common.cancel")}
            </button>
          </div>
        </Card>
      )}

      {loading ? (
        <Spinner label={t("transport.common.loading")} />
      ) : drivers.length === 0 ? (
        <Card>{t("transport.drivers.noDrivers")}</Card>
      ) : (
        <div className="space-y-2">
          {drivers.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-4 shadow-sm">
              <div>
                <p className="font-medium text-foreground">
                  {d.name} {!d.isActive && <span className="ml-2 rounded bg-muted px-2 py-0.5 text-xs">{t("transport.common.inactive")}</span>}
                </p>
                <p className="text-sm text-muted-foreground">
                  {d.phone} · {d.licenseNumber ?? "—"} · {d._count.routes} routes
                </p>
              </div>
              <button onClick={() => remove(d.id)} className="rounded-lg border border-border px-3 py-1.5 text-sm text-destructive">
                {t("transport.common.delete")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
