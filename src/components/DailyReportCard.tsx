"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { onMoneyRefresh } from "@/lib/moneyRefresh";
import TxDrillModal from "@/components/TxDrillModal";
import WaStatusBadge from "@/components/WaStatusBadge";

// «الضغط على المبلغ يفتح مكوّناته» (المرحلة ٥ · ووُسِّع 2026-08-13): الجدولُ نفسُه صار
// `TxDrillModal` المشترك — تستعمله هذه البطاقةُ ونافذةُ يومٍ سابقٍ في حسابات المدير معاً،
// فلا يختلف سطرٌ بين شاشةٍ وأخرى ولا يُنسى تعديلٌ في إحداهما.

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
  // أ-٢٣ · تفصيلُ التفعيلات على لوحات الساس — لا يأتي إلّا لمكتبٍ بأكثرَ من لوحة
  activationsByPanel?: { panelId: number; label: string; count: number }[];
};
type Tower = { id: number; name: string | null };
type TowerUser = { id: number; name: string; towerId: number }; // مستخدمو مكاتب الوكيل (لتبويب المستخدمين)

const fmt = (n: number | null | undefined) => (n == null ? "0" : Number(n).toLocaleString("en-US"));

// بطاقة التقرير اليومي (بنية النموذج المعتمد): زرّ «سجل الوصولات» البرتقالي بالترويسة،
// تبويبات المكاتب، جدول الفئات، شريط المجموع اللاجوردي، ومستطيل حساب الماستر.
export default function DailyReportCard({
  isAdmin,
  towers,
  towerUsers = [],
  initial,
}: {
  isAdmin: boolean;
  towers: Tower[];
  towerUsers?: TowerUser[];
  initial: DailyReport;
}) {
  const [sel, setSel] = useState<"all" | number>("all");
  // اختيار المستخدم (لمكتبٍ فيه مستخدمان+): «الكل» أو مستخدم محدّد — للمدير فقط
  const [userSel, setUserSel] = useState<"all" | number>("all");
  const officeUsers = sel !== "all" ? towerUsers.filter((u) => u.towerId === sel) : [];
  const showUserTabs = isAdmin && sel !== "all" && officeUsers.length >= 2;
  // معامل userId المُلحق بالجلبات — فقط حين مكتبٌ محدّد ومستخدمٌ محدّد
  const uq = isAdmin && sel !== "all" && userSel !== "all" ? `&userId=${userSel}` : "";
  const [data, setData] = useState<DailyReport>(initial);
  const [loading, setLoading] = useState(false);
  const [drill, setDrill] = useState<string | null>(null); // الصنفُ المضغوط — والجلبُ داخل العارض
  const first = useRef(true);

  useEffect(() => {
    if (!isAdmin) return;
    // التبويب الأول (الإجمالي) بياناته جاهزة من الخادم — لا نُعيد الجلب عبثاً
    if (first.current) { first.current = false; return; }
    setLoading(true);
    fetch(`/api/reports/daily?towerId=${sel}${uq}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setData(d); })
      .finally(() => setLoading(false));
  }, [sel, isAdmin, uq]);

  // تحديث صامت عند أي تغيّر مالي (تفعيل/تسديد/تحصيل/حذف) وعند العودة للصفحة —
  // بلا مؤقّت دوري (قرار محمد 2026-07-29 بعد حادثة «فرق الـ35 ألفاً» بحساب المواصلات:
  // بطاقة المستخدم كانت تُحسب لحظة فتح الصفحة فقط فلا ترى عملياته اللاحقة)
  useEffect(() => {
    return onMoneyRefresh(() => {
      fetch(`/api/reports/daily?towerId=${isAdmin ? sel : "all"}${uq}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d) setData(d); })
        .catch(() => {});
    });
  }, [sel, isAdmin, uq]);

  // فتح تفاصيل سطر: الحركات الفعلية وراء الرقم لليوم والمكتب (والمستخدم) المعروضين.
  // والجلبُ والحذفُ صارا داخل `TxDrillModal` — فهذه البطاقةُ تُسمّي الصنفَ فقط.
  const openDrill = (kind: string) => setDrill(kind);
  const drillUser = isAdmin && sel !== "all" && userSel !== "all" ? userSel : null;

  // بعد حذفِ حركةٍ من التفصيل: تُعاد أرقامُ البطاقة، وإلّا عُرض مجموعٌ يشمل حركةً حُذفت
  const refreshCard = () => {
    fetch(`/api/reports/daily?towerId=${isAdmin ? sel : "all"}${uq}`)
      .then((x) => (x.ok ? x.json() : null)).then((d) => { if (d) setData(d); }).catch(() => {});
  };

  const rows = [
    { cat: "تفعيل اشتراكات", count: String(data.activationCount), wasel: fmt(data.activationIn), kind: "activation" },
    // أ-٢٣ · «كم مشتركاً مُفعَّلاً من ساس ١ وكم من ساس ٢» (طلب محمد 2026-08-13) — يظهر في
    // التقرير الحيّ **وفي التقارير القديمة** لأنّ الاثنَين يُحسبان بـ`computeDailyReport` نفسِها.
    // ولا يظهر لمكتبٍ بلوحةٍ واحدة إطلاقاً (الحقلُ لا يأتي من الخادم أصلاً).
    ...((data.activationsByPanel ?? []).map((p) => ({
      cat: `   ↳ من ${p.label}`, count: String(p.count), wasel: "", kind: "activation" as const,
    }))),
    { cat: "فاتورة المبيع (المُحصَّل)", count: String(data.invoiceCount), wasel: fmt(data.invoiceIn), kind: "invoice" },
    { cat: "مبيعات المخزن", count: "", wasel: fmt(data.salesIn), kind: "sale" },
    { cat: "المقبوضات (اليوم)", count: "", wasel: fmt(data.otherIn), kind: "other" },
    { cat: "المصروفات (اليوم)", count: "", wasel: fmt(data.expenses), kind: "expenses" },
  ];

  return (
    <div className="card">
      <div className="ch">
        <h2>التقرير اليومي</h2>
        {/* مؤشِّرُ واتساب المكاتب — نُقل إلى هنا (طلبُ محمد): الزرُّ الجديد في شريط
            المشتركين كان سيُزيحه يساراً. ويقول **لماذا** يحتاجه كلُّ مكتبٍ منقطع. */}
        <WaStatusBadge />
        <Link className="obtn" href="/receipts" style={{ textDecoration: "none" }}>سجل الوصولات</Link>
      </div>
      <div style={{ padding: "0 16px 6px", fontSize: 11, color: "var(--muted)" }}>{formatDate(new Date())}</div>

      {isAdmin && (
        <div className="rtabs">
          <button className={`rtab ${sel === "all" ? "on" : ""}`} onClick={() => { setSel("all"); setUserSel("all"); }}>📊 الإجمالي</button>
          {towers.map((t) => (
            <button key={t.id} className={`rtab ${sel === t.id ? "on" : ""}`} onClick={() => { setSel(t.id); setUserSel("all"); }}>
              {t.name ?? `#${t.id}`}
            </button>
          ))}
        </div>
      )}

      {/* مكتبٌ فيه مستخدمان+ : تبويب اختيار المستخدم — يرى المدير حساب كلّ مستخدمٍ وحده */}
      {showUserTabs && (
        <div className="rtabs" style={{ marginTop: 2 }}>
          <button className={`rtab ${userSel === "all" ? "on" : ""}`} onClick={() => setUserSel("all")}>👥 كل المستخدمين</button>
          {officeUsers.map((u) => (
            <button key={u.id} className={`rtab ${userSel === u.id ? "on" : ""}`} onClick={() => setUserSel(u.id)}>
              👤 {u.name}
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
          {showUserTabs && userSel !== "all" ? ` — ${officeUsers.find((u) => u.id === userSel)?.name ?? ""}` : ""}
        </span>
      </div>

      {/* حساب الماستر — مستقل تماماً، لا يدخل ضمن المجموع أعلاه */}
      <div className="masterbar" onClick={() => openDrill("master")} style={{ cursor: "pointer", ...(loading ? { opacity: .5 } : {}) }} title="اضغط لعرض حركات الماستر اليوم">
        <b>{fmt(data.masterIn)} د.ع</b>
        <span>🅜 حساب الماستر (مستقل)</span>
      </div>

      {/* التفصيلُ بالعارض المشترك: يوزرُ المشترك واسمُه ووقتُه بالثانية — ونفسُه يُستعمَل
          في نافذة يومٍ سابقٍ بحسابات المدير، فلا تعريفَين لسطرٍ واحد. */}
      {drill && (
        <TxDrillModal
          kind={drill} towerId={isAdmin ? sel : "all"} userId={drillUser}
          onClose={() => setDrill(null)} onChanged={refreshCard}
        />
      )}
    </div>
  );
}
