"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

// في التطبيق المثبّت (standalone): يحصر التنقّل بإدارة الفنيين لأي حساب.
// المتصفح العادي غير متأثّر (الموقع كامل للمدير/الموظف).
export default function StandaloneLock() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone && pathname && !pathname.startsWith("/field-management")) {
      router.replace("/field-management");
    }
  }, [pathname, router]);
  return null;
}
