"use client";

import { useCallback, useEffect, useState } from "react";

const todayKey = () => new Date(new Date().getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10); // بغداد
const fmtTime = (d: string | null) =>
  d ? new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Baghdad" }) : "—";

type Rec = { id: number; dayKey: string | null; checkIn: string | null; checkOut: string | null; checkoutBy: string | null; lateExcuse: string | null };

// إدارة حضور الفني للمدير: سجل البصمات (تاريخ + دخول + خروج) مع حذف كل بصمة، خروج يدوي، وإضافة يوم كامل.
export default function AttendanceManager({ technicianId, technicianName, onClose, onChange }: { technicianId: number; technicianName: string; onClose: () => void; onChange: () => void }) {
  const [log, setLog] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  const [addDate, setAddDate] = useState(todayKey());
  const [showAdd, setShowAdd] = useState(false);

  const loadLog = useCallback(() => {
    setLoading(true);
    fetch(`/api/field/attendance?technicianId=${technicianId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setLog(d?.log ?? []))
      .finally(() => setLoading(false));
  }, [technicianId]);
  useEffect(() => { loadLog(); }, [loadLog]);

  async function req(method: string, body?: Record<string, unknown>, qs?: string) {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/field/attendance${qs ?? ""}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ t: "err", m: d.error ?? "تعذّر التنفيذ" }); return false; }
    loadLog(); onChange();
    return true;
  }

  const hasOpenToday = log.some((r) => r.dayKey === todayKey() && r.checkIn && !r.checkOut);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center sm:p-3" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-slate-50 p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300 sm:hidden" />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">🗓️ سجل حضور {technicianName}</h3>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:bg-slate-100">✕</button>
        </div>
        {msg && <div className={`mb-3 rounded-xl px-3 py-2 text-sm ${msg.t === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{msg.m}</div>}

        {/* سجل البصمات: تاريخ + دخول + خروج + حذف */}
        <div className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-[1.4fr_1fr_1fr_auto] gap-1 bg-slate-100 px-3 py-2 text-[11px] font-bold text-slate-500">
            <span>التاريخ</span><span className="text-center">دخول</span><span className="text-center">خروج</span><span> </span>
          </div>
          {loading ? (
            <div className="p-4 text-center text-sm text-slate-400">جاري التحميل…</div>
          ) : log.length === 0 ? (
            <div className="p-4 text-center text-sm text-slate-400">لا بصمات في السجل الحالي</div>
          ) : (
            <ul className="max-h-64 overflow-y-auto divide-y divide-slate-100">
              {log.map((r) => (
                <li key={r.id} className="grid grid-cols-[1.4fr_1fr_1fr_auto] items-center gap-1 px-3 py-2 text-sm">
                  <span className="font-semibold text-slate-700" dir="ltr">{r.dayKey}</span>
                  <span className="text-center font-bold text-emerald-700" dir="ltr">{fmtTime(r.checkIn)}</span>
                  <span className="text-center font-bold text-rose-600" dir="ltr">
                    {fmtTime(r.checkOut)}
                    {r.checkOut && r.checkoutBy === "auto" && <span className="mr-1 text-[9px] text-amber-500">تلقائي</span>}
                  </span>
                  <button
                    onClick={() => { if (r.dayKey && confirm(`حذف بصمة ${r.dayKey}؟`)) req("DELETE", undefined, `?technicianId=${technicianId}&dayKey=${r.dayKey}`); }}
                    disabled={busy} title="حذف هذه البصمة" className="rounded-lg px-1.5 py-1 text-sm text-rose-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50">🗑️</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* خروج يدوي لليوم (إن نسي الفني) */}
        {hasOpenToday && (
          <>
            <div className="mb-1 text-sm font-bold text-slate-700">خروج يدوي لليوم (نسيان الفني)</div>
            <div className="mb-4 grid grid-cols-2 gap-2">
              <button onClick={async () => { if (await req("PATCH", { technicianId, mode: "now" })) setMsg({ t: "ok", m: "سُجّل الخروج الآن ✓" }); }} disabled={busy}
                className="flex flex-col items-center gap-1 rounded-xl bg-amber-50 py-3 font-bold text-amber-700 active:scale-95 disabled:opacity-60">
                <span className="text-xl leading-none">🕐</span><span className="text-xs">خروج الآن</span>
              </button>
              <button onClick={async () => { if (await req("PATCH", { technicianId, mode: "scheduled" })) setMsg({ t: "ok", m: "سُجّل الخروج بوقته ✓" }); }} disabled={busy}
                className="flex flex-col items-center gap-1 rounded-xl bg-amber-50 py-3 font-bold text-amber-700 active:scale-95 disabled:opacity-60">
                <span className="text-xl leading-none">⏰</span><span className="text-xs">خروج بوقته</span>
              </button>
            </div>
          </>
        )}

        {/* إضافة بصمة يوم كامل (لتاريخ فائت) */}
        {!showAdd ? (
          <button onClick={() => setShowAdd(true)} className="w-full rounded-xl border border-emerald-200 bg-emerald-50 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-100">➕ إضافة بصمة يوم كامل</button>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <label className="mb-1 block text-xs font-semibold text-slate-500">تاريخ اليوم المُضاف</label>
            <input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} dir="ltr" className="mb-3 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-mynet-blue" />
            <p className="mb-3 text-[11px] text-slate-400">تُسجَّل الدخول والخروج بوقتَي الدوام (بلا خصم/إضافي).</p>
            <div className="flex gap-2">
              <button onClick={async () => { if (await req("PATCH", { technicianId, addDay: addDate })) { setMsg({ t: "ok", m: "أُضيفت بصمة يوم كامل ✓" }); setShowAdd(false); } }} disabled={busy}
                className="flex-1 rounded-xl bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-60">{busy ? "..." : "إضافة"}</button>
              <button onClick={() => setShowAdd(false)} className="rounded-xl bg-slate-100 px-5 py-2.5 font-semibold text-slate-600">إلغاء</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
