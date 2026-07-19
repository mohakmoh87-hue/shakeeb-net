"use client";

import { useState } from "react";

type Loc = { name: string; gmaps: string; waze: string };

// زر «خريطة»: يجلب موقع المشترك (بـ subscriberId أو netUser أو نصّ بطاقة)
// ويعرض زرَّي ملاحة (خرائط جوجل + Waze). الموقع يُشتق تلقائياً من اليوزر.
export default function MapButton({
  subscriberId, netUser, text, towerId, size = "md", className = "",
}: {
  subscriberId?: number; netUser?: string | null; text?: string | null; towerId?: number | null;
  size?: "sm" | "md"; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loc, setLoc] = useState<Loc | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function fetchLoc() {
    setLoading(true); setErr("");
    const qs = new URLSearchParams();
    if (subscriberId) qs.set("subscriberId", String(subscriberId));
    if (netUser) qs.set("netUser", netUser);
    if (text) qs.set("text", text);
    if (towerId) qs.set("towerId", String(towerId));
    try {
      const r = await fetch(`/api/map/resolve?${qs.toString()}`);
      const d = await r.json();
      if (r.ok) { setLoc(d); setOpen(true); }
      else setErr(d.error ?? "تعذّر تحديد الموقع");
    } catch { setErr("تعذّر تحديد الموقع"); }
    setLoading(false);
  }

  const btnCls = size === "sm"
    ? "px-2 py-1 text-[11px]"
    : "px-3 py-1.5 text-xs";

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); fetchLoc(); }}
        disabled={loading}
        title="عرض الموقع على الخريطة"
        className={`inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 ${btnCls} ${className}`}
      >
        🗺️ {loading ? "…" : "خريطة"}
      </button>
      {err && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4" onClick={() => setErr("")}>
          <div className="w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-3xl">📍</div>
            <div className="mb-4 text-sm font-semibold text-slate-700">{err}</div>
            <button onClick={() => setErr("")} className="w-full rounded-lg bg-slate-100 py-2 text-slate-600">حسناً</button>
          </div>
        </div>
      )}
      {open && loc && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="max-h-[92dvh] w-full max-w-xs overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-center text-lg font-bold text-slate-800">📍 موقع المشترك</div>
            <div className="mb-4 text-center text-xs text-slate-400" dir="ltr">{loc.name}</div>
            <a href={loc.gmaps} target="_blank" rel="noreferrer" className="mb-2 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 font-bold text-white hover:bg-emerald-700">
              🗺️ خرائط جوجل
            </a>
            <a href={loc.waze} target="_blank" rel="noreferrer" className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-sky-500 py-3 font-bold text-white hover:bg-sky-600">
              🧭 Waze
            </a>
            <button onClick={() => setOpen(false)} className="w-full rounded-lg bg-slate-100 py-2 text-slate-600 hover:bg-slate-200">إغلاق</button>
          </div>
        </div>
      )}
    </>
  );
}
