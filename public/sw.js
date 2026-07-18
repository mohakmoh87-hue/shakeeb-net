// Service Worker — إشعارات Web Push لتطبيق إدارة الفنيين (شكيب نت).
// يعمل والتطبيق مغلق على أندرويد. (التخزين المؤقت network-first يُضاف في مرحلة لاحقة.)

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = { title: "شكيب نت", body: "", tag: "field", url: "/field-management" };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (_) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
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
