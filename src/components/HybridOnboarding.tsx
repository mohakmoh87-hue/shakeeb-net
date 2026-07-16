"use client";

import { useState } from "react";

// إشعار إعداد الحاسبة ضمن النظام الهجين — يظهر لكل مستخدم غير مدير طالما لا توجد
// حاسبة معتمَدة ومتصلة في النظام (يُحسم من الخادم عبر hybridActive)، فيختفي فور اعتماد
// حاسبة عاملة. تشخيص موثوق لا يعتمد على فحص localhost من المتصفّح.
export default function HybridOnboarding({ isAdmin, hybridActive }: { isAdmin: boolean; hybridActive: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  // المدير لا يحتاجه، ولا يظهر إن كان النظام نشطاً، أو أُخفي لهذه الجلسة
  if (isAdmin || hybridActive || dismissed) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white p-7 text-center shadow-2xl">
        <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-sky-100 text-5xl">🖥️</div>
        <h2 className="mb-2 text-2xl font-extrabold text-sky-700">إعداد النظام الهجين</h2>
        <p className="mb-5 text-slate-600">
          لا توجد بعد حاسبة مكتب معتمَدة ومتصلة في النظام الهجين. لتسريع العمل وتشغيل واتساب،
          ثبّت الوكيل على حاسبة المكتب واعتمِدها — وبعدها لن يظهر هذا الإشعار.
        </p>

        {!showSteps ? (
          <div className="flex gap-2">
            <button onClick={() => setShowSteps(true)} className="flex-1 rounded-xl bg-mynet-blue py-3 text-lg font-bold text-white hover:bg-mynet-blue-dark">
              موافق — إعداد الآن
            </button>
            <button onClick={() => setDismissed(true)} className="rounded-xl bg-slate-100 px-5 py-3 font-semibold text-slate-600 hover:bg-slate-200">
              لاحقاً
            </button>
          </div>
        ) : (
          <div className="text-right">
            <ol className="mb-4 space-y-2.5 text-sm text-slate-700">
              <li className="flex gap-2"><span className="font-bold text-mynet-blue">١.</span> حمّل ملف الإعداد: <a href="/api/hybrid/installer" className="font-bold text-mynet-blue underline">تنزيل وكيل شكيب نت</a></li>
              <li className="flex gap-2"><span className="font-bold text-mynet-blue">٢.</span> شغّله على حاسبة المكتب بنقرة مزدوجة، ووافق على تنبيه ويندوز، والصق رابط قاعدة البيانات.</li>
              <li className="flex gap-2"><span className="font-bold text-mynet-blue">٣.</span> من «حسابات المدير ← حواسيب النظام الهجين» اعتمِد الحاسبة (تفعيل).</li>
            </ol>
            <p className="mb-4 text-xs text-slate-400">يختفي هذا الإشعار تلقائياً فور ظهور حاسبة معتمَدة ومتصلة.</p>
            <button onClick={() => setDismissed(true)} className="w-full rounded-xl bg-slate-100 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-200">
              إخفاء لهذه المرة
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
