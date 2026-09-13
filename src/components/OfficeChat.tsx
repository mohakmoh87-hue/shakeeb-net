"use client";

import { useEffect, useState } from "react";

// واجهة واتساب الأصليّة (المحادثات) مضمّنةً من بوّابة شكيب عبر رمزٍ موقَّع — تحلّ محلّ
// الواجهة القديمة (relay whatsapp-web.js + استطلاع). تعمل لمكتبٍ يُرسل عبر البوّابة.
export default function OfficeChat({ officeId, officeName, onClose }: { officeId: number; officeName: string; state?: string; onClose: () => void }) {
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [url, setUrl] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`/api/office-chat?officeId=${officeId}`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.available && d.url) { setUrl(d.url); setStatus("ready"); }
        else setStatus("unavailable");
      })
      .catch(() => { if (alive) setStatus("error"); });
    return () => { alive = false; };
  }, [officeId]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-3" onClick={onClose}>
      <div className="flex h-[90dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-emerald-600 px-4 py-2 text-white">
          <h3 className="font-bold">💬 واتساب — {officeName}</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-emerald-700">✕</button>
        </div>

        {status === "loading" && (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">جارٍ فتح المحادثات…</div>
        )}
        {status === "unavailable" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <span className="text-4xl">🔌</span>
            <div className="text-lg font-bold text-slate-700">المحادثات غير متاحة لهذا المكتب</div>
            <div className="max-w-md text-sm text-slate-500">تظهر المحادثات الكاملة (قراءة وردّ ووسائط وتسجيل صوتيّ) عندما يكون واتساب هذا المكتب مربوطاً عبر <b>بوّابة شكيب</b> (طريقة API عبر البوّابة). اربط رقم المكتب بالبوّابة ثمّ عُد هنا.</div>
          </div>
        )}
        {status === "error" && (
          <div className="flex flex-1 items-center justify-center text-sm text-red-600">تعذّر الاتصال بالبوّابة — أعد المحاولة</div>
        )}
        {status === "ready" && (
          <iframe
            src={url}
            title={`واتساب — ${officeName}`}
            className="w-full flex-1 border-0"
            allow="microphone; clipboard-read; clipboard-write; autoplay"
          />
        )}
      </div>
    </div>
  );
}
