"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import { usePermission } from "@/lib/usePermission";

type Product = { id: number; title: string; price: number | null; description: string | null; category: string | null; stock: number | null; photo: string | null; status: string; agentName: string | null; createdAt: string };
type Order = { id: number; subscriberName: string | null; productTitle: string; price: number | null; qty: number; phone: string; address: string; note: string | null; status: string; createdAt: string };
type PForm = { title: string; price: string; category: string; description: string; stock: string; photo: string | null };

const emptyForm = (): PForm => ({ title: "", price: "", category: "", description: "", stock: "", photo: null });
const fmt = (n: number | null) => (n == null ? "بلا سعر" : `${n.toLocaleString("en-US")} د.ع`);
const ORDER_LABEL: Record<string, string> = { new: "جديد", accepted: "مقبول", delivered: "مُسلّم", declined: "مرفوض", cancelled: "مُلغى" };
const ORDER_CLASS: Record<string, string> = { new: "bg-sky-100 text-sky-700", accepted: "bg-amber-100 text-amber-700", delivered: "bg-emerald-100 text-emerald-700", declined: "bg-rose-100 text-rose-700", cancelled: "bg-slate-200 text-slate-600" };

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
  const [tab, setTab] = useState<"products" | "orders">("products");
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<PForm>(emptyForm());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const loadProducts = useCallback(() => {
    fetch("/api/store/products").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setProducts(d.items || []); }).catch(() => {});
  }, []);
  const loadOrders = useCallback(() => {
    fetch("/api/store/orders").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) { setOrders(d.items || []); setCounts(d.counts || {}); } }).catch(() => {});
  }, []);
  useEffect(() => { loadProducts(); loadOrders(); }, [loadProducts, loadOrders]);

  function openAdd() { setEditId(null); setForm(emptyForm()); setErr(""); setModal(true); }
  function openEdit(p: Product) {
    setEditId(p.id);
    setForm({ title: p.title, price: p.price?.toString() ?? "", category: p.category ?? "", description: p.description ?? "", stock: p.stock?.toString() ?? "", photo: p.photo });
    setErr(""); setModal(true);
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
    const priceDigits = form.price.replace(/[^\d]/g, "");
    const stockDigits = form.stock.replace(/[^\d]/g, "");
    const priceNum = priceDigits ? Number(priceDigits) : null;
    const stockNum = stockDigits ? Number(stockDigits) : null;
    const body = { id: editId ?? undefined, title: form.title.trim(), price: priceNum, category: form.category.trim(), description: form.description.trim(), stock: stockNum, photo: form.photo };
    const r = await fetch("/api/store/products", { method: editId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { const d = await r.json().catch(() => null); setErr(d?.error || "فشل الحفظ"); return; }
    setModal(false); loadProducts();
  }

  async function toggle(p: Product) {
    const r = await fetch("/api/store/products", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, status: p.status === "visible" ? "hidden" : "visible" }) });
    if (!r.ok) { alert("فشل تغييرُ حالة المنتج — أعد المحاولة"); return; }
    loadProducts();
  }
  async function del(p: Product) {
    if (!confirm(`حذفُ «${p.title}» نهائيّاً؟`)) return;
    const r = await fetch(`/api/store/products?id=${p.id}`, { method: "DELETE" });
    if (!r.ok) { alert("فشل حذفُ المنتج — أعد المحاولة"); return; }
    loadProducts();
  }
  async function setStatus(o: Order, status: string) {
    const r = await fetch("/api/store/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: o.id, status }) });
    if (!r.ok) { alert("فشل تحديثُ الطلب — أعد المحاولة"); return; }
    loadOrders();
  }

  if (!me) return <div className="p-6 text-slate-400">جاري التحميل...</div>;
  if (!can("store.manage")) return <div className="p-6"><PageHeader title="متجري" /><div className="rounded-lg bg-red-50 px-4 py-3 text-red-600">ليس لديك صلاحية إدارة المتجر.</div></div>;

  const newCount = counts.new || 0;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="متجري" subtitle="كتالوجُ متجرك في التطبيق وطلباتُه" action={tab === "products" ? <button onClick={openAdd} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">+ منتج</button> : undefined} />

      <div className="mb-4 flex gap-2">
        <button onClick={() => setTab("products")} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === "products" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}>المنتجات ({products.length})</button>
        <button onClick={() => setTab("orders")} className={`relative rounded-lg px-4 py-2 text-sm font-semibold ${tab === "orders" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}>
          طلبات المتجر
          {newCount > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-500 px-1 text-[10px] font-bold text-white">{newCount}</span>}
        </button>
      </div>

      {tab === "products" ? (
        products.length === 0 ? (
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
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400">
                    {p.category && <span className="rounded bg-sky-50 px-1.5 py-0.5 font-bold text-sky-600">{p.category}</span>}
                    {p.stock != null && <span>مخزون: {p.stock}</span>}
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
        )
      ) : orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 py-14 text-center text-sm text-slate-400">لا طلباتٍ بعد</div>
      ) : (
        <div className="space-y-2.5">
          {orders.map((o) => (
            <div key={o.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-800">{o.productTitle} {o.qty > 1 && <span className="text-slate-500">× {o.qty}</span>}</div>
                  <div className="mt-0.5 text-[12px] text-slate-500">{fmt(o.price)}{o.subscriberName ? ` · ${o.subscriberName}` : ""}</div>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${ORDER_CLASS[o.status] || "bg-slate-100 text-slate-600"}`}>{ORDER_LABEL[o.status] || o.status}</span>
              </div>
              <div className="mt-2 grid gap-0.5 text-[12px] text-slate-600">
                <div>📍 {o.address}</div>
                <div dir="ltr" className="text-right">📞 {o.phone}</div>
                {o.note && <div className="text-slate-500">📝 {o.note}</div>}
              </div>
              {o.status === "new" && (
                <div className="mt-2.5 flex gap-1.5">
                  <button onClick={() => setStatus(o, "accepted")} className="flex-1 rounded-lg bg-amber-100 py-1.5 text-[12px] font-semibold text-amber-800 hover:bg-amber-200">قبول</button>
                  <button onClick={() => setStatus(o, "declined")} className="rounded-lg bg-rose-100 px-3 py-1.5 text-[12px] font-semibold text-rose-700 hover:bg-rose-200">رفض</button>
                </div>
              )}
              {o.status === "accepted" && (
                <div className="mt-2.5 flex gap-1.5">
                  <button onClick={() => setStatus(o, "delivered")} className="flex-1 rounded-lg bg-emerald-100 py-1.5 text-[12px] font-semibold text-emerald-800 hover:bg-emerald-200">تمّ التوصيل</button>
                  <button onClick={() => setStatus(o, "declined")} className="rounded-lg bg-rose-100 px-3 py-1.5 text-[12px] font-semibold text-rose-700 hover:bg-rose-200">رفض</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modal && (
        <Modal title={editId ? "تعديل منتج" : "منتج جديد"} onClose={() => setModal(false)}>
          <div className="space-y-3 overflow-y-auto p-5">
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
              <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">السعر (د.ع)</span>
                <input value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} dir="ltr" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="اختياري" /></label>
              <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">المخزون</span>
                <input value={form.stock} onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))} dir="ltr" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="اختياري" /></label>
            </div>
            <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">الفئة</span>
              <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} maxLength={80} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="مثال: راوترات، إكسسوارات" /></label>
            <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">الوصف (اختياري)</span>
              <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} maxLength={1000} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="تفاصيل المنتج…" /></label>
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
