"use client";

import { useEffect, useState } from "react";
import InstallApp from "@/components/InstallApp";

// صفحة تسجيل الدخول بالطراز الجديد (رموز .nst من النموذج المعتمد) — المنطق كما هو:
// دخول + نسيت كلمة السر + تجربة أسبوع + الصفحة التعريفية + رقم التواصل + تثبيت التطبيق.
// الشعار أعلى النافذة يبدّله السوبر أدمن من «⚙️ حسابي» بلوحة المالك (طلب محمد 2026-07-29).
export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ownerPhone, setOwnerPhone] = useState("");
  const [logo, setLogo] = useState<string | null>(null); // شعار الدخول (يبدّله السوبر أدمن)
  // نسيت كلمة السر
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotUser, setForgotUser] = useState("");
  const [forgotMsg, setForgotMsg] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  useEffect(() => {
    fetch("/api/public/contact").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.phone) setOwnerPhone(d.phone); });
    fetch("/api/public/login-logo").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.logo) setLogo(d.logo); }).catch(() => {});
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
      // 🔴 كان: `isAppMode() ? "/field-management" : …` — أي أنّ التطبيقَ **يطمس وجهةَ الخادم**
      //   لكلّ حساب. والخادمُ يعرف الدورَ ويقولُه: الفنيُّ يُردّ بـ`/field-management`
      //   والمستخدمُ بوجهته. فطلبُ محمد (2026-08-15) أن يدخل المديرُ كاملَ الموقع من التطبيق
      //   «مثل التسجيل العادي» ⇒ تُحتَرم وجهةُ الخادم دائماً، والحصرُ يبقى على الفنيّ وحدَه
      //   (يفرضه `StandaloneLock` بسؤال `/api/me`).
      window.location.href = data.redirect ?? "/dashboard";
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
    <main className="nst flex min-h-screen items-center justify-center p-4" style={{ background: "var(--ground)" }}>
      {/* أنماط الطراز الجديد لعناصر الدخول (نفس لمسات النموذج: حدود line وتركيز navy وزر متدرّج) */}
      <style>{`
        .lg-inp{width:100%;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:10px;padding:10px 12px;font-size:14px;outline:none;transition:border-color .15s,box-shadow .15s}
        .lg-inp:focus{border-color:var(--navy-3);box-shadow:0 0 0 3px rgba(42,84,128,.14)}
        .lg-lb{display:block;margin-bottom:4px;font-size:12px;font-weight:700;color:var(--ink-2)}
        .lg-btn{width:100%;border-radius:10px;padding:11px;font-weight:800;font-size:15px;color:#fff;background:linear-gradient(135deg,var(--navy-3),var(--navy));box-shadow:var(--sh);transition:filter .15s}
        .lg-btn:hover{filter:brightness(1.08)}
        .lg-btn:disabled{opacity:.6}
      `}</style>

      <div className="w-full max-w-md rounded-2xl border p-8" style={{ background: "var(--surface)", borderColor: "var(--line)", boxShadow: "var(--sh-lg)" }}>
        <div className="mb-7 text-center">
          {/* الشعار: المخصّص من السوبر أدمن، وإلا الافتراضي */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo ?? "/icons/logo.png"} alt="SHAKEEB" className="mx-auto mb-3 h-[72px] w-[72px] rounded-2xl object-cover shadow-md" />
          <h1 className="text-2xl font-extrabold" style={{ color: "var(--ink)" }}>SHAKEEB</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>نظام إدارة وكيل الانترنت</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="lg-lb">اسم المستخدم</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="lg-inp" autoFocus autoComplete="username" />
          </div>
          <div>
            <label className="lg-lb">كلمة السر</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="lg-inp" autoComplete="current-password" />
          </div>

          {error && (
            <div className="rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: "rgba(229,56,79,.08)", color: "var(--bad)" }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="lg-btn">
            {loading ? "جاري الدخول..." : "تسجيل الدخول"}
          </button>
          <div className="text-center">
            <button type="button" onClick={() => { setForgotOpen(true); setForgotMsg(""); setForgotUser(username); }} className="text-sm font-semibold hover:underline" style={{ color: "var(--navy-3)" }}>نسيت كلمة السر؟</button>
          </div>
        </form>

        {/* تجربة أسبوع + الصفحة التعريفية — للموقع فقط، تُخفى داخل التطبيق (data-site-only) */}
        <div data-site-only className="mt-5 border-t pt-4 text-center" style={{ borderColor: "var(--line)" }}>
          <p className="mb-2 text-sm" style={{ color: "var(--muted)" }}>أول مرة؟ جرّب النظام مجاناً</p>
          <button
            onClick={() => { setTrialOpen(true); setTErr(""); }}
            className="w-full rounded-[10px] border-2 py-2.5 font-bold transition hover:brightness-95"
            style={{ borderColor: "var(--ok)", color: "var(--ok)", background: "rgba(15,166,120,.07)" }}
          >
            🎁 تجربة مجانية لمدة أسبوع
          </button>
          {/* الصفحة التعريفية — تفتح بتبويب جديد وتبقى صفحة الدخول */}
          <a
            href="/about" target="_blank" rel="noopener"
            className="mt-2 block w-full rounded-[10px] border-2 py-2.5 text-center font-bold transition hover:brightness-95"
            style={{ borderColor: "var(--navy-3)", color: "var(--navy-ink)", background: "rgba(42,84,128,.07)" }}
          >
            ✨ اكتشف مزايا النظام
          </a>
        </div>

        {ownerPhone && (
          <div className="mt-5 border-t pt-4 text-center text-sm" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
            للتواصل والاشتراك: <a href={`tel:${ownerPhone}`} className="font-bold" style={{ color: "var(--navy-3)" }} dir="ltr">{ownerPhone}</a>
          </div>
        )}

        {/* تثبيت تطبيق إدارة الفنيين (يظهر حسب الجهاز، ويختفي إن كان مثبّتاً) */}
        <InstallApp />
      </div>

      {forgotOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setForgotOpen(false)}>
          <div className="max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-2xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--line)", boxShadow: "var(--sh-lg)" }} onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-center text-lg font-bold" style={{ color: "var(--ink)" }}>استرجاع كلمة السر</h2>
            <p className="mb-4 text-center text-xs" style={{ color: "var(--muted)" }}>أدخل اسم المستخدم؛ سنرسل رابط إعادة التعيين إلى إيميل الاسترجاع المضبوط لحسابك.</p>
            {forgotMsg ? (
              <div className="rounded-lg px-3 py-3 text-center text-sm font-semibold" style={{ background: "rgba(15,166,120,.08)", color: "var(--ok)" }}>{forgotMsg}</div>
            ) : (
              <form onSubmit={sendForgot} className="space-y-3">
                <input value={forgotUser} onChange={(e) => setForgotUser(e.target.value)} placeholder="اسم المستخدم" dir="ltr" className="lg-inp text-left" />
                <button type="submit" disabled={forgotLoading || !forgotUser.trim()} className="lg-btn">{forgotLoading ? "جارٍ الإرسال…" : "إرسال رابط الاسترجاع"}</button>
              </form>
            )}
            <button onClick={() => setForgotOpen(false)} className="mt-3 w-full rounded-lg py-2 text-sm font-semibold" style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}>إغلاق</button>
          </div>
        </div>
      )}

      {trialOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setTrialOpen(false)}>
          <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-2xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--line)", boxShadow: "var(--sh-lg)" }} onClick={(e) => e.stopPropagation()}>
            {tDone ? (
              <div className="text-center">
                <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full text-4xl" style={{ background: "rgba(15,166,120,.12)", color: "var(--ok)" }}>✓</div>
                <h2 className="mb-2 text-xl font-bold" style={{ color: "var(--ink)" }}>تم استلام طلبك</h2>
                <p className="mb-4 text-sm" style={{ color: "var(--ink-2)" }}>حسابك التجريبي <b>بانتظار موافقة الإدارة</b> لتفعيله. سنراجع طلبك قريباً، وبعد الموافقة يمكنك تسجيل الدخول باسم المستخدم وكلمة السر اللذين أدخلتهما.</p>
                <button onClick={() => { setTrialOpen(false); setTDone(false); setTf({ fullName: "", username: "", password: "" }); }} className="lg-btn" style={{ background: "var(--ok)" }}>حسناً</button>
              </div>
            ) : (
            <>
            <h2 className="mb-1 text-center text-xl font-bold" style={{ color: "var(--ink)" }}>🎁 تجربة أسبوع مجاناً</h2>
            <p className="mb-2 text-center text-xs" style={{ color: "var(--muted)" }}>صالح ٧ أيام بعد الموافقة. أنشئ اسم مستخدم وكلمة سر خاصّين بك.</p>
            <div className="mb-4 rounded-lg px-3 py-2 text-center text-xs font-semibold" style={{ background: "rgba(15,166,120,.08)", color: "var(--ok)" }}>
              يمنحك الحساب التجريبي: مكتب واحد · مدير واحد · مستخدم واحد · ٣ فنيين · ٣٠٠٠ مشترك فقط.
            </div>
            {tErr && <div className="mb-3 rounded-lg px-3 py-2 text-center text-sm font-semibold" style={{ background: "rgba(229,56,79,.08)", color: "var(--bad)" }}>{tErr}</div>}
            <form onSubmit={startTrial} className="space-y-3">
              <input placeholder="اسمك / اسم المحل" value={tf.fullName} onChange={(e) => setTf({ ...tf, fullName: e.target.value })} className="lg-inp" />
              <input placeholder="اسم مستخدم (إنجليزي)" dir="ltr" value={tf.username} onChange={(e) => setTf({ ...tf, username: e.target.value })} className="lg-inp text-left" autoComplete="off" />
              <input placeholder="كلمة السر" type="password" dir="ltr" value={tf.password} onChange={(e) => setTf({ ...tf, password: e.target.value })} className="lg-inp text-left" autoComplete="new-password" />
              <div className="flex gap-2">
                <button type="submit" disabled={tLoading} className="lg-btn flex-1" style={{ background: "var(--ok)" }}>
                  {tLoading ? "جاري الإنشاء..." : "ابدأ التجربة"}
                </button>
                <button type="button" onClick={() => setTrialOpen(false)} className="rounded-[10px] px-5 py-2.5 font-semibold" style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}>إلغاء</button>
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
