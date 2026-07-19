import type { MetadataRoute } from "next";

// بيان تطبيق الويب (PWA) — يجعل الموقع قابلاً للتثبيت كتطبيق مستقلّ.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SHAKEEB — إدارة الفنيين",
    short_name: "SHAKEEB",
    description: "تطبيق إدارة الفنيين: الحضور والإجازات والرواتب والإشعارات",
    start_url: "/field-management",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0e3039",
    theme_color: "#0f6fbf",
    lang: "ar",
    dir: "rtl",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // يسمح لـ getInstalledRelatedApps بكشف أنّ هذا الـPWA مثبّت (فنعرض «افتحه» بدل إعادة التثبيت)
    related_applications: [{ platform: "webapp", url: "https://shakeebnet.com/manifest.webmanifest" }],
    prefer_related_applications: false,
  };
}
