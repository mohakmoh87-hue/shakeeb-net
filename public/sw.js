// Service Worker — شكيب نت (تطبيق إدارة الفنيين)
//  • إشعارات Web Push (تعمل والتطبيق مغلق على أندرويد).
//  • تخزين مؤقت network-first: يجلب من الشبكة دائماً (فيظهر التحديث فوراً بلا
//    إعادة تنصيب)، ويرجع من الكاش عند انقطاع الشبكة فقط.

const CACHE = "shakeeb-net-v1";

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

// ===== التخزين المؤقت: network-first لطلبات GET من نفس الأصل (عدا API) =====
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // موارد خارجية: كما هي
  if (url.pathname.startsWith("/api/")) return; // API دائماً من الشبكة (بلا كاش)

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
        if (req.mode === "navigate") {
          const home = await caches.match("/field-management");
          if (home) return home;
        }
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
