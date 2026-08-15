"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isAppMode } from "@/lib/appMode";

// ═════════ مَن يُحصَر في «إدارة الفنيّين» داخل التطبيق؟ (طلبُ محمد 2026-08-15) ═════════
//
// بنصّ الطلب: «دخولُ الفنيّ يكون فقط على صفحة إدارة الفنيّين، أمّا إذا سُجّل بيوزر مدير
// فيجب الدخولُ إلى كامل الموقع مثل التسجيل العادي».
//
// 🔴 وكان القفلُ يضرب **كلَّ حساب**: `if (isAppMode() && !pathname.startsWith("/field-management"))`
//   ⇒ المديرُ الذي يفتح التطبيق يُقذَف إلى شاشة الفنيّين مهما ضغط، فلا يرى تقريراً ولا
//   صندوقاً ولا زرَّ «حضور الفنيين» الجديد (وهي شكوى محمد في النقطة ٣ حرفيّاً — والسببُ
//   هذا السطرُ لا نقصٌ في الزرّ).
//
// 🔑 والتمييزُ من الخادم لا من الواجهة: جلسةُ الفنيّ نوعٌ آخر (`kind: "technician"`) ولا
//   يراها `/api/me` — فيردّ ٤٠١. فنجاحُ `/api/me` = مستخدمٌ حقيقيّ (مديرٌ أو موظّف) ⇒ لا قفل.
//
// ⏸️ ولا قرارَ قبل الجواب: القفلُ الفوريُّ كان سيقذف المديرَ قبل أن نعرف مَن هو. فلا شيء
//   يقع حتى يصل الردّ — والتأخيرُ جزءٌ من ثانيةٍ على شبكةٍ محلّيّة.
//
// 🎨 ومعه وسمُ الدور `html[data-app-role]`: ملفُّ الأنماط يُخفي واجهةَ الموقع في التطبيق
//   (`[data-site-chrome]`)، ولولا هذا الوسمُ لَدخل المديرُ كاملَ الموقع **بلا قائمةِ تنقّل**
//   — أي «فُتح له كلُّ شيء ولا يستطيع بلوغَ شيء».
export default function StandaloneLock() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isAppMode()) return;
    let alive = true;
    fetch("/api/me")
      .then((r) => {
        if (!alive) return;
        const root = document.documentElement;
        if (r.ok) {
          // مستخدمٌ حقيقيّ (مدير/موظّف) ⇒ التطبيقُ يفتح كلَّ الموقع، وتظهر قائمةُ التنقّل
          root.setAttribute("data-app-role", "manager");
          return;
        }
        // فنيٌّ (أو بلا جلسة) ⇒ التطبيقُ شاشةٌ واحدة كما هو
        root.setAttribute("data-app-role", "tech");
        if (pathname && !pathname.startsWith("/field-management")) router.replace("/field-management");
      })
      .catch(() => { /* تعذّر السؤال ⇒ لا نقفل ولا نفتح: يبقى الحالُ كما هو */ });
    return () => { alive = false; };
  }, [pathname, router]);

  return null;
}
