"use client";

import { useEffect } from "react";

// ═════ مُبلّغُ أخطاء الواجهة — الطرفُ الساكنُ في متصفّح كلّ مستخدم ═════
// أيُّ خطأٍ غيرِ ملتقَطٍ (انهيارُ مكوّن · promise مرفوض) يُرسَل إلى الخادم فيُقرأ
// من سجلّ التدقيق — بدل أن يضيع في كونسول متصفّحٍ لن يفتحه أحد.
// لا يغيّر سلوكَ الصفحة بشيء: يستمع فقط، وحدُّه ٥ بلاغاتٍ لكلّ تحميل صفحة.
export default function ClientErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const reported = new Set<string>();
    const report = (kind: "error" | "unhandledrejection", message: string, stack?: string) => {
      const msg = (message || "").slice(0, 500);
      if (!msg || sent >= 5 || reported.has(msg)) return;
      reported.add(msg);
      sent++;
      void fetch("/api/client-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, message: msg, stack: stack?.slice(0, 2000), page: location.pathname }),
        keepalive: true, // يصل حتى لو كانت الصفحةُ تنهار وتُغادَر
      }).catch(() => {});
    };
    const onErr = (e: ErrorEvent) => report("error", e.message, e.error?.stack);
    const onRej = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      report("unhandledrejection", r?.message ?? String(r), r?.stack);
    };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => { window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onRej); };
  }, []);
  return null;
}
