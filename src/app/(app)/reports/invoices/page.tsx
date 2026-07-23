"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import PrintNowButton from "@/components/PrintNowButton";
import { usePermission } from "@/lib/usePermission";

// «تقرير الفواتير» = سجل المواد المباعة حصراً (المكان الوحيد لعرضه):
// كل سطر مادة بيعت — من فاتورة المبيع (بيع/بيع مباشر) أو من ذمة فني (بيع صيانة).
// بحث بالتاريخ والنص الحر + ترتيب بأي عمود (تصاعدي/تنازلي) + حذف الوصل عكسياً.

type Row = {
  lineId: number; invoiceId: number; number: number; date: string | null;
  item: string; count: number; price: number; total: number;
  type: string; buyer: string; tech: string | null; office: string | null; byUser: string | null;
};
type SortKey = "number" | "date" | "item" | "count" | "price" | "total" | "type" | "buyer" | "tech" | "office";

const fmt = (n: number) => Number(n).toLocaleString("en-US");
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleString("en-GB", { timeZone: "Asia/Baghdad", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export default function SoldItemsReport() {
  const { can } = usePermission();
  const [rows, setRows] = useState<Row[]>([]);
  const [totalAmount, setTotalAmount] = useState(0);
  const [invoiceCount, setInvoiceCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const load = useCallback((f = "", t = "", search = "") => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (f) qs.set("from", f);
    if (t) qs.set("to", t);
    if (search.trim()) qs.set("q", search.trim());
    fetch(`/api/reports/sold-items${qs.toString() ? `?${qs}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setRows(d.rows ?? []); setTotalAmount(d.totalAmount ?? 0); setInvoiceCount(d.invoiceCount ?? 0); } })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  // النقر على ترويسة عمود: تصاعدي ثم تنازلي عند التكرار (أرقام وتواريخ وأحرف)
  function sortBy(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }
  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: Row, b: Row): number => {
      if (sortKey === "date") return dir * ((a.date ? new Date(a.date).getTime() : 0) - (b.date ? new Date(b.date).getTime() : 0));
      if (sortKey === "item" || sortKey === "type" || sortKey === "buyer" || sortKey === "tech" || sortKey === "office")
        return dir * (a[sortKey] ?? "").toString().localeCompare((b[sortKey] ?? "").toString(), "ar");
      return dir * (Number(a[sortKey] ?? 0) - Number(b[sortKey] ?? 0));
    };
    return [...rows].sort(cmp);
  }, [rows, sortKey, sortDir]);

  // حذف الوصل كاملاً عكسياً: يُرجع المواد للمخزن (ولذمة الفني في بيع الصيانة) ويلغي مبلغه
  async function voidInvoice(r: Row) {
    const extra = r.type === "بيع صيانة" ? "وتعود المواد لذمة الفني وللمخزن" : "وتعود المواد للمخزن";
    if (!confirm(`حذف الوصل #${r.number} كاملاً (كل موادّه) عكسياً؟\nسيُلغى مبلغه من الصندوق ${extra}.`)) return;
    const res = await fetch(`/api/invoices/${r.invoiceId}/void`, { method: "POST" });
    if (res.ok) load(from, to, q);
    else alert(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "تعذّر الحذف");
  }

  return (
    <div className="p-6">
      <PageHeader title="تقرير الفواتير — سجل المواد المباعة" subtitle="كل مادة بيعت من فاتورة المبيع أو من ذمة فني (بيع صيانة) — هذا هو المكان الحصري للسجل" />

      {/* الفلاتر: تاريخ (من/إلى) + بحث حر بأي شيء */}
      <div className="no-print mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">من تاريخ</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">إلى تاريخ</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue" />
        </div>
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-600">بحث حر</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") load(from, to, q); }}
            placeholder="اسم مادة، مشترٍ، فني، نوع، رقم وصل، مبلغ…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue"
          />
        </div>
        <button onClick={() => load(from, to, q)} className="rounded-lg bg-mynet-blue px-4 py-2 text-sm font-semibold text-white hover:bg-mynet-blue-dark">🔍 بحث</button>
        {(from || to || q) && (
          <button onClick={() => { setFrom(""); setTo(""); setQ(""); load("", "", ""); }} className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-600 hover:bg-slate-200">إظهار الكل</button>
        )}
      </div>

      {/* الملخّص */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="أسطر المواد" value={fmt(sorted.length)} />
        <Stat label="عدد الوصولات" value={fmt(invoiceCount)} />
        <Stat label="إجمالي المبيع" value={fmt(totalAmount)} color="text-emerald-600" />
      </div>

      {/* الجدول — كل ترويسة قابلة للترتيب */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[900px] text-right text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <Th label="الوصل" k="number" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <Th label="التاريخ" k="date" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <Th label="المادة" k="item" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <Th label="الكمية" k="count" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <Th label="السعر" k="price" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <Th label="الإجمالي" k="total" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <Th label="النوع" k="type" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <Th label="المشتري" k="buyer" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <Th label="الفني" k="tech" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <Th label="المكتب" k="office" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <th className="p-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="p-8 text-center text-slate-400">جاري التحميل…</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={11} className="p-8 text-center text-slate-400">لا مواد مباعة ضمن هذا النطاق</td></tr>
            ) : (
              sorted.map((r) => (
                <tr key={r.lineId} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-2.5 font-semibold" dir="ltr">#{r.number}</td>
                  <td className="p-2.5 whitespace-nowrap" dir="ltr">{fmtDate(r.date)}</td>
                  <td className="p-2.5 font-semibold text-slate-800">{r.item}</td>
                  <td className="p-2.5">{fmt(r.count)}</td>
                  <td className="p-2.5">{fmt(r.price)}</td>
                  <td className="p-2.5 font-bold text-emerald-700">{fmt(r.total)}</td>
                  <td className="p-2.5">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${r.type === "بيع صيانة" ? "bg-purple-50 text-purple-700" : r.type === "بيع مباشر" ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-600"}`}>{r.type}</span>
                  </td>
                  <td className="p-2.5 text-slate-600">{r.buyer}</td>
                  <td className="p-2.5 text-slate-600">{r.tech ?? "—"}</td>
                  <td className="p-2.5 text-slate-500">{r.office ?? "—"}</td>
                  <td className="p-2.5">
                    <div className="flex justify-end gap-1.5">
                      <PrintNowButton kind="invoice" id={r.invoiceId} />
                      {can("receipts.void") && (
                        <button onClick={() => voidInvoice(r)} title="حذف الوصل كاملاً عكسياً" className="rounded bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600 hover:bg-red-100">🗑 حذف</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-400">حذف السطر يحذف الوصل كاملاً عكسياً (كل موادّه): يُلغى مبلغه من الصندوق وتعود المواد للمخزن — ولذمة الفني في بيع الصيانة.</p>
    </div>
  );
}

// ترويسة عمود قابلة للترتيب: تصاعدي/تنازلي مع سهم يوضّح الاتجاه الحالي
function Th({ label, k, sortKey, sortDir, onSort }: { label: string; k: SortKey; sortKey: SortKey; sortDir: "asc" | "desc"; onSort: (k: SortKey) => void }) {
  const active = sortKey === k;
  return (
    <th className="p-2.5">
      <button onClick={() => onSort(k)} className={`inline-flex items-center gap-1 whitespace-nowrap select-none hover:text-mynet-blue ${active ? "font-bold text-mynet-blue" : ""}`}>
        {label}
        <span className="text-[10px]">{active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}</span>
      </button>
    </th>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-xl font-bold ${color ?? "text-slate-800"}`}>{value}</div>
    </div>
  );
}
