import type { CapacitorConfig } from "@capacitor/cli";

// غلاف التطبيق الأصلي (Capacitor) لتطبيق إدارة الفنيين.
// يحمّل الموقع الحيّ مباشرةً، فيصل التحديث تلقائياً بلا إعادة بناء الـapk.
// الإضافات الأصلية (موقع الخلفية/الإشعارات) تُضاف لاحقاً وتُستدعى من كود الويب عبر جسر Capacitor.
const config: CapacitorConfig = {
  appId: "com.shakeebnet.field",
  appName: "SHAKEEB",
  webDir: "native/www",
  server: {
    url: "https://shakeebnet.com/field-management",
    cleartext: false,
  },
  android: {
    // مخطط https للجسر (لا يؤثر على تحميل الموقع البعيد)
    allowMixedContent: false,
  },
};

export default config;
