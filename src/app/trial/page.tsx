"use client";

import { useEffect, useState } from "react";
import { hasTrialSkin, setTrialSkin } from "@/components/trialSkin";

// ═════════ 🧪 صفحةُ تجربة طراز التطبيق (طلبُ محمد 2026-08-19) ═════════
//
// «اريد انشاء تطبيق احمله في هاتفي لاجربه وحدي ونجري التعديلات عليه واذا تمت
// جميع التعديلات فيهمل هذا التطبيق وتتم نفس التعديلات على التطبيق الحالي».
//
// المفتاحُ كعكةٌ على هذا الجهاز وحدَه — لا صفَّ قاعدةٍ ولا أثرَ على غيره.
// والصفحةُ للمدير: جلسةُ الفنيّ لا يراها /api/me فيُرَدّ عنها.
// لا رابطَ يقود إلى هنا — تُفتح بكتابة /trial يدويّاً.
export default function TrialPage() {
  const [me, setMe] = useState<"loading" | "ok" | "no">("loading");
  const [on, setOn] = useState(false);

  useEffect(() => {
    // قراءةُ الكعكة داخل ردّ الشبكة لا في جسم التأثير (قاعدة set-state-in-effect)
    fetch("/api/me")
      .then((r) => { setMe(r.ok ? "ok" : "no"); setOn(hasTrialSkin()); })
      .catch(() => { setMe("no"); setOn(hasTrialSkin()); });
  }, []);

  if (me === "loading") return <div className="p-8 text-center text-slate-500">لحظة…</div>;
  if (me === "no") {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-3xl">🔒</div>
          <p className="mt-2 font-bold text-slate-700">هذه صفحةُ تجربةٍ داخليّةٌ للمدير</p>
          <p className="mt-1 text-sm text-slate-500">سجّل دخولَ مديرٍ أوّلاً ثمّ افتحها ثانية.</p>
        </div>
      </div>
    );
  }

  const flip = (next: boolean) => {
    setTrialSkin(next);
    // الوسمُ يوضع/يُرفع فوراً بلا انتظار إعادة تحميل — والسكربتُ المبكّر يثبّته لاحقاً
    if (next) document.documentElement.setAttribute("data-app-trial", "");
    else document.documentElement.removeAttribute("data-app-trial");
    setOn(next);
  };

  return (
    <div className="mx-auto max-w-md p-5" dir="rtl">
      <h1 className="text-xl font-extrabold text-slate-800">🧪 تجربةُ طراز التطبيق</h1>
      <p className="mt-1 text-sm text-slate-500">
        العلَمُ يخصّ <b>هذا الجهازَ وحدَه</b> — المدراءُ والفنيّون وتطبيقُهم لا يتغيّر عندهم شيء.
      </p>

      <div className={`mt-4 rounded-xl border p-4 shadow-sm ${on ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"}`}>
        <p className="font-bold">{on ? "✅ التجربةُ مُشغَّلةٌ على هذا الجهاز" : "⭘ التجربةُ مُطفأة"}</p>
        <button
          onClick={() => flip(!on)}
          className={`mt-3 w-full rounded-lg px-4 py-2.5 font-bold text-white ${on ? "bg-slate-500 hover:bg-slate-600" : "bg-mynet-blue hover:bg-mynet-blue-dark"}`}
        >
          {on ? "إيقاف التجربة" : "تشغيل التجربة على هذا الجهاز"}
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm leading-7 text-slate-600 shadow-sm">
        <p className="font-bold text-slate-700">📱 لتحويلها «تطبيقاً» على هاتفك:</p>
        <ol className="mt-1 list-decimal pr-5">
          <li>شغّل التجربةَ بالزرّ أعلاه</li>
          <li>من قائمة كروم (⋮) اختر <b>«إضافة إلى الشاشة الرئيسيّة»</b></li>
          <li>افتح الأيقونةَ الجديدة وسجّل دخولَك — هذا هو تطبيقُ التجربة</li>
        </ol>
        <p className="mt-2 text-xs text-slate-400">
          وعند اكتمال التعديلات: تُعتَمد على التطبيق الحقيقيّ بتبديل مفتاحٍ واحد، وتحذف الأيقونةَ التجريبيّة.
        </p>
      </div>
    </div>
  );
}
