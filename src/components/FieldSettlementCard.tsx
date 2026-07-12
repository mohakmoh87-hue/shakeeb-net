"use client";

import { useCallback, useEffect, useState } from "react";

type Tech = { id: number; name: string; towerId: number | null; pendingTotal: number; pendingCount: number };
type Office = { id: number; name: string | null };

const fmt = (n: number) => Number(n).toLocaleString("en-US");

// تحصيل الفنيين على الواجهة الرئيسية: لكل فني اسمه ومجموع تكتاته المنجزة وزر «اكمال».
export default function FieldSettlementCard() {
  const [techs, setTechs] = useState<Tech[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [isManager, setIsManager] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(() => {
    fetch("/api/field/settlement")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setTechs(d.technicians ?? []); setOffices(d.offices ?? []); setIsManager(!!d.isManager); } })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function settle(t: Tech) {
    if (!confirm(`تحصيل ${fmt(t.pendingTotal)} د.ع من الفني ${t.name}؟ ستُزال تكتاته المنجزة.`)) return;
    setBusyId(t.id);
    const r = await fetch("/api/field/settlement", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ technicianId: t.id }),
    });
    setBusyId(null);
    if (r.ok) load(); else alert("تعذّر التحصيل");
  }

  if (loading) return null;
  if (techs.length === 0) return null;

  const officeName = (id: number | null) => offices.find((o) => o.id === id)?.name ?? "بدون مكتب";
  // تجميع حسب المكتب للمدير
  const groups = isManager
    ? offices.map((o) => ({ office: o.name ?? `مكتب ${o.id}`, list: techs.filter((t) => t.towerId === o.id) })).filter((g) => g.list.length > 0)
    : [{ office: null as string | null, list: techs }];

  const Row = (t: Tech) => (
    <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-slate-700">👷 {t.name}</div>
        <div className="text-xs text-slate-400">{t.pendingCount} تكت منجز</div>
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-sm font-bold ${t.pendingTotal > 0 ? "text-emerald-700" : "text-slate-400"}`}>{fmt(t.pendingTotal)} د.ع</span>
        <button
          onClick={() => settle(t)}
          disabled={t.pendingTotal <= 0 || busyId === t.id}
          className="rounded-lg bg-mynet-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-40"
        >
          {busyId === t.id ? "…" : "اكمال"}
        </button>
      </div>
    </div>
  );

  return (
    <section className="mx-auto mt-5 max-w-7xl rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-lg">🛠️</span>
        <h2 className="text-base font-bold text-slate-800">تحصيل الفنيين</h2>
        <span className="text-xs text-slate-400">— مجموع تكتات كل فني المنجزة، اضغط «اكمال» عند استلام المبلغ منه</span>
      </div>
      <div className="space-y-4">
        {groups.map((g, i) => (
          <div key={i}>
            {g.office && <div className="mb-1.5 text-sm font-semibold text-mynet-blue">🏢 {g.office}</div>}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {g.list.map(Row)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
