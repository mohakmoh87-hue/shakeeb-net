"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// الطباعة الصامتة: عند فتح صفحة الوصل يُرسَل أمر طباعة تلقائياً، فيلتقطه العامل
// المحلي بحاسبة المكتب ويطبع فوراً على الطابعة الافتراضية — بلا أي نافذة حوار،
// ومن أي جهاز (هاتف/حاسبة/تطبيق). تظهر الحالة بشريط صغير أعلى الوصل.
type Phase = "sending" | "queued" | "done" | "failed" | "offline" | "error";

export default function SilentPrint({ kind, id }: { kind: "subscription" | "invoice"; id: number }) {
  const [phase, setPhase] = useState<Phase>("sending");
  const [detail, setDetail] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sentRef = useRef(false);

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const send = useCallback(async () => {
    stopPoll();
    setPhase("sending"); setDetail("");
    const r = await fetch("/api/print", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (!r?.ok || !d?.ok) { setPhase("error"); setDetail(d?.error ?? "تعذّر الاتصال بالخادم"); return; }
    if (!d.workerOnline) { setPhase("offline"); return; }
    setPhase("queued");
    // تتبّع الحالة حتى ٣٠ ثانية: تمّت/فشلت
    const started = Date.now();
    pollRef.current = setInterval(async () => {
      if (Date.now() - started > 30_000) { stopPoll(); return; }
      const s = await fetch(`/api/print?jobId=${d.jobId}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (s?.status === "done") { stopPoll(); setPhase("done"); }
      else if (s?.status === "failed") { stopPoll(); setPhase("failed"); setDetail(s.error ?? ""); }
    }, 2000);
  }, [kind, id]);

  useEffect(() => {
    if (sentRef.current) return; // منع الإرسال المزدوج (StrictMode)
    sentRef.current = true;
    void send();
    return stopPoll;
  }, [send]);

  const styles: Record<Phase, string> = {
    sending: "bg-slate-100 text-slate-600",
    queued: "bg-sky-50 text-sky-700",
    done: "bg-emerald-50 text-emerald-700",
    failed: "bg-red-50 text-red-600",
    offline: "bg-amber-50 text-amber-700",
    error: "bg-red-50 text-red-600",
  };
  const texts: Record<Phase, string> = {
    sending: "⏳ جارٍ إرسال الوصل للطابعة...",
    queued: "🖨️ أُرسل للطباعة الصامتة بالمكتب...",
    done: "✅ طُبع الوصل على طابعة المكتب",
    failed: `❌ فشلت الطباعة${detail ? `: ${detail}` : ""} — استخدم زر الطباعة`,
    offline: "⚠️ حاسبة المكتب غير متصلة — استخدم زر «طباعة الوصل» من هذا الجهاز",
    error: `⚠️ ${detail || "تعذّر إرسال أمر الطباعة"}`,
  };

  return (
    <div className={`no-print mb-3 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${styles[phase]}`}>
      <span>{texts[phase]}</span>
      {(phase === "done" || phase === "failed" || phase === "error") && (
        <button onClick={() => void send()} className="shrink-0 rounded-md bg-white/70 px-2.5 py-1 text-xs font-bold text-slate-700 shadow-sm hover:bg-white">
          🖨️ إعادة الطباعة
        </button>
      )}
    </div>
  );
}
