"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { onMoneyRefresh } from "@/lib/moneyRefresh";
import TxDrillModal from "@/components/TxDrillModal";
import WaStatusBadge from "@/components/WaStatusBadge";
import { useTrialOffice } from "@/components/TrialOfficeContext";

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
  // اختيارُ المكتب مشتركٌ عبر السياق: في تطبيق الهاتف يتبعه مربّعُ إدارة الفنيّين ومستطيلُ
  // الفعالين/المتصلين. على سطح المكتب لا قارئَ آخرَ للسياق فالسلوكُ مطابقٌ تماماً للسابق.
  const { office: sel, setOffice: setSel } = useTrialOffice();
  // اختيار المستخدم (لمكتبٍ فيه مستخدمان+): «الكل» أو مستخدم محدّد — للمدير فقط
  const [userSel, setUserSel] = useState<"all" | number>("all");
  const officeUsers = sel !== "all" ? towerUsers.filter((u) => u.towerId === sel) : [];
  const showUserTabs = isAdmin && sel !== "all" && officeUsers.length >= 2;
  // معامل userId المُلحق بالجلبات — فقط حين مكتبٌ محدّد ومستخدمٌ محدّد
  const uq = isAdmin && sel !== "all" && userSel !== "all" ? `&userId=${userSel}` : "";
  const [data, setData] = useState<DailyReport>(initial);
  const [loading, setLoading] = useState(false);
  const [drill, setDrill] = useState<string | null>(null); // الصنفُ المضغوط — والجلبُ داخل العارض
  // 🧪 التقريرُ المكبَّر (شاشة ج في النموذج): في التجربة البطاقةُ الصغيرةُ كلُّها زرُّ
  //    تكبيرٍ واحد — «لا تُرى تفاصيلُ شيءٍ إلّا وهو كبير» — والأسطرُ تُضغَط في المكبَّر وحدَه.
  const [big, setBig] = useState(false);
  const inTrial = () => typeof document !== "undefined" && document.documentElement.hasAttribute("data-app-trial");
  const first = useRef(true);

  useEffect(() => {
    if (!isAdmin) return;
    // التبويب الأول (الإجمالي) بياناته جاهزة من الخادم — لا نُعيد الجلب عبثاً
    if (first.current) { first.current = false; return; }
    setLoading(true);
    fetch(`/api/reports/daily?towerId=${sel}${uq}`)
      .then((r) => (r.ok ? r.json() : null))
      // متوسّط(٢٧) · الفشلُ كان صامتاً: تبقى أرقامُ المكتب السابق معروضةً باسم المكتب
      // الجديد — أخطرُ أنواع الكذب في تقريرٍ ماليّ. الآن يُقال صراحةً وتبقى القراءةُ للسابق.
      .then((d) => { if (d) setData(d); else alert("تعذّر جلبُ تقرير هذا المكتب — الأرقامُ المعروضةُ ما زالت للتبويب السابق"); })
      .catch(() => alert("تعذّر جلبُ تقرير هذا المكتب — الأرقامُ المعروضةُ ما زالت للتبويب السابق"))
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
        {/* 🧪 في التجربة ينتقل المؤشّر فوق مربّع إدارة الفنيّين (طلب محمد 2026-08-19)
            وزرُّ سجلّ الوصولات يكفي مكانُه في العمود الأيسر — فيُخفيان هنا بالعلامة */}
        <span data-trial-hide><WaStatusBadge /></span>
        <span data-trial-hide><Link className="obtn" href="/receipts" style={{ textDecoration: "none" }}>سجل الوصولات</Link></span>
      </div>
      <div style={{ padding: "0 16px 6px", fontSize: 11, color: "var(--muted)" }}>{formatDate(new Date())}</div>

      {isAdmin && (
        // 🧪 data-trial-hide: تبويباتُ الأزرار تختفي في تطبيق التجربة وتحلّ محلَّها القائمةُ
        //    المنسدلة أدناه (طلب محمد 2026-08-19: «الاجمالي والمكاتب قائمة منسدلة واحدة»).
        //    في المتصفّح/الإنتاج: التبويباتُ كما هي والقائمةُ مخفيّةٌ تماماً — صفرُ فرق.
        <div className="rtabs" data-trial-hide>
          <button className={`rtab ${sel === "all" ? "on" : ""}`} onClick={() => { setSel("all"); setUserSel("all"); }}>📊 الإجمالي</button>
          {towers.map((t) => (
            <button key={t.id} className={`rtab ${sel === t.id ? "on" : ""}`} onClick={() => { setSel(t.id); setUserSel("all"); }}>
              {t.name ?? `#${t.id}`}
            </button>
          ))}
        </div>
      )}
      {isAdmin && (
        <select
          className="trial-picker"
          aria-label="اختيار المكتب — الإجمالي أو مكتب محدّد"
          value={sel === "all" ? "all" : String(sel)}
          onChange={(e) => { const v = e.target.value; setSel(v === "all" ? "all" : Number(v)); setUserSel("all"); }}
        >
          <option value="all">📊 الإجمالي — كلّ المكاتب</option>
          {towers.map((t) => (
            <option key={t.id} value={String(t.id)}>{t.name ?? `#${t.id}`}</option>
          ))}
        </select>
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
            {/* 🧪 في التجربة: مبيعاتُ المخزن والمقبوضاتُ والمصروفاتُ تُخفى من الصغير (طلب محمد
                2026-08-19) ويحلّ محلَّها سطرُ «مصروف مقبوض» بفرق الرقمَين، والضغطُ يكبّر لا يفصّل */}
            {rows.map((r) => (
              <tr key={r.cat}
                data-trial-hide={["sale", "other", "expenses"].includes(r.kind) ? "" : undefined}
                onClick={() => (inTrial() ? setBig(true) : openDrill(r.kind))}
                style={{ cursor: "pointer" }} title="اضغط لعرض الحركات المكوّنة لهذا المبلغ">
                <td>{r.cat}</td>
                <td className="num">{r.count}</td>
                {/* 🧪 السهمُ يُحذف في التجربة (طلب محمد: «علامات اسهم صغيرة اريد مسحها لاعطاء مساحة») */}
                <td className="wsl">{r.wasel} <span data-trial-hide style={{ opacity: .45, fontSize: 11 }}>↗</span></td>
              </tr>
            ))}
            <tr data-trial-show onClick={() => setBig(true)} style={{ cursor: "pointer" }} title="اضغط للتكبير">
              <td>مصروف مقبوض</td>
              <td className="num"></td>
              <td className="wsl">{fmt(data.otherIn - data.expenses)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sumbar" onClick={() => (inTrial() ? setBig(true) : openDrill("total"))} style={{ cursor: "pointer", ...(loading ? { opacity: .5 } : {}) }} title="اضغط لعرض كل حركات اليوم">
        <b>{fmt(data.total)} د.ع</b>
        <span>
          {/* 🧪 في التجربة تكفي «المجموع» وحدَها (طلب محمد) — فالقائمةُ المنسدلةُ فوقها تقول السياق */}
          المجموع<span data-trial-hide>{isAdmin && sel !== "all" ? ` — ${towers.find((t) => t.id === sel)?.name ?? ""}` : isAdmin ? " (كل المكاتب)" : ""}
          {showUserTabs && userSel !== "all" ? ` — ${officeUsers.find((u) => u.id === userSel)?.name ?? ""}` : ""}</span>
        </span>
      </div>

      {/* حساب الماستر — مستقل تماماً، لا يدخل ضمن المجموع أعلاه */}
      <div className="masterbar" onClick={() => (inTrial() ? setBig(true) : openDrill("master"))} style={{ cursor: "pointer", ...(loading ? { opacity: .5 } : {}) }} title="اضغط لعرض حركات الماستر اليوم">
        <b>{fmt(data.masterIn)} د.ع</b>
        {/* 🧪 في التجربة تكفي «ماستر» (طلب محمد: «حساب ماستر مستقل يكفي كتابة ماستر») */}
        <span><span data-trial-hide>🅜 حساب الماستر (مستقل)</span><span data-trial-show>ماستر</span></span>
      </div>

      {/* 🧪 التقريرُ المكبَّر (شاشة ج): ينبثق من مكان البطاقة بحلقةٍ بيضاء، وما خلفه يبقى
          مرئيّاً بلا تعتيم، والضغطُ خارجَه يُعيده — وفيه وحدَه كلُّ الأسطر وكلُّها تُفصَّل */}
      {big && (
        <>
          <div className="trial-bd" onClick={() => setBig(false)} title="اضغط خارجَه ليعود صغيراً" />
          <div className="trial-expand">
            {isAdmin && (
              <select
                className="trial-picker" style={{ margin: "0 0 5px", width: "100%" }}
                aria-label="اختيار المكتب"
                value={sel === "all" ? "all" : String(sel)}
                onChange={(e) => { const v = e.target.value; setSel(v === "all" ? "all" : Number(v)); setUserSel("all"); }}
              >
                <option value="all">📊 الإجمالي — كلّ المكاتب</option>
                {towers.map((t) => <option key={t.id} value={String(t.id)}>{t.name ?? `#${t.id}`}</option>)}
              </select>
            )}
            <div style={loading ? { opacity: .5 } : undefined}>
              <table className="rep">
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.cat} onClick={() => openDrill(r.kind)} title="اضغط لعرض الحركات المكوّنة لهذا المبلغ">
                      <td>{r.cat}</td>
                      <td className="num">{r.count}</td>
                      <td className="wsl">{r.wasel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="sumbar" onClick={() => openDrill("total")} style={{ cursor: "pointer" }}>
                <b>{fmt(data.total)} د.ع</b><span>المجموع</span>
              </div>
              <div className="masterbar" onClick={() => openDrill("master")} style={{ cursor: "pointer" }}>
                <b>{fmt(data.masterIn)} د.ع</b><span>ماستر</span>
              </div>
            </div>
            <div style={{ textAlign: "center", fontSize: 10, opacity: .85, paddingTop: 4 }}>كلُّ سطرٍ يُضغَط فيُظهر حركاتِه</div>
          </div>
        </>
      )}

      {/* التفصيلُ بالعارض المشترك: يوزرُ المشترك واسمُه ووقتُه بالثانية — ونفسُه يُستعمَل
          في نافذة يومٍ سابقٍ بحسابات المدير، فلا تعريفَين لسطرٍ واحد. */}
      {drill && (
        <TxDrillModal
          kind={drill} towerId={isAdmin ? sel : "all"} userId={drillUser}
          onClose={() => setDrill(null)} onChanged={refreshCard}
          allowTransfer // أ-٥/١ · «تحويل» يظهر في تفصيلَي المجموع والماستر لليوم الحاليّ
        />
      )}
    </div>
  );
}
