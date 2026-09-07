"use client";

import { useCallback, useEffect, useState } from "react";

type Dist = { agentId: number; name: string | null; isDistributor: boolean; username: string | null; plainPassword: string | null; targets: number[] };
type AgentLite = { id: number; name: string | null };
type Data = { distributors: Dist[]; allAgents: AgentLite[] };

export default function OwnerDistributorsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [msg, setMsg] = useState("");
  const [nu, setNu] = useState({ agentId: "", username: "", password: "" });

  const load = useCallback(() => {
    fetch("/api/owner/card-distributors").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setData(d); });
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(body: Record<string, unknown>, okMsg: string) {
    setMsg("");
    const r = await fetch("/api/owner/card-distributors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(d?.error ?? "فشل"); return false; }
    setMsg(okMsg); load(); return true;
  }

  if (!data) return <div className="p-6 text-slate-400">جاري التحميل...</div>;

  const nameOf = (id: number) => data.allAgents.find((a) => a.id === id)?.name ?? `#${id}`;
  const nonDist = data.allAgents.filter((a) => !data.distributors.some((d) => d.agentId === a.id));

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-800">🃏 موزّعو الكروت</h1>
        <a href="/owner" className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 hover:bg-slate-200">← رجوع</a>
      </div>
      <p className="text-xs leading-5 text-slate-500">
        فعّل وكيلاً موزّعاً، وأنشئ له حسابَ دخولٍ منفصلاً لصفحة <b dir="ltr">/card-distributor</b>، وحدّد الوكلاءَ الذين يضع في مخازنهم كروتاً. الموزّعُ يغيّر كلمةَ مروره بنفسه لاحقاً.
      </p>

      {/* تفعيلُ موزّعٍ جديد */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 font-semibold text-slate-800">تفعيلُ موزّعٍ جديد</div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={nu.agentId} onChange={(e) => setNu({ ...nu, agentId: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">— اختر الوكيل —</option>
            {nonDist.map((a) => <option key={a.id} value={a.id}>{a.name ?? `#${a.id}`}</option>)}
          </select>
          <input value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} dir="ltr" placeholder="اسم المستخدم" className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} dir="ltr" placeholder="كلمة المرور (٨+)" className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button
            type="button"
            onClick={async () => { if (await act({ action: "create", agentId: Number(nu.agentId), username: nu.username.trim(), password: nu.password }, "✓ فُعِّل الموزّع")) setNu({ agentId: "", username: "", password: "" }); }}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >+ تفعيل</button>
        </div>
      </div>

      {/* الموزّعون */}
      {data.distributors.map((d) => (
        <div key={d.agentId} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="font-bold text-slate-800">{d.name ?? `#${d.agentId}`} {d.isDistributor ? <span className="ml-1 rounded bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">مفعّل</span> : <span className="ml-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">متوقّف</span>}</div>
            <div className="flex gap-2">
              <button type="button" onClick={() => act({ action: d.isDistributor ? "disable" : "enable", agentId: d.agentId }, "✓ حُدِّث")} className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-slate-200">{d.isDistributor ? "إيقاف" : "تفعيل"}</button>
              <button type="button" onClick={() => { const p = prompt("كلمةُ مرورٍ جديدة (٨ فأكثر)")?.trim(); if (p) act({ action: "reset", agentId: d.agentId, password: p }, "✓ صُفِّرت"); }} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700 hover:bg-amber-100">تصفير كلمة المرور</button>
            </div>
          </div>
          <div className="mb-3 text-xs text-slate-500">حساب /card-distributor: <b dir="ltr">{d.username ?? "—"}</b> {d.plainPassword && <span dir="ltr" className="text-slate-400">/ {d.plainPassword}</span>}</div>

          <div className="rounded-lg bg-slate-50 p-3">
            <div className="mb-2 text-xs font-semibold text-slate-600">الوكلاءُ المسموح لهم (يضعُ في مخازنهم كروتاً):</div>
            <div className="mb-2 flex flex-wrap gap-1">
              {d.targets.length === 0 && <span className="text-xs text-slate-400">لا وكلاءَ بعد.</span>}
              {d.targets.map((tid) => (
                <span key={tid} className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-1 text-xs text-sky-800">
                  {nameOf(tid)}
                  <button type="button" onClick={() => act({ action: "removeTarget", agentId: d.agentId, targetAgentId: tid }, "✓ أُزيل")} className="text-sky-500 hover:text-red-600">✕</button>
                </span>
              ))}
            </div>
            <select
              defaultValue=""
              onChange={(e) => { const v = Number(e.target.value); if (v) { act({ action: "addTarget", agentId: d.agentId, targetAgentId: v }, "✓ أُضيف"); e.currentTarget.value = ""; } }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">+ أضِف وكيلاً…</option>
              {data.allAgents.filter((a) => a.id !== d.agentId && !d.targets.includes(a.id)).map((a) => <option key={a.id} value={a.id}>{a.name ?? `#${a.id}`}</option>)}
            </select>
          </div>
        </div>
      ))}

      {msg && <div className="sticky bottom-0 rounded-lg bg-white/90 px-3 py-2 text-sm text-slate-700 backdrop-blur">{msg}</div>}
    </div>
  );
}
