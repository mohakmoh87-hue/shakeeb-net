"use client";

import { useState } from "react";

// قسم «تنصيب الحاسبة» — تعليمات كاملة خطوة بخطوة + توليد أمر تنصيب آمن (برمز لمرّة واحدة).
// لا يحتاج الوكيل لأي رابط يدوي ولا للرجوع لأحد.
export default function InstallComputer() {
  const [open, setOpen] = useState(false);
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");

  async function gen() {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/hybrid/install-token", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setCmd(d.command); else setErr(d.error ?? "تعذّر توليد الأمر");
    } catch { setErr("تعذّر الاتصال"); }
    setBusy(false);
  }
  function copy() {
    navigator.clipboard?.writeText(cmd).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  return (
    <div className="mb-6 rounded-xl border border-sky-200 bg-sky-50 shadow-sm">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-right">
        <span className="font-bold text-slate-800">🖥️ تنصيب حاسبة مكتب</span>
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-sky-200 px-4 py-4 text-sm text-slate-700">
          <p>لجعل حاسبة المكتب جزءاً من النظام (واتساب سريع + SAS محلي + مزامنة تلقائية):</p>
          <ol className="list-decimal space-y-2 pr-5 leading-relaxed">
            <li>على <b>حاسبة المكتب</b>: اضغط زر «ابدأ» ← اكتب <b>PowerShell</b> ← افتحه.</li>
            <li>اضغط <b>«توليد أمر التنصيب»</b> بالأسفل، ثم <b>انسخ الأمر</b> والصقه في PowerShell واضغط Enter.</li>
            <li>سيُثبّت البرنامج تلقائياً (Node و Git والمكتبات ومتصفّح الواتساب) — قد يأخذ عدّة دقائق. <b>لا تُدخِل أي رابط يدوياً</b>؛ كل الإعدادات تُجلب تلقائياً بالأمر.</li>
            <li>بعد انتهائه: ارجع إلى <a href="/hybrid" className="font-semibold text-sky-700 underline">حواسيب النظام الهجين</a> ← تظهر الحاسبة خلال ~٢٠ ثانية ← اكتب لها اسماً ← اضغط <b>«تفعيل»</b>.</li>
            <li>(إن كانت ستستضيف واتساب) افتح «واتساب المكاتب» وامسح رمز QR مرّة واحدة.</li>
          </ol>
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">⏱️ أمر التنصيب صالح ٣٠ دقيقة فقط ولمرّة واحدة. إن انتهى، ولّد أمراً جديداً.</div>

          {err && <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-600">{err}</div>}

          {!cmd ? (
            <button onClick={gen} disabled={busy} className="rounded-xl bg-sky-600 px-5 py-2.5 font-bold text-white hover:bg-sky-700 disabled:opacity-60">
              {busy ? "..." : "🔑 توليد أمر التنصيب"}
            </button>
          ) : (
            <div>
              <div className="mb-1 text-xs font-semibold text-slate-500">انسخ هذا الأمر والصقه في PowerShell على حاسبة المكتب:</div>
              <div className="flex items-stretch gap-2">
                <code dir="ltr" className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-xs text-slate-800">{cmd}</code>
                <button onClick={copy} className={`shrink-0 rounded-lg px-4 py-2 text-sm font-bold text-white ${copied ? "bg-emerald-600" : "bg-sky-600 hover:bg-sky-700"}`}>{copied ? "✓ نُسِخ" : "📋 نسخ"}</button>
              </div>
              <button onClick={gen} className="mt-2 text-xs text-sky-700 underline">توليد أمر جديد</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
