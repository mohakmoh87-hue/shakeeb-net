"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ═════ 📬 مُضيف الرسائل الداخليّة المنبثقة (طلب محمد — 2026-08-20) ═════
// يستطلع المفتوحةَ للمستقبِل الحالي (فنيّاً أو مستخدماً/مديراً — الخادمُ يميّز الجلسة)
// ويعرض أقدمَها منبثقةً فوق كلّ شيء:
//   • لا تُغلق إلّا بضغط X (لا نقرُ فراغٍ ولا مهلة) — قاعدةُ محمد الصريحة.
//   • «↩️ ردّ» يفتح صندوقَ نصٍّ والردُّ يصل المرسِلَ بنفس الآليّة.
//   • بعد X تظهر التالية إن وُجدت (طابورٌ بالأقدم أوّلاً).
// يُركَّب في فرعَي التخطيط كليهما: قشرة المستخدم/المدير، وغلاف الفنيّ المجرّد —
// فيظهر فوق بطاقات الفنيّ وفوق الشاشة الرئيسيّة سواء.

type Msg = { id: number; fromName: string; text: string; createdAt: string; replyToId: number | null };

const POLL_MS = 25_000;

export default function InternalMsgHost() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);
  const [sentNote, setSentNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    // لا استطلاعَ وتبويبُ المتصفّح مخفيّ — يُستأنف عند العودة
    if (typeof document !== "undefined" && document.hidden) return;
    fetch("/api/internal-messages")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.messages)) setMsgs(d.messages); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, POLL_MS);
    const onShow = () => load();
    document.addEventListener("visibilitychange", onShow);
    return () => { if (timer.current) clearInterval(timer.current); document.removeEventListener("visibilitychange", onShow); };
  }, [load]);

  const cur = msgs[0];
  if (!cur) return null;

  async function closeCur() {
    if (!cur || busy) return;
    setBusy(true); setErr("");
    try {
      await fetch("/api/internal-messages", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: cur.id }),
      });
    } catch { /* الإغلاقُ المحلّيُّ يمضي والاستطلاعُ القادم يصحّح */ }
    setBusy(false); setReply(""); setReplying(false); setSentNote(false);
    setMsgs((m) => m.filter((x) => x.id !== cur.id));
  }

  async function sendReply() {
    if (!cur || !reply.trim() || busy) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/internal-messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replyToId: cur.id, text: reply.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      setBusy(false);
      if (!r.ok) { setErr(d.error ?? "تعذّر إرسال الردّ"); return; }
      setReply(""); setReplying(false); setSentNote(true);
    } catch { setBusy(false); setErr("تعذّر الاتصال بالخادم"); }
  }

  const when = new Date(cur.createdAt).toLocaleString("en-GB", {
    timeZone: "Asia/Baghdad", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit",
  });

  return (
    // ⚠️ لا onClick على الخلفيّة عمداً — الإغلاقُ بـX حصراً (شرط محمد)
    <div className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/60 p-4">
      <div className="my-auto max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-2 rounded-t-2xl bg-mynet-blue px-4 py-3 text-white">
          <div className="min-w-0">
            <div className="truncate text-sm font-extrabold">📩 رسالة من {cur.fromName}</div>
            <div className="text-[11px] opacity-80" dir="ltr">{when}</div>
          </div>
          <button onClick={closeCur} disabled={busy} title="إغلاق"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-lg font-bold hover:bg-white/30 disabled:opacity-60">✕</button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words px-4 py-4 text-sm leading-7 text-slate-800">
          {cur.text}
        </div>

        <div className="border-t border-slate-100 p-3">
          {err && <div className="mb-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-600">{err}</div>}
          {sentNote && <div className="mb-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">✓ وصل ردُّك للمرسِل</div>}
          {!replying ? (
            <div className="flex items-center justify-between gap-2">
              <button onClick={() => { setReplying(true); setSentNote(false); }}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200">↩️ ردّ</button>
              {msgs.length > 1 && <span className="text-[11px] text-slate-400">+{msgs.length - 1} رسالة أخرى بعد هذه</span>}
            </div>
          ) : (
            <div>
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} autoFocus
                placeholder="اكتب ردّك…" className="mb-2 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm leading-6 outline-none focus:border-mynet-blue" />
              <div className="flex gap-2">
                <button onClick={sendReply} disabled={busy || !reply.trim()}
                  className="flex-1 rounded-lg bg-emerald-600 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                  {busy ? "جارٍ…" : "إرسال الردّ"}
                </button>
                <button onClick={() => { setReplying(false); setReply(""); }} disabled={busy}
                  className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600">تراجع</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
