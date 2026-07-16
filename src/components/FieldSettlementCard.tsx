"use client";

import { useCallback, useEffect, useState } from "react";

type Item = { title: string; kind: string; amount: number };
type Tech = { id: number; name: string; towerId: number | null; pendingTotal: number; pendingCount: number; items?: Item[] };
type Office = { id: number; name: string | null };

const fmt = (n: number) => Number(n).toLocaleString("en-US");

// تحصيل الفنيين على الواجهة الرئيسية: لكل فني اسمه ومجموع تكتاته المنجزة وزر «اكمال».
export default function FieldSettlementCard() {
  const [techs, setTechs] = useState<Tech[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [isManager, setIsManager] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null); // فني مفتوح تفصيل مبلغه

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

  const Row = (t: Tech) => {
    const open = openId === t.id;
    return (
    <div key={t.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-700">👷 {t.name}</div>
          <div className="text-xs text-slate-400">{t.pendingCount} تكت منجز</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${t.pendingTotal > 0 ? "text-emerald-700" : "text-slate-400"}`}>{fmt(t.pendingTotal)} د.ع</span>
          {/* زر + لعرض تفاصيل المبلغ قبل الإكمال */}
          <button
            onClick={() => setOpenId(open ? null : t.id)}
            disabled={t.pendingCount <= 0}
            title="تفاصيل المبلغ"
            className={`flex h-7 w-7 items-center justify-center rounded-lg border text-sm font-bold disabled:opacity-30 ${open ? "border-mynet-blue bg-blue-50 text-mynet-blue" : "border-slate-300 text-slate-500 hover:bg-slate-50"}`}
          >
            {open ? "−" : "+"}
          </button>
          <button
            onClick={() => settle(t)}
            disabled={t.pendingTotal <= 0 || busyId === t.id}
            className="rounded-lg bg-mynet-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-40"
          >
            {busyId === t.id ? "…" : "اكمال"}
          </button>
        </div>
      </div>
      {/* تفصيل التكتات المكوّنة للمبلغ */}
      {open && (
        <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
          {(t.items ?? []).length === 0 ? (
            <div className="text-center text-xs text-slate-400">لا تفاصيل</div>
          ) : (
            (t.items ?? []).map((it, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-slate-600">{it.kind ? `${it.kind} — ` : ""}{it.title}</span>
                <span className="shrink-0 font-semibold text-emerald-700">{fmt(it.amount)} د.ع</span>
              </div>
            ))
          )}
          <div className="mt-1 flex items-center justify-between border-t border-slate-100 pt-1 text-xs font-bold">
            <span className="text-slate-700">المجموع</span>
            <span className="text-emerald-700">{fmt(t.pendingTotal)} د.ع</span>
          </div>
        </div>
      )}
    </div>
    );
  };

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
