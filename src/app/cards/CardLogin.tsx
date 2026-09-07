"use client";

import { useState } from "react";

export default function CardLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/cards/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: username.trim(), password }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d?.error ?? "تعذّر الدخول"); return; }
      window.location.reload();
    } catch { setErr("خطأُ شبكة"); }
    finally { setBusy(false); }
  }

  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-md">
        <div className="text-center">
          <div className="text-3xl">🃏</div>
          <h1 className="mt-1 text-xl font-bold text-slate-800">موزّع الكروت</h1>
          <p className="text-xs text-slate-500">دخولُ الموزّع لإدارة الكروت والتحويلات</p>
        </div>
        <input value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" placeholder="اسم المستخدم" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" dir="ltr" placeholder="كلمة المرور" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</div>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-emerald-600 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{busy ? "جارٍ الدخول..." : "دخول"}</button>
      </form>
    </div>
  );
}
