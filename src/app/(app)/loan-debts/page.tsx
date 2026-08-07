"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import DateRangeFilter from "@/components/DateRangeFilter";
import { usePermission } from "@/lib/usePermission";
import { formatDate } from "@/lib/format";

// شاشة «ديون القروض» (طلب محمد 2026-08-06): قروض فزعة القائمة — بلا زرّ تسديد، ولا تدخل
// التقرير اليوميّ. تُمحى تلقائيّاً عند تفعيل المشترك عاديّاً. العزل مُطبَّق في الخادم (towerScope).
type Row = {
  id: number; subscriberId: number; name: string | null; phone: string | null;
  netUser: string | null; amount: number; grantDate: string; expiryVirtual: string | null;
  createdByUser: string | null; office: string | null;
};
type Office = { id: number; name: string | null };
const fmt = (n: number | null | undefined) => (n == null ? "0" : Number(n).toLocaleString("en-US"));

export default function LoanDebtsPage() {
  const { me, can } = usePermission();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [on, setOn] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [office, setOffice] = useState("all");
  const [offices, setOffices] = useState<Office[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // فلتر المكتب للمدير فقط — يجلب مكاتب وكيله (نفس عزل /api/towers)
    if (me?.isAdmin) {
      fetch("/api/towers")
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => setOffices(Array.isArray(d) ? d.map((o: { id: number; name: string | null }) => ({ id: o.id, name: o.name })) : []))
        .catch(() => {});
    }
  }, [me?.isAdmin]);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (on && from && to) { p.set("from", from); p.set("to", to); }
    if (office !== "all") p.set("towerId", office);
    fetch(`/api/loan-debts?${p.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setRows(d.rows ?? []); setTotal(d.total ?? 0); } setLoading(false); })
      .catch(() => setLoading(false));
  }, [q, on, from, to, office]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  // إلغاء قرضٍ عكسيّاً: يحذف الدين ويُرجع تاريخ الانتهاء لما قبل القرض (تزول الـ٣٠ يوماً)
  const canReverse = can("subscriptions.manage");
  async function reverseLoan(r: Row) {
    if (!confirm(
      `إلغاء قرض «${r.name ?? r.netUser ?? r.subscriberId}» عكسيّاً؟\n\n` +
      `• يُحذف الدين (${fmt(r.amount)} د.ع) من القائمة.\n` +
      `• يعود تاريخ انتهائه لما كان قبل القرض (تزول الـ٣٠ يوماً).\n` +
      `• الساس لا يتغيّر (أيّامه الحقيقيّة تبقى كما هي).\n\nلا يمكن التراجع.`
    )) return;
    const res = await fetch(`/api/loan-debts/${r.id}`, { method: "DELETE" });
    if (res.ok) load();
    else { const d = await res.json().catch(() => ({})); alert(d.error ?? "تعذّر الإلغاء"); }
  }

  return (
    <div className="p-6">
      <PageHeader title="ديون القروض" subtitle="قروض فزعة القائمة — لا تُسدَّد هنا، ولا تدخل التقرير اليوميّ. تُمحى تلقائيّاً عند تفعيل المشترك عاديّاً." />

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="بحث بالاسم أو اليوزر أو الهاتف"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue"
          />
        </div>
        {me?.isAdmin && (
          <select value={office} onChange={(e) => setOffice(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="all">كل المكاتب</option>
            {offices.map((o) => <option key={o.id} value={o.id}>{o.name ?? `#${o.id}`}</option>)}
          </select>
        )}
        <DateRangeFilter on={on} setOn={setOn} from={from} setFrom={setFrom} to={to} setTo={setTo} label="مدى تاريخ المنح" />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 bg-amber-50 px-4 py-2">
          <span className="text-sm font-bold text-amber-800">💳 إجمالي القروض القائمة: {fmt(total)} د.ع</span>
          <span className="text-xs text-slate-500">{rows.length} قرض</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="p-2 text-right">المشترك</th>
                <th className="p-2">اليوزر</th>
                <th className="p-2">المبلغ</th>
                <th className="p-2">تاريخ المنح</th>
                <th className="p-2">ينتهي (وهميّ)</th>
                <th className="p-2">المكتب</th>
                <th className="p-2">مَن منح</th>
                {canReverse && <th className="p-2">إلغاء</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={canReverse ? 8 : 7} className="p-8 text-center text-slate-400">جارٍ التحميل…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={canReverse ? 8 : 7} className="p-8 text-center text-slate-400">لا قروض قائمة</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="p-2 font-semibold text-slate-800">
                    {r.name ?? "—"}
                    {r.phone && <span className="block text-[11px] font-normal text-slate-400" dir="ltr">{r.phone}</span>}
                  </td>
                  <td className="p-2 text-center text-slate-600" dir="ltr">{r.netUser ?? "—"}</td>
                  <td className="p-2 text-center font-bold text-amber-700">{fmt(r.amount)}</td>
                  <td className="p-2 text-center text-slate-500" dir="ltr">{formatDate(r.grantDate)}</td>
                  <td className="p-2 text-center text-slate-500" dir="ltr">{r.expiryVirtual ? formatDate(r.expiryVirtual) : "—"}</td>
                  <td className="p-2 text-center text-slate-600">{r.office ?? "—"}</td>
                  <td className="p-2 text-center text-slate-500">{r.createdByUser ?? "—"}</td>
                  {canReverse && (
                    <td className="p-2 text-center">
                      <button onClick={() => reverseLoan(r)} className="rounded bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-100" title="إلغاء القرض عكسيّاً — يزيل الدين والـ30 يوماً">🗑️ إلغاء</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
