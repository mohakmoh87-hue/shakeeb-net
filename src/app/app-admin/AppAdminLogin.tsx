"use client";

import { useState } from "react";

// دخولُ أدمن التطبيق — يستدعي /api/app-admin/login (بحساب أنشأه المالك). عند النجاح يُعيد
// تحميلَ الصفحة فتُظهر اللوحة (الجلسةُ تُفحَص في الخادم). محروسٌ ومحدودُ المعدّل.
export default function AppAdminLogin() {
  const [f, setF] = useState({ username: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const res = await fetch("/api/app-admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? "تعذّر الدخول"); return; }
      window.location.reload();
    } catch { setErr("تعذّر الاتصال بالخادم"); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid min-h-[100dvh] place-items-center bg-slate-50 p-6" dir="rtl">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="text-center">
          <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl bg-indigo-600 text-3xl">📱</div>
          <h1 className="text-xl font-bold text-slate-800">أدمن التطبيق</h1>
          <p className="mt-1 text-xs text-slate-500">دخولٌ خاصٌّ بإدارة تطبيق المشترك</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">اسم المستخدم</label>
          <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} dir="ltr"
            className="w-full rounded-lg border border-slate-300 px-3 py-2" autoComplete="username" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">كلمة المرور</label>
          <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} dir="ltr"
            className="w-full rounded-lg border border-slate-300 px-3 py-2" autoComplete="current-password" />
        </div>
        {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</div>}
        <button type="submit" disabled={busy}
          className="w-full rounded-lg bg-indigo-600 py-2.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
          {busy ? "جارٍ الدخول..." : "دخول"}
        </button>
      </form>
    </div>
  );
}
