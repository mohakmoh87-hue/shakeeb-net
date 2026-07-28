"use client";

import { useEffect, useState } from "react";
import { localSasBase } from "@/lib/localSas";

// عدّاد المشتركين (أ5): الفعالون والعدد الكلي، يتحدّث كل 5 ثوانٍ محلياً بالكامل من
// حاسبة المكتب (العامل المحلي يقرأ من SAS مباشرة) — بلا أي مرور على Azure/Aiven.
// بلا عامل محلي: قراءة واحدة من السحابة عند الفتح فقط (بلا استطلاع دوري).
export default function SubscriberCounter({ towerIds }: { towerIds: number[] }) {
  const [stats, setStats] = useState<{ active: number; total: number } | null>(null);
  const [live, setLive] = useState(false); // يتحدّث من حاسبة المكتب

  const key = towerIds.join(",");
  useEffect(() => {
    if (!key) return;
    let stop = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    (async () => {
      const base = await localSasBase();
      if (stop) return;
      if (base) {
        const load = async () => {
          try {
            const r = await fetch(`${base}/stats/subscribers?towers=${key}`);
            const d = await r.json().catch(() => null);
            if (!stop && r.ok && d && typeof d.total === "number") {
              setStats({ active: d.active, total: d.total });
              setLive(true);
            }
          } catch { /* العامل توقّف مؤقتاً — نُبقي آخر أرقام */ }
        };
        void load();
        timer = setInterval(load, 5000);
      } else {
        // بلا حاسبة مكتب: قراءة واحدة من السحابة، ولا استطلاع كل 5 ثوانٍ (شرط الاستهلاك)
        try {
          const r = await fetch("/api/subscribers/stats");
          const d = await r.json().catch(() => null);
          if (!stop && r.ok && d && typeof d.total === "number") setStats(d);
        } catch { /* */ }
      }
    })();
    return () => { stop = true; if (timer) clearInterval(timer); };
  }, [key]);

  if (!stats) return null;
  const fmt = (n: number) => n.toLocaleString("en-US");
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-xl">👤</span>
        <span className="text-sm font-bold text-slate-700">المشتركين</span>
        {live && <span title="يتحدّث كل 5 ثوانٍ من حاسبة المكتب مباشرة" className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">⚡ مباشر</span>}
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="font-extrabold text-emerald-600">{fmt(stats.active)} <span className="text-[11px] font-semibold text-slate-500">فعال</span></span>
        <span className="text-slate-300">|</span>
        <span className="font-extrabold text-slate-700">{fmt(stats.total)} <span className="text-[11px] font-semibold text-slate-500">الكلي</span></span>
      </div>
    </div>
  );
}
