"use client";

import { useEffect } from "react";

// طباعة تلقائية فورية عند فتح صفحة الوصل (بلا ضغط زر). مع تشغيل المتصفح بوضع
// «kiosk-printing» تتمّ الطباعة صامتة على الطابعة الافتراضية بلا نافذة حوار.
export default function AutoPrint() {
  useEffect(() => {
    // مهلة قصيرة كي يكتمل رسم الوصل والشعار قبل الطباعة
    const t = setTimeout(() => { try { window.print(); } catch { /* تجاهل */ } }, 500);
    return () => clearTimeout(t);
  }, []);
  return null;
}
