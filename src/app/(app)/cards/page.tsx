"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import DateRangeFilter from "@/components/DateRangeFilter";
import { formatDateTime } from "@/lib/format";

type Stat = { packageId: number; name: string | null; price: number | null; cardCost: number | null; available: number; amount: number };
type UsedCard = { id: number; serial: string | null; packageName: string | null; subscriber: string | null; office: string | null; useDate: string | null; userName: string | null };
type AvailCard = { id: number; serial: string | null; packageId: number | null; packageName: string | null; price: number | null; addDate: string | null };

const fmt = (n: number | null) => (n == null ? "—" : Number(n).toLocaleString("en-US"));
const fmtDT = (d: string | null) => formatDateTime(d);

export default function CardsPage() {
  const [stats, setStats] = useState<Stat[]>([]);
  const [used, setUsed] = useState<UsedCard[]>([]);
  const [avail, setAvail] = useState<AvailCard[]>([]);
  const [canDelete, setCanDelete] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [availFilter, setAvailFilter] = useState<number | "">("");
  const [canEditPrice, setCanEditPrice] = useState(false); // تصحيح سعر الكارت للمدير حصراً
  const [fixTarget, setFixTarget] = useState<{ packageId: number; oldPrice: number; count: number } | null>(null);
  const [fixNewPrice, setFixNewPrice] = useState("");
  const [fixBusy, setFixBusy] = useState(false);
  // ===== بحث الكروت المستخدمة (طلب محمد 2026-08-05) =====
  // البحث في الخادم لا في المعروض: فيطال كل الكروت لا آخر ألف فقط.
  const [uq, setUq] = useState("");        // سيريال أو اسم مشترك أو ساحب الكارت
  const [uFrom, setUFrom] = useState("");  // من تاريخ الاستخدام
  const [uTo, setUTo] = useState("");      // إلى تاريخ الاستخدام
  const [uMatched, setUMatched] = useState(0);
  const [uDateOn, setUDateOn] = useState(false); // مطفأ = كل التواريخ
  const [uLoading, setULoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [view, setView] = useState<"stock" | "available" | "used">("stock");
  const [packageId, setPackageId] = useState<number | "">("");
  const [text, setText] = useState("");
  const [costMap, setCostMap] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  const load = useCallback(() => {
    fetch("/api/recharge-cards/stats").then((r) => {
      if (r.ok) r.json().then(setStats);
    });
  }, []);
  useEffect(() => { load(); }, [load]);
  const loadAvail = useCallback(() => {
    fetch("/api/recharge-cards/available").then((r) => void (r.ok && r.json().then((d) => {
      setAvail(d.cards ?? []);
      setCanDelete(!!d.canDelete);
      setSelected(new Set());
    })));
  }, []);
  const loadUsed = useCallback((q = "", from = "", to = "") => {
    const qs = new URLSearchParams();
    if (q.trim()) qs.set("q", q.trim());
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    setULoading(true);
    fetch(`/api/recharge-cards/used${qs.toString() ? `?${qs}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) { setUsed(d.cards ?? d ?? []); setUMatched(d.matched ?? (d.cards ?? d ?? []).length); }
        setULoading(false);
      })
      .catch(() => setULoading(false));
  }, []);
  useEffect(() => {
    // تأجيلٌ بدورة واحدة: نداء يضبط الحالة داخل التأثير مباشرةً يُشعل إعادة تصيير متتالية
    if (view === "used") { const t = setTimeout(() => loadUsed(uq, uDateOn ? uFrom : "", uDateOn ? uTo : ""), 0); return () => clearTimeout(t); }
    if (view === "available") loadAvail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, loadAvail, loadUsed]);

  // ═════ أ-١٨ · البحثُ مربوطٌ بالحالة لا بالحدث ═════
  // هذه الصفحةُ **لم يُبلَّغ عنها** وفيها العلّةُ نفسُها: التأثيرُ أعلاه يعتمد على `view`
  // ولا على نصِّ البحث، فالكتابةُ لا تجلب — والجلبُ معلَّقٌ بـEnter وبالزرِّ وحدَهما.
  // فمَن بحث عن سيريالٍ بلا نتائجَ ثمّ مسح الحقلَ بقيت قائمتُه فارغةً، وزرُّ «مسح»
  // شرطُه وجودُ نصٍّ فيختفي لحظةَ الحاجة إليه. (وأوّلُ تركيبٍ يُستثنى: التأثيرُ أعلاه
  // جلبَ سلفاً عند فتح التبويب.)
  const firstUq = useRef(true);
  useEffect(() => {
    if (firstUq.current) { firstUq.current = false; return; }
    if (view !== "used") return;
    const t = setTimeout(() => loadUsed(uq, uDateOn ? uFrom : "", uDateOn ? uTo : ""), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uq]);

  const availShown = availFilter ? avail.filter((c) => c.packageId === availFilter) : avail;
  // تفصيل مبالغ الفئة المختارة حسب سعر الكارت (السعر مثبَّت لحظة الإضافة لكل كارت)
  const breakdown = availFilter
    ? Object.entries(availShown.reduce<Record<number, number>>((acc, c) => { const p = c.price ?? 0; acc[p] = (acc[p] ?? 0) + 1; return acc; }, {}))
        .map(([price, count]) => ({ price: Number(price), count }))
        .sort((a, b) => b.price - a.price)
    : [];
  const breakdownTotal = breakdown.reduce((sum, g) => sum + g.price * g.count, 0);
  async function submitFixPrice() {
    if (!fixTarget || fixBusy) return;
    const np = Number(fixNewPrice);
    if (!Number.isFinite(np) || np < 0) { setError("أدخل سعراً صحيحاً"); return; }
    setFixBusy(true); setError("");
    try {
      const res = await fetch("/api/recharge-cards/fix-price", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packageId: fixTarget.packageId, oldPrice: fixTarget.oldPrice, newPrice: np }) });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "فشل التصحيح"); return; }
      setFixTarget(null); loadAvail(); load();
    } catch { setError("تعذّر الاتصال بالخادم"); }
    finally { setFixBusy(false); }
  }
  function toggle(id: number) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleAll() {
    setSelected((s) => s.size === availShown.length ? new Set() : new Set(availShown.map((c) => c.id)));
  }
  async function deleteSelected() {
    if (selected.size === 0) return;
    // المبلغ الذي سينقص من «ديون الكارتات» — الأسعار متاحة في القائمة أصلاً (بلا طلب إضافي)
    const selDebt = avail.filter((c) => selected.has(c.id)).reduce((sum, c) => sum + (c.price ?? 0), 0);
    if (!confirm(
      `حذف ${selected.size} كارت نهائياً من المخزن؟

` +
      `⚠️ سيُنقص هذا ${fmt(selDebt)} د.ع من «ديون الكارتات».
` +
      `الحذف نهائي ولا يمكن التراجع عنه.`
    )) return;
    setDeleting(true);
    try {
      const send = (ownerPassword?: string) => fetch("/api/recharge-cards/bulk-delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], ...(ownerPassword ? { ownerPassword } : {}) }),
      });
      let res = await send();
      let d = await res.json();
      // 🛡️ و-٤ · بوّابةُ الدفعة الكبيرة: فوقَ خمسينَ كارتاً تُطلَب كلمةُ مرور المالك
      //   وتُعاد المحاولةُ مرّةً واحدة. ولا تُخزَّن الكلمةُ ولا تُرسَل إلّا في هذا النداء.
      if (!res.ok && d?.needOwnerPassword) {
        const pass = window.prompt(`${d.error}\n\nكلمةُ مرور المالك:`);
        if (!pass) { setError("أُلغي الحذف — لم تُدخَل كلمةُ مرور المالك"); return; }
        res = await send(pass);
        d = await res.json();
      }
      if (!res.ok) { setError(d.error ?? "فشل الحذف"); return; }
      loadAvail(); load();
    } catch { setError("تعذّر الاتصال بالخادم"); }
    finally { setDeleting(false); }
  }
  useEffect(() => {
    fetch("/api/card-price").then((r) => void (r.ok && r.json().then((d) => {
      const m: Record<number, number> = {};
      for (const p of (d.packages ?? [])) m[p.id] = p.cardCost ?? 0;
      setCostMap(m);
      setCanEditPrice(!!d.canEdit);
    })));
  }, []);
  const cardPrice = packageId ? (costMap[packageId] ?? 0) : 0;

  const serials = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  async function add() {
    setError("");
    setResult("");
    if (!packageId) { setError("اختر الفئة"); return; }
    if (serials.length === 0) { setError("الصق سيريلات الكروت (سطر لكل كارت)"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/recharge-cards/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId, serials }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "فشل"); return; }
      setResult(`تمت إضافة ${data.added} كارت${data.duplicates ? ` (تخطّي ${data.duplicates} مكرّر)` : ""}`);
      setText("");
      load();
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally { setSaving(false); }
  }

  return (
    <div className="p-6">
      <PageHeader title="كروت التفعيل" subtitle="مخزون سيريلات الكروت حسب الفئة" />

      <div className="mb-4 flex gap-2">
        <button onClick={() => setView("stock")} className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${view === "stock" ? "bg-mynet-blue text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>المتاح والإضافة</button>
        <button onClick={() => setView("available")} className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${view === "available" ? "bg-mynet-blue text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>الكروت المتاحة</button>
        <button onClick={() => setView("used")} className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${view === "used" ? "bg-mynet-blue text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>الكروت المستخدمة</button>
      </div>

      {view === "available" ? (
        <div>
          <div data-app-bar className="mb-3 flex flex-wrap items-center gap-2">
            <select value={availFilter} onChange={(e) => setAvailFilter(Number(e.target.value) || "")} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
              <option value="">كل الفئات ({avail.length})</option>
              {stats.map((s) => <option key={s.packageId} value={s.packageId}>{s.name}</option>)}
            </select>
            <span className="text-sm text-slate-500">معروض: {availShown.length} كارت متاح</span>
            {canDelete && (
              <button onClick={deleteSelected} disabled={deleting || selected.size === 0} className="mr-auto rounded-lg bg-red-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40">
                {deleting ? "جاري الحذف..." : `🗑 حذف المحدّد (${selected.size})`}
              </button>
            )}
          </div>
          {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
          {availFilter && breakdown.length > 0 && (
            <div className="mb-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h4 className="mb-2 font-bold text-slate-800">تفصيل مبالغ الفئة حسب سعر الكارت</h4>
              <div className="space-y-1.5">
                {breakdown.map((g) => (
                  <div key={g.price} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-slate-700"><b>{g.count}</b> كارت × <b>{fmt(g.price)}</b> د.ع = <b className="text-emerald-700">{fmt(g.count * g.price)}</b> د.ع</span>
                    {canEditPrice && <button onClick={() => { setFixTarget({ packageId: availFilter as number, oldPrice: g.price, count: g.count }); setFixNewPrice(String(g.price)); setError(""); }} className="rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 hover:bg-amber-100">✏️ تصحيح السعر</button>}
                  </div>
                ))}
              </div>
              <div className="mt-2 border-t border-slate-100 pt-2 text-base font-extrabold text-emerald-700">المجموع: {fmt(breakdownTotal)} د.ع</div>
            </div>
          )}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  {canDelete && <th className="p-3 w-10"><input type="checkbox" checked={availShown.length > 0 && selected.size === availShown.length} onChange={toggleAll} /></th>}
                  <th className="p-3">#</th><th className="p-3">السيريال</th><th className="p-3">الفئة</th><th className="p-3">سعر الكارت</th><th className="p-3">تاريخ الإضافة</th>
                </tr>
              </thead>
              <tbody>
                {availShown.length === 0 ? (
                  <tr><td colSpan={canDelete ? 6 : 5} className="p-8 text-center text-slate-400">لا توجد كروت متاحة</td></tr>
                ) : availShown.map((c) => (
                  <tr key={c.id} className={`border-t border-slate-100 ${selected.has(c.id) ? "bg-red-50" : ""}`}>
                    {canDelete && <td className="p-3"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>}
                    <td className="p-3">{c.id}</td>
                    <td className="p-3 font-bold" dir="ltr">{c.serial}</td>
                    <td className="p-3">{c.packageName ?? "—"}</td>
                    <td className="p-3">{fmt(c.price)} د.ع</td>
                    <td className="p-3" dir="ltr">{fmtDT(c.addDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!canDelete && <div className="mt-2 text-xs text-slate-400">حذف الكروت متاح للمدير أو من يملك صلاحية «حذف كروت التفعيل من المخزن».</div>}
        </div>
      ) : view === "used" ? (
        <>
        {/* بحث: سيريال أو اسم مشترك + مدى تاريخ الاستخدام */}
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-600">بحث</label>
            <input
              value={uq}
              onChange={(e) => setUq(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") loadUsed(uq, uDateOn ? uFrom : "", uDateOn ? uTo : ""); }}
              placeholder="🔍 سيريال الكارت، أو اسم المشترك، أو من سحبه…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue"
            />
          </div>
          <DateRangeFilter
            on={uDateOn} setOn={setUDateOn} from={uFrom} setFrom={setUFrom} to={uTo} setTo={setUTo}
            onChange={(onNow, f, t) => loadUsed(uq, onNow ? f : "", onNow ? t : "")}
          />
          <button onClick={() => loadUsed(uq, uDateOn ? uFrom : "", uDateOn ? uTo : "")} disabled={uLoading}
            className="rounded-lg bg-mynet-blue px-4 py-2 text-sm font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-60">
            {uLoading ? "…" : "🔍 بحث"}
          </button>
          {(uq || uDateOn) && (
            <button onClick={() => { setUq(""); setUFrom(""); setUTo(""); setUDateOn(false); loadUsed("", "", ""); }}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-600 hover:bg-slate-200">إظهار الكل</button>
          )}
          <span className="mr-auto self-center text-xs font-semibold text-slate-500">
            معروض {used.length} من أصل {uMatched}{uMatched > used.length ? " — ضيّق البحث لرؤية الباقي" : ""}
          </span>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr><th className="p-3">#</th><th className="p-3">السيريال</th><th className="p-3">الفئة</th><th className="p-3">المشترك</th><th className="p-3">المكتب</th><th className="p-3">التاريخ والساعة</th><th className="p-3">بواسطة</th></tr>
            </thead>
            <tbody>
              {used.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-slate-400">{uq || uDateOn ? "لا كارت يطابق بحثك" : "لا توجد كروت مستخدمة"}</td></tr>
              ) : used.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-3">{c.id}</td>
                  <td className="p-3 font-bold" dir="ltr">{c.serial}</td>
                  <td className="p-3">{c.packageName ?? "—"}</td>
                  <td className="p-3 font-medium">{c.subscriber ?? "—"}</td>
                  <td className="p-3 text-mynet-blue">{c.office ?? "—"}</td>
                  <td className="p-3" dir="ltr">{fmtDT(c.useDate)}</td>
                  <td className="p-3 text-slate-500">{c.userName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      ) : (
      <>
      {/* المتاح لكل فئة */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.length === 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 sm:col-span-3">
            لا توجد فئات بعد. أنشئ الفئات (50/100/150 ميكا) وأسعارها من صفحة <b>الباقات</b> (الشريط العلوي)، ثم عُد لإضافة الكروت.
          </div>
        ) : (
          stats.map((s) => (
            <div key={s.packageId}
              onClick={() => { setAvailFilter(s.packageId); setView("available"); }}
              title="اضغط لعرض كروت هذه الفئة"
              className="cursor-pointer rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-mynet-blue hover:shadow-md">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800">{s.name}</span>
                <span className="text-sm text-slate-500">سعر الكارت {fmt(s.cardCost)} د.ع</span>
              </div>
              <div className="mt-2 text-3xl font-extrabold text-mynet-blue">{s.available}</div>
              <div className="text-xs text-slate-400">كارت متاح — اضغط لعرضها ↗</div>
              <div className="mt-2 border-t border-slate-100 pt-2 text-sm font-bold text-emerald-700">المبلغ: {fmt(s.amount)} د.ع</div>
            </div>
          ))
        )}
      </div>

      {/* المجموع الكلي لمبالغ الكروت المتاحة (بالأسعار الفعليّة المخزَّنة لكل كارت) */}
      {stats.length > 0 && (
        <div className="mb-6 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <span className="font-bold text-emerald-800">💰 المجموع الكلي لمبالغ الكروت المتاحة</span>
          <span className="text-2xl font-extrabold text-emerald-700">{fmt(stats.reduce((sum, s) => sum + (s.amount ?? 0), 0))} د.ع</span>
        </div>
      )}

      {/* لصق كروت جديدة */}
      <div className="max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 font-bold text-slate-800">إضافة كروت (لصق)</h3>
        <label className="mb-1 block text-sm font-medium text-slate-700">الفئة</label>
        <select value={packageId} onChange={(e) => setPackageId(Number(e.target.value) || "")} className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2">
          <option value="">— اختر الفئة —</option>
          {stats.map((s) => <option key={s.packageId} value={s.packageId}>{s.name} ({fmt(s.price)} د.ع)</option>)}
        </select>

        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          {packageId ? <>سعر كارت هذه الفئة المثبّت: <b>{fmt(cardPrice)} د.ع</b></> : "اختر الفئة لعرض سعر كارتها"}
          {packageId ? (
            <div className="mt-0.5 text-xs text-slate-500">
              يُطبَّق تلقائياً على الكروت المُضافة (المجموع {fmt(cardPrice * serials.length)} د.ع يُضاف لديون الكارتات).
              يُحدَّد سعر كل فئة من <b>حسابات المدير</b> بصلاحية «تحديد سعر الكارت».
            </div>
          ) : null}
        </div>

        <label className="mb-1 block text-sm font-medium text-slate-700">
          سيريلات الكروت — سطر لكل كارت
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          dir="ltr"
          placeholder={"12345\n54321\n23456"}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-mynet-blue"
        />
        <div className="mt-1 text-xs text-slate-500">عدد الكروت: {serials.length}</div>

        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        {result && <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">✓ {result}</div>}

        <button onClick={add} disabled={saving} className="mt-4 w-full rounded-lg bg-mynet-blue py-2.5 font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-60">
          {saving ? "جاري الإضافة..." : `إضافة ${serials.length} كارت`}
        </button>
      </div>
      </>
      )}

      {/* تصحيح سعر مجموعة كروت (للمدير) — لتصحيح سعرٍ أُدخِل خطأً قبل الإضافة */}
      {fixTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => setFixTarget(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-lg font-bold text-slate-800">تصحيح سعر الكارت</h3>
            <p className="mb-3 text-sm text-slate-500">{fixTarget.count} كارت بسعر {fmt(fixTarget.oldPrice)} د.ع — سيُصحَّح سعرها (يؤثّر في ديون الكارتات).</p>
            <label className="mb-1 block text-sm font-medium text-slate-700">السعر الصحيح لكل كارت</label>
            <input type="number" value={fixNewPrice} onChange={(e) => setFixNewPrice(e.target.value)} dir="ltr" className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue" />
            {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
            <div className="flex gap-2">
              <button onClick={() => void submitFixPrice()} disabled={fixBusy} className="flex-1 rounded-lg bg-mynet-blue py-2.5 font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-60">{fixBusy ? "جارٍ..." : "حفظ التصحيح"}</button>
              <button onClick={() => setFixTarget(null)} className="rounded-lg bg-slate-100 px-4 py-2.5 text-slate-600 hover:bg-slate-200">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
