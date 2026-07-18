"use client";

import { useCallback, useEffect, useState } from "react";

type Leave = {
  id: number; technicianId: number; technicianName: string; kind: string; paid: boolean;
  dayKey: string; startMin: number | null; endMin: number | null; reason: string;
  status: string; decidedBy: string | null;
};
const minToHHMM = (m: number | null) => (m == null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "قيد المراجعة", cls: "bg-amber-100 text-amber-700" },
  approved: { label: "مقبولة", cls: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "مرفوضة", cls: "bg-red-100 text-red-600" },
};

// مراجعة المدير لطلبات الإجازة — قبول/رفض (المعلّق أولاً).
export default function LeaveReview({ officeId, officeName, onClose, onChange }: { officeId: number | null; officeName: string; onClose: () => void; onChange: () => void }) {
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(() => {
    fetch(`/api/field/leaves${officeId != null ? `?officeId=${officeId}` : ""}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setLeaves(d.leaves ?? []));
  }, [officeId]);
  useEffect(() => { load(); }, [load]);

  async function decide(id: number, status: "approved" | "rejected") {
    setBusyId(id);
    const r = await fetch("/api/field/leaves", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    const d = await r.json().catch(() => ({}));
    setBusyId(null);
    if (!r.ok) { alert(d.error ?? "تعذّر"); return; }
    load(); onChange();
  }

  const pending = leaves.filter((l) => l.status === "pending");
  const decided = leaves.filter((l) => l.status !== "pending");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-3" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-slate-50 p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300 sm:hidden" />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">📅 إجازات {officeName}</h3>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:bg-slate-100">✕</button>
        </div>

        <div className="mb-2 text-sm font-bold text-amber-700">المعلّقة ({pending.length})</div>
        {pending.length === 0 ? (
          <div className="mb-4 rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-400">لا طلبات معلّقة</div>
        ) : (
          <ul className="mb-4 space-y-2">
            {pending.map((l) => (
              <li key={l.id} className="rounded-2xl border border-amber-200 bg-white p-3.5 shadow-sm">
                <Row l={l} />
                <div className="mt-2.5 flex gap-2">
                  <button onClick={() => decide(l.id, "approved")} disabled={busyId === l.id} className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">قبول</button>
                  <button onClick={() => decide(l.id, "rejected")} disabled={busyId === l.id} className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-60">رفض</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {decided.length > 0 && (
          <>
            <div className="mb-2 text-sm font-bold text-slate-600">مقرّرة سابقاً</div>
            <ul className="space-y-2">
              {decided.map((l) => {
                const st = STATUS[l.status] ?? STATUS.pending;
                return (
                  <li key={l.id} className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm">
                    <div className="min-w-0"><Row l={l} compact /></div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
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

function Row({ l, compact }: { l: Leave; compact?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={`font-bold text-slate-800 ${compact ? "text-sm" : "text-base"}`}>
        👷 {l.technicianName}
        <span className="mr-2 font-normal text-slate-500">
          {l.kind === "day" ? `إجازة يوم ${l.paid ? "براتب" : "بلا راتب"}` : `إجازة زمنية ${minToHHMM(l.startMin)}–${minToHHMM(l.endMin)}`}
        </span>
        <span className="font-normal text-slate-400" dir="ltr"> {l.dayKey}</span>
      </div>
      <div className={`text-slate-500 ${compact ? "truncate text-[11px]" : "text-xs"}`}>السبب: {l.reason}</div>
    </div>
  );
}
