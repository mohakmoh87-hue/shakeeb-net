"use client";

import { useEffect, useState } from "react";

export default function ResetPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token") ?? "";
    setToken(t);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 4) { setError("كلمة السر 4 أحرف على الأقل"); return; }
    if (password !== password2) { setError("كلمتا السر غير متطابقتين"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? "تعذّرت إعادة التعيين"); return; }
      setDone(true);
    } catch { setError("تعذّر الاتصال بالخادم"); }
    finally { setLoading(false); }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <h1 className="mb-1 text-center text-xl font-bold text-slate-800">إعادة تعيين كلمة السر</h1>
        {done ? (
          <div className="mt-4 text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-4xl">✓</div>
            <p className="mb-4 text-sm text-slate-600">تم تغيير كلمة السر بنجاح.</p>
            <a href="/login" className="inline-block w-full rounded-lg bg-blue-600 py-2.5 font-semibold text-white hover:bg-blue-700">تسجيل الدخول</a>
          </div>
        ) : !token ? (
          <p className="mt-4 text-center text-sm text-red-600">رابط غير صالح — افتح رابط الاسترجاع من بريدك.</p>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="كلمة السر الجديدة" dir="ltr" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left outline-none focus:border-blue-500" autoComplete="new-password" />
            <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} placeholder="تأكيد كلمة السر" dir="ltr" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left outline-none focus:border-blue-500" autoComplete="new-password" />
            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
            <button type="submit" disabled={loading} className="w-full rounded-lg bg-blue-600 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{loading ? "جارٍ الحفظ…" : "تعيين كلمة السر"}</button>
          </form>
        )}
      </div>
    </main>
  );
}
