"use client";

import { useCallback, useEffect, useState } from "react";

type Item = { date: string; type: string; label: string; amount: number; reason?: string };
type Statement = {
  daysPaid: number; cleanDays: number; dailyAmount: number; baseEarned: number; overtime: number; bonuses: number; credits: number;
  attendanceDeductions: number; confirmedDeductions: number; advances: number; net: number; periodFrom: string; periodTo: string; items: Item[];
};
type Period = { from: string | null; to: string | null };
type Archive = { id: number; periodFrom: string; periodTo: string; net: number; daysPaid: number; createdAt: string; paidByUser: string | null };
const num = (n: number) => Number(n).toLocaleString("en-US");
const signed = (n: number) => (n >= 0 ? `+${num(n)}` : `−${num(Math.abs(n))}`);

// كشف راتب الفني — يعرضه المدير (مع «تسديد») والفني (قراءة فقط).
export default function SalaryModal({ technicianId, name, onClose, onSettled }: { technicianId?: number | null; name?: string; onClose: () => void; onSettled?: () => void }) {
  const isManager = technicianId != null;
  const [st, setSt] = useState<Statement | null>(null);
  const [history, setHistory] = useState<Archive[]>([]);
  const [period, setPeriod] = useState<Period | null>(null);
  const [techName, setTechName] = useState(name ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    const q = isManager ? `?technicianId=${technicianId}` : "";
    fetch(`/api/field/salary${q}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setSt(d.statement ?? null); setHistory(d.history ?? []); setPeriod(d.period ?? null); if (d.name) setTechName(d.name);
    });
  }, [isManager, technicianId]);
  useEffect(() => { load(); }, [load]);

  async function settle() {
    if (!confirm(`تسديد راتب «${techName}»؟ سيُسجَّل صرفٌ بمقدار الصافي، ويُصفَّر سجل الحضور والخصومات والإجازات ضمن الفترة فقط. أي حركة أو خصم بتاريخ بعد نهاية الفترة يُرحَّل للشهر القادم.`)) return;
    setBusy(true); setMsg("");
    const r = await fetch("/api/field/salary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ technicianId }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error ?? "تعذّر التسديد"); return; }
    setMsg(`تم التسديد ✓ (صُرف ${num(d.paid)} د.ع)`); load(); onSettled?.();
  }

  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/50 sm:items-center sm:p-3" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">💰 راتب {techName}</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
        </div>
        {msg && <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${msg.includes("✓") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{msg}</div>}

        {!st ? (
          <div className="p-6 text-center text-sm text-slate-400">جاري الحساب…</div>
        ) : (
          <>
            {/* الصافي */}
            <div className="mb-3 rounded-2xl bg-gradient-to-l from-mynet-blue to-mynet-blue-dark p-4 text-center text-white">
              <div className="text-xs opacity-80">صافي الراتب المستحقّ</div>
              <div className="text-3xl font-extrabold">{num(st.net)} <span className="text-base font-normal">د.ع</span></div>
              <div className="mt-1 text-[11px] opacity-80" dir="ltr">{st.periodFrom} → {st.periodTo}</div>
              {!period?.from && <div className="mt-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px]">لم تُضبط فترة — يُحتسب كل السجل</div>}
            </div>

            {/* التفصيل */}
            <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
              <Cell label={`مبالغ الأيام (${st.daysPaid})`} value={num(st.baseEarned)} tone="pos" />
              <Cell label="الإضافي" value={num(st.overtime)} tone="pos" />
              <Cell label="المكافآت" value={num(st.bonuses)} tone="pos" />
              <Cell label="إضافة للحساب (قبض)" value={num(st.credits ?? 0)} tone="pos" />
              <Cell label="خصم الحضور" value={num(st.attendanceDeductions)} tone="neg" />
              <Cell label="خصومات مؤكّدة" value={num(st.confirmedDeductions)} tone="neg" />
              <Cell label="سحب من الحساب (صرف)" value={num(st.advances ?? 0)} tone="neg" />
              <Cell label="بصمات سليمة" value={String(st.cleanDays)} tone="mut" />
            </div>

            {/* التفاصيل المؤثّرة */}
            <div className="mb-1 text-sm font-bold text-slate-700">البنود المؤثّرة</div>
            {st.items.length === 0 ? (
              <div className="mb-3 rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-400">لا بنود مؤثّرة (كل البصمات سليمة)</div>
            ) : (
              <ul className="mb-3 space-y-1">
                {st.items.map((it, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs">
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-700">{it.label}</span>
                      <span className="mr-1 text-slate-400" dir="ltr"> {it.date}</span>
                      {it.reason && <div className="truncate text-[11px] text-slate-500">{it.reason}</div>}
                    </div>
                    <span className={`shrink-0 font-bold ${it.amount > 0 ? "text-emerald-600" : it.amount < 0 ? "text-rose-600" : "text-slate-400"}`}>{it.amount === 0 ? "—" : signed(it.amount)}</span>
                  </li>
                ))}
              </ul>
            )}

            {isManager && (
              <button onClick={settle} disabled={busy} className="mb-4 w-full rounded-xl bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                {busy ? "..." : `💵 تسديد الراتب (${num(Math.max(0, st.net))} د.ع)`}
              </button>
            )}

            {/* الأرشيف */}
            {history.length > 0 && (
              <>
                <div className="mb-1 text-sm font-bold text-slate-700">كشوف سابقة</div>
                <ul className="space-y-1">
                  {history.map((h) => (
                    <li key={h.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs">
                      <span className="text-slate-500" dir="ltr">{h.periodFrom} → {h.periodTo}</span>
                      <span className="font-bold text-slate-700">{num(h.net)} د.ع · {h.daysPaid} يوم</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone: "pos" | "neg" | "mut" }) {
  const c = tone === "pos" ? "text-emerald-700 bg-emerald-50" : tone === "neg" ? "text-rose-700 bg-rose-50" : "text-slate-500 bg-slate-50";
  return <div className={`rounded-lg px-3 py-2 ${c}`}><div className="text-[11px] opacity-80">{label}</div><div className="font-bold">{value}</div></div>;
}
