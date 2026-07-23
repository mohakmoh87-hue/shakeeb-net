"use client";

import { useEffect, useState } from "react";

type Detail = {
  id: number;
  kind: "قبض" | "صرف";
  amount: number;
  date: string | null;
  serverDate: string | null;
  notes: string | null;
  source: string;
  sourceType: string;
  accountName: string | null;
  officeName: string | null;
  byName: string | null;
  ref: { label: string; url?: string } | null;
};

const fmt = (n: number) => Number(n).toLocaleString("en-US");
// تاريخ ووقت بتوقيت بغداد
const dt = (s: string | null) =>
  s ? new Date(s).toLocaleString("en-GB", { timeZone: "Asia/Baghdad", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

// نافذة تفاصيل حركة مالية: تُفتح بالنقر على أي حركة في الصندوق أو التقرير التفصيلي
export default function MoneyTxModal({ id, onClose }: { id: number; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`/api/money/${id}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (r.ok) setD(j);
        else setErr(j.error ?? "تعذّر جلب التفاصيل");
      })
      .catch(() => { if (alive) setErr("تعذّر الاتصال بالخادم"); });
    return () => { alive = false; };
  }, [id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold text-slate-800">💰 تفاصيل الحركة المالية #{id}</h3>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100">✕</button>
        </div>

        {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</div>}
        {!d && !err && <div className="py-6 text-center text-sm text-slate-400">جار التحميل…</div>}

        {d && (
          <div className="space-y-2 text-sm">
            {/* المبلغ والنوع */}
            <div className={`rounded-xl p-3 text-center ${d.kind === "قبض" ? "bg-emerald-50" : "bg-red-50"}`}>
              <div className={`text-2xl font-extrabold ${d.kind === "قبض" ? "text-emerald-700" : "text-red-700"}`}>
                {d.kind === "قبض" ? "+" : "−"} {fmt(d.amount)} د.ع
              </div>
              <div className="text-xs text-slate-500">{d.kind === "قبض" ? "قبض (داخل للصندوق)" : "صرف (خارج من الصندوق)"}</div>
            </div>

            <Row label="المصدر" value={d.source} />
            {d.ref && (
              <Row
                label="مرتبطة بـ"
                value={d.ref.url ? (
                  <a href={d.ref.url} target="_blank" rel="noreferrer" className="font-semibold text-mynet-blue hover:underline">{d.ref.label} ↗</a>
                ) : d.ref.label}
              />
            )}
            <Row label="الحساب" value={d.accountName ?? "—"} />
            <Row label="المكتب" value={d.officeName ?? "—"} />
            <Row label="سجّلها" value={d.byName ?? "—"} />
            <Row label="التاريخ" value={<span dir="ltr">{dt(d.date)}</span>} />
            {d.notes && <Row label="ملاحظات" value={d.notes} />}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="text-left font-medium text-slate-800">{value}</span>
    </div>
  );
}
