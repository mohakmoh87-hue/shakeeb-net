"use client";

import { useEffect, useState } from "react";
import InstallApp from "@/components/InstallApp";
import { isAppMode } from "@/lib/appMode";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ownerPhone, setOwnerPhone] = useState("");
  // نسيت كلمة السر
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotUser, setForgotUser] = useState("");
  const [forgotMsg, setForgotMsg] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  useEffect(() => {
    fetch("/api/public/contact").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.phone) setOwnerPhone(d.phone); });
  }, []);

  async function sendForgot(e: React.FormEvent) {
    e.preventDefault();
    setForgotMsg(""); setForgotLoading(true);
    try {
      await fetch("/api/auth/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: forgotUser }) });
      setForgotMsg("إن كان لحسابك إيميل استرجاع مضبوط، سيصلك رابط إعادة التعيين خلال دقائق. تحقّق من بريدك.");
    } catch { setForgotMsg("تعذّر الاتصال بالخادم"); }
    finally { setForgotLoading(false); }
  }
  // تجربة أسبوع
  const [trialOpen, setTrialOpen] = useState(false);
  const [tf, setTf] = useState({ fullName: "", username: "", password: "" });
  const [tErr, setTErr] = useState("");
  const [tLoading, setTLoading] = useState(false);
  const [tDone, setTDone] = useState(false); // طلب التجربة أُرسل وبانتظار الموافقة

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "فشل تسجيل الدخول");
        return;
      }
      // في التطبيق (PWA مثبّت أو التطبيق الأصلي): يبقى الجميع على إدارة الفنيين. وإلا التوجيه حسب الدور.
      window.location.href = isAppMode() ? "/field-management" : (data.redirect ?? "/dashboard");
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }

  async function startTrial(e: React.FormEvent) {
    e.preventDefault();
    setTErr(""); setTLoading(true);
    try {
      const res = await fetch("/api/auth/trial-signup", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tf),
      });
      const data = await res.json();
      if (!res.ok) { setTErr(data.error ?? "تعذّر إنشاء الحساب"); return; }
      setTDone(true); // بانتظار موافقة المالك — لا دخول تلقائي
    } catch { setTErr("تعذّر الاتصال بالخادم"); }
    finally { setTLoading(false); }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-2xl font-bold text-white">
            نت
          </div>
          <h1 className="text-2xl font-bold text-slate-800">SHAKEEB</h1>
          <p className="mt-1 text-sm text-slate-500">
            نظام إدارة وكيل الانترنت
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              اسم المستخدم
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              autoFocus
              autoComplete="username"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              كلمة السر
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 py-2.5 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? "جاري الدخول..." : "تسجيل الدخول"}
          </button>
          <div className="text-center">
            <button type="button" onClick={() => { setForgotOpen(true); setForgotMsg(""); setForgotUser(username); }} className="text-sm text-blue-600 hover:underline">نسيت كلمة السر؟</button>
          </div>
        </form>

        {/* تجربة أسبوع + الصفحة التعريفية — للموقع فقط، تُخفى داخل التطبيق (data-site-only) */}
        <div data-site-only className="mt-5 border-t border-slate-200 pt-4 text-center">
          <p className="mb-2 text-sm text-slate-500">أول مرة؟ جرّب النظام مجاناً</p>
          <button
            onClick={() => { setTrialOpen(true); setTErr(""); }}
            className="w-full rounded-lg border-2 border-emerald-500 bg-emerald-50 py-2.5 font-bold text-emerald-700 transition hover:bg-emerald-100"
          >
            🎁 تجربة مجانية لمدة أسبوع
          </button>
          {/* الصفحة التعريفية — تفتح بتبويب جديد وتبقى صفحة الدخول */}
          <a
            href="/about" target="_blank" rel="noopener"
            className="mt-2 block w-full rounded-lg border-2 border-blue-200 bg-blue-50 py-2.5 text-center font-bold text-blue-700 transition hover:bg-blue-100"
          >
            ✨ اكتشف مزايا SHAKEEB
          </a>
        </div>

        {ownerPhone && (
          <div className="mt-5 border-t border-slate-200 pt-4 text-center text-sm text-slate-500">
            للتواصل والاشتراك: <a href={`tel:${ownerPhone}`} className="font-bold text-blue-600" dir="ltr">{ownerPhone}</a>
          </div>
        )}

        {/* تثبيت تطبيق إدارة الفنيين (يظهر حسب الجهاز، ويختفي إن كان مثبّتاً) */}
        <InstallApp />
      </div>

      {forgotOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setForgotOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-center text-lg font-bold text-slate-800">استرجاع كلمة السر</h2>
            <p className="mb-4 text-center text-xs text-slate-500">أدخل اسم المستخدم؛ سنرسل رابط إعادة التعيين إلى إيميل الاسترجاع المضبوط لحسابك.</p>
            {forgotMsg ? (
              <div className="rounded-lg bg-emerald-50 px-3 py-3 text-center text-sm text-emerald-700">{forgotMsg}</div>
            ) : (
              <form onSubmit={sendForgot} className="space-y-3">
                <input value={forgotUser} onChange={(e) => setForgotUser(e.target.value)} placeholder="اسم المستخدم" dir="ltr" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left outline-none focus:border-blue-500" />
                <button type="submit" disabled={forgotLoading || !forgotUser.trim()} className="w-full rounded-lg bg-blue-600 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{forgotLoading ? "جارٍ الإرسال…" : "إرسال رابط الاسترجاع"}</button>
              </form>
            )}
            <button onClick={() => setForgotOpen(false)} className="mt-3 w-full rounded-lg bg-slate-100 py-2 text-sm font-semibold text-slate-600">إغلاق</button>
          </div>
        </div>
      )}

      {trialOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setTrialOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {tDone ? (
              <div className="text-center">
                <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-4xl">✓</div>
                <h2 className="mb-2 text-xl font-bold text-slate-800">تم استلام طلبك</h2>
                <p className="mb-4 text-sm text-slate-600">حسابك التجريبي <b>بانتظار موافقة الإدارة</b> لتفعيله. سنراجع طلبك قريباً، وبعد الموافقة يمكنك تسجيل الدخول باسم المستخدم وكلمة السر اللذين أدخلتهما.</p>
                <button onClick={() => { setTrialOpen(false); setTDone(false); setTf({ fullName: "", username: "", password: "" }); }} className="w-full rounded-lg bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700">حسناً</button>
              </div>
            ) : (
            <>
            <h2 className="mb-1 text-center text-xl font-bold text-slate-800">🎁 تجربة أسبوع مجاناً</h2>
            <p className="mb-4 text-center text-xs text-slate-500">حساب مدير بمكتب واحد، صالح ٧ أيام بعد الموافقة. أنشئ اسم مستخدم وكلمة سر خاصّين بك.</p>
            {tErr && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-600">{tErr}</div>}
            <form onSubmit={startTrial} className="space-y-3">
              <input placeholder="اسمك / اسم المحل" value={tf.fullName} onChange={(e) => setTf({ ...tf, fullName: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-500" />
              <input placeholder="اسم مستخدم (إنجليزي)" dir="ltr" value={tf.username} onChange={(e) => setTf({ ...tf, username: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left outline-none focus:border-emerald-500" autoComplete="off" />
              <input placeholder="كلمة السر" type="password" dir="ltr" value={tf.password} onChange={(e) => setTf({ ...tf, password: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left outline-none focus:border-emerald-500" autoComplete="new-password" />
              <div className="flex gap-2">
                <button type="submit" disabled={tLoading} className="flex-1 rounded-lg bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                  {tLoading ? "جاري الإنشاء..." : "ابدأ التجربة"}
                </button>
                <button type="button" onClick={() => setTrialOpen(false)} className="rounded-lg bg-slate-100 px-5 py-2.5 font-semibold text-slate-600">إلغاء</button>
              </div>
            </form>
            </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
