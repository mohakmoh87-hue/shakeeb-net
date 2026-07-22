"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import PrintNowButton from "@/components/PrintNowButton";
import MoneyTxModal from "@/components/MoneyTxModal";
import { formatDate } from "@/lib/format";
import { usePermission } from "@/lib/usePermission";

type Entry = {
  id: number;
  subscriberName: string | null;
  cardType: string | null;
  month: string | null;
  money: number | null;
  moneyIn: number | null;
  date: string | null;
};
type Money = {
  id: number;
  moneyIn: number | null;
  moneyOut: number | null;
  notes: string | null;
  date: string | null;
};
type Data = {
  entries: Entry[];
  money: Money[];
  totals: {
    activationsCount: number;
    activationsTotal: number;
    activationsCollected: number;
    cashIn: number;
    cashOut: number;
  };
};

const fmt = (n: number | null) => (n == null ? "0" : Number(n).toLocaleString("en-US"));
const fmtDate = (d: string | null) => formatDate(d);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function DetailedReport() {
  const firstOfMonth = new Date(new Date().setDate(1));
  const [from, setFrom] = useState(iso(firstOfMonth));
  const [to, setTo] = useState(iso(new Date()));
  const [data, setData] = useState<Data | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null); // حركة مالية مفتوحة التفاصيل
  const { can } = usePermission();

  const load = useCallback(() => {
    fetch(`/api/reports/detailed?from=${from}&to=${to}`).then(
      (r) => void (r.ok && r.json().then(setData)),
    );
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  // حذف وصل تفعيل عكسياً (لتنظيف أي وصل متبقٍّ من هنا)
  async function voidEntry(id: number) {
    if (!window.confirm("حذف وصل التفعيل نهائياً؟ سيُزال من كل التقارير.")) return;
    const res = await fetch(`/api/subscription-entries/${id}/void`, { method: "POST" });
    if (res.ok) load();
    else { const d = await res.json().catch(() => ({})); alert(d.error ?? "تعذّر الحذف"); }
  }

  // حذف حركة مالية عكسياً (تسديد دين/حركة يدوية). حركات التفعيل/الفواتير تُحذف من صفحاتها.
  async function voidMoney(id: number) {
    if (!window.confirm("حذف هذه الحركة المالية نهائياً؟ سيُزال مبلغها من الصندوق.")) return;
    const res = await fetch(`/api/money/${id}/void`, { method: "POST" });
    if (res.ok) load();
    else { const d = await res.json().catch(() => ({})); alert(d.error ?? "تعذّر الحذف"); }
  }

  return (
    <div className="p-6">
      <PageHeader title="تقرير تفصيلي" subtitle="التفعيلات والحركات المالية ضمن مدة" action={<PrintButton />} />

      <div className="no-print mb-5 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-sm text-slate-600">من</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-600">إلى</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" />
        </div>
      </div>

      {data && (
        <div className="print-area space-y-6">
          {/* ملخّص */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Summary label="عدد التفعيلات" value={fmt(data.totals.activationsCount)} />
            <Summary label="قيمة التفعيلات" value={fmt(data.totals.activationsTotal)} />
            <Summary label="المُحصّل" value={fmt(data.totals.activationsCollected)} color="text-emerald-600" />
            <Summary label="قبض الصندوق" value={fmt(data.totals.cashIn)} color="text-emerald-600" />
            <Summary label="صرف الصندوق" value={fmt(data.totals.cashOut)} color="text-red-600" />
          </div>

          {/* التفعيلات */}
          <div>
            <h3 className="mb-2 font-bold text-slate-800">عمليات التفعيل ({data.entries.length})</h3>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr><th className="p-2">#</th><th className="p-2">المشترك</th><th className="p-2">الباقة</th><th className="p-2">أشهر</th><th className="p-2">القيمة</th><th className="p-2">المُحصّل</th><th className="p-2">التاريخ</th><th className="no-print p-2"></th></tr>
                </thead>
                <tbody>
                  {data.entries.length === 0 ? (
                    <tr><td colSpan={8} className="p-4 text-center text-slate-400">لا توجد عمليات</td></tr>
                  ) : data.entries.map((e) => (
                    <tr key={e.id} className="border-t border-slate-100">
                      <td className="p-2">{e.id}</td>
                      <td className="p-2">{e.subscriberName ?? "—"}</td>
                      <td className="p-2">{e.cardType ?? "—"}</td>
                      <td className="p-2">{e.month ?? "—"}</td>
                      <td className="p-2">{fmt(e.money)}</td>
                      <td className="p-2 text-emerald-600">{fmt(e.moneyIn)}</td>
                      <td className="p-2">{fmtDate(e.date)}</td>
                      <td className="no-print p-2">
                        <div className="flex gap-1.5">
                          <PrintNowButton kind="subscription" id={e.id} />
                          {can("receipts.void") && (
                            <button onClick={() => voidEntry(e.id)} className="rounded bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600 hover:bg-red-100">🗑 حذف</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* الحركات المالية */}
          <div>
            <h3 className="mb-2 font-bold text-slate-800">الحركات المالية ({data.money.length})</h3>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr><th className="p-2">#</th><th className="p-2">قبض</th><th className="p-2">صرف</th><th className="p-2">ملاحظات</th><th className="p-2">التاريخ</th>{can("receipts.void") && <th className="no-print p-2"></th>}</tr>
                </thead>
                <tbody>
                  {data.money.length === 0 ? (
                    <tr><td colSpan={can("receipts.void") ? 6 : 5} className="p-4 text-center text-slate-400">لا توجد حركات</td></tr>
                  ) : data.money.map((m) => (
                    <tr key={m.id} onClick={() => setDetailId(m.id)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" title="عرض التفاصيل">
                      <td className="p-2">{m.id}</td>
                      <td className="p-2 text-emerald-600">{m.moneyIn ? fmt(m.moneyIn) : "—"}</td>
                      <td className="p-2 text-red-600">{m.moneyOut ? fmt(m.moneyOut) : "—"}</td>
                      <td className="p-2 text-slate-600">{m.notes ?? "—"}</td>
                      <td className="p-2">{fmtDate(m.date)}</td>
                      {can("receipts.void") && (
                        <td className="no-print p-2"><button onClick={(e) => { e.stopPropagation(); voidMoney(m.id); }} className="rounded bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600 hover:bg-red-100">🗑 حذف</button></td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* نافذة تفاصيل الحركة المالية */}
      {detailId != null && <MoneyTxModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function Summary({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-xl font-bold ${color ?? "text-slate-800"}`}>{value}</div>
    </div>
  );
}
