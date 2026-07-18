"use client";

import { useState } from "react";

const todayKey = () => new Date(new Date().getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10); // بغداد

// إدارة حضور الفني للمدير: إضافة بصمة يوم كامل لتاريخ يختاره، مسح بصمة خاطئة، وخروج يدوي.
export default function AttendanceManager({ technicianId, technicianName, onClose, onChange }: { technicianId: number; technicianName: string; onClose: () => void; onChange: () => void }) {
  const [date, setDate] = useState(todayKey());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);

  async function req(method: string, body?: Record<string, unknown>, qs?: string) {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/field/attendance${qs ?? ""}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ t: "err", m: d.error ?? "تعذّر التنفيذ" }); return false; }
    onChange();
    return true;
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center sm:p-3" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-slate-50 p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300 sm:hidden" />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">🗓️ حضور {technicianName}</h3>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:bg-slate-100">✕</button>
        </div>
        {msg && <div className={`mb-3 rounded-xl px-3 py-2 text-sm ${msg.t === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{msg.m}</div>}

        {/* بصمة يوم كامل / مسح بصمة لتاريخ */}
        <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="mb-1 block text-xs font-semibold text-slate-500">التاريخ</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" className="mb-3 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-mynet-blue" />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={async () => { if (await req("PATCH", { technicianId, addDay: date })) setMsg({ t: "ok", m: "أُضيفت بصمة يوم كامل ✓" }); }} disabled={busy}
              className="flex flex-col items-center gap-1 rounded-xl bg-emerald-50 py-3 font-bold text-emerald-700 active:scale-95 disabled:opacity-60">
              <span className="text-xl leading-none">✅</span><span className="text-xs">بصمة يوم كامل</span>
            </button>
            <button onClick={async () => { if (confirm(`مسح بصمة ${date} لهذا الفني؟`)) { if (await req("DELETE", undefined, `?technicianId=${technicianId}&dayKey=${date}`)) setMsg({ t: "ok", m: "مُسحت بصمة هذا التاريخ ✓" }); } }} disabled={busy}
              className="flex flex-col items-center gap-1 rounded-xl bg-rose-50 py-3 font-bold text-rose-600 active:scale-95 disabled:opacity-60">
              <span className="text-xl leading-none">🗑️</span><span className="text-xs">مسح البصمة</span>
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">«بصمة يوم كامل» تُسجّل الدخول والخروج بوقتَي الدوام (بلا خصم/إضافي). «مسح البصمة» يحذف بصمة اليوم المحدّد ليعيد الفني بصمته.</p>
        </div>

        {/* خروج يدوي لليوم (نسيان الفني) */}
        <div className="mb-1 text-sm font-bold text-slate-700">خروج يدوي (نسيان الفني اليوم)</div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={async () => { if (await req("PATCH", { technicianId, mode: "now" })) setMsg({ t: "ok", m: "سُجّل الخروج الآن ✓" }); }} disabled={busy}
            className="flex flex-col items-center gap-1 rounded-xl bg-amber-50 py-3 font-bold text-amber-700 active:scale-95 disabled:opacity-60">
            <span className="text-xl leading-none">🕐</span><span className="text-xs">خروج الآن</span>
          </button>
          <button onClick={async () => { if (await req("PATCH", { technicianId, mode: "scheduled" })) setMsg({ t: "ok", m: "سُجّل الخروج بوقته ✓" }); }} disabled={busy}
            className="flex flex-col items-center gap-1 rounded-xl bg-amber-50 py-3 font-bold text-amber-700 active:scale-95 disabled:opacity-60">
            <span className="text-xl leading-none">⏰</span><span className="text-xs">خروج بوقته</span>
          </button>
        </div>
      </div>
    </div>
  );
}
