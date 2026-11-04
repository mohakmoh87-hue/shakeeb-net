"use client";

import { useCallback, useEffect, useState } from "react";

type Listing = { id: number; sellerName: string | null; realName?: string; netUser?: string; title: string; price: number | null; description: string | null; phone: string; photo: string | null; category: string | null; status: string; createdAt: string };

export default function MarketReview({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<Listing[]>([]);
  const [pending, setPending] = useState(0);
  const [cats, setCats] = useState<string[]>([]);
  const [newCat, setNewCat] = useState("");
  const [catMsg, setCatMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/app-admin/market?only=pending&page=1").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) { setItems(d.items || []); setCats(d.categories || []); setPending(d.counts?.pending ?? 0); }
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function decide(id: number, status: string) {
    setBusy(true);
    await fetch("/api/app-admin/market", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    setBusy(false);
    load();
    onChanged?.();
  }
  async function del(id: number) {
    if (!confirm("حذفُ الإعلان نهائيّاً؟")) return;
    setBusy(true);
    await fetch(`/api/app-admin/market?id=${id}`, { method: "DELETE" });
    setBusy(false);
    load();
    onChanged?.();
  }
  async function saveCats() {
    setCatMsg("");
    if (cats.length === 0) { setCatMsg("أضِف فئةً واحدةً على الأقل"); return; }
    const r = await fetch("/api/app-admin/market", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categories: cats }) });
    setCatMsg(r.ok ? "✓ حُفِظ" : "فشل الحفظ");
  }

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-semibold text-slate-800">🏷️ فئاتُ السوق وطلباتُ النشر</div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${pending > 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
          {pending > 0 ? `${pending} بانتظار موافقتك` : "لا طلباتٍ منتظرة"}
        </span>
      </div>

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
        <div className="mb-2 text-xs font-bold text-slate-600">الفئات</div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {cats.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{c}
              <button onClick={() => setCats(cats.filter((x) => x !== c))} className="text-rose-500 hover:text-rose-700">✕</button>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newCat.trim()) { setCats([...new Set([...cats, newCat.trim()])]); setNewCat(""); } }} placeholder="فئةٌ جديدة" className="w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          <button onClick={() => { if (newCat.trim()) { setCats([...new Set([...cats, newCat.trim()])]); setNewCat(""); } }} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-200">+ إضافة</button>
          <button onClick={() => void saveCats()} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">حفظ</button>
          {catMsg && <span className="text-xs text-slate-600">{catMsg}</span>}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="mb-2 text-xs font-bold text-slate-600">طلباتُ النشر</div>
        {items.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">لا إعلاناتٍ بانتظار الموافقة</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((it) => (
              <div key={it.id} className="flex items-start gap-3 py-2.5">
                {it.photo
                  ? <img src={it.photo} alt="" className="h-14 w-14 shrink-0 rounded-lg bg-slate-50 object-contain" />
                  : <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-slate-100 text-lg">🛒</div>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-bold text-slate-800">{it.title}</span>
                    {it.category && <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">{it.category}</span>}
                  </div>
                  <div className="text-[11px] text-slate-500">{it.price != null ? `${it.price.toLocaleString("en-US")} د.ع · ` : ""}{it.sellerName ?? "—"}{it.netUser ? ` · ${it.netUser}` : ""} · <span dir="ltr">{it.phone}</span></div>
                  {it.description && <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{it.description}</div>}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <button disabled={busy} onClick={() => void decide(it.id, "visible")} className="rounded bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-200 disabled:opacity-50">✓ موافقة</button>
                  <button disabled={busy} onClick={() => void decide(it.id, "hidden")} className="rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-50">رفضٌ وإخفاء</button>
                  <button disabled={busy} onClick={() => void del(it.id)} className="rounded bg-rose-100 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-200 disabled:opacity-50">حذف</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
