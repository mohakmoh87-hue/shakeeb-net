"use client";

import { useEffect, useRef, useState } from "react";

// قسم النسخ الاحتياطي والاسترجاع في الإعدادات (لكل وكيل).
export default function BackupSection() {
  const [email, setEmail] = useState("");
  const [savedEmail, setSavedEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/agent").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d?.backupEmail) { setEmail(d.backupEmail); setSavedEmail(d.backupEmail); }
    });
  }, []);

  async function saveEmail() {
    setSaving(true); setMsg(null);
    const r = await fetch("/api/agent", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ backupEmail: email.trim() || null }) });
    setSaving(false);
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setSavedEmail(email.trim()); setMsg({ kind: "ok", text: "✓ حُفظ إيميل النسخ الاحتياطي" }); }
    else setMsg({ kind: "err", text: d.error ?? "تعذّر الحفظ" });
  }

  async function sendNow() {
    setSending(true); setMsg(null);
    const r = await fetch("/api/backup/send-now", { method: "POST" });
    setSending(false);
    const d = await r.json().catch(() => ({}));
    if (r.ok) setMsg({ kind: "ok", text: "✓ أُرسلت النسخة إلى إيميلك" });
    else setMsg({ kind: "err", text: d.error ?? "تعذّر الإرسال" });
  }

  async function onRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = ""; // اسمح بإعادة اختيار نفس الملف لاحقاً
    if (!f) return;
    if (!confirm("⚠️ استرجاع كامل (استبدال):\nسيُمسح كل ما لديك حالياً (المشتركون، الكروت، الحسابات، المصروفات، الفواتير، الفنيون، المكاتب...) ويُستبدَل ببيانات هذا الملف.\nلا يمكن التراجع. هل أنت متأكد؟")) return;
    if (!confirm("تأكيد أخير: سيتم الاستبدال الكامل الآن.")) return;
    setRestoring(true); setMsg(null);
    try {
      const buf = await f.arrayBuffer();
      const r = await fetch("/api/backup/restore", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: buf });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setMsg({ kind: "ok", text: `✓ تم الاسترجاع: ${d.rowsRestored ?? 0} سجل في ${d.tablesRestored ?? 0} جدول. حدّث الصفحة.` });
      else setMsg({ kind: "err", text: d.error ?? "تعذّر الاسترجاع" });
    } catch { setMsg({ kind: "err", text: "تعذّر قراءة الملف" }); }
    finally { setRestoring(false); }
  }

  return (
    <div className="mb-5 max-w-lg rounded-xl border border-sky-200 bg-sky-50 p-5 shadow-sm">
      <h3 className="mb-1 font-bold text-sky-800">💾 النسخ الاحتياطي والاسترجاع</h3>
      <p className="mb-3 text-xs text-slate-500">يُرسل النظام نسخة كاملة من بياناتك إلى إيميلك يومياً تلقائياً. احتفظ بها لاسترجاع بياناتك عند الحاجة (حتى على جهاز آخر).</p>

      <label className="mb-1 block text-sm font-semibold text-slate-700">إيميل النسخ الاحتياطي (= إيميل الاسترجاع)</label>
      <div className="mb-1 flex gap-2">
        <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500" />
        <button onClick={saveEmail} disabled={saving || email.trim() === savedEmail} className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50">{saving ? "…" : "حفظ"}</button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <a href="/api/backup/export" className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">⬇️ تنزيل نسخة الآن</a>
        <button onClick={sendNow} disabled={sending || !savedEmail} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50" title={!savedEmail ? "احفظ إيميلاً أولاً" : ""}>{sending ? "جاري الإرسال…" : "✉️ إرسال إلى إيميلي الآن"}</button>
        <button onClick={() => fileRef.current?.click()} disabled={restoring} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">{restoring ? "جاري الاسترجاع…" : "♻️ استرجاع عن طريق النسخة الاحتياطية"}</button>
        <input ref={fileRef} type="file" accept=".gz,.json,application/gzip,application/json" onChange={onRestoreFile} className="hidden" />
      </div>

      {msg && <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{msg.text}</div>}
      <p className="mt-2 text-[11px] text-slate-400">ملاحظة: الاسترجاع لا يشمل حسابات الدخول (تبقى كما هي على هذا الجهاز) — يشمل كل بيانات العمل.</p>
    </div>
  );
}
