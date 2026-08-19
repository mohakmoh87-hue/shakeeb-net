"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isAppMode } from "@/lib/appMode";

// في التطبيق (PWA مثبّت أو التطبيق الأصلي): يحصر التنقّل بإدارة الفنيين لأي حساب.
// المتصفح العادي غير متأثّر (الموقع كامل للمدير/الموظف).
//
// ═════════ 🧪 وتحت علَم التجربة (trialSkin) سلوكُ الطراز الجديد ═════════
//
// بنصّ طلب محمد (2026-08-15): «دخولُ الفنيّ يكون فقط على صفحة إدارة الفنيّين، أمّا
// إذا سُجّل بيوزر مدير فيجب الدخولُ إلى كامل الموقع مثل التسجيل العادي».
//
// 🔑 والتمييزُ من الخادم لا من الواجهة: جلسةُ الفنيّ نوعٌ آخر (`kind: "technician"`)
//   ولا يراها `/api/me` — فيردّ ٤٠١. فنجاحُ `/api/me` = مستخدمٌ حقيقيّ (مديرٌ أو
//   موظّف) ⇒ لا قفل. ⏸️ ولا قرارَ قبل الجواب: القفلُ الفوريُّ كان سيقذف المديرَ
//   قبل أن نعرف مَن هو.
//
// 🎨 ومعه وسمُ الدور `html[data-app-role]`: ملفُّ الأنماط يُظهر واجهةَ الموقع للمدير
//   في التطبيق (`[data-site-chrome]`)، ولولاه لَدخل كاملَ الموقع بلا قائمةِ تنقّل.
//
// 🛡️ وبلا العلَم: السلوكُ الحاليُّ حرفاً بحرف — فالإنتاجُ (تطبيقُ الفنيّين وكلُّ
//   PWA مثبّت) لا يتغيّر فيه شيء. وعند اعتماد الطراز يُحذف شرطُ العلَم فقط.
export default function StandaloneLock() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!isAppMode()) return;
    // 📜 اعتمادُ الطراز (عقد محمد 2026-08-19): في وضع التطبيق يُحسم كلُّ شيءٍ بالدور من
    //   الخادم دائماً — الفنيُّ محصورٌ بلا ثوبٍ (تجربتُه القديمة حرفيّاً)، والمديرُ حرٌّ
    //   بالثوب الكامل. لا مسارَ «قديمَ» بعدُ: مصيرُ الفنيّ في الفرعَين واحدٌ (القذفُ
    //   لصفحته) فسلوكُه لم يتغيّر ذرّة.
    let alive = true;
    fetch("/api/me")
      .then((r) => {
        if (!alive) return;
        const root = document.documentElement;
        if (r.ok) {
          // مستخدمٌ حقيقيّ (مدير/موظّف) ⇒ التطبيقُ يفتح كلَّ الموقع، وتظهر قائمةُ التنقّل
          root.setAttribute("data-app-role", "manager");
          // مديرٌ مسجَّلٌ من قبل الاعتماد (لا كعكةَ عنده): تُزرع الكعكةُ الآن ويُشعل
          //   الوسمُ فوراً — وأوّلُ مرّةٍ فقط تُنعَش الصفحةُ ليكتمل الثوبُ من رأسه،
          //   فلا إعادةَ تنصيبٍ ولا إعادةَ دخول (شرطا محمد ٢ و٣).
          try {
            if (!document.cookie.split("; ").includes("appSkin=1")) {
              document.cookie = "appSkin=1; Max-Age=31536000; Path=/; SameSite=Lax";
              root.setAttribute("data-app-trial", "");
              if (!sessionStorage.getItem("appSkinBoot")) {
                sessionStorage.setItem("appSkinBoot", "1");
                window.location.reload();
                return;
              }
            }
          } catch { /* كعكاتٌ محجوبة؟ الوسمُ يوضع أدناه على كلّ حال */ }
          root.setAttribute("data-app-trial", "");
          // 🔴 بلاغ محمد 2026-08-19: «لازال يوجهني الى ادارة الفنيين وليس الرئيسية» —
          //   الأيقونةُ المثبَّتةُ تحمل start_url القديم (/field-management) وكروم يُحدّث
          //   البيانَ بكسل. فأوّلُ هبوطٍ في الجلسة إن كان مديراً على صفحة الفنيّين
          //   يُحوَّل للرئيسيّة **مرّةً واحدة** — وتنقّلُه إليها بعد ذلك حرٌّ لا يُمَسّ.
          try {
            if (!sessionStorage.getItem("trialEntryDone")) {
              sessionStorage.setItem("trialEntryDone", "1");
              if (pathname === "/field-management") router.replace("/dashboard");
            }
          } catch { /* تخزينُ الجلسة محجوبٌ؟ نتجاهل — يبقى السلوكُ القديم */ }
          return;
        }
        // فنيٌّ (أو بلا جلسة) ⇒ التطبيقُ شاشةٌ واحدة كما هو
        root.setAttribute("data-app-role", "tech");
        // 📜 عقدُ محمد (2026-08-19): «لا تغير اي شيء في تسجيل دخول الفني اطلاقا» —
        //   حتى على جهاز التجربة نفسِه: جلسةُ الفنيّ تُطفئ علَمَ الطراز كلّيّاً فيرى
        //   الفنيُّ تجربتَه الأصليّةَ حرفيّاً، وكلُّ الجديد يبقى للمدير وحدَه.
        root.removeAttribute("data-app-trial");
        if (pathname && !pathname.startsWith("/field-management")) router.replace("/field-management");
      })
      .catch(() => { /* تعذّر السؤال ⇒ لا نقفل ولا نفتح: يبقى الحالُ كما هو */ });
    return () => { alive = false; };
  }, [pathname, router]);
  return null;
}
