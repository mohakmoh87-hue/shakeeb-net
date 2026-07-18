"use client";

import { useEffect, useState } from "react";

type Pkg = { id: number; name: string | null; priceDinar: number | null; rewardAmount: number | null };

// إعداد مبلغ مكافأة التفعيل لكل باقة (نظام أكواد المكافآت) — يظهر للمدير فقط.
export default function RewardConfig() {
  const [pkgs, setPkgs] = useState<Pkg[] | null>(null);
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState("");
  const [allowed, setAllowed] = useState(true);

  function load() {
    fetch("/api/rewards/config").then((r) => {
      if (r.status === 403 || r.status === 401) { setAllowed(false); return; }
      if (r.ok) r.json().then((d) => {
        setPkgs(d.packages ?? []);
        const inp: Record<number, string> = {};
        for (const p of (d.packages ?? [])) inp[p.id] = String(p.rewardAmount ?? 0);
        setInputs(inp);
      });
    });
  }
  useEffect(() => { load(); }, []);

  async function save(packageId: number) {
    setMsg("");
    const r = await fetch("/api/rewards/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packageId, amount: Number(inputs[packageId]) || 0 }) });
    if (r.ok) { setMsg("✓ حُفظ مبلغ المكافأة"); load(); }
    else { const d = await r.json().catch(() => ({})); setMsg(d.error ?? "فشل الحفظ"); }
  }

  if (!allowed || !pkgs) return null;

  return (
    <div className="mb-6 max-w-lg rounded-xl border border-fuchsia-200 bg-fuchsia-50 p-5 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-bold text-fuchsia-800">🎁 مكافأة التفعيل لكل باقة</h3>
        <a href="/rewards" className="rounded-lg bg-fuchsia-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-fuchsia-700">📒 سجلّ المكافآت</a>
      </div>
      <p className="mb-3 text-xs text-slate-500">مبلغ المكافأة لكل شهر تفعيل. يتراكم للمشترك عند كل تفعيل (× عدد الأشهر) ويُرسل له كوداً بواتساب يستخدمه خصماً عند الصيانة أو فاتورة المبيع فقط. فعّل النظام لكل مكتب من صفحة «المكاتب».</p>
      {pkgs.length === 0 ? <div className="text-sm text-slate-400">لا توجد باقات بعد — أضِفها من صفحة الباقات.</div> : (
        <div className="space-y-2">
          {pkgs.map((pk) => (
            <div key={pk.id} className="flex items-center gap-2">
              <div className="w-32 shrink-0 text-sm font-medium text-slate-700">{pk.name ?? `#${pk.id}`}</div>
              <input type="number" min={0} value={inputs[pk.id] ?? ""} onChange={(e) => setInputs((m) => ({ ...m, [pk.id]: e.target.value }))} placeholder="مبلغ المكافأة (د.ع)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <button onClick={() => save(pk.id)} className="shrink-0 rounded-lg bg-fuchsia-600 px-3 py-2 text-sm font-semibold text-white hover:bg-fuchsia-700">حفظ</button>
            </div>
          ))}
        </div>
      )}
      {msg && <div className="mt-2 text-sm text-emerald-700">{msg}</div>}
    </div>
  );
}
