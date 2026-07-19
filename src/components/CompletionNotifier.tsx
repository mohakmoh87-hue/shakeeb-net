"use client";

import { useEffect, useRef, useState } from "react";

type Done = { id: number; title: string; kind: string | null; amount: number | null; technicianName: string; completedAt: string };

// إشعار كبير وسط الشاشة عند إنجاز أي بطاقة في إدارة الفنيين (ضمن نطاق المستخدم).
// يستطلع كل 25 ثانية ويعرض ما أُنجز بعد فتح الصفحة فقط.
export default function CompletionNotifier() {
  const [queue, setQueue] = useState<Done[]>([]);
  const since = useRef<string>(new Date().toISOString());
  const seen = useRef<Set<number>>(new Set());

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const r = await fetch(`/api/field/recent-completions?since=${encodeURIComponent(since.current)}`);
        if (r.ok) {
          const d = await r.json();
          const fresh: Done[] = (d.completions ?? []).filter((c: Done) => !seen.current.has(c.id));
          if (fresh.length) {
            for (const c of fresh) seen.current.add(c.id);
            since.current = fresh[fresh.length - 1].completedAt;
            if (alive) setQueue((q) => [...q, ...fresh]);
          }
        }
      } catch { /* تجاهل */ }
    }
    const iv = setInterval(poll, 25000);
    poll();
    return () => { alive = false; clearInterval(iv); };
  }, []);

  if (queue.length === 0) return null;
  const cur = queue[0];
  const fmt = (n: number | null) => (n == null ? "" : Number(n).toLocaleString("en-US"));

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" onClick={() => setQueue((q) => q.slice(1))}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-7 text-center shadow-2xl"
        style={{ animation: "popIn .25s ease-out" }}
      >
        <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-5xl">✅</div>
        <h2 className="mb-1 text-2xl font-extrabold text-emerald-700">تم إنجاز بطاقة</h2>
        <p className="mb-1 text-lg font-bold text-slate-800">{cur.title}</p>
        <div className="mb-4 flex flex-wrap items-center justify-center gap-2 text-sm text-slate-500">
          <span className="rounded-full bg-slate-100 px-3 py-1">👷 {cur.technicianName}</span>
          {cur.kind && <span className="rounded-full bg-slate-100 px-3 py-1">{cur.kind}</span>}
          {cur.amount != null && <span className="rounded-full bg-emerald-50 px-3 py-1 font-bold text-emerald-700">{fmt(cur.amount)} د.ع</span>}
        </div>
        <button
          onClick={() => setQueue((q) => q.slice(1))}
          className="w-full rounded-xl bg-mynet-blue py-3 text-lg font-bold text-white hover:bg-mynet-blue-dark"
        >
          حسناً {queue.length > 1 ? `(${queue.length - 1} أخرى)` : ""}
        </button>
      </div>
      <style>{`@keyframes popIn{from{transform:scale(.8);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
    </div>
  );
}
