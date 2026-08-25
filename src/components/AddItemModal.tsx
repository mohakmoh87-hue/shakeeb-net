"use client";

import { useEffect, useMemo, useState } from "react";

// ═════ ➕ نافذةُ إضافة مادة — اقتراحُ محمد 2026-08-25 ═════
//
// بنصّه: «لِمَ لا يكون عند إضافة مادة تظهر لائحةٌ بكلّ المواد كما يمكن البحثُ عن مادة،
//  وإذا اخترتَ مادةً تكتب سعرَها وكميّتَها وتضيفها؛ أو يمكن كتابةُ اسم مادةٍ غير موجودةٍ
//  لإضافتها كمادّةٍ جديدة وتبقى نفسُ خيارات الإضافة من سعرٍ وغيره».
//
// 🔴 والعلّةُ التي يحلّها: مسارُ الإنشاء كان بلا فحصِ تكرار، فاسمٌ موجودٌ يُكتب ثانيةً
//   ⇒ صفّان بالاسم نفسِه في المكتب نفسِه، ينقسم بينهما المخزونُ ولكلٍّ متوسّطُ شراءٍ
//   وسعرُ بيعٍ مختلف بلا تنبيهٍ لأحد. الاختيارُ من القائمة يمنعه، والخادمُ يردّ 409.
//
// 🔒 وقرارُ محمد: **النافذةُ للمدير وحدَه** (كما كان زرُّ الإضافة)، **والمكتبُ يُختار
//   فيها صراحةً** لا من فلتر الجدول — فالمخزنُ لكلّ مكتبٍ على حِدة، وإضافةٌ إلى المكتب
//   الخطأ تُفسد رقمَين معاً.

export type ItemLite = {
  id: number;
  name: string | null;
  count: number | null;
  priceDinar: number | null;
  priceSale: number | null;
  towerId: number | null;
};
type Tower = { id: number; name: string | null };

const norm = (s: string) => s.trim().toLowerCase();
const fmt = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("en-US"));

export default function AddItemModal({
  towers, defaultTowerId, onClose, onDone,
}: {
  towers: Tower[];
  defaultTowerId: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [towerId, setTowerId] = useState<string>(defaultTowerId != null ? String(defaultTowerId) : "");
  const [items, setItems] = useState<ItemLite[] | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<ItemLite | null>(null);
  const [creating, setCreating] = useState(false);

  const [qty, setQty] = useState("");
  const [buy, setBuy] = useState("");
  const [sale, setSale] = useState("");
  const [sale2, setSale2] = useState("");
  const [category, setCategory] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  // تبديلُ المكتب يُصفّر كلَّ ما يتعلّق بالمكتب السابق — **في المُعالِج لا في الأثر**،
  // فالتصفيرُ فعلُ المستخدم لا مزامنةُ حالة (وقاعدةُ `set-state-in-effect` تمنعه هناك).
  // 🔒 وأخطرُ ما يمنعه: بقاءُ مادةٍ مختارةٍ من مكتبٍ سابقٍ ⇒ إضافةٌ إلى المكتب الخطأ.
  function pickTower(v: string) {
    setTowerId(v); setItems(null); setPicked(null); setCreating(false); setErr(""); setOk("");
  }

  // موادُّ المكتب المختار — تُعاد قراءتُها عند كلّ تبديلِ مكتب (الكميّاتُ لكلّ مكتبٍ وحدَه)
  useEffect(() => {
    if (!towerId) return;
    // 🔑 حارسُ الردّ المتأخّر: تبديلٌ سريعٌ بين مكتبَين قد يُعيد ردَّ الأوّل بعد الثاني
    //    فتُعرَض كميّاتُ مكتبٍ تحت اسم آخر. الإلغاءُ يمنعها.
    let alive = true;
    fetch(`/api/items?officeId=${towerId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("تعذّر جلب المواد"))))
      .then((d: ItemLite[]) => { if (alive) setItems(d); })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : "تعذّر جلب المواد"); });
    return () => { alive = false; };
  }, [towerId]);

  const results = useMemo(() => {
    const list = items ?? [];
    const k = norm(q);
    if (!k) return list.slice(0, 40);
    return list.filter((i) => norm(i.name ?? "").includes(k)).slice(0, 40);
  }, [items, q]);

  // 🔑 «لا مطابقَ بالاسم كاملاً» لا «لا نتائجَ للبحث»: بحثٌ يعيد «كيبل ٥» لا يعني أنّ
  //    «كيبل» غيرُ موجودة — فزرُّ الإنشاء لا يظهر إلّا حين لا يوجد اسمٌ مطابقٌ تماماً.
  const exact = useMemo(
    () => (items ?? []).find((i) => norm(i.name ?? "") === norm(q)) ?? null,
    [items, q],
  );
  const canOfferNew = !!towerId && q.trim().length > 0 && !exact;

  async function addToExisting() {
    if (!picked) return;
    const add = Number(qty) || 0;
    const price = Number(buy) || 0;
    if (add <= 0) { setErr("أدخل كميةً مضافةً أكبر من صفر"); return; }
    if (price <= 0) { setErr("أدخل سعر شراء هذه الدفعة"); return; }
    setBusy(true); setErr(""); setOk("");
    // 🔑 مسارُ الزيادة القائم نفسُه — فيرث حارسَ السعر وحسابَ المتوسّط بلا سطرٍ جديد
    const r = await fetch(`/api/items/${picked.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: picked.name, count: (picked.count ?? 0) + add, batchBuyPrice: price,
        priceSale: picked.priceSale, towerId: picked.towerId,
      }),
    });
    const d = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) { setErr(d?.error ?? "تعذّرت الإضافة"); return; }
    setOk(`أُضيفت ${add} إلى «${picked.name}» بسعر ${fmt(price)} — الرصيد ${fmt((picked.count ?? 0) + add)}`);
    setQty(""); setBuy(""); setPicked(null); setQ("");
    // تحديثُ القائمة في مكانها كي يرى الرصيدَ الجديد بلا إغلاق النافذة
    setItems((prev) => (prev ?? []).map((i) => (i.id === picked.id ? { ...i, count: (i.count ?? 0) + add } : i)));
    onDone();
  }

  async function createNew() {
    const add = Number(qty) || 0;
    const price = Number(buy) || 0;
    if (!q.trim()) { setErr("اكتب اسم المادة"); return; }
    if (add > 0 && price <= 0) { setErr("أدخل سعر شراء الدفعة الافتتاحية"); return; }
    setBusy(true); setErr(""); setOk("");
    const r = await fetch("/api/items", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: q.trim(), count: add, priceDinar: price || null,
        priceSale: Number(sale) || null, priceSale2: Number(sale2) || null,
        category: category.trim() || null, towerId: Number(towerId),
      }),
    });
    const d = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) { setErr(d?.error ?? "تعذّر الإنشاء"); return; }
    setOk(`أُنشئت «${q.trim()}»${add > 0 ? ` بكمية ${fmt(add)} بسعر ${fmt(price)}` : " (بلا كمية)"}`);
    setQ(""); setQty(""); setBuy(""); setSale(""); setSale2(""); setCategory(""); setCreating(false);
    setItems((prev) => [...(prev ?? []), { id: d.id, name: d.name, count: d.count, priceDinar: d.priceDinar, priceSale: d.priceSale, towerId: d.towerId }]);
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="border-b border-slate-200 p-5 pb-3">
          <h3 className="text-lg font-bold text-slate-800">➕ إضافة مادة</h3>
          <p className="mt-1 text-sm text-slate-500">ابحث عن المادة وزِد كميّتَها بسعر شرائها — أو اكتب اسماً جديداً لإنشائها.</p>

          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-medium text-slate-500">المكتب (مخزنٌ مستقلٌّ لكلّ مكتب)</span>
            <select value={towerId} onChange={(e) => pickTower(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-mynet-blue focus:outline-none">
              <option value="">اختر المكتب…</option>
              {towers.map((t) => <option key={t.id} value={t.id}>{t.name ?? `#${t.id}`}</option>)}
            </select>
          </label>

          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-medium text-slate-500">ابحث أو اكتب اسم مادة جديدة</span>
            <input value={q} disabled={!towerId}
              onChange={(e) => { setQ(e.target.value); setPicked(null); setCreating(false); setOk(""); }}
              placeholder={towerId ? "🔍 اسم المادة…" : "اختر المكتب أولاً"}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-mynet-blue focus:outline-none disabled:bg-slate-100" />
          </label>
        </div>

        <div className="flex-1 overflow-y-auto p-5 pt-3">
          {err && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-600">{err}</p>}
          {ok && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">✓ {ok}</p>}

          {towerId && items == null && !err && <p className="py-6 text-center text-sm text-slate-400">جارٍ التحميل…</p>}

          {/* ═══ مادةٌ مختارة: كميّةٌ وسعرُ دفعة ═══ */}
          {picked && (
            <div className="mb-4 rounded-xl border-2 border-mynet-blue bg-sky-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-800">{picked.name}</div>
                  <div className="text-xs text-slate-500">الرصيد الحالي <b>{fmt(picked.count)}</b> · متوسّط الشراء <b>{fmt(picked.priceDinar)}</b></div>
                </div>
                <button onClick={() => setPicked(null)} className="rounded-lg bg-white px-2 py-1 text-xs font-semibold text-slate-600">تغيير</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">الكمية المضافة</span>
                  <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-mynet-blue focus:outline-none" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">سعر شراء الدفعة</span>
                  <input type="number" value={buy} onChange={(e) => setBuy(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-mynet-blue focus:outline-none" />
                </label>
              </div>
              <button onClick={addToExisting} disabled={busy}
                className="mt-3 w-full rounded-lg bg-mynet-blue py-2.5 font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-50">
                {busy ? "جارٍ…" : "➕ إضافة للمخزن"}
              </button>
            </div>
          )}

          {/* ═══ اسمٌ لا مطابقَ له: إنشاءُ مادةٍ جديدة بنفس خيارات الإضافة ═══ */}
          {!picked && canOfferNew && !creating && (
            <button onClick={() => setCreating(true)}
              className="mb-4 w-full rounded-xl border-2 border-dashed border-emerald-400 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700 hover:bg-emerald-100">
              ➕ أضِف «{q.trim()}» مادّةً جديدة
            </button>
          )}
          {!picked && creating && (
            <div className="mb-4 rounded-xl border-2 border-emerald-400 bg-emerald-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="font-bold text-emerald-800">مادّة جديدة: {q.trim()}</div>
                <button onClick={() => setCreating(false)} className="rounded-lg bg-white px-2 py-1 text-xs font-semibold text-slate-600">إلغاء</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">الكمية</span>
                  <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">سعر الشراء</span>
                  <input type="number" value={buy} onChange={(e) => setBuy(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">سعر البيع</span>
                  <input type="number" value={sale} onChange={(e) => setSale(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">سعر بيع خاص</span>
                  <input type="number" value={sale2} onChange={(e) => setSale2(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
                <label className="col-span-2 block"><span className="mb-1 block text-xs font-medium text-slate-500">التصنيف</span>
                  <input value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
              </div>
              <button onClick={createNew} disabled={busy}
                className="mt-3 w-full rounded-lg bg-emerald-600 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                {busy ? "جارٍ…" : "✓ إنشاء المادة"}
              </button>
            </div>
          )}

          {/* ═══ القائمة ═══ */}
          {!picked && !creating && items != null && (
            results.length === 0
              ? <p className="rounded-lg bg-slate-50 py-6 text-center text-sm text-slate-500">{q ? "لا مادّةَ بهذا الاسم" : "لا موادَّ في هذا المكتب بعد"}</p>
              : (
                <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                  {results.map((i) => (
                    <button key={i.id} onClick={() => { setPicked(i); setQty(""); setBuy(""); setErr(""); setOk(""); }}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-right hover:bg-sky-50">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700">{i.name}</span>
                      <span className="shrink-0 text-xs text-slate-500">الرصيد <b className="text-slate-700">{fmt(i.count)}</b></span>
                      <span className="shrink-0 text-xs text-slate-500">الشراء <b className="text-slate-700">{fmt(i.priceDinar)}</b></span>
                    </button>
                  ))}
                </div>
              )
          )}
        </div>

        <div className="border-t border-slate-200 p-4">
          <button onClick={onClose} className="w-full rounded-lg bg-slate-200 py-2.5 font-semibold text-slate-700 hover:bg-slate-300">إغلاق</button>
        </div>
      </div>
    </div>
  );
}
