"use client";

import { useEffect, useState } from "react";

// منفذ الوكيل المحلي (يستمع عليه برنامج شكيب نت المُنصَّب على حاسبة المكتب)
const AGENT_PORT = 47615;
const DISMISS_KEY = "shakeebnet_agent_installed"; // علامة إخفاء دائم لهذه الحاسبة/المتصفّح

// إشعار إعداد الحاسبة ضمن النظام الهجين — يظهر لكل مستخدم غير مدير عند كل دخول.
// يتوقّف تلقائياً فور اكتشاف الوكيل على localhost، أو يدوياً عبر زرّ «تم التثبيت» (لمتصفّحات
// تحجب فحص localhost من صفحة https رغم أن الوكيل شغّال).
export default function HybridOnboarding({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState<"checking" | "installed" | "missing">("checking");
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    if (isAdmin) return; // المدير لا يحتاج تنصيب الوكيل
    // إخفاء دائم إن أكّد المستخدم التثبيت سابقاً على هذه الحاسبة
    try { if (localStorage.getItem(DISMISS_KEY) === "1") { setStatus("installed"); return; } } catch { /* ignore */ }
    let alive = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1800);
    // localhost معفى من حظر المحتوى المختلط؛ الوكيل يردّ برؤوس PNA/CORS المناسبة
    fetch(`http://127.0.0.1:${AGENT_PORT}/health`, { signal: ctrl.signal, mode: "cors", cache: "no-store" })
      .then((r) => { if (alive) setStatus(r.ok ? "installed" : "missing"); })
      .catch(() => { if (alive) setStatus("missing"); })
      .finally(() => clearTimeout(timer));
    return () => { alive = false; ctrl.abort(); clearTimeout(timer); };
  }, [isAdmin]);

  function dismissForever() {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setStatus("installed");
  }

  // لا يظهر للمدير، ولا أثناء الفحص، ولا عند اكتشاف الوكيل مُنصَّباً
  if (isAdmin || status !== "missing") return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white p-7 text-center shadow-2xl">
        <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-sky-100 text-5xl">🖥️</div>
        <h2 className="mb-2 text-2xl font-extrabold text-sky-700">إعداد هذه الحاسبة</h2>
        <p className="mb-5 text-slate-600">
          هذه الحاسبة ليست بعد ضمن نظام شكيب نت الهجين. لتسريع العمل وتشغيل واتساب من هذا المكتب،
          ثبّت الوكيل لمرّة واحدة — وبعدها لن يظهر هذا الإشعار مجدداً.
        </p>

        {!showSteps ? (
          <div className="flex gap-2">
            <button onClick={() => setShowSteps(true)} className="flex-1 rounded-xl bg-mynet-blue py-3 text-lg font-bold text-white hover:bg-mynet-blue-dark">
              موافق — إعداد الآن
            </button>
            <button onClick={() => setStatus("installed")} className="rounded-xl bg-slate-100 px-5 py-3 font-semibold text-slate-600 hover:bg-slate-200">
              لاحقاً
            </button>
          </div>
        ) : (
          <div className="text-right">
            <ol className="mb-4 space-y-2.5 text-sm text-slate-700">
              <li className="flex gap-2"><span className="font-bold text-mynet-blue">١.</span> حمّل ملف الإعداد: <a href="/api/hybrid/installer" className="font-bold text-mynet-blue underline">تنزيل وكيل شكيب نت</a></li>
              <li className="flex gap-2"><span className="font-bold text-mynet-blue">٢.</span> شغّل الملف بنقرة مزدوجة ووافق على تنبيه ويندوز.</li>
              <li className="flex gap-2"><span className="font-bold text-mynet-blue">٣.</span> امسح رمز واتساب (QR) بهاتف المكتب عند طلبه.</li>
            </ol>
            <p className="mb-3 text-xs text-slate-400">يختفي تلقائياً فور تشغيل الوكيل. وإن ثبّتّه ولم يختفِ (بعض المتصفّحات تحجب الفحص) اضغط الزرّ الأخضر لإخفائه نهائياً على هذه الحاسبة.</p>
            <button onClick={dismissForever} className="mb-2 w-full rounded-xl bg-emerald-600 py-3 font-bold text-white hover:bg-emerald-700">
              ✅ تم التثبيت — أخفِ نهائياً على هذه الحاسبة
            </button>
            <button onClick={() => setStatus("installed")} className="w-full rounded-xl bg-slate-100 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-200">
              إخفاء لهذه المرة فقط
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
