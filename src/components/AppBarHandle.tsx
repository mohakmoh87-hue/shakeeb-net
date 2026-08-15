"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isAppMode } from "@/lib/appMode";

// ═════════ مقبضُ شريط الخيارات في التطبيق (طلبُ محمد 2026-08-15) ═════════
//
// بنصّ الطلب: «الازرار … تكون فوق صفحة الحسابات تاخذ ربع الشاشة الاسفل بشكل
// ثابت ودائم وتخفي خلفها خيارات لانها اصلا فوق الصفحة ويجب ان يمكن اخفائها
// وفتحها وليس تكون ثابته ظاهرة دائما».
//
// 🔴 والعلّةُ حقيقيّةٌ لا تفضيل: الشريطُ مُثبَّتٌ **فوق** الصفحة لا داخلَ تدفّقها،
//   فربعُ الشاشة الأسفل يصير محجوباً دائماً — وفي حسابات المدير تحديداً يقع
//   تحته سجلُّ الحركات وأزرارُ الحذف، فتُصبح غيرَ قابلةٍ للبلوغ أصلاً.
//
// 🔑 والحلُّ ورقةٌ تُطوى: الشريطُ منزلقٌ خارجَ الشاشة افتراضاً، ولا يبقى منه إلّا
//   مقبضٌ نحيف. ضغطةٌ ترفعه وضغطةٌ تُعيده — فالربعُ الأسفل مشغولٌ لحظةَ الحاجة
//   وحدَها. والحالةُ وسمٌ على <html> فيتولّى الـCSS الانزلاقَ بلا إعادة رسم.
//
// ولا يظهر المقبضُ إلّا في التطبيق وفي صفحةٍ تحمل شريطاً فعلاً — فصفحةٌ بلا
// خيارات لا يعلوها مقبضٌ فارغ.
//
// ⚠️ ولا يحمل `data-app-only`: قاعدتُه تفرض `display:block !important` فتهدم
//    توسيطَ المقبض (flex). فإخفاؤه في المتصفّح يتولّاه صنفُه في globals.css.
export default function AppBarHandle() {
  const pathname = usePathname();
  const [has, setHas] = useState(false);
  const [open, setOpen] = useState(false);

  // هل في هذه الصفحة شريطٌ أصلاً؟ يُسأل بعد رسم الصفحة، ويُعاد السؤال مع كلّ تنقّل.
  // ⏱️ ويُؤجَّل بإطارَين لأنّ الشريط قد يكون مشروطاً بحالةٍ تصل بعد أوّل رسم
  //    (شريطُ «المحدَّدون» في الديون مثلاً لا يوجد قبل التحديد).
  useEffect(() => {
    if (!isAppMode()) return;
    let alive = true;
    const check = () => { if (alive) setHas(!!document.querySelector("[data-app-bar]")); };
    check();
    const t = window.setTimeout(check, 400);
    // والمراقبُ يلتقط شريطاً يظهر لاحقاً بفعل المستخدم (تحديدُ صفوفٍ مثلاً)
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { alive = false; window.clearTimeout(t); mo.disconnect(); };
  }, [pathname]);

  // يُطوى الشريطُ مع كلّ تنقّلٍ لصفحةٍ جديدة — وإلّا وصل المستخدمُ إلى الصفحة
  // التالية وربعُها الأسفل محجوبٌ بشريطٍ لم يفتحه هو.
  // 📐 والضبطُ أثناء الرسم لا داخل تأثير: `setState` في جسم التأثير يُنتج رسمَين
  //    متتاليَين (وتمنعه قاعدةُ react-hooks/set-state-in-effect هنا).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  // والوسمُ على <html> هو ما يقرؤه الـCSS لينزلق الشريط.
  useEffect(() => {
    const root = document.documentElement;
    if (open) root.setAttribute("data-appbar-open", "1");
    else root.removeAttribute("data-appbar-open");
    return () => root.removeAttribute("data-appbar-open");
  }, [open]);

  if (!has) return null;

  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      aria-label={open ? "إخفاء الخيارات" : "إظهار الخيارات"}
      className="app-bar-handle"
    >
      <span className="app-bar-grip" aria-hidden="true" />
      <span>{open ? "إخفاء الخيارات" : "الخيارات"}</span>
    </button>
  );
}
