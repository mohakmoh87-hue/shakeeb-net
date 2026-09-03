"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import { usePermission } from "@/lib/usePermission";

type Product = { id: number; title: string; price: number | null; description: string | null; category: string | null; stock: number | null; photo: string | null; status: string; agentName: string | null; createdAt: string; itemName: string | null; linked: boolean };
type WhItem = { name: string; price: number | null; category: string | null; count: number };
type PForm = { title: string; price: string; category: string; description: string; stock: string; photo: string | null; itemName: string | null };
type Fees = { deliverySub: string; installSub: string; deliveryOther: string; installOther: string };

const emptyForm = (): PForm => ({ title: "", price: "", category: "", description: "", stock: "", photo: null, itemName: null });
const fmt = (n: number | null) => (n == null ? "بلا سعر" : `${n.toLocaleString("en-US")} د.ع`);
const digits = (s: string) => { const d = s.replace(/[^\d]/g, ""); return d ? Number(d) : null; };
const num2str = (n: number | null | undefined) => (n == null ? "" : String(n));

async function fileToDataUrl(file: File): Promise<string | null> {
  const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file); });
  const img = document.createElement("img");
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("img")); img.src = dataUrl; });
  let w = img.naturalWidth, h = img.naturalHeight; const maxDim = 1200;
  if (w > maxDim || h > maxDim) { if (w >= h) { h = Math.round((h * maxDim) / w); w = maxDim; } else { w = Math.round((w * maxDim) / h); h = maxDim; } }
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d"); if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  let q = 0.82; let out = canvas.toDataURL("image/jpeg", q);
  while (out.length > 380000 && q > 0.4) { q -= 0.12; out = canvas.toDataURL("image/jpeg", q); }
  return out.length > 400000 ? null : out;
}

export default function StorePage() {
  const { can, me } = usePermission();
  const [products, setProducts] = useState<Product[]>([]);
  const [whItems, setWhItems] = useState<WhItem[]>([]);
  const [fees, setFees] = useState<Fees>({ deliverySub: "", installSub: "", deliveryOther: "", installOther: "" });
  const [feesMsg, setFeesMsg] = useState("");
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<PForm>(emptyForm());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    fetch("/api/store/products").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setProducts(d.items || []); }).catch(() => {});
    fetch("/api/store/items").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setWhItems(d.items || []); }).catch(() => {});
    fetch("/api/store/settings").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setFees({ deliverySub: num2str(d.deliverySub), installSub: num2str(d.installSub), deliveryOther: num2str(d.deliveryOther), installOther: num2str(d.installOther) }); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function saveFees() {
    setFeesMsg("");
    const r = await fetch("/api/store/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deliverySub: digits(fees.deliverySub), installSub: digits(fees.installSub), deliveryOther: digits(fees.deliveryOther), installOther: digits(fees.installOther) }) });
    setFeesMsg(r.ok ? "✓ حُفِظت الرسوم" : "فشل الحفظ");
  }

  function openAdd() { setEditId(null); setForm(emptyForm()); setErr(""); setModal(true); }
  function openEdit(p: Product) {
    setEditId(p.id);
    setForm({ title: p.title, price: p.price?.toString() ?? "", category: p.category ?? "", description: p.description ?? "", stock: p.itemName ? "" : (p.stock?.toString() ?? ""), photo: p.photo, itemName: p.itemName });
    setErr(""); setModal(true);
  }
  function pickWh(name: string) {
    if (!name) { setForm((f) => ({ ...f, itemName: null })); return; }
    const it = whItems.find((x) => x.name === name);
    setForm((f) => ({ ...f, itemName: name, title: name, price: it?.price != null ? String(it.price) : f.price, category: it?.category ?? f.category, stock: "" }));
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try { const url = await fileToDataUrl(file); if (!url) { setErr("تعذّرت الصورة — جرّب صورةً أصغر"); return; } setForm((f) => ({ ...f, photo: url })); setErr(""); }
    catch { setErr("تعذّرت قراءةُ الصورة"); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!form.title.trim()) { setErr("اسمُ المنتج مطلوب"); return; }
    setBusy(true); setErr("");
    const body = { id: editId ?? undefined, title: form.title.trim(), price: digits(form.price), category: form.category.trim(), description: form.description.trim(), stock: form.itemName ? null : digits(form.stock), photo: form.photo, itemName: form.itemName };
    const r = await fetch("/api/store/products", { method: editId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { const d = await r.json().catch(() => null); setErr(d?.error || "فشل الحفظ"); return; }
    setModal(false); load();
  }
  async function toggle(p: Product) {
    const r = await fetch("/api/store/products", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, status: p.status === "visible" ? "hidden" : "visible" }) });
    if (!r.ok) { alert("فشل تغييرُ حالة المنتج — أعد المحاولة"); return; }
    load();
  }
  async function del(p: Product) {
    if (!confirm(`حذفُ «${p.title}» نهائيّاً؟`)) return;
    const r = await fetch(`/api/store/products?id=${p.id}`, { method: "DELETE" });
    if (!r.ok) { alert("فشل حذفُ المنتج — أعد المحاولة"); return; }
    load();
  }

  if (!me) return <div className="p-6 text-slate-400">جاري التحميل...</div>;
  if (!can("store.manage")) return <div className="p-6"><PageHeader title="متجري" /><div className="rounded-lg bg-red-50 px-4 py-3 text-red-600">ليس لديك صلاحية مشاهدة متجري.</div></div>;

  const selWh = form.itemName ? whItems.find((x) => x.name === form.itemName) : null;
  const feeInput = (v: string, set: (s: string) => void, ph: string) => <input value={v} onChange={(e) => { set(e.target.value); setFeesMsg(""); }} dir="ltr" inputMode="numeric" placeholder={ph} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="متجري" subtitle="منتجاتُ متجرك في التطبيق — تصل الطلباتُ إلى «طلبات المتجر» في إدارة الفنيين" action={<button onClick={openAdd} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">+ منتج</button>} />

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-1 text-sm font-bold text-slate-800">رسوم التوصيل والتنصيب</div>
        <div className="mb-3 text-[11px] text-slate-500">ثابتةٌ لكامل الطلب (لا لكلّ مادة). اتركها فارغةً إن لا رسم. «تنصيب» فارغٌ ⇒ لا يظهر خيارُ «توصيل وتنصيب» للزبون.</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-emerald-50 p-3">
            <div className="mb-2 text-xs font-bold text-emerald-700">مشتركوك</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="mb-1 block text-[11px] text-slate-600">توصيل (د.ع)</span>{feeInput(fees.deliverySub, (s) => setFees((f) => ({ ...f, deliverySub: s })), "اختياري")}</label>
              <label className="block"><span className="mb-1 block text-[11px] text-slate-600">تنصيب (د.ع)</span>{feeInput(fees.installSub, (s) => setFees((f) => ({ ...f, installSub: s })), "اختياري")}</label>
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="mb-2 text-xs font-bold text-slate-600">غير المشتركين</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="mb-1 block text-[11px] text-slate-600">توصيل (د.ع)</span>{feeInput(fees.deliveryOther, (s) => setFees((f) => ({ ...f, deliveryOther: s })), "اختياري")}</label>
              <label className="block"><span className="mb-1 block text-[11px] text-slate-600">تنصيب (د.ع)</span>{feeInput(fees.installOther, (s) => setFees((f) => ({ ...f, installOther: s })), "اختياري")}</label>
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={() => void saveFees()} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">حفظ الرسوم</button>
          {feesMsg && <span className="text-xs text-slate-600">{feesMsg}</span>}
        </div>
      </div>

      {products.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 py-14 text-center text-sm text-slate-400">لا منتجاتٍ بعد — اضغط «+ منتج» لإضافة أوّل منتج</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => (
            <div key={p.id} className={`overflow-hidden rounded-xl border border-slate-200 bg-white ${p.status === "hidden" ? "opacity-60" : ""}`}>
              <div className="grid h-28 w-full place-items-center bg-slate-100">
                {p.photo ? <img src={p.photo} alt="" className="h-full w-full object-cover" /> : <span className="text-3xl text-slate-300">🏬</span>}
              </div>
              <div className="p-2.5">
                <div className="truncate text-sm font-bold text-slate-800">{p.title}</div>
                <div className="mt-1 text-[13px] font-extrabold text-emerald-700">{fmt(p.price)}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
                  {p.linked ? <span className="rounded bg-sky-50 px-1.5 py-0.5 font-bold text-sky-700">🔗 مخزن: {p.stock ?? 0}</span> : (p.stock != null && <span>مخزون: {p.stock}</span>)}
                  {p.category && <span className="rounded bg-slate-50 px-1.5 py-0.5">{p.category}</span>}
                  {p.status === "hidden" && <span className="rounded bg-slate-200 px-1.5 py-0.5 font-bold text-slate-600">مخفيّ</span>}
                </div>
                <div className="mt-2 flex gap-1">
                  <button onClick={() => openEdit(p)} className="flex-1 rounded bg-slate-100 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200">تعديل</button>
                  <button onClick={() => toggle(p)} className="flex-1 rounded bg-amber-50 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100">{p.status === "visible" ? "إخفاء" : "إظهار"}</button>
                  <button onClick={() => del(p)} className="rounded bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100">حذف</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <Modal title={editId ? "تعديل منتج" : "منتج جديد"} onClose={() => setModal(false)}>
          <div className="space-y-3 overflow-y-auto p-5">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">اختر من المخزن (اختياري)</span>
              <select value={form.itemName ?? ""} onChange={(e) => pickWh(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">— منتج حرّ (بلا ربط بالمخزن) —</option>
                {whItems.map((it) => <option key={it.name} value={it.name}>{it.name} (المتوفّر: {it.count})</option>)}
              </select>
              {selWh && <div className="mt-1 rounded-lg bg-sky-50 px-3 py-1.5 text-[11px] text-sky-700">🔗 مرتبطٌ بالمخزن — العددُ ({selWh.count}) يُحدَّث تلقائيّاً مع المخزن. السعرُ مبدئيٌّ ويمكنك تغييره.</div>}
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">صورة (اختياري)</span>
              <div className="flex items-center gap-3">
                <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-slate-100">
                  {form.photo ? <img src={form.photo} alt="" className="h-full w-full object-cover" /> : <span className="text-2xl text-slate-300">🏬</span>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <input type="file" accept="image/*" onChange={onPickPhoto} className="text-xs" />
                  {form.photo && <button onClick={() => setForm((f) => ({ ...f, photo: null }))} className="w-fit text-[11px] text-rose-500">إزالة الصورة</button>}
                </div>
              </div>
            </label>
            <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">اسمُ المنتج</span>
              <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} maxLength={120} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="مثال: راوتر TP-Link" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">سعر البيع (د.ع)</span>
                <input value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} dir="ltr" inputMode="numeric" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="اختياري" /></label>
              {form.itemName
                ? <div><span className="mb-1 block text-xs font-semibold text-slate-600">المخزون</span><div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">من المخزن: {selWh?.count ?? 0}</div></div>
                : <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">المخزون</span>
                    <input value={form.stock} onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))} dir="ltr" inputMode="numeric" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="اختياري" /></label>}
            </div>
            <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">الفئة</span>
              <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} maxLength={80} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="مثال: راوترات، إكسسوارات" /></label>
            <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">الوصف (اختياري)</span>
              <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} maxLength={1000} rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="تفاصيل المنتج…" /></label>
            {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</div>}
            <div className="flex gap-2 pt-1">
              <button disabled={busy} onClick={() => void save()} className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? "جارٍ الحفظ…" : editId ? "حفظ التعديل" : "إضافة المنتج"}</button>
              <button onClick={() => setModal(false)} className="rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-200">إلغاء</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
