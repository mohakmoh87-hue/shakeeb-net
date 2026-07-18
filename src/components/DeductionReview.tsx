"use client";

import { useCallback, useEffect, useState } from "react";

type Adj = {
  id: number; technicianId: number; technicianName: string; kind: string; source: string;
  amount: number; reason: string; overrunMin: number | null; status: string; dayKey: string; decidedBy: string | null;
};
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "معلّق", cls: "bg-amber-100 text-amber-700" },
  confirmed: { label: "مؤكّد", cls: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "ملغى", cls: "bg-slate-200 text-slate-500" },
};
const num = (n: number) => Number(n).toLocaleString("en-US");

// مراجعة المدير للخصومات المعلّقة (تجاوز الوقت) — تأكيد/رفض.
export default function DeductionReview({ officeId, officeName, onClose, onChange }: { officeId: number | null; officeName: string; onClose: () => void; onChange: () => void }) {
  const [rows, setRows] = useState<Adj[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(() => {
    fetch(`/api/field/adjustments${officeId != null ? `?officeId=${officeId}` : ""}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setRows(d.adjustments ?? []));
  }, [officeId]);
  useEffect(() => { load(); }, [load]);

  async function decide(id: number, status: "confirmed" | "rejected") {
    setBusyId(id);
    const r = await fetch("/api/field/adjustments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    const d = await r.json().catch(() => ({}));
    setBusyId(null);
    if (!r.ok) { alert(d.error ?? "تعذّر"); return; }
    load(); onChange();
  }

  const pending = rows.filter((r) => r.status === "pending");
  const decided = rows.filter((r) => r.status !== "pending");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-3" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">💠 خصومات {officeName}</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
        </div>

        <div className="mb-2 text-sm font-bold text-amber-700">المعلّقة ({pending.length})</div>
        {pending.length === 0 ? (
          <div className="mb-4 rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-400">لا خصومات معلّقة</div>
        ) : (
          <ul className="mb-4 space-y-2">
            {pending.map((a) => (
              <li key={a.id} className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2">
                <Row a={a} />
                <div className="mt-2 flex gap-2">
                  <button onClick={() => decide(a.id, "confirmed")} disabled={busyId === a.id} className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">تأكيد الخصم</button>
                  <button onClick={() => decide(a.id, "rejected")} disabled={busyId === a.id} className="flex-1 rounded-lg bg-slate-400 py-1.5 text-sm font-bold text-white hover:bg-slate-500 disabled:opacity-60">إلغاء</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {decided.length > 0 && (
          <>
            <div className="mb-2 text-sm font-bold text-slate-600">مقرّرة سابقاً</div>
            <ul className="space-y-1.5">
              {decided.map((a) => {
                const st = STATUS[a.status] ?? STATUS.pending;
                return (
                  <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="min-w-0"><Row a={a} compact /></div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ a, compact }: { a: Adj; compact?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={`font-bold ${a.kind === "deduction" ? "text-rose-700" : "text-emerald-700"} ${compact ? "text-xs" : "text-sm"}`}>
        👷 {a.technicianName} · {a.kind === "deduction" ? "خصم" : "مكافأة"} <b>{num(a.amount)}</b> د.ع
        <span className="mr-1 font-normal text-slate-400" dir="ltr"> {a.dayKey}</span>
      </div>
      <div className={`text-slate-500 ${compact ? "truncate text-[11px]" : "text-xs"}`}>{a.reason}</div>
    </div>
  );
}
