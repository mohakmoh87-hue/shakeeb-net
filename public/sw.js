// Service Worker — شكيب نت (تطبيق إدارة الفنيين)
//  • إشعارات Web Push (تعمل والتطبيق مغلق على أندرويد).
//  • التخزين المؤقت للملفات الثابتة فقط (سكربتات/أيقونات) — صفحات HTML لا تُخزَّن
//    أبداً: كانت تُخزَّن بأرقام جلسة صاحبها فتظهر لحظياً لمن يدخل بحساب آخر على
//    نفس المتصفح عند تعثّر الشبكة (حادثة عزل الوكلاء 2026-07-29) — سُدَّت نهائياً.

const CACHE = "shakeeb-net-v2"; // رفع الإصدار يمسح كاش v1 القديم (وفيه صفحات مخزونة) عند التفعيل

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// الملفات الآمنة للتخزين: ثابتة لا تحمل بيانات جلسة/وكيل
function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.ico"
  );
}

// ===== التخزين المؤقت: network-first للملفات الثابتة فقط (عدا API والصفحات) =====
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // موارد خارجية: كما هي
  if (!isStaticAsset(url)) return; // API والصفحات: دائماً من الشبكة (بلا كاش إطلاقاً)

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok && res.type === "basic") {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
        }
        return res;
      } catch (_) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw _;
      }
    })()
  );
});

// ===== إشعارات Web Push =====
self.addEventListener("push", (event) => {
  let data = { title: "شكيب نت", body: "", tag: "field", url: "/field-management" };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (_) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      dir: "rtl",
      lang: "ar",
      renotify: true,
      data: { url: data.url || "/field-management" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/field-management";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) { if ("focus" in w) { w.navigate(url); return w.focus(); } }
      return self.clients.openWindow(url);
    })
  );
});
