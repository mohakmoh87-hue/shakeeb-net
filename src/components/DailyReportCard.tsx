"use client";

import { useEffect, useRef, useState } from "react";
import { formatDate } from "@/lib/format";

export type DailyReport = {
  activationCount: number;
  activationIn: number;
  invoiceCount: number;
  invoiceIn: number;
  salesIn: number;
  otherIn: number;
  expenses: number;
  total: number;
};
type Tower = { id: number; name: string | null };

const fmt = (n: number | null | undefined) => (n == null ? "0" : Number(n).toLocaleString("en-US"));

// لوحة التقرير اليومي: مستخدم المكتب يرى مكتبه؛ المدير يرى تبويبات (الإجمالي + كل مكتب).
export default function DailyReportCard({
  isAdmin,
  towers,
  initial,
}: {
  isAdmin: boolean;
  towers: Tower[];
  initial: DailyReport;
}) {
  const [sel, setSel] = useState<"all" | number>("all");
  const [data, setData] = useState<DailyReport>(initial);
  const [loading, setLoading] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (!isAdmin) return;
    // التبويب الأول (الإجمالي) بياناته جاهزة من الخادم — لا نُعيد الجلب عبثاً
    if (first.current) { first.current = false; return; }
    setLoading(true);
    fetch(`/api/reports/daily?towerId=${sel}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setData(d); })
      .finally(() => setLoading(false));
  }, [sel, isAdmin]);

  const rows = [
    { cat: "تفعيل اشتراكات", count: data.activationCount, wasel: fmt(data.activationIn) },
    { cat: "فاتورة المبيع", count: data.invoiceCount, wasel: fmt(data.invoiceIn) },
    { cat: "مبيعات المخزن", count: "" as number | string, wasel: fmt(data.salesIn) },
    { cat: "المقبوضات (اليوم)", count: "" as number | string, wasel: fmt(data.otherIn) },
    { cat: "المصروفات (اليوم)", count: "" as number | string, wasel: fmt(data.expenses) },
  ];

  const tabCls = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-semibold transition ${active ? "bg-mynet-blue text-white shadow" : "bg-white text-slate-600 hover:bg-slate-100"}`;

  return (
    <aside className="rounded-xl bg-white shadow-xl">
      <div className="flex items-center justify-between rounded-t-xl bg-slate-100 px-4 py-3">
        <span className="text-xs text-slate-400">{formatDate(new Date())}</span>
        <h2 className="text-lg font-bold text-slate-800">التقرير اليومي</h2>
      </div>

      {isAdmin && (
        <div className="flex flex-wrap gap-1 border-b border-slate-200 bg-slate-50 p-2">
          <button onClick={() => setSel("all")} className={tabCls(sel === "all")}>📊 الإجمالي</button>
          {towers.map((t) => (
            <button key={t.id} onClick={() => setSel(t.id)} className={tabCls(sel === t.id)}>
              {t.name ?? `#${t.id}`}
            </button>
          ))}
        </div>
      )}

      <div className={`overflow-hidden p-3 transition ${loading ? "opacity-50" : ""}`}>
        <table className="w-full text-right text-sm">
          <thead>
            <tr className="border-b-2 border-slate-200 text-slate-500">
              <th className="p-2 font-semibold">الفئة</th>
              <th className="p-2 font-semibold">العدد</th>
              <th className="p-2 font-semibold">الواصل</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cat} className="border-b border-slate-100">
                <td className="p-2 font-medium text-slate-700">{r.cat}</td>
                <td className="p-2 text-slate-500">{r.count}</td>
                <td className="p-2 font-semibold text-emerald-600">{r.wasel}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 rounded-lg bg-emerald-50 p-3">
          <div className="flex items-center justify-between">
            <span className="text-2xl font-extrabold text-emerald-600">{fmt(data.total)} د.ع</span>
            <span className="text-sm font-semibold text-slate-600">
              المجموع{isAdmin && sel !== "all" ? ` — ${towers.find((t) => t.id === sel)?.name ?? ""}` : isAdmin ? " (كل المكاتب)" : ""}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
