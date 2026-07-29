"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/format";

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
  const router = useRouter();
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
    { cat: "تفعيل اشتراكات", count: String(data.activationCount), wasel: fmt(data.activationIn) },
    { cat: "فاتورة المبيع", count: String(data.invoiceCount), wasel: fmt(data.invoiceIn) },
    { cat: "مبيعات المخزن", count: "", wasel: fmt(data.salesIn) },
    { cat: "المقبوضات (اليوم)", count: "", wasel: fmt(data.otherIn) },
    { cat: "المصروفات (اليوم)", count: "", wasel: fmt(data.expenses) },
  ];

  return (
    <div className="card">
      <div className="ch">
        <h2>التقرير اليومي</h2>
        <button className="obtn" onClick={() => router.push("/subscriptions")}>سجل الوصولات</button>
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

      <div style={loading ? { opacity: .5, transition: "opacity .15s" } : undefined}>
        <table className="rep">
          <thead><tr><th>الفئة</th><th>العدد</th><th>الواصل</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cat}>
                <td>{r.cat}</td>
                <td className="num">{r.count}</td>
                <td className="wsl">{r.wasel}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="sumbar">
          <b>{fmt(data.total)} د.ع</b>
          <span>
            المجموع{isAdmin && sel !== "all" ? ` — ${towers.find((t) => t.id === sel)?.name ?? ""}` : isAdmin ? " (كل المكاتب)" : ""}
          </span>
        </div>

        {/* حساب الماستر — مستقل تماماً، لا يدخل ضمن المجموع أعلاه */}
        <div className="masterbar">
          <b>{fmt(data.masterIn)} د.ع</b>
          <span>🅜 حساب الماستر (مستقل)</span>
        </div>
      </div>
    </div>
  );
}
