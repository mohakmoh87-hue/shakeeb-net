"use client";

import { useCallback, useEffect, useState } from "react";

type Leave = {
  id: number; kind: string; paid: boolean; dayKey: string;
  startMin: number | null; endMin: number | null; reason: string; status: string;
};
const todayKey = () => new Date(new Date().getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10); // بغداد
const minToHHMM = (m: number | null) => (m == null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
const hhmmToMin = (s: string) => { const m = s.match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "قيد المراجعة", cls: "bg-amber-100 text-amber-700" },
  approved: { label: "مقبولة", cls: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "مرفوضة", cls: "bg-red-100 text-red-600" },
};

// نافذة الفني لطلب الإجازة (يوم/زمنية) + عرض طلباته وحالتها.
export default function TechLeaveModal({ mode, onClose }: { mode: "day" | "time"; onClose: () => void }) {
  const [tab, setTab] = useState<"day" | "time">(mode);
  const [remaining, setRemaining] = useState(0);
  const [quota, setQuota] = useState(0);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [date, setDate] = useState(todayKey());
  const [paid, setPaid] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    fetch("/api/field/leaves").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setRemaining(d.remaining ?? 0); setQuota(d.quota ?? 0); setLeaves(d.leaves ?? []);
    });
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === "day" && remaining <= 0) setPaid(false); }, [tab, remaining]);

  async function submit() {
    setMsg(""); if (!reason.trim()) { setMsg("السبب مطلوب"); return; }
    const body: Record<string, unknown> = { kind: tab, dayKey: date, reason: reason.trim() };
    if (tab === "day") body.paid = paid;
    else {
      const s = hhmmToMin(from), e = hhmmToMin(to);
      if (s == null || e == null || e <= s) { setMsg("حدّد فترة زمنية صحيحة (من/إلى)"); return; }
      body.startMin = s; body.endMin = e;
    }
    setBusy(true);
    const r = await fetch("/api/field/leaves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error ?? "تعذّر الإرسال"); return; }
    setReason(""); setFrom(""); setTo(""); setPaid(false); load();
    setMsg("تم إرسال الطلب ✓");
  }

  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/50 sm:items-center sm:p-3" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">📅 طلب إجازة</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
        </div>

        {/* تبويب النوع */}
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
          {(["day", "time"] as const).map((k) => (
            <button key={k} onClick={() => { setTab(k); setMsg(""); }}
              className={`rounded-lg py-2 text-sm font-bold transition ${tab === k ? "bg-white text-mynet-blue shadow" : "text-slate-500"}`}>
              {k === "day" ? "إجازة يوم" : "إجازة زمنية"}
            </button>
          ))}
        </div>

        {msg && <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${msg.includes("✓") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{msg}</div>}

        <label className="mb-1 block text-xs font-semibold text-slate-500">التاريخ</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue" />

        {tab === "day" ? (
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">نوع الإجازة</span>
              <span className="text-[11px] text-slate-400">المتبقّي من الحصّة المدفوعة: <b className={remaining > 0 ? "text-emerald-600" : "text-red-500"}>{remaining}</b>/{quota}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => remaining > 0 && setPaid(true)} disabled={remaining <= 0}
                className={`rounded-lg border py-2 text-sm font-bold transition ${paid ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500"} disabled:opacity-40`}>
                براتب
              </button>
              <button onClick={() => setPaid(false)}
                className={`rounded-lg border py-2 text-sm font-bold transition ${!paid ? "border-mynet-blue bg-blue-50 text-mynet-blue" : "border-slate-200 text-slate-500"}`}>
                بلا راتب
              </button>
            </div>
            {remaining <= 0 && <p className="mt-1 text-[11px] text-amber-600">استنفدت حصّة الإجازات المدفوعة هذا الشهر — الطلب سيكون بلا راتب.</p>}
          </div>
        ) : (
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">من الساعة</label>
              <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">إلى الساعة</label>
              <input type="time" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue" />
            </div>
          </div>
        )}

        <label className="mb-1 block text-xs font-semibold text-slate-500">السبب (إلزامي)</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="اكتب سبب الإجازة..." className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue" />

        <button onClick={submit} disabled={busy} className="mb-4 w-full rounded-xl bg-mynet-blue py-2.5 font-bold text-white hover:bg-mynet-blue-dark disabled:opacity-60">
          {busy ? "..." : "إرسال الطلب"}
        </button>

        {/* طلباتي السابقة */}
        <div className="mb-1 text-sm font-bold text-slate-700">طلباتي</div>
        {leaves.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-400">لا طلبات بعد</div>
        ) : (
          <ul className="space-y-1.5">
            {leaves.map((l) => {
              const st = STATUS[l.status] ?? STATUS.pending;
              return (
                <li key={l.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-700">
                      {l.kind === "day" ? `يوم ${l.paid ? "براتب" : "بلا راتب"}` : `زمنية ${minToHHMM(l.startMin)}–${minToHHMM(l.endMin)}`}
                      <span className="mr-1 font-normal text-slate-400" dir="ltr"> {l.dayKey}</span>
                    </div>
                    <div className="truncate text-[11px] text-slate-500">{l.reason}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
