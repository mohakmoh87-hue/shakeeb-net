"use client";

import { useCallback, useEffect, useState } from "react";
import { usePermission } from "@/lib/usePermission";
import { askVoidEffect } from "@/lib/voidPrompt";

// ===== «من أين أتت كلُّ واحدة بالتفصيل الكامل» (طلب محمد 2026-08-13) =====
// «هذه الخياراتُ يجب أن أستطيع الضغط عليها لمشاهدة تفاصيلَ من أين أتت كلُّ واحدةٍ بالتفصيل
//  الكامل… أريد اليوزر والاسم معاً ووقت تفعيله بالساعة والدقيقة والثانية… ولا أحتاج تاريخَ
//  اليوم لأنّي أصلاً سأضغط على تاريخٍ لأرى ما فيه.»
//
// ⚠️ ولماذا مكوّنٌ واحدٌ لا ثلاثة: كان التفصيلُ مكتوباً **داخل** بطاقة الرئيسيّة وحدها،
// فلمّا صارت نافذةُ يومٍ سابقٍ في حسابات المدير (أ-٦) عُرضت مربّعاتٌ **جامدة** لا تُضغط.
// ونسخُ الجدول ثالثةً يعني ثلاثةَ تعريفاتٍ للحقيقة الواحدة تتباعد مع أوّل تعديل — وهي عينُ
// العلّة التي وُلد منها `moneyKinds.ts`. فالجدولُ هنا **مرّةً واحدة**، والشاشاتُ تُناديه.
//
// و`day` هو الفرقُ الحرِج: بلا تمريره تُفتح نافذةُ يومٍ ماضٍ **بسطورِ اليوم** فيختلف
// التفصيلُ عن المجموع — وذلك أسوأُ من ألّا يُفتح شيء.

export type DrillRow = {
  id: number; date: string | null; moneyIn: number; moneyOut: number;
  notes: string | null; office: string | null; account: string | null; by: string | null;
  sourceType: string | null;
  subject?: { name: string | null; netUser: string | null; subscriberId: number | null } | null;
  /** تفصيلةُ الصنف: سعرُ التفعيل والمرحَّل · رقمُ الفاتورة وإجماليها ومتبقّيها */
  detail?: string | null;
  /** حركةُ الصندوق التي تُحذَف بها — فارغٌ يعني لا مالَ لها في الصندوق فلا زرَّ حذف */
  voidId?: number | null;
};
type Drill = {
  kind: string; rows: DrillRow[];
  totals: { count: number; moneyIn: number; moneyOut: number; net: number };
  truncated: boolean;
};

export const KIND_TITLE: Record<string, string> = {
  activation: "تفعيل اشتراكات", invoice: "فاتورة المبيع", sale: "مبيعات المخزن",
  other: "المقبوضات", expenses: "المصروفات", master: "🅜 حساب الماستر", total: "المجموع",
};

const fmt = (n: number | null | undefined) => (n == null ? "0" : Number(n).toLocaleString("en-US"));

/** الوقتُ بالساعة والدقيقة **والثانية** بتوقيت بغداد — بلا تاريخ (طلبُ محمد صريحاً). */
export const hms = (d: string | Date | null) =>
  d == null ? "—" : new Date(d).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Baghdad", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });

/** سطرُ «اليوزر والاسم معاً» — واليوزرُ بـdir=ltr وإلّا انقلب ترتيبُه بين العربيّة.
 *  ويأخذ الصاحبَ وحدَه لا السطرَ كلَّه، ليصلح لأيّ جدولٍ بلا تحويلِ أنواعٍ قسريّ. */
export function SubjectCell({ s }: { s?: { name: string | null; netUser: string | null } | null }) {
  if (!s || (!s.name && !s.netUser)) {
    // لا صاحبَ لها: سحبٌ/خصمٌ يدويٌّ أو بيعٌ مباشرٌ بلا مشترك — والشرطةُ هنا حقيقةٌ لا نقص
    return <span className="text-slate-300">—</span>;
  }
  return (
    <div className="leading-tight">
      {s.netUser && <div className="font-mono text-[12px] font-bold text-indigo-700" dir="ltr">{s.netUser}</div>}
      {s.name && <div className="text-[12px] text-slate-700">{s.name}</div>}
    </div>
  );
}

export default function TxDrillModal({
  kind, day, towerId, userId, onClose, onChanged, subtitle, allowTransfer = false,
}: {
  kind: string;
  /** يومُ بغداد YYYY-MM-DD — فارغٌ يعني اليوم الحالي */
  day?: string | null;
  towerId: number | "all" | null;
  userId?: number | null;
  onClose: () => void;
  /** يُنادى بعد حذفِ حركةٍ ليُحدِّث الشاشةَ المُناديةَ أرقامَها */
  onChanged?: () => void;
  subtitle?: string;
  /** أ-٥/١ · نموذجُ «تحويل نقدي↔ماستر» أسفل التفاصيل — لبطاقة التقرير اليوميّ (اليوم الحاليّ) */
  allowTransfer?: boolean;
}) {
  const [d, setD] = useState<Drill | null>(null);
  const [busy, setBusy] = useState(true); // يبدأ محمّلاً — فلا `setState` داخل الأثر
  const [reload, setReload] = useState(0);
  const [tAmount, setTAmount] = useState(""); // مبلغ التحويل نقدي↔ماستر
  const [tBusy, setTBusy] = useState(false);
  const [tMsg, setTMsg] = useState<string | null>(null);
  const { can } = usePermission();

  // الجلبُ في الأثر مباشرةً، والحالةُ تُكتب في ردود الوعد لا في متنه — وإلّا صارت
  // `setState` متزامنةً داخل الأثر فتُطلق تصييراً متسلسلاً (قاعدةُ set-state-in-effect).
  // و`alive` يمنع كتابةَ ردٍّ متأخّرٍ بعد إغلاق النافذة أو تغيُّرِ الصنف.
  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ kind, towerId: towerId == null ? "all" : String(towerId) });
    if (day) q.set("day", day);
    if (userId != null) q.set("userId", String(userId));
    fetch(`/api/reports/daily/rows?${q.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((x) => { if (alive && x && !x.error) setD(x); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [kind, day, towerId, userId, reload]);

  // إعادةُ الجلب بعد حذفٍ — من مُعالِج حدثٍ لا من أثر، فلا تُخالف القاعدة أعلاه
  const reloadRows = useCallback(() => { setBusy(true); setReload((n) => n + 1); }, []);

  async function voidRow(r: DrillRow) {
    // ⚠️ الحذفُ على **حركة الصندوق** حصراً. وسطرُ التفعيل/الفاتورة معرّفُه معرّفُ القيد لا
    // معرّفُ المال، فلو مُرّر إلى مسار حذفِ المال لحُذفت **حركةٌ أخرى بالمصادفة**. فلا يُقبَل
    // إلّا `voidId`، وغيابُه يعني ألّا زرَّ من الأصل.
    const target = r.voidId ?? null;
    if (target == null) return;
    const choice = await askVoidEffect("هذه الحركة");
    if (!choice) return;
    const res = await fetch(`/api/money/${target}/void`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reverse: choice.reverse }),
    });
    if (!res.ok) { const x = await res.json().catch(() => ({})); alert(x.error ?? "تعذّر الحذف"); return; }
    reloadRows();
    onChanged?.();
  }

  const canVoid = can("receipts.void");

  // ═════ أ-٥/١ · تحويلُ مبلغٍ بين النقديّ والماستر (طلب محمد بالحرف: «أسفلها تحويل») ═════
  // يظهر في تفصيلَي «المجموع» و«الماستر» لليوم الحاليّ فقط — فالتحويل قيدُ لحظته لا قيدُ
  // يومٍ ماضٍ. والاتّجاهان متاحان معاً كما طلب («والعكس»).
  const showTransfer = allowTransfer && !day && (kind === "total" || kind === "master") && can("finance.manage");
  async function doTransfer(toMaster: boolean) {
    const amount = Number(tAmount);
    if (!Number.isInteger(amount) || amount <= 0) { setTMsg("أدخل مبلغاً صحيحاً بلا كسور"); return; }
    if (!window.confirm(`تحويل ${amount.toLocaleString("en-US")} د.ع ${toMaster ? "من النقدي إلى الماستر" : "من الماستر إلى النقدي"}؟`)) return;
    setTBusy(true); setTMsg(null);
    const res = await fetch("/api/money/transfer", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, toMaster, towerId: towerId !== "all" && towerId != null ? towerId : undefined }),
    });
    const x = await res.json().catch(() => ({}));
    setTBusy(false);
    if (!res.ok) { setTMsg(x.error ?? "تعذّر التحويل"); return; }
    setTMsg(`✓ ${x.message ?? "تمّ التحويل"}`);
    setTAmount("");
    reloadRows();
    onChanged?.();
  }

  return (
    // z أعلى من نافذة اليوم (‎z-90‎) كي يظهر فوقها لا تحتها
    <div className="fixed inset-0 z-[97] flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
      <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-lg font-extrabold text-slate-800">
              {KIND_TITLE[kind] ?? kind}
              {day && <span className="text-slate-400"> · <span dir="ltr">{day}</span></span>}
            </h3>
            <p className="mt-0.5 text-sm text-slate-500">
              {busy && !d ? "..." : d ? (
                <>
                  {fmt(d.totals.count)} حركة · قبض {fmt(d.totals.moneyIn)} · صرف {fmt(d.totals.moneyOut)} · الصافي {fmt(d.totals.net)}
                  {d.truncated ? " — معروضٌ أوّلُ ٥٠٠ (والمجموعُ أعلاه للكلّ)" : ""}
                </>
              ) : "—"}
              {subtitle ? ` · ${subtitle}` : ""}
            </p>
          </div>
          <button onClick={onClose} aria-label="إغلاق"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-2xl text-slate-500 shadow-sm hover:bg-slate-200">✕</button>
        </div>

        <div className="overflow-auto">
          {busy && !d ? <div className="p-10 text-center text-slate-400">جاري التحميل...</div>
          : !d || d.rows.length === 0 ? <div className="p-10 text-center text-slate-400">لا حركاتَ في هذا السطر</div>
          : (
            <table className="w-full text-right text-sm">
              <thead className="sticky top-0 bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-2.5 font-bold">الوقت</th>
                  <th className="p-2.5 font-bold">اليوزر / الاسم</th>
                  <th className="p-2.5 font-bold">قبض</th>
                  <th className="p-2.5 font-bold">صرف</th>
                  <th className="p-2.5 font-bold">المكتب</th>
                  <th className="p-2.5 font-bold">الحساب</th>
                  <th className="p-2.5 font-bold">البيان</th>
                  <th className="p-2.5 font-bold">بواسطة</th>
                  {canVoid && <th className="p-2.5"></th>}
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 align-top hover:bg-slate-50/70">
                    <td className="p-2.5 whitespace-nowrap font-mono text-[12px] text-slate-500" dir="ltr">{hms(r.date)}</td>
                    <td className="p-2.5"><SubjectCell s={r.subject} /></td>
                    <td className="p-2.5 font-bold text-emerald-600">{r.moneyIn ? fmt(r.moneyIn) : "—"}</td>
                    <td className="p-2.5 font-bold text-red-600">{r.moneyOut ? fmt(r.moneyOut) : "—"}</td>
                    <td className="p-2.5 text-slate-500">{r.office ?? "—"}</td>
                    <td className="p-2.5 text-slate-500">{r.account ?? "—"}</td>
                    <td className="p-2.5 text-slate-600">
                      {/* التفصيلةُ الدقيقةُ أوّلاً (السعر · المرحَّل · التحذير)، ثمّ ملاحظةُ السطر */}
                      {r.detail && <div className="text-[12px] font-semibold text-slate-700">{r.detail}</div>}
                      <div className={r.detail ? "text-[11px] text-slate-400" : ""}>{r.notes ?? (r.detail ? "" : "—")}</div>
                    </td>
                    <td className="p-2.5 text-slate-400">{r.by ?? "—"}</td>
                    {canVoid && (
                      <td className="p-2.5">
                        {r.voidId != null ? (
                          <button onClick={() => void voidRow(r)} title="حذف حركة الصندوق"
                            className="rounded bg-red-50 px-2 py-1 font-semibold text-red-600 hover:bg-red-100">🗑</button>
                        ) : (
                          <span className="text-[11px] text-slate-300" title="لا مالَ لها في الصندوق — لا شيءَ يُحذَف">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* أ-٥/١ · «تحويل» أسفل التفاصيل: نقدي↔ماستر بمبلغٍ — صفّان مزدوجان يُحذفان معاً */}
        {showTransfer && (
          <div className="border-t border-slate-200 bg-indigo-50/60 px-5 py-3">
            <div className="mb-1.5 text-sm font-bold text-indigo-800">⇄ تحويل بين النقدي والماستر</div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number" inputMode="numeric" value={tAmount} onChange={(e) => setTAmount(e.target.value)}
                placeholder="المبلغ (د.ع)" dir="ltr"
                className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
              <button onClick={() => void doTransfer(true)} disabled={tBusy}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                نقدي ← ماستر 🅜
              </button>
              <button onClick={() => void doTransfer(false)} disabled={tBusy}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                🅜 ماستر ← نقدي
              </button>
              {towerId === "all" && (
                <span className="text-[11px] text-slate-500">💡 اختر مكتباً من التبويبات ليُنسب التحويل له</span>
              )}
            </div>
            {tMsg && (
              <div className={`mt-2 rounded-lg px-3 py-1.5 text-xs ${tMsg.startsWith("✓") ? "bg-emerald-100 text-emerald-700" : "bg-red-50 text-red-600"}`}>{tMsg}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
