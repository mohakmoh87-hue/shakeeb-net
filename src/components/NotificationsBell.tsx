"use client";

import { useCallback, useEffect, useState } from "react";
import { isNativeApp, getFcmToken } from "@/lib/nativeTracking";

type Notif = { id: number; type: string; title: string; body: string; read: boolean; createdAt: string };
const ICON: Record<string, string> = { checkin: "🟢", checkout: "🔴", leave: "📅", deduction: "💠" };
const fmt = (d: string) => new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function urlB64ToUint8Array(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// جرس إشعارات المدير: قائمة الأحداث + بشارة غير المقروء + تفعيل إشعارات الهاتف (Web Push).
export default function NotificationsBell() {
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [push, setPush] = useState<"unsupported" | "off" | "denied" | "on" | "busy">("off");

  const load = useCallback(() => {
    fetch("/api/field/notifications").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return; setItems(d.notifications ?? []); setUnread(d.unread ?? 0);
    });
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);

  // حالة اشتراك Push الحالية
  useEffect(() => {
    // التطبيق الأصلي: WebView لا يدعم Web Push — نستعمل FCM (زرّ التفعيل يسجّل رمز الجهاز)
    if (isNativeApp()) { setPush(localStorage.getItem("fcmOn") === "1" ? "on" : "off"); return; }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) { setPush("unsupported"); return; }
    if (Notification.permission === "denied") { setPush("denied"); return; }
    navigator.serviceWorker.getRegistration().then((reg) => reg?.pushManager.getSubscription()).then((sub) => setPush(sub ? "on" : "off")).catch(() => {});
  }, []);

  async function openList() {
    setOpen(true);
    if (unread > 0) { await fetch("/api/field/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" }); setUnread(0); setItems((xs) => xs.map((x) => ({ ...x, read: true }))); }
  }

  async function enablePush() {
    // التطبيق الأصلي: سجّل رمز FCM (WebView لا يدعم Web Push)
    if (isNativeApp()) {
      setPush("busy");
      const token = await getFcmToken();
      if (!token) { setPush("off"); alert("تعذّر الحصول على رمز الإشعارات — تأكّد من السماح بالإشعارات في إعدادات التطبيق"); return; }
      const r = await fetch("/api/push/fcm-token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => null);
      if (r?.ok) { localStorage.setItem("fcmOn", "1"); setPush("on"); } else setPush("off");
      return;
    }
    if (push === "unsupported") { alert("هذا الجهاز/المتصفح لا يدعم الإشعارات"); return; }
    setPush("busy");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setPush(perm === "denied" ? "denied" : "off"); return; }
      const { publicKey } = await fetch("/api/push/vapid").then((r) => r.json());
      if (!publicKey) { alert("الإشعارات غير مفعّلة على الخادم بعد (مفاتيح VAPID)"); setPush("off"); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) });
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const r = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys }) });
      setPush(r.ok ? "on" : "off");
    } catch { setPush("off"); }
  }

  return (
    <>
      <button onClick={openList} className="relative rounded-lg bg-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/30" title="الإشعارات">
        🔔
        {unread > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white ring-2 ring-black/25">{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-3" onClick={() => setOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">🔔 الإشعارات</h3>
              <button onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
            </div>

            {/* تفعيل إشعارات الهاتف */}
            {push !== "on" && (
              <button onClick={enablePush} disabled={push === "busy"} className="mb-3 w-full rounded-xl bg-mynet-blue py-2.5 text-sm font-bold text-white hover:bg-mynet-blue-dark disabled:opacity-60">
                {push === "busy" ? "..." : push === "denied" ? "الإشعارات محظورة — فعّلها من إعدادات المتصفح" : "📲 تفعيل إشعارات الهاتف"}
              </button>
            )}
            {push === "on" && <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-center text-xs font-semibold text-emerald-700">✓ إشعارات الهاتف مُفعّلة</div>}

            {items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">لا إشعارات</div>
            ) : (
              <ul className="space-y-1.5">
                {items.map((n) => (
                  <li key={n.id} className={`rounded-lg border px-3 py-2 ${n.read ? "border-slate-200 bg-white" : "border-mynet-blue/30 bg-blue-50/50"}`}>
                    <div className="flex items-start gap-2">
                      <span className="text-lg leading-none">{ICON[n.type] ?? "🔔"}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-slate-800">{n.title}</div>
                        <div className="text-xs text-slate-600">{n.body}</div>
                        <div className="mt-0.5 text-[10px] text-slate-400" dir="ltr">{fmt(n.createdAt)}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
