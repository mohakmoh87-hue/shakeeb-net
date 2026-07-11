import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // undici يُحمَّل كحزمة Node خارجية (لتكامل SAS4 مع الشهادات الموقّعة ذاتياً)
  serverExternalPackages: ["undici", "whatsapp-web.js", "puppeteer", "puppeteer-core", "qrcode"],
  // استبعاد مكتبات العامل الثقيلة (واتساب/متصفّح) من حزم دوال الاستضافة (Vercel) —
  // فهي تعمل على حواسيب المكاتب المحلية فقط، وإدراجها يضخّم الدوال ويُفشل النشر.
  outputFileTracingExcludes: {
    "*": [
      "node_modules/whatsapp-web.js/**",
      "node_modules/puppeteer/**",
      "node_modules/puppeteer-core/**",
      "node_modules/@puppeteer/**",
    ],
  },
};

export default nextConfig;
