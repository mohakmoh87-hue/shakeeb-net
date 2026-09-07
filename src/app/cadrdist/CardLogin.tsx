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

  const input = "w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/15";

  return (
    <div dir="rtl" className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0a0f1e] p-4 text-slate-100">
      <div className="pointer-events-none absolute inset-0 select-none opacity-[0.05]">
        <div className="absolute -right-10 top-6 text-[220px] leading-none">♠</div>
        <div className="absolute -left-10 bottom-2 text-[220px] leading-none">♣</div>
      </div>
      <form onSubmit={submit} className="relative w-full max-w-sm space-y-4 rounded-3xl border border-white/10 bg-white/[0.04] p-7 shadow-2xl shadow-black/50 backdrop-blur">
        <div className="text-center">
          <div className="mx-auto mb-2 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-amber-300 via-amber-400 to-orange-500 text-3xl shadow-lg shadow-amber-900/40">🃏</div>
          <h1 className="bg-gradient-to-l from-cyan-300 to-emerald-300 bg-clip-text text-2xl font-black text-transparent">موزّع الكروت</h1>
          <p className="mt-1 text-xs text-slate-400">دخولُ الموزّع لإدارة الكروت والتحويلات</p>
        </div>
        <input value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" placeholder="اسم المستخدم" className={input} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" dir="ltr" placeholder="كلمة المرور" className={input} />
        {err && <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{err}</div>}
        <button type="submit" disabled={busy} className="w-full rounded-xl bg-gradient-to-l from-emerald-500 to-teal-500 py-3 font-bold text-white shadow-lg shadow-emerald-900/40 transition hover:from-emerald-400 hover:to-teal-400 active:scale-[.98] disabled:opacity-60">{busy ? "جارٍ الدخول..." : "دخول"}</button>
      </form>
    </div>
  );
}
