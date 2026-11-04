"use client";

import { useCallback, useEffect, useState } from "react";

type Listing = { id: number; sellerName: string | null; title: string; price: number | null; description: string | null; phone: string; photo: string | null; category: string | null; status: string; createdAt: string };

export default function MarketModeration({ reloadToken = 0 }: { reloadToken?: number }) {
  const [items, setItems] = useState<Listing[]>([]);
  const [counts, setCounts] = useState<{ visible: number; hidden: number; pending: number } | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);

  const load = useCallback((query: string, p: number) => {
    const u = new URL("/api/app-admin/market", window.location.origin);
    if (query.trim()) u.searchParams.set("q", query.trim());
    u.searchParams.set("page", String(p));
    fetch(u.pathname + u.search).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) { setItems(d.items || []); setCounts(d.counts || null); setPages(d.pages || 0); setTotal(d.total || 0); setPage(d.page || 1); }
    }).catch(() => {});
  }, []);
  useEffect(() => { load("", 1); }, [load, reloadToken]);

  async function setStatus(id: number, status: string) {
    await fetch("/api/app-admin/market", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    load(q, page);
  }
  async function del(id: number) {
    if (!confirm("حذفُ الإعلان نهائيّاً؟")) return;
    await fetch(`/api/app-admin/market?id=${id}`, { method: "DELETE" });
    load(q, items.length === 1 && page > 1 ? page - 1 : page);
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 font-semibold text-slate-800">🛒 سوق المستعمل</div>
      {counts && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center"><div className="text-2xl font-extrabold text-emerald-600" dir="ltr">{counts.visible}</div><div className="mt-0.5 text-[11px] text-slate-500">ظاهرة</div></div>
          <div className={`rounded-xl border p-3 text-center ${counts.pending > 0 ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50"}`}><div className="text-2xl font-extrabold text-amber-600" dir="ltr">{counts.pending}</div><div className="mt-0.5 text-[11px] text-slate-500">بانتظار الموافقة</div></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center"><div className="text-2xl font-extrabold text-slate-700" dir="ltr">{counts.hidden}</div><div className="mt-0.5 text-[11px] text-slate-500">مخفيّة</div></div>
        </div>
      )}

      <div className="mb-2 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") load(q, 1); }} placeholder="بحثٌ بالعنوان أو البائع أو الهاتف…" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <button onClick={() => load(q, 1)} className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200">🔍</button>
      </div>
      <div className="mb-2 text-[11px] text-slate-400">{q.trim() ? `نتائجُ البحث: ${total}` : `المجموع: ${total}`}</div>

      <div className="divide-y divide-slate-100">
        {items.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">لا إعلانات</div>
        ) : items.map((it) => {
          const hidden = it.status === "hidden";
          const waiting = it.status === "pending";
          return (
            <div key={it.id} className={`flex items-start gap-3 py-2.5 ${hidden ? "opacity-60" : ""}`}>
              {it.photo
                ? <img src={it.photo} alt="" className="h-14 w-14 shrink-0 rounded-lg bg-slate-50 object-contain" />
                : <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-slate-100 text-lg">🛒</div>}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-bold text-slate-800">{it.title}</span>
                  {it.category && <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">{it.category}</span>}
                  {hidden && <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">مخفيّ</span>}
                  {waiting && <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">بانتظار الموافقة</span>}
                </div>
                <div className="text-[11px] text-slate-500">{it.price != null ? `${it.price.toLocaleString("en-US")} د.ع · ` : ""}{it.sellerName ?? "—"} · <span dir="ltr">{it.phone}</span></div>
                {it.description && <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{it.description}</div>}
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                {waiting
                  ? <>
                      <button onClick={() => void setStatus(it.id, "visible")} className="rounded bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-200">✓ موافقة</button>
                      <button onClick={() => void setStatus(it.id, "hidden")} className="rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200">رفضٌ وإخفاء</button>
                    </>
                  : hidden
                    ? <button onClick={() => void setStatus(it.id, "visible")} className="rounded bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-200">إظهار</button>
                    : <button onClick={() => void setStatus(it.id, "hidden")} className="rounded bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-200">إخفاء</button>}
                <button onClick={() => void del(it.id)} className="rounded bg-rose-100 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-200">حذف</button>
              </div>
            </div>
          );
        })}
      </div>
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2 text-sm">
          <button disabled={page <= 1} onClick={() => load(q, page - 1)} className="rounded-lg bg-slate-100 px-3 py-1 disabled:opacity-40">‹</button>
          <span className="text-slate-500">{page} / {pages}</span>
          <button disabled={page >= pages} onClick={() => load(q, page + 1)} className="rounded-lg bg-slate-100 px-3 py-1 disabled:opacity-40">›</button>
        </div>
      )}
    </div>
  );
}
