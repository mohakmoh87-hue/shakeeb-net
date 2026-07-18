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
  // رؤوس حماية على كل الصفحات عدا بروكسي SAS المضمّن (/sas/*) — حتى لا تُعطّل أصوله
  async headers() {
    return [
      {
        source: "/:path((?!sas/).*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          // CSP محافظة: تمنع تأطير الموقع بمواقع أخرى وحقن <base>/كائنات، دون تقييد
          // السكربتات/الأنماط/الصور (كي لا تتعطّل أي وظيفة قائمة).
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
