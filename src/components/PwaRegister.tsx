"use client";

import { useEffect } from "react";

// يسجّل عامل الخدمة عند الإقلاع (للتخزين المؤقت network-first + استقبال Push).
export default function PwaRegister() {
  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
