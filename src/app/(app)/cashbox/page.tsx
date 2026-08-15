"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import PageHeader from "@/components/PageHeader";
import MoneyTxModal from "@/components/MoneyTxModal";
import DateRangeFilter from "@/components/DateRangeFilter";
import { formatDateTime } from "@/lib/format";
import { usePermission } from "@/lib/usePermission";
import { askVoidEffect } from "@/lib/voidPrompt";

// مفاتيح الترتيب المتاحة في جدول الحركات
type SortKey = "id" | "date" | "moneyIn" | "moneyOut" | "accountName" | "notes";

type Tx = {
  id: number;
  moneyIn: number | null;
  moneyOut: number | null;
  accountName: string | null;
  notes: string | null;
  date: string | null;
  sourceType: string | null;
  towerId: number | null;
  settledAt?: string | null;   // قيدُ مكتبٍ وُسِم مسدَّداً
  settledTxId?: number | null;
};
// مكتب تسديد (حساب عليه علامة «مكتب تفعيل») وما عليه من قيود غير مسدَّدة
type SettleOffice = { id: number; name: string | null; towerId: number | null; office: string | null; owed: number; count: number };
type SettleRow = { id: number; date: string | null; moneyIn: number | null; moneyOut: number | null; notes: string | null; settledAt: string | null; sourceType: string | null };
type Account = { id: number; name: string | null; towerId: number | null };
type Tower = { id: number; name: string | null };

const fmt = (n: number | null | undefined) =>
  n == null ? "0" : Number(n).toLocaleString("en-US");
const fmtDate = (d: string | null) => formatDateTime(d); // بالتاريخ والساعة والدقيقة (طلب محمد)

// أسماء أنواع الحركات كما يراها المستخدم — الصفحة صارت سجل الحركات الشامل
const SRC_LABEL: Record<string, string> = {
  manual: "يدوي", master: "🅜 ماستر", "master-invoice": "🅜 فاتورة ماستر", "master-debt": "🅜 تسديد دين ماستر",
  activation: "تفعيل", invoice: "فاتورة", sale: "بيع مخزن", debt: "تسديد دين", salary: "راتب",
  "office-settle": "تسديد مكتب",
};
const srcLabel = (s: string | null) => (s == null ? "يدوي" : SRC_LABEL[s] ?? s);
const SRC_CLASS: Record<string, string> = {
  master: "bg-indigo-50 text-indigo-700", "master-invoice": "bg-indigo-50 text-indigo-700", "master-debt": "bg-indigo-50 text-indigo-700",
  activation: "bg-emerald-50 text-emerald-700", invoice: "bg-sky-50 text-sky-700",
  sale: "bg-amber-50 text-amber-700", debt: "bg-rose-50 text-rose-700", salary: "bg-violet-50 text-violet-700",
  "office-settle": "bg-teal-50 text-teal-700",
};

export default function CashboxPage() {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [listState, setListState] = useState<"loading" | "ok" | "error">("loading");
  const [summary, setSummary] = useState({ totalIn: 0, totalOut: 0, balance: 0 });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [towers, setTowers] = useState<Tower[]>([]);

  const [type, setType] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState<number | "">("");
  // الماستر صفة للحركة لا بديل عن الحساب: يمكن اختيار حساب (مدير/فني) ووسمها ماستر معاً
  const [isMaster, setIsMaster] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const { can } = usePermission();

  // بحث بالتاريخ (من – إلى) وبحث حر (كلمة/اسم حساب/مبلغ/رقم) وترتيب الأعمدة
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [detailId, setDetailId] = useState<number | null>(null); // حركة مفتوحة التفاصيل
  // فلتر نوع الحركة — الافتراضي «الكل»: الصفحة صارت سجل كل الحركات لا اليدوي فقط
  const [typeFilter, setTypeFilter] = useState("entered");
  const [matched, setMatched] = useState(0); // إجمالي المطابق (قد يفوق المعروض)
  // فلتر مكتب واحد يصل من رابط بطاقة الشاشة الرئيسية (?office=)
  const [officeId, setOfficeId] = useState<number | "">("");
  // فلتر حساب واحد (نثرية مثلاً) — يسار البحث الحرّ، فالبحث كان يبتلع الشريط كلّه
  const [accFilter, setAccFilter] = useState<number | "">("");
  // مفتاح المدى: مطفأ = كل التواريخ (يُشعَل تلقائياً إن وصل الرابط بتاريخ من بطاقة الرئيسية)
  const [dateOn, setDateOn] = useState(false);
  // ===== مكاتب التسديد: ما عليها، وتسديده كلّه أو بعضه =====
  const [settleOffices, setSettleOffices] = useState<SettleOffice[]>([]);
  const [openOffice, setOpenOffice] = useState<number | null>(null); // المكتب المفتوحة تفاصيله
  const [settleRows, setSettleRows] = useState<SettleRow[]>([]);
  const [settleSel, setSettleSel] = useState<Set<number>>(new Set());
  const [showSettled, setShowSettled] = useState(false); // إظهار المسدَّدة (لإرجاعها)
  const [settleBusy, setSettleBusy] = useState(false);
  const [settleMsg, setSettleMsg] = useState("");

  const loadSettle = useCallback(() => {
    fetch("/api/money/settlements").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) setSettleOffices(d.offices ?? []);
    }).catch(() => {});
  }, []);
  const loadSettleRows = useCallback((accId: number, withSettled: boolean) => {
    fetch("/api/money/settlements?accountId=" + accId + (withSettled ? "&settled=1" : ""))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setSettleRows(d.rows ?? []); setSettleSel(new Set()); } })
      .catch(() => {});
  }, []);

  // أ-١٨ · حارسُ السباق: الجلبُ صار يُطلَق مع كلّ حرفٍ (مُهدَّأً)، فردُّ طلبٍ قديمٍ
  // قد يصل **بعد** الجديد فيدهسه — فتُعرَض نتيجةُ بحثٍ سابقٍ فوق نصٍّ آخر. الإلغاءُ
  // يُنهي القديمَ قبل إطلاق الجديد، فآخرُ ما يُعرَض هو آخرُ ما طُلب دائماً.
  const inflight = useRef<AbortController | null>(null);

  const load = useCallback((f = "", t = "", search = "", kind = "entered", office: number | "" = "", acc: number | "" = "") => {
    const qs = new URLSearchParams();
    if (kind) qs.set("type", kind);
    if (office !== "") qs.set("officeId", String(office));
    if (acc !== "") qs.set("accountId", String(acc));
    if (f) qs.set("from", f);
    if (t) qs.set("to", t);
    if (search.trim()) qs.set("q", search.trim());
    setListState("loading");
    inflight.current?.abort();
    const ac = new AbortController();
    inflight.current = ac;
    fetch(`/api/money${qs.toString() ? `?${qs}` : ""}`, { signal: ac.signal }).then((r) => {
      if (r.ok)
        r.json().then((d) => {
          setTxs(d.transactions);
          setSummary(d.summary);
          setMatched(d.matched ?? d.transactions.length);
          setListState("ok");
        });
      else setListState("error"); // فشل الجلب لا يُعرض قائمة فارغة موهِمة بالمسح
    }).catch((e: unknown) => {
      // الإلغاءُ ليس فشلاً: طلبٌ أُلغي لأنّ المستخدمَ كتب حرفاً آخر — ولو عُدَّ خطأً
      // لَظهرت «تعذّر الجلب» مع كلّ حرفٍ يُكتَب.
      if ((e as { name?: string })?.name === "AbortError") return;
      setListState("error");
    });
  }, []);

  useEffect(() => {
    // الرابط القادم من بطاقة الرئيسية يحمل اليوم والمكتب — بدونه كنت تضغط رقم
    // اليوم فتفتح صفحةً تعرض كل الأزمنة ولا تجد فيها ما يجمعه
    const sp = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    const uf = sp.get("from") ?? "";
    const ut = sp.get("to") ?? "";
    const uk = sp.get("type") ?? "entered";
    const uo = Number(sp.get("office"));
    const office: number | "" = Number.isFinite(uo) && uo > 0 ? uo : "";
    if (uf) setFrom(uf);
    if (ut) setTo(ut);
    if (uf || ut) setDateOn(true); // جئت من بطاقة تحمل تاريخاً ⇒ المدى مُفعَّل
    setTypeFilter(uk);
    setOfficeId(office);
    load(uf, ut, q, uk, office, "");
    fetch("/api/accounts").then((r) => void (r.ok && r.json().then(setAccounts)));
    loadSettle();
    fetch("/api/towers").then((r) => void (r.ok && r.json().then(setTowers)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, loadSettle]);

  // ═════ أ-١٨ · البحثُ مربوطٌ بالحالة لا بالحدث (بلاغُ محمد 2026-08-13) ═════
  // 🔴 كان الجلبُ معلَّقاً بـ`Enter` وبزرِّ البحث وحدَهما، و`onChange` يُحدّث الحالةَ
  //   **ولا يجلب**. فمَن بحث عن اسمٍ بلا نتائجَ ثمّ **مسح الحقلَ** بقيت القائمةُ فارغةً
  //   — والقائمةُ تعرض نتيجةَ بحثٍ لم يُعد قائماً.
  // 🔴 وأسوأُ منه: زرُّ «مسح» شرطُه `(from || to || q || accFilter !== "")` ⇒ لحظةَ يُفرَغ
  //   الحقلُ **يختفي الزرُّ نفسُه**، فيبقى المستخدمُ أمام قائمةٍ فارغةٍ بلا أيّ طريقٍ
  //   لإرجاعها إلّا إعادةُ تحميل الصفحة. وهو عينُ ما وصفه محمد.
  // ⇒ الجلبُ يتبع `q` بتهدئةِ ٣٥٠ مللي (نمطُ `loan-debts` القائمُ في المستودع): كلُّ
  //   حرفٍ يُضيّق، ومسحُ الحقلِ **يُرجع الكلَّ تلقائيّاً** فلا يُحتاج زرٌّ أصلاً.
  // 🔑 والاعتماديّةُ على `q` وحدَها **مقصودةٌ لا سهو**: بقيّةُ المُرشِّحات (النوع ·
  //   المكتب · الحساب · المدى) تُطلق `load` بنفسها في مُعالِج تغييرها، فإضافتُها هنا
  //   تُنتج جلبَين لكلّ تغييرٍ منها. وأوّلُ تركيبٍ يُستثنى لأنّ الأثرَ أعلاه جلبَ سلفاً.
  const firstSearch = useRef(true);
  useEffect(() => {
    if (firstSearch.current) { firstSearch.current = false; return; }
    const t = setTimeout(() => load(from, to, q, typeFilter, officeId, accFilter), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // تسديد: الكل إن لم يُحدَّد شيء، أو المحدَّد فقط. يُقيَّد قبضاً بتاريخ اليوم فيدخل تقريره.
  async function settle(accId: number, ids?: number[]) {
    const office = settleOffices.find((o) => o.id === accId);
    const partial = Array.isArray(ids) && ids.length > 0;
    const sum = partial
      ? settleRows.filter((r) => ids.includes(r.id)).reduce((s2, r) => s2 + (r.moneyOut ?? 0) - (r.moneyIn ?? 0), 0)
      : (office?.owed ?? 0);
    if (sum <= 0) { setSettleMsg("لا مبلغ للتسديد"); return; }
    const n = partial ? ids.length : (office?.count ?? 0);
    if (!confirm("تسديد " + sum.toLocaleString("en-US") + " د.ع من «" + (office?.name ?? "") + "»؟\n" +
      "يُقيَّد قبضاً بتاريخ اليوم فيدخل تقرير اليوم، وتُوسَم " + n + " قيداً بأنها سُدِّدت.")) return;
    setSettleBusy(true); setSettleMsg("");
    const r = await fetch("/api/money/settlements", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: accId, ...(partial ? { txIds: ids } : {}) }),
    });
    const d = await r.json().catch(() => ({}));
    setSettleBusy(false);
    if (!r.ok) { setSettleMsg(d.error ?? "تعذّر التسديد"); return; }
    setSettleMsg("✓ سُدِّد " + Number(d.total).toLocaleString("en-US") + " د.ع (" + d.settled + " قيد) — دخل تقرير اليوم");
    loadSettle();
    if (openOffice === accId) loadSettleRows(accId, showSettled);
    load(from, to, q, typeFilter, officeId, accFilter);
  }

  // إرجاع قيد مسدَّد إلى الدين (ينقص حركة التسديد بمقداره فلا يبقى مالٌ مقبوضٌ بلا مقابل)
  async function unsettle(ids: number[]) {
    if (!ids.length) return;
    if (!confirm("إرجاع " + ids.length + " قيد إلى الدين؟\nستنقص حركة التسديد بمقدارها من تقرير يومها.")) return;
    setSettleBusy(true); setSettleMsg("");
    const r = await fetch("/api/money/settlements", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unsettle: true, txIds: ids }),
    });
    const d = await r.json().catch(() => ({}));
    setSettleBusy(false);
    if (!r.ok) { setSettleMsg(d.error ?? "تعذّر الإرجاع"); return; }
    setSettleMsg("✓ أُرجع " + d.reverted + " قيد إلى الدين");
    loadSettle();
    if (openOffice != null) loadSettleRows(openOffice, showSettled);
    load(from, to, q, typeFilter, officeId, accFilter);
  }

  // اسم المكتب لعرضه بجانب اسم الحساب (لتمييز الحسابات المتكرّرة مثل «نثرية»)
  const towerName = (id: number | null) => towers.find((t) => t.id === id)?.name ?? null;

  // النقر على اسم الحقل: تصاعدي ثم تنازلي عند التكرار
  function sortBy(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }
  const sortedTxs = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: Tx, b: Tx): number => {
      if (sortKey === "date") return dir * (( a.date ? new Date(a.date).getTime() : 0) - (b.date ? new Date(b.date).getTime() : 0));
      if (sortKey === "accountName" || sortKey === "notes")
        return dir * (a[sortKey] ?? "").toString().localeCompare((b[sortKey] ?? "").toString(), "ar");
      return dir * (Number(a[sortKey] ?? 0) - Number(b[sortKey] ?? 0));
    };
    return [...txs].sort(cmp);
  }, [txs, sortKey, sortDir]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!amount || Number(amount) <= 0) {
      setError("أدخل مبلغاً صحيحاً");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/money", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          amount: Number(amount),
          accountId: accountId || null,
          notes,
          ...(isMaster ? { master: true } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "فشل الحفظ");
        return;
      }
      setOkMsg(isMaster ? "✓ سُجّلت حركة الماستر — تظهر في سطر الماستر بتقرير اليوم" : "✓ سُجّلت الحركة");
      setTimeout(() => setOkMsg(""), 3500);
      setAmount("");
      setNotes("");
      load(from, to, q, typeFilter, officeId, accFilter);
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setSaving(false);
    }
  }

  // حذف حركة مالية — يسأل: هل يؤثر على المبالغ والتقرير (إرجاع عكسي) أم حذف فقط؟
  // ═════ أ-٥ · الموضع ٣: تحويلُ وصلٍ قائمٍ بين الماستر والنقديّ (طلبُ محمد) ═════
  // «أيّ وصلٍ يُحوَّل من ماستر إلى نقديّ، أو من نقديّ إلى ماستر.»
  // 🔑 وهو **تبديلُ نوعٍ لا حركةٌ جديدة**: المجموعُ الكلّيُّ لا يتغيّر، ويتغيّر توزيعُه
  //    بين دفترِ الماستر ودفترِ الصندوق. والتأكيدُ يُظهر الاتّجاهَ صريحاً قبل التنفيذ.
  async function convertKind(t: Tx) {
    const isM = String(t.sourceType ?? "").startsWith("master");
    const dir = isM ? "من الماستر إلى النقديّ (يدخل الصندوق)" : "من النقديّ إلى الماستر (يخرج من الصندوق)";
    if (!window.confirm(`تحويلُ هذا الوصل ${dir}؟

المبلغُ لا يتغيّر — يتغيّر الدفترُ الذي يُحسَب فيه.`)) return;
    const res = await fetch(`/api/money/${t.id}/convert`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { alert(j.error ?? "تعذّر التحويل"); return; }
    setOkMsg(String(j.message ?? "تمّ التحويل").split("**").join(""));
    load(from, to, q, typeFilter, officeId, accFilter);
  }

  async function voidTx(t: Tx) {
    const label = t.sourceType === "debt" ? "تسديد الدين" : "الحركة المالية";
    const choice = await askVoidEffect(label, "money"); // ب-٥-أ · قيدُ صندوق: المبلغُ يخرج في الحالتَين
    if (!choice) return;
    const res = await fetch(`/api/money/${t.id}/void`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reverse: choice.reverse }) });
    if (res.ok) load(from, to, q, typeFilter, officeId, accFilter);
    else {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "تعذّر الحذف");
    }
  }

  return (
    <div className="p-6">
      <PageHeader title="المصروفات والمقبوضات" subtitle="الصرف والقبض المُسجَّل هنا على أي حساب — نقدي أو ماستر. التفعيلات والمبيعات مكانها «سجل الوصولات»، ويمكنك استعراضها من فلتر النوع عند الحاجة" />

      {/* بطاقات الرصيد */}
      {/* البطاقات تعكس **الفلتر المعروض** لا اليدوي وحده — والرصيد كان يُحسب في الخادم ولا يُعرض */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="إجمالي القبض (حسب الفلتر)" value={fmt(summary.totalIn)} color="text-emerald-600" bg="bg-emerald-50" />
        <StatCard label="إجمالي الصرف (حسب الفلتر)" value={fmt(summary.totalOut)} color="text-red-600" bg="bg-red-50" />
        <StatCard label="الرصيد (قبض − صرف)" value={fmt(summary.balance)} color={summary.balance < 0 ? "text-red-600" : "text-sky-700"} bg="bg-sky-50" />
      </div>

      {officeId !== "" && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800 ring-1 ring-sky-200">
          <span>
            معروض مكتب واحد: <b>{towers.find((t) => t.id === officeId)?.name ?? officeId}</b>
            {from ? <> — يوم <b dir="ltr">{from}</b></> : null}
          </span>
          <button onClick={() => { setOfficeId(""); setFrom(""); setTo(""); load("", "", q, typeFilter, ""); }}
            className="rounded-lg bg-white px-3 py-1 text-xs font-bold text-sky-700 ring-1 ring-sky-300 hover:bg-sky-100">أظهر الكل</button>
        </div>
      )}

      {/* ===== مكاتب التسديد: ما عليها من دين (طلب محمد 2026-08-05) =====
          ما يُحسم على «مكتب تفعيل» يبقى ديناً عليه يسدّده أسبوعياً أو شهرياً — ولم يكن في
          البرنامج مكانٌ يجمعه ولا زرٌّ يسدّده، فكان يُدار على ورقة خارج النظام. */}
      {settleOffices.length > 0 && (
        <div className="mb-6 rounded-xl border border-teal-200 bg-teal-50/60 p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="font-bold text-teal-900">🏪 مكاتب التسديد — ما عليها</div>
            <div className="text-xs font-semibold text-teal-700">المجموع: {fmt(settleOffices.reduce((s2, o) => s2 + o.owed, 0))} د.ع</div>
          </div>
          {settleMsg && (
            <div className={"mb-2 rounded-lg px-3 py-2 text-xs font-semibold " + (settleMsg.startsWith("✓") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600")}>{settleMsg}</div>
          )}
          <div className="space-y-2">
            {settleOffices.map((o) => (
              <div key={o.id} className="rounded-lg border border-teal-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-800">{o.name ?? ("حساب " + o.id)}</div>
                    <div className="text-[11px] text-slate-500">{o.office ?? "—"} · {o.count} قيد غير مسدَّد</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={"text-lg font-extrabold " + (o.owed > 0 ? "text-rose-600" : "text-emerald-600")} dir="ltr">{fmt(o.owed)}</div>
                    {can("finance.manage") && o.owed > 0 && (
                      <button onClick={() => settle(o.id, undefined)} disabled={settleBusy}
                        className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-60">تسديد</button>
                    )}
                    <button
                      onClick={() => {
                        const next = openOffice === o.id ? null : o.id;
                        setOpenOffice(next); setSettleMsg("");
                        if (next != null) loadSettleRows(next, showSettled);
                      }}
                      className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200"
                      title="عرض القيود واختيار بعضها"
                    >{openOffice === o.id ? "−" : "+"}</button>
                  </div>
                </div>

                {openOffice === o.id && (
                  <div className="border-t border-teal-100 px-3 py-2">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                      <label className="flex cursor-pointer items-center gap-1 text-slate-600">
                        <input type="checkbox" checked={showSettled} onChange={(e) => { setShowSettled(e.target.checked); loadSettleRows(o.id, e.target.checked); }} className="h-3.5 w-3.5 accent-teal-600" />
                        إظهار المسدَّدة (لإرجاعها)
                      </label>
                      <span className="text-slate-400">·</span>
                      <button onClick={() => setSettleSel(new Set(settleRows.filter((r) => !r.settledAt).map((r) => r.id)))} className="font-semibold text-teal-700 hover:underline">تحديد الكل</button>
                      <button onClick={() => setSettleSel(new Set())} className="font-semibold text-slate-500 hover:underline">إلغاء التحديد</button>
                      {settleSel.size > 0 && can("finance.manage") && (
                        <button onClick={() => settle(o.id, [...settleSel])} disabled={settleBusy}
                          className="mr-auto rounded-lg bg-teal-600 px-3 py-1 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-60">
                          تسديد المحدَّد ({settleSel.size}) — {fmt(settleRows.filter((r) => settleSel.has(r.id)).reduce((s2, r) => s2 + (r.moneyOut ?? 0) - (r.moneyIn ?? 0), 0))}
                        </button>
                      )}
                    </div>
                    {settleRows.length === 0 ? (
                      <div className="py-3 text-center text-xs text-slate-400">لا قيود</div>
                    ) : (
                      <div className="max-h-64 overflow-y-auto">
                        <table className="w-full text-xs">
                          <tbody>
                            {settleRows.map((r) => (
                              <tr key={r.id} className={"border-b border-slate-100 " + (r.settledAt ? "bg-emerald-50/50" : "")}>
                                <td className="w-6 py-1">
                                  {!r.settledAt && (
                                    <input type="checkbox" checked={settleSel.has(r.id)}
                                      onChange={() => setSettleSel((prev) => { const nx = new Set(prev); if (nx.has(r.id)) nx.delete(r.id); else nx.add(r.id); return nx; })}
                                      className="h-3.5 w-3.5 accent-teal-600" />
                                  )}
                                </td>
                                <td className="py-1 text-slate-400" dir="ltr">#{r.id}</td>
                                <td className="py-1 text-slate-500">{fmtDate(r.date)}</td>
                                <td className="max-w-[260px] truncate py-1 text-slate-700" title={r.notes ?? ""}>{r.notes ?? "—"}</td>
                                <td className="py-1 text-left font-bold text-rose-600" dir="ltr">{fmt((r.moneyOut ?? 0) - (r.moneyIn ?? 0))}</td>
                                <td className="w-24 py-1 text-left">
                                  {r.settledAt ? (
                                    <span className="inline-flex items-center gap-1">
                                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-bold text-emerald-700">سُدِّدت</span>
                                      {can("finance.manage") && (
                                        <button onClick={() => unsettle([r.id])} disabled={settleBusy} className="text-[10px] font-semibold text-slate-500 hover:text-rose-600 hover:underline">إرجاع</button>
                                      )}
                                    </span>
                                  ) : null}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* بحث بالتاريخ (من – إلى) — يشمل اليومين، والإجماليات أعلاه تعكس النتيجة */}
      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <DateRangeFilter
          on={dateOn} setOn={setDateOn} from={from} setFrom={setFrom} to={to} setTo={setTo}
          onChange={(onNow, f, t) => load(onNow ? f : "", onNow ? t : "", q, typeFilter, officeId, accFilter)}
        />
        {/* اختيار حساب بعينه (نثرية مثلاً) — يسار البحث الحرّ الذي كان يبتلع الشريط */}
        <div className="w-[180px]">
          <label className="mb-1 block text-xs font-medium text-slate-600">الحساب</label>
          <select
            value={accFilter}
            onChange={(e) => { const v = e.target.value === "" ? "" : Number(e.target.value); setAccFilter(v); load(from, to, q, typeFilter, officeId, v); }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue"
          >
            <option value="">كل الحسابات</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name ?? `حساب ${a.id}`}{towerName(a.towerId) ? ` — ${towerName(a.towerId)}` : ""}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[150px] flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-600">بحث حر</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") load(from, to, q, typeFilter, officeId, accFilter); }}
            placeholder="كلمة، مبلغ، أو رقم حركة…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">النوع</label>
          <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); load(from, to, q, e.target.value, officeId); }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue">
            <option value="entered">مصروف ومقبوض (المُدخَل هنا)</option>
            <option value="all">كل الحركات المالية</option>
            <option value="manual">يدوي نقدي فقط</option>
            <option value="master">🅜 ماستر</option>
            <option value="activation">تفعيل</option>
            <option value="invoice">فاتورة</option>
            <option value="sale">بيع مخزن</option>
            <option value="debt">تسديد دين</option>
            <option value="salary">راتب</option>
            <option value="orphan">⚠️ بلا مكتب (يجب ألا يوجد شيء)</option>
          </select>
        </div>
        <button onClick={() => load(from, to, q, typeFilter, officeId, accFilter)} className="rounded-lg bg-mynet-blue px-4 py-2 text-sm font-semibold text-white hover:bg-mynet-blue-dark">🔍 بحث</button>
        {(from || to || q || accFilter !== "") && (
          <button onClick={() => { setFrom(""); setTo(""); setQ(""); setAccFilter(""); load("", "", "", typeFilter, officeId, ""); }} className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-600 hover:bg-slate-200">إظهار الكل</button>
        )}
        <span className="mr-auto self-center text-xs font-semibold text-slate-500">
          معروض {sortedTxs.length} من أصل {matched}{matched > sortedTxs.length ? " — ضيّق البحث لرؤية الباقي" : ""}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
        {/* نموذج قبض/صرف */}
        <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-bold text-slate-800">حركة جديدة</h3>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setType("in")}
              className={`rounded-lg py-2 font-semibold transition ${type === "in" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              قبض +
            </button>
            <button
              type="button"
              onClick={() => setType("out")}
              className={`rounded-lg py-2 font-semibold transition ${type === "out" ? "bg-red-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              صرف −
            </button>
          </div>

          <label className="mb-1 block text-sm font-medium text-slate-700">المبلغ (د.ع)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
          />

          <label className="mb-1 block text-sm font-medium text-slate-700">الحساب</label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(Number(e.target.value) || "")}
            className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
          >
            <option value="">— بدون حساب —</option>
            {accounts.map((a) => {
              const office = towerName(a.towerId);
              return (
                <option key={a.id} value={a.id}>{a.name}{office ? ` — ${office}` : ""}</option>
              );
            })}
          </select>
          <label className="mb-3 flex cursor-pointer items-start gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
            <input type="checkbox" checked={isMaster} onChange={(e) => setIsMaster(e.target.checked)} className="mt-0.5 h-4 w-4" />
            <span>
              <b>🅜 هذه الحركة من/إلى الماستر</b> (لا نقدي)
              <span className="block text-indigo-600">تظهر في سطر الماستر بالتقرير اليومي ولا تدخل إجمالي الصندوق — ويبقى الحساب المختار أعلاه منسوباً إليها (مدير أو فني).</span>
            </span>
          </label>

          <label className="mb-1 block text-sm font-medium text-slate-700">ملاحظات</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
          />

          {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
          {okMsg && <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{okMsg}</div>}

          <button
            type="submit"
            disabled={saving}
            className={`w-full rounded-lg py-3 font-bold text-white shadow disabled:opacity-60 ${type === "in" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}`}
          >
            {saving ? "جاري الحفظ..." : type === "in" ? "تسجيل قبض" : "تسجيل صرف"}
          </button>
        </form>

        {/* سجل الحركات */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <SortTh label="#" k="id" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
                <SortTh label="التاريخ" k="date" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
                <SortTh label="قبض" k="moneyIn" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
                <SortTh label="صرف" k="moneyOut" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
                <th className="p-3">النوع</th>
                <SortTh label="الحساب" k="accountName" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
                <th className="p-3">المكتب</th>
                <SortTh label="ملاحظات" k="notes" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
                {can("receipts.void") && <th className="p-3"></th>}
              </tr>
            </thead>
            <tbody>
              {listState === "loading" ? (
                <tr><td colSpan={9} className="p-8 text-center text-slate-400">جاري تحميل الحركات...</td></tr>
              ) : listState === "error" ? (
                <tr><td colSpan={9} className="p-8 text-center font-semibold text-red-500">تعذّر جلب الحركات — حدّث الصفحة (البيانات محفوظة بالقاعدة)</td></tr>
              ) : sortedTxs.length === 0 ? (
                <tr><td colSpan={can("receipts.void") ? 9 : 8} className="p-6 text-center text-slate-400">لا توجد حركات</td></tr>
              ) : (
                sortedTxs.map((t) => (
                  <tr key={t.id} onClick={() => setDetailId(t.id)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" title="عرض التفاصيل">
                    <td className="p-3">{t.id}</td>
                    <td className="p-3">{fmtDate(t.date)}</td>
                    <td className="p-3 font-semibold text-emerald-600">{t.moneyIn ? fmt(t.moneyIn) : "—"}</td>
                    <td className="p-3 font-semibold text-red-600">{t.moneyOut ? fmt(t.moneyOut) : "—"}</td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SRC_CLASS[t.sourceType ?? "manual"] ?? "bg-slate-100 text-slate-600"}`}>{srcLabel(t.sourceType)}</span>
                      {/* قيدٌ سدّده مكتبه — يُعرَف من الجدول نفسه بلا فتح لوحة التسديد */}
                      {t.settledAt && <span className="mr-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700" title={`سُدِّد في ${fmtDate(t.settledAt)}`}>سُدِّدت</span>}
                    </td>
                    <td className="p-3">{t.accountName ?? "—"}</td>
                    <td className="p-3">{towerName(t.towerId) ?? "—"}</td>
                    <td className="p-3 text-slate-600">{t.notes ?? "—"}</td>
                    {can("receipts.void") && (
                      <td className="p-3">
                        <div className="flex items-center gap-1.5">
                          {/* أ-٥ · الموضع ٣: تحويلُ الوصل بين الماستر والنقديّ — والمبلغُ لا يتغيّر */}
                          <button onClick={(e) => { e.stopPropagation(); void convertKind(t); }}
                            className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-mynet-blue hover:bg-blue-100"
                            title="تحويلٌ بين الماستر والنقديّ — المبلغُ لا يتغيّر، ويتغيّر الدفترُ الذي يُحسَب فيه">
                            {String(t.sourceType ?? "").startsWith("master") ? "→ نقديّ" : "→ ماستر"}
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); voidTx(t); }} className="rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100" title="حذف عكسي">🗑 حذف</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* نافذة تفاصيل الحركة المالية */}
      {detailId != null && <MoneyTxModal id={detailId} onClose={() => setDetailId(null)} onDeleted={() => load(from, to, q, typeFilter, officeId, accFilter)} />}
    </div>
  );
}

// ترويسة عمود قابلة للترتيب: تصاعدي/تنازلي مع سهم يوضّح الاتجاه الحالي
function SortTh({ label, k, sortKey, sortDir, onSort }: { label: string; k: SortKey; sortKey: SortKey; sortDir: "asc" | "desc"; onSort: (k: SortKey) => void }) {
  const active = sortKey === k;
  return (
    <th className="p-3">
      <button onClick={() => onSort(k)} className={`inline-flex items-center gap-1 select-none hover:text-mynet-blue ${active ? "font-bold text-mynet-blue" : ""}`}>
        {label}
        <span className="text-[10px]">{active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}</span>
      </button>
    </th>
  );
}

function StatCard({ label, value, color, bg, big }: { label: string; value: string; color: string; bg: string; big?: boolean }) {
  return (
    <div className={`rounded-xl border border-slate-200 ${bg} p-5 shadow-sm`}>
      <div className="text-sm text-slate-600">{label}</div>
      <div className={`${big ? "text-3xl" : "text-2xl"} font-extrabold ${color}`}>{value}</div>
      <div className="text-xs text-slate-400">د.ع</div>
    </div>
  );
}
