"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { formatDateTime } from "@/lib/format";

type Stat = { packageId: number; name: string | null; price: number | null; available: number };
type UsedCard = { id: number; serial: string | null; packageName: string | null; subscriber: string | null; useDate: string | null; userName: string | null };
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
  useEffect(() => {
    if (view === "used") fetch("/api/recharge-cards/used").then((r) => { if (r.ok) r.json().then(setUsed); });
    if (view === "available") loadAvail();
  }, [view, loadAvail]);

  const availShown = availFilter ? avail.filter((c) => c.packageId === availFilter) : avail;
  function toggle(id: number) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleAll() {
    setSelected((s) => s.size === availShown.length ? new Set() : new Set(availShown.map((c) => c.id)));
  }
  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`حذف ${selected.size} كارت نهائياً من المخزن؟ سيُخصم مبلغها من ديون الكارتات.`)) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/recharge-cards/bulk-delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      });
      const d = await res.json();
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
          <div className="mb-3 flex flex-wrap items-center gap-2">
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
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr><th className="p-3">#</th><th className="p-3">السيريال</th><th className="p-3">الفئة</th><th className="p-3">المشترك</th><th className="p-3">التاريخ والساعة</th><th className="p-3">بواسطة</th></tr>
            </thead>
            <tbody>
              {used.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-slate-400">لا توجد كروت مستخدمة</td></tr>
              ) : used.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="p-3">{c.id}</td>
                  <td className="p-3 font-bold" dir="ltr">{c.serial}</td>
                  <td className="p-3">{c.packageName ?? "—"}</td>
                  <td className="p-3 font-medium">{c.subscriber ?? "—"}</td>
                  <td className="p-3" dir="ltr">{fmtDT(c.useDate)}</td>
                  <td className="p-3 text-slate-500">{c.userName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
            <div key={s.packageId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800">{s.name}</span>
                <span className="text-sm text-slate-500">{fmt(s.price)} د.ع</span>
              </div>
              <div className="mt-2 text-3xl font-extrabold text-mynet-blue">{s.available}</div>
              <div className="text-xs text-slate-400">كارت متاح</div>
            </div>
          ))
        )}
      </div>

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
    </div>
  );
}
