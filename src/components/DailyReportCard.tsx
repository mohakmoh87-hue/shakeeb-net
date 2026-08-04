"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { onMoneyRefresh } from "@/lib/moneyRefresh";
import { usePermission } from "@/lib/usePermission";
import { askVoidEffect } from "@/lib/voidPrompt";

// «الضغط على المبلغ يفتح مكوّناته» (المرحلة ٥): كل سطر في التقرير كان رقماً جامداً
// لا سبيل لمعرفة مِمَّ تكوّن ولا حذف حركة خاطئة منه.
type DrillRow = {
  id: number; date: string | null; moneyIn: number; moneyOut: number;
  notes: string | null; office: string | null; account: string | null; by: string | null; sourceType: string | null;
};
type Drill = {
  kind: string;
  rows: DrillRow[];
  totals: { count: number; moneyIn: number; moneyOut: number; net: number };
  truncated: boolean;
};
const KIND_TITLE: Record<string, string> = {
  activation: "تفعيل اشتراكات", invoice: "فاتورة المبيع", sale: "مبيعات المخزن",
  other: "المقبوضات (اليوم)", expenses: "المصروفات (اليوم)", master: "🅜 حساب الماستر", total: "المجموع",
};

export type DailyReport = {
  activationCount: number;
  activationIn: number;
  invoiceCount: number;
  invoiceIn: number;
  salesIn: number;
  masterIn: number;
  otherIn: number;
  expenses: number;
  total: number;
};
type Tower = { id: number; name: string | null };

const fmt = (n: number | null | undefined) => (n == null ? "0" : Number(n).toLocaleString("en-US"));

// بطاقة التقرير اليومي (بنية النموذج المعتمد): زرّ «سجل الوصولات» البرتقالي بالترويسة،
// تبويبات المكاتب، جدول الفئات، شريط المجموع اللاجوردي، ومستطيل حساب الماستر.
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
  const [drill, setDrill] = useState<Drill | null>(null);
  const [drillBusy, setDrillBusy] = useState(false);
  const { can } = usePermission();
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

  // تحديث صامت عند أي تغيّر مالي (تفعيل/تسديد/تحصيل/حذف) وعند العودة للصفحة —
  // بلا مؤقّت دوري (قرار محمد 2026-07-29 بعد حادثة «فرق الـ35 ألفاً» بحساب المواصلات:
  // بطاقة المستخدم كانت تُحسب لحظة فتح الصفحة فقط فلا ترى عملياته اللاحقة)
  useEffect(() => {
    return onMoneyRefresh(() => {
      fetch(`/api/reports/daily?towerId=${isAdmin ? sel : "all"}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d) setData(d); })
        .catch(() => {});
    });
  }, [sel, isAdmin]);

  // فتح تفاصيل سطر: الحركات الفعلية وراء الرقم لليوم والمكتب المعروضين
  function openDrill(kind: string) {
    setDrillBusy(true); setDrill(null);
    fetch(`/api/reports/daily/rows?kind=${kind}&towerId=${isAdmin ? sel : "all"}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setDrill(d); })
      .finally(() => setDrillBusy(false));
  }

  async function voidDrillRow(r: DrillRow) {
    const choice = await askVoidEffect("هذه الحركة");
    if (!choice) return;
    const res = await fetch(`/api/money/${r.id}/void`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reverse: choice.reverse }),
    });
    if (res.ok) {
      openDrill(drill?.kind ?? "total");
      fetch(`/api/reports/daily?towerId=${isAdmin ? sel : "all"}`).then((x) => (x.ok ? x.json() : null)).then((d) => { if (d) setData(d); });
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "تعذّر الحذف");
    }
  }

  const rows = [
    { cat: "تفعيل اشتراكات", count: String(data.activationCount), wasel: fmt(data.activationIn), kind: "activation" },
    { cat: "فاتورة المبيع", count: String(data.invoiceCount), wasel: fmt(data.invoiceIn), kind: "invoice" },
    { cat: "مبيعات المخزن", count: "", wasel: fmt(data.salesIn), kind: "sale" },
    { cat: "المقبوضات (اليوم)", count: "", wasel: fmt(data.otherIn), kind: "other" },
    { cat: "المصروفات (اليوم)", count: "", wasel: fmt(data.expenses), kind: "expenses" },
  ];

  return (
    <div className="card">
      <div className="ch">
        <h2>التقرير اليومي</h2>
        <Link className="obtn" href="/receipts" style={{ textDecoration: "none" }}>سجل الوصولات</Link>
      </div>
      <div style={{ padding: "0 16px 6px", fontSize: 11, color: "var(--muted)" }}>{formatDate(new Date())}</div>

      {isAdmin && (
        <div className="rtabs">
          <button className={`rtab ${sel === "all" ? "on" : ""}`} onClick={() => setSel("all")}>📊 الإجمالي</button>
          {towers.map((t) => (
            <button key={t.id} className={`rtab ${sel === t.id ? "on" : ""}`} onClick={() => setSel(t.id)}>
              {t.name ?? `#${t.id}`}
            </button>
          ))}
        </div>
      )}

      {/* rep-wrap: الجدول وحده يمرّر داخلياً عند ضيق الارتفاع؛ المجموع والماستر ثابتان أسفله */}
      <div className="rep-wrap" style={loading ? { opacity: .5, transition: "opacity .15s" } : undefined}>
        <table className="rep">
          <thead><tr><th>الفئة</th><th>العدد</th><th>الواصل</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cat} onClick={() => openDrill(r.kind)} style={{ cursor: "pointer" }} title="اضغط لعرض الحركات المكوّنة لهذا المبلغ">
                <td>{r.cat}</td>
                <td className="num">{r.count}</td>
                <td className="wsl">{r.wasel} <span style={{ opacity: .45, fontSize: 11 }}>↗</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sumbar" onClick={() => openDrill("total")} style={{ cursor: "pointer", ...(loading ? { opacity: .5 } : {}) }} title="اضغط لعرض كل حركات اليوم">
        <b>{fmt(data.total)} د.ع</b>
        <span>
          المجموع{isAdmin && sel !== "all" ? ` — ${towers.find((t) => t.id === sel)?.name ?? ""}` : isAdmin ? " (كل المكاتب)" : ""}
        </span>
      </div>

      {/* حساب الماستر — مستقل تماماً، لا يدخل ضمن المجموع أعلاه */}
      <div className="masterbar" onClick={() => openDrill("master")} style={{ cursor: "pointer", ...(loading ? { opacity: .5 } : {}) }} title="اضغط لعرض حركات الماستر اليوم">
        <b>{fmt(data.masterIn)} د.ع</b>
        <span>🅜 حساب الماستر (مستقل)</span>
      </div>

      {(drill || drillBusy) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setDrill(null); setDrillBusy(false); }}>
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <h3 className="text-base font-bold text-slate-800">{drill ? KIND_TITLE[drill.kind] ?? drill.kind : "..."} — حركات اليوم</h3>
                {drill && (
                  <p className="text-xs text-slate-500">
                    {drill.totals.count} حركة · قبض {fmt(drill.totals.moneyIn)} · صرف {fmt(drill.totals.moneyOut)} · الصافي {fmt(drill.totals.net)}
                    {drill.truncated ? " — معروض أول 500" : ""}
                  </p>
                )}
              </div>
              <button onClick={() => { setDrill(null); setDrillBusy(false); }} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
            </div>
            <div className="overflow-auto">
              {drillBusy || !drill ? (
                <div className="p-8 text-center text-slate-400">جاري التحميل...</div>
              ) : drill.rows.length === 0 ? (
                <div className="p-8 text-center text-slate-400">لا حركات في هذا السطر اليوم</div>
              ) : (
                <table className="w-full text-right text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-600">
                    <tr><th className="p-2">الوقت</th><th className="p-2">المكتب</th><th className="p-2">الحساب</th>
                      <th className="p-2">قبض</th><th className="p-2">صرف</th><th className="p-2">الملاحظة</th>
                      <th className="p-2">بواسطة</th>{can("receipts.void") && <th className="p-2"></th>}</tr>
                  </thead>
                  <tbody>
                    {drill.rows.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="p-2 whitespace-nowrap text-slate-500" dir="ltr">{r.date ? new Date(r.date).toLocaleTimeString("en-GB", { timeZone: "Asia/Baghdad", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                        <td className="p-2 text-slate-500">{r.office ?? "—"}</td>
                        <td className="p-2 text-slate-500">{r.account ?? "—"}</td>
                        <td className="p-2 font-bold text-emerald-600">{r.moneyIn ? fmt(r.moneyIn) : "—"}</td>
                        <td className="p-2 font-bold text-red-600">{r.moneyOut ? fmt(r.moneyOut) : "—"}</td>
                        <td className="p-2 text-slate-600">{r.notes ?? "—"}</td>
                        <td className="p-2 text-slate-400">{r.by ?? "—"}</td>
                        {can("receipts.void") && (
                          <td className="p-2"><button onClick={() => voidDrillRow(r)} className="rounded bg-red-50 px-2 py-1 font-semibold text-red-600 hover:bg-red-100" title="حذف">🗑</button></td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
