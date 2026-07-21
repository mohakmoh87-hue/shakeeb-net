"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import { formatDate } from "@/lib/format";
import { usePermission } from "@/lib/usePermission";

type Invoice = {
  id: number;
  number: number | null;
  date: string | null;
  subscriberName: string | null;
  itemNames: string;
  totalMy: number | null;
  waselHim: number | null;
  note: string | null;
};
type Data = {
  invoices: Invoice[];
  totals: { count: number; total: number; collected: number };
};

const fmt = (n: number | null) => (n == null ? "0" : Number(n).toLocaleString("en-US"));
const fmtDate = (d: string | null) => formatDate(d);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function InvoicesReport() {
  const firstOfMonth = new Date(new Date().setDate(1));
  const [from, setFrom] = useState(iso(firstOfMonth));
  const [to, setTo] = useState(iso(new Date()));
  const [data, setData] = useState<Data | null>(null);
  const { can } = usePermission();

  const load = useCallback(() => {
    fetch(`/api/reports/invoices?from=${from}&to=${to}`).then(
      (r) => void (r.ok && r.json().then(setData)),
    );
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  // حذف فاتورة عكسياً (إرجاع المخزون والمبلغ)
  async function voidInvoice(id: number) {
    if (!window.confirm("حذف الفاتورة عكسياً؟\nسيُلغى مبلغها من الصندوق وتُرجَع المواد للمخزون.")) return;
    const res = await fetch(`/api/invoices/${id}/void`, { method: "POST" });
    if (res.ok) load();
    else {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "تعذّر الحذف");
    }
  }

  return (
    <div className="p-6">
      <PageHeader title="تقرير الفواتير" subtitle="فواتير البيع ضمن مدة" action={<PrintButton />} />

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
        <div className="print-area">
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Summary label="عدد الفواتير" value={fmt(data.totals.count)} />
            <Summary label="إجمالي المبيعات" value={fmt(data.totals.total)} color="text-mynet-blue" />
            <Summary label="المُحصّل" value={fmt(data.totals.collected)} color="text-emerald-600" />
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr><th className="p-2">رقم</th><th className="p-2">التاريخ</th><th className="p-2">المشترك</th><th className="p-2">المواد</th><th className="p-2">الإجمالي</th><th className="p-2">المدفوع</th><th className="p-2">المتبقّي</th><th className="no-print p-2"></th></tr>
              </thead>
              <tbody>
                {data.invoices.length === 0 ? (
                  <tr><td colSpan={8} className="p-4 text-center text-slate-400">لا توجد فواتير</td></tr>
                ) : data.invoices.map((inv) => (
                  <tr key={inv.id} className="border-t border-slate-100">
                    <td className="p-2">#{inv.number}</td>
                    <td className="p-2">{fmtDate(inv.date)}</td>
                    <td className="p-2 font-medium">{inv.subscriberName ?? "—"}</td>
                    <td className="p-2 text-slate-600">{inv.itemNames || "—"}</td>
                    <td className="p-2 font-semibold">{fmt(inv.totalMy)}</td>
                    <td className="p-2 text-emerald-600">{fmt(inv.waselHim)}</td>
                    <td className="p-2 text-red-600">{fmt((inv.totalMy ?? 0) - (inv.waselHim ?? 0))}</td>
                    <td className="no-print p-2">
                      <div className="flex gap-1.5">
                        <a href={`/invoices/${inv.id}/receipt`} target="_blank" rel="noopener noreferrer" className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-100" title="إعادة طباعة الوصل">🖨 طباعة</a>
                        {can("receipts.void") && (
                          <button onClick={() => voidInvoice(inv.id)} className="rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100" title="حذف عكسي">🗑 حذف</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
