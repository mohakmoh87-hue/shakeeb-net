"use client";

import { useEffect, useState } from "react";

type Adj = { id: number; kind: string; source: string; amount: number; reason: string; overrunMin: number | null; status: string; dayKey: string };
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "معلّق", cls: "bg-amber-100 text-amber-700" },
  confirmed: { label: "مؤكّد", cls: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "ملغى", cls: "bg-slate-200 text-slate-500" },
};
const num = (n: number) => Number(n).toLocaleString("en-US");

// عرض الفني لخصوماته ومكافآته (قراءة فقط).
export default function TechAdjustments({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Adj[]>([]);
  const [totals, setTotals] = useState({ pending: 0, confirmed: 0, bonus: 0 });

  useEffect(() => {
    fetch("/api/field/adjustments").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d || d.role !== "technician") return;
      setRows(d.adjustments ?? []);
      setTotals({ pending: d.pendingDeductions ?? 0, confirmed: d.confirmedDeductions ?? 0, bonus: d.confirmedBonuses ?? 0 });
    });
  }, []);

  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/50 sm:items-center sm:p-3" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">💠 الخصومات والمكافآت</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
        </div>

        <div className="mb-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-amber-50 p-2"><div className="text-[10px] font-semibold text-amber-600">خصم معلّق</div><div className="text-sm font-bold text-amber-700">{num(totals.pending)}</div></div>
          <div className="rounded-xl bg-rose-50 p-2"><div className="text-[10px] font-semibold text-rose-600">خصم مؤكّد</div><div className="text-sm font-bold text-rose-700">{num(totals.confirmed)}</div></div>
          <div className="rounded-xl bg-emerald-50 p-2"><div className="text-[10px] font-semibold text-emerald-600">مكافآت</div><div className="text-sm font-bold text-emerald-700">{num(totals.bonus)}</div></div>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-400">لا خصومات أو مكافآت بعد</div>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((a) => {
              const st = STATUS[a.status] ?? STATUS.pending;
              return (
                <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="min-w-0">
                    <div className={`text-xs font-bold ${a.kind === "deduction" ? "text-rose-700" : "text-emerald-700"}`}>
                      {a.kind === "deduction" ? "خصم" : "مكافأة"} {num(a.amount)} د.ع
                      <span className="mr-1 font-normal text-slate-400" dir="ltr"> {a.dayKey}</span>
                    </div>
                    <div className="truncate text-[11px] text-slate-500">{a.reason}</div>
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
