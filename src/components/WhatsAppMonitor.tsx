"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Office = { id: number; name: string | null; state: string };

// مراقب اتصال واتساب المكاتب: يفحص كل دقيقة، وإن كان أحدها غير متصل يُظهر تنبيهاً متكرراً
export default function WhatsAppMonitor() {
  const [show, setShow] = useState(false);
  const [down, setDown] = useState<Office[]>([]);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(async () => {
    try {
      const r = await fetch("/api/whatsapp/offices-status");
      if (!r.ok) return; // بلا صلاحية — لا نُزعج المستخدم
      const d = await r.json();
      const dc: Office[] = d.disconnected ?? [];
      setDown(dc);
      if (dc.length > 0) {
        setShow(true);
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setShow(false), 20000);
      } else setShow(false);
    } catch { /* تجاهل */ }
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, 60000);
    return () => { clearInterval(id); if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [check]);

  if (!show || down.length === 0) return null;

  return (
    <div className="fixed left-1/2 top-4 z-[100] w-[92%] max-w-md -translate-x-1/2 animate-[pulse_1.5s_ease-in-out] rounded-xl border border-red-300 bg-red-600 px-4 py-3 text-white shadow-2xl">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚠️</span>
          <div>
            <div className="text-sm font-bold">واتساب غير متصل ({down.length} مكتب)</div>
            <div className="text-xs text-red-100">{down.map((o) => o.name).filter(Boolean).join("، ") || "مكاتب"}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link href="/towers" className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50">ربط الآن</Link>
          <button onClick={() => setShow(false)} className="flex h-7 w-7 items-center justify-center rounded-full text-white/80 hover:bg-red-700" title="إخفاء">✕</button>
        </div>
      </div>
    </div>
  );
}
