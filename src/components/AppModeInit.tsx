"use client";

import { useEffect } from "react";
import { isAppMode } from "@/lib/appMode";

// يضبط html[data-app-mode] على كل الصفحات حين نكون داخل التطبيق (PWA مثبّت أو التطبيق الأصلي).
// سكربت الرأس يضبطه مبكّراً (بلا وميض)؛ هذا احتياط موثوق لأن Capacitor قد يتأخّر لحظة الرأس.
export default function AppModeInit() {
  useEffect(() => {
    if (isAppMode()) document.documentElement.setAttribute("data-app-mode", "");
  }, []);
  return null;
}
