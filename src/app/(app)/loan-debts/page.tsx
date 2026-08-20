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
// القوالب الفعّالة من /api/sms-templates/effective — سُلَّم مكتب ← وكيل ← افتراضيّ + القوالب
// الحرّة (بلاغ محمد 2026-08-20: نافذةُ الرسالة هنا كانت نصّاً حرّاً بلا قائمة قوالب أصلاً؛
// النمطُ منقولٌ حرفيّاً من صفحة «كلّ المشتركين» — وقراءةُ صفوف القاعدة وحدَها تُظهرها فارغة).
type Tpl = { key: string; type: string; text: string; scope: "office" | "agent" | "default" | "custom" };
const SCOPE_TAG: Record<string, string> = { office: " — قالب المكتب", agent: " — قالب الوكيل", default: " — افتراضيّ", custom: "" };
const TPL_NAMES: Record<string, string> = {
  activation: "تفعيل الاشتراك", expiring: "تذكير قبل الانتهاء", debtPaid: "تسديد دين",
  debts: "مطالبة بالديون", maintenance: "الصيانة/التنصيب", reward: "منح المكافأة",
  rewardUsed: "استخدام المكافأة", subSummary: "ملخص الاشتراك (وصل)", noAnswer: "ميجاوب (لم يرد)",
  loan: "قرض فزعة", other: "أخرى (عام)",
};
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
  // ═════ طلبُ محمد 2026-08-13 · رسالةٌ ووصلٌ لأصحاب القروض ═════
  // كانت الصفحةُ عرضاً محضاً: يرى المديرُ مَن عليه قرضٌ ولا يستطيع مطالبتَه إلّا بنسخِ
  // رقمه يدويّاً إلى صفحةٍ أخرى. والوصلُ **هو نفسُه قالبُ وصل المشتركين** بنصِّ طلبه —
  // فلا قالبٌ جديدٌ ولا مسارٌ جديد، بل استعمالُ ما هو قائمٌ ومُدقَّقُ العزل.
  // ⚠️ والمجموعةُ تحمل **مُعرِّفاتَ مشتركين** لا قروض: كِلا المسارَين يعمل على المشترك،
  //   ومُعرِّفُ القرض لا يعني لهما شيئاً — وخلطُهما يُرسل لمشتركٍ آخرَ صامتاً.
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [sendOpen, setSendOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [tplErr, setTplErr] = useState(""); // سببُ عدم ظهور القوالب (يُعرَض بدل الصمت)

  // القوالب الفعّالة — تُجلب لمكتب العرض (تخصيص المكتب يغلب قالب الوكيل)
  const loadTpls = useCallback(() => {
    const qs = office !== "all" ? `?officeId=${office}` : "";
    fetch(`/api/sms-templates/effective${qs}`)
      .then(async (r) => {
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? `خطأ ${r.status}`); }
        return r.json();
      })
      .then((d) => { setTpls(Array.isArray(d?.templates) ? d.templates : []); setTplErr(""); })
      .catch((e) => { setTpls([]); setTplErr((e as Error).message || "تعذّر جلب القوالب"); });
  }, [office]);
  useEffect(() => { loadTpls(); }, [loadTpls]);

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

  // ═════ التحديدُ الجماعيّ — بمُعرِّف **المشترك** ═════
  const allOn = rows.length > 0 && rows.every((r) => checked.has(r.subscriberId));
  const toggleAll = () => setChecked(allOn ? new Set() : new Set(rows.map((r) => r.subscriberId)));
  const toggle = (subId: number) => setChecked((s) => {
    const n = new Set(s); if (n.has(subId)) n.delete(subId); else n.add(subId); return n;
  });
  // المحدَّدون الذين لهم هاتفٌ — فرسالةٌ بلا رقمٍ تُحسَب فاشلةً وتُزحم سجلَّ الرسائل
  const withPhone = rows.filter((r) => checked.has(r.subscriberId) && r.phone?.trim()).length;

  /** إرسالُ رسالةٍ واتسابٍ للمحدَّدين — بالخلفيّة (نمطُ «كلّ المشتركين» نفسُه). */
  async function sendMessages() {
    if (!checked.size || !text.trim()) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "WHATSAPP", text, target: "list", subscriberIds: [...checked], background: true }),
      });
      const d = await r.json().catch(() => ({}));
      setBusy(false);
      if (!r.ok) { setMsg(d.error ?? "تعذّر الإرسال"); return; }
      setSendOpen(false); setText("");
      setMsg(`📨 بدأ الإرسال في الخلفيّة لـ ${d.total ?? checked.size} مشترك — تابِعْه في «سجل الرسائل».`);
    } catch { setBusy(false); setMsg("تعذّر الاتصال بالخادم"); }
  }

  /** طباعةُ وصلٍ للمحدَّدين — `kind:"notice"` = **قالبُ وصل المشتركين** بنصِّ طلب محمد. */
  async function printReceipts() {
    if (!checked.size) return;
    if (!confirm(`طباعة ${checked.size} وصل على طابعة المكتب؟\n\nالقالبُ المستعمَل: «وصل المشترك» — وهو نفسُه قالبُ وصولات قائمة المشتركين.`)) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/print", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "notice", ids: [...checked] }),
      });
      const d = await r.json().catch(() => ({}));
      setBusy(false);
      setMsg(r.ok
        ? `🖨️ أُرسلت ${d.queued ?? 0} وصل للطباعة${d.workerOnline ? "" : " — ⚠️ حاسبة المكتب غير متصلة، ستُطبع عند عودتها"}`
        : (d.error ?? "تعذّرت الطباعة"));
    } catch { setBusy(false); setMsg("تعذّر الاتصال بالخادم"); }
  }

  // إلغاء قرضٍ عكسيّاً: يحذف الدين ويُرجع تاريخ الانتهاء لما قبل القرض (تزول الـ٣٠ يوماً)
  const canReverse = can("subscriptions.manage");
  // زرُّ الرسالة مقيَّدٌ بصلاحيّتها في الخادم (`guard("messaging.manage")`) — فزرٌّ يفشل
  // دائماً أسوأُ من غيابه، والمستخدمُ لا يعرف أنّ السببَ صلاحيّةٌ لا عطل.
  const canSend = can("messaging.manage");
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

      {/* ═════ طلبُ محمد · مطالبةُ أصحاب القروض: رسالةٌ أو وصلٌ مطبوع ═════
          يظهر الشريطُ عند التحديد فقط فلا يزحم الشاشةَ حين لا حاجة. */}
      {checked.size > 0 && (
        <div data-app-bar className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-mynet-blue/30 bg-sky-50 px-4 py-2.5">
          <span className="text-sm font-bold text-slate-700">
            محدَّد: {checked.size}
            {/* رسالةٌ بلا رقمٍ تُحسَب فاشلةً وتُزحم سجلَّ الرسائل — فيُقال العددُ قبل الإرسال */}
            {withPhone < checked.size && (
              <span className="mr-1 text-[11px] font-semibold text-amber-700">
                ({withPhone} منهم له هاتف — والباقي لا تصله رسالة)
              </span>
            )}
          </span>
          {canSend && <button onClick={() => setSendOpen(true)} disabled={busy || withPhone === 0}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            📨 إرسالُ رسالة
          </button>}
          <button onClick={printReceipts} disabled={busy}
            title="القالبُ نفسُه: «وصل المشترك»"
            className="rounded-lg bg-mynet-blue px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50">
            🖨️ طباعةُ وصل
          </button>
          <button onClick={() => setChecked(new Set())} className="text-xs text-slate-500 hover:text-slate-700">إلغاءُ التحديد</button>
        </div>
      )}
      {msg && <div className="mb-3 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">{msg}</div>}

      {/* نافذةُ نصِّ الرسالة — الإرسالُ بالخلفيّة فلا تنتظر أمام شاشة */}
      {sendOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSendOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 font-bold text-slate-800">📨 رسالةٌ لأصحاب القروض</h3>
            <p className="mb-3 text-xs text-slate-500">
              تُرسَل لـ{withPhone} مشتركاً عبر واتساب المكتب، بفاصلِ عشرِ ثوانٍ بين رسالةٍ وأخرى — بالخلفيّة.
            </p>
            {/* قوالبُ الرسائل كلُّها — اختيارُ قالبٍ يملأ النصَّ ويبقى قابلاً للتعديل قبل الإرسال */}
            {tpls.length > 0 ? (
              <select onChange={(e) => { const t = tpls.find((x) => x.key === e.target.value); if (t?.text) setText(t.text); }}
                className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">— اختر قالباً جاهزاً ({tpls.length}) —</option>
                {tpls.map((t) => (
                  <option key={t.key} value={t.key}>
                    {TPL_NAMES[t.type] ?? t.type}{SCOPE_TAG[t.scope] ?? ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {tplErr ? `تعذّر جلب القوالب: ${tplErr}` : "لا قوالب متاحة — أنشئها من صفحة «قوالب الرسائل»، أو اكتب النصّ يدويّاً أدناه."}
              </div>
            )}
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5}
              placeholder={"نصّ الرسالة… يمكنك استعمال {اسم_المشترك} {اسم_المستخدم} {تاريخ_الانتهاء} {العنوان}"}
              className="mb-3 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm leading-6" />
            <div className="flex gap-2">
              <button onClick={sendMessages} disabled={busy || !text.trim()}
                className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                {busy ? "جارٍ…" : "إرسال"}
              </button>
              <button onClick={() => setSendOpen(false)} className="rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-600">تراجع</button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 bg-amber-50 px-4 py-2">
          <span className="text-sm font-bold text-amber-800">💳 إجمالي القروض القائمة: {fmt(total)} د.ع</span>
          <span className="text-xs text-slate-500">{rows.length} قرض</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="p-2">
                  <input type="checkbox" checked={allOn} onChange={toggleAll} title="تحديد الكل" className="h-4 w-4" />
                </th>
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
                <tr><td colSpan={canReverse ? 9 : 8} className="p-8 text-center text-slate-400">جارٍ التحميل…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={canReverse ? 9 : 8} className="p-8 text-center text-slate-400">لا قروض قائمة</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="p-2 text-center">
                    <input type="checkbox" checked={checked.has(r.subscriberId)} onChange={() => toggle(r.subscriberId)} className="h-4 w-4" />
                  </td>
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
