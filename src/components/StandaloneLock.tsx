"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isAppMode } from "@/lib/appMode";

// في التطبيق (PWA مثبّت أو التطبيق الأصلي): يحصر التنقّل بإدارة الفنيين لأي حساب.
// المتصفح العادي غير متأثّر (الموقع كامل للمدير/الموظف).
export default function StandaloneLock() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (isAppMode() && pathname && !pathname.startsWith("/field-management")) {
      router.replace("/field-management");
    }
  }, [pathname, router]);
  return null;
}
