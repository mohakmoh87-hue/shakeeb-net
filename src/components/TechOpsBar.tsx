"use client";

import { useEffect, useState } from "react";
import TechLeaveModal from "./TechLeaveModal";
import TechAdjustments from "./TechAdjustments";
import SalaryModal from "./SalaryModal";
import { bioConfirm, bioReRegister } from "@/lib/biometric";
import { isNativeApp, startNativeTracking, stopNativeTracking, openNativeSettings } from "@/lib/nativeTracking";

type AttState = "none" | "in" | "done";
const fmtTime = (d: string | null) => (d ? new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");

// شريط الفني السفلي: زر البصمة (دخول↔خروج) + قائمة «عمليات».
export default function TechOpsBar({ techName }: { techName: string }) {
  const [state, setState] = useState<AttState>("none");
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opsOpen, setOpsOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [leaveMode, setLeaveMode] = useState<"day" | "time" | null>(null);
  const [adjOpen, setAdjOpen] = useState(false);
  const [salaryOpen, setSalaryOpen] = useState(false);
  const [bioOpen, setBioOpen] = useState(false); // نافذة تأكيد البصمة
  const [bioBusy, setBioBusy] = useState(false);
  const [bioErr, setBioErr] = useState("");
  const [trackReq, setTrackReq] = useState(false); // المكتب يطلب موقعي الآن
  const [geoBlocked, setGeoBlocked] = useState(false); // إذن الموقع مرفوض/متعذّر أثناء الطلب

  useEffect(() => {
    fetch("/api/field/attendance").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d?.role === "technician") { setState(d.state); setCheckIn(d.checkIn); setCheckOut(d.checkOut); }
    });
  }, []);

  // تتبع الموقع بالطلب: فحص خفيف كل 30ث «هل التتبع مطلوب؟» — إن طُلب يُرسل الموقع كل 30ث
  // (فيبقى حيّاً لدى المكتب)، وإن ردّ الخادم بالتوقف يعود للخمول فوراً. إن رُفض إذن الموقع
  // يُرفع تنبيه للفني ليُفعّله. الإرسال يتوقف تماماً حين لا يُطلب.
  useEffect(() => {
    let locTimer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    const stopLoc = () => { if (locTimer) { clearInterval(locTimer); locTimer = null; } };
    const sendLoc = () => {
      if (stopped || typeof navigator === "undefined" || !("geolocation" in navigator)) { setGeoBlocked(true); return; }
      navigator.geolocation.getCurrentPosition(
        async (p) => {
          setGeoBlocked(false);
          if (stopped) return;
          const r = await fetch("/api/field/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: p.coords.latitude, lng: p.coords.longitude }) }).catch(() => null);
          const d = await r?.json().catch(() => null);
          if (!d?.tracking) { stopLoc(); setTrackReq(false); }
        },
        (err) => { setGeoBlocked(err.code === err.PERMISSION_DENIED || err.code === err.POSITION_UNAVAILABLE); },
        { enableHighAccuracy: true, timeout: 20_000, maximumAge: 10_000 },
      );
    };
    // إرسال الموقع للخادم؛ يعيد هل يبقى التتبع مطلوباً (للخدمة الأصلية لتُطفئ نفسها)
    const postLoc = async (lat: number, lng: number): Promise<boolean> => {
      const r = await fetch("/api/field/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat, lng }) }).catch(() => null);
      const d = await r?.json().catch(() => null);
      return !!d?.tracking;
    };
    const check = async () => {
      const d = await fetch("/api/field/track").then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (stopped) return;
      if (d?.tracking) {
        setTrackReq(true);
        if (isNativeApp()) {
          // التطبيق الأصلي: خدمة خلفية تعمل والتطبيق مُبعَد وتُطفأ تلقائياً عند إيقاف الخادم
          const res = await startNativeTracking(postLoc);
          if (!stopped) setGeoBlocked(res === "denied");
        } else if (!locTimer) {
          sendLoc(); locTimer = setInterval(sendLoc, 30_000); // المتصفح: إرسال فوري ثم كل 30ث
        }
      } else {
        setTrackReq(false); setGeoBlocked(false);
        if (isNativeApp()) void stopNativeTracking(); else stopLoc();
      }
    };
    check();
    const checkTimer = setInterval(check, 30_000);
    return () => { stopped = true; clearInterval(checkTimer); stopLoc(); if (isNativeApp()) void stopNativeTracking(); };
  }, []);

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(""), 4200); }

  // تفعيل الموقع بلمسة الفني — داخل التطبيق: فتح الإعدادات لمنح الإذن؛ بالمتصفح: طلب الإذن
  function primeLocation() {
    if (isNativeApp()) { void openNativeSettings(); flash("فعّل «السماح دائماً» للموقع من الإعدادات ثم ارجع"); return; }
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) { flash("جهازك لا يدعم تحديد الموقع"); return; }
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        setGeoBlocked(false);
        await fetch("/api/field/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: p.coords.latitude, lng: p.coords.longitude }) }).catch(() => {});
        flash("تم تفعيل الموقع ✓ — مكتبك يتابعك الآن");
      },
      () => { setGeoBlocked(true); flash("فعّل إذن الموقع من إعدادات المتصفح ثم أعد المحاولة"); },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  // موقع الفني الحالي (للبصمة الجغرافية) — يرجع null إن تعذّر
  function getPosition(): Promise<{ lat: number; lng: number } | null> {
    return new Promise((resolve) => {
      if (typeof navigator === "undefined" || !("geolocation" in navigator)) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 9000, maximumAge: 10000 },
      );
    });
  }

  // تسجيل البصمة فعلياً (بعد تأكيد بصمة الهاتف)
  async function stamp() {
    if (busy || state === "done") return;
    const action = state === "none" ? "in" : "out";
    setBusy(true);
    const pos = await getPosition(); // قد يطلب إذن الموقع
    const r = await fetch("/api/field/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...(pos ?? {}) }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { flash(d.error ?? "تعذّر تسجيل البصمة"); return; }
    setState(d.state);
    if (action === "in") { setCheckIn(d.checkIn); flash("تم تسجيل الدخول ✓"); }
    else { setCheckOut(d.checkOut); flash("تم تسجيل الخروج ✓"); }
  }

  // فتح نافذة تأكيد البصمة قبل التسجيل
  function openBio() {
    if (busy || state === "done") return;
    setBioErr(""); setBioOpen(true);
  }

  // لمس المستشعر: يُطلق بصمة الهاتف الحقيقية ثم يُكمل التسجيل
  async function confirmBio() {
    setBioBusy(true); setBioErr("");
    const res = await bioConfirm(techName);
    setBioBusy(false);
    if (res === "failed") { setBioErr("لم تُؤكَّد البصمة — أعد المحاولة"); return; }
    // ok أو unsupported (جهاز بلا مستشعر) → نُكمل التسجيل
    setBioOpen(false);
    await stamp();
  }

  // إعادة تسجيل البصمة على هذا الجهاز (عند تبديل الهاتف)
  async function reRegisterBio() {
    setBioBusy(true); setBioErr("");
    const res = await bioReRegister(techName);
    setBioBusy(false);
    if (res === "ok") setBioErr("تم تسجيل بصمة هذا الجهاز ✓ — المس المستشعر للتأكيد");
    else if (res === "unsupported") setBioErr("هذا الجهاز لا يدعم البصمة");
    else setBioErr("تعذّر تسجيل البصمة — أعد المحاولة");
  }

  const btn = state === "none"
    ? { label: "بصمة دخول", cls: "bg-emerald-600 hover:bg-emerald-700", icon: "🟢" }
    : state === "in"
      ? { label: "بصمة خروج", cls: "bg-red-600 hover:bg-red-700", icon: "🔴" }
      : { label: "انتهى دوام اليوم", cls: "bg-slate-400 cursor-default", icon: "✓" };

  const ops = [
    { key: "leave", label: "طلب إجازة", icon: "📅" },
    { key: "tleave", label: "طلب إجازة زمنية", icon: "⏱️" },
    { key: "adjust", label: "الخصومات والمكافآت", icon: "💠" },
    { key: "salary", label: "الراتب", icon: "💰" },
  ];

  return (
    <>
      {leaveMode && <TechLeaveModal mode={leaveMode} onClose={() => setLeaveMode(null)} />}
      {adjOpen && <TechAdjustments onClose={() => setAdjOpen(false)} />}
      {salaryOpen && <SalaryModal onClose={() => setSalaryOpen(false)} />}
      {toast && <div className="fixed bottom-24 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-slate-900/90 px-5 py-2 text-sm font-semibold text-white shadow-lg">{toast}</div>}

      {/* المكتب يطلب موقعي الآن — شفافية للفني + تفعيل الإذن إن كان محجوباً */}
      {trackReq && (
        <div className="fixed inset-x-2 top-2 z-[80] mx-auto max-w-md rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg backdrop-blur"
          style={{ background: geoBlocked ? "rgba(220,38,38,0.95)" : "rgba(5,150,105,0.95)", color: "white" }}>
          {geoBlocked ? (
            <div className="flex items-center justify-between gap-2">
              <span>📍 مكتبك يطلب موقعك — الإذن محجوب</span>
              <button onClick={primeLocation} className="shrink-0 rounded-lg bg-white px-3 py-1 text-xs font-bold text-red-700">فعّل الموقع</button>
            </div>
          ) : (
            <span>📍 مكتبك يتابع موقعك الآن</span>
          )}
        </div>
      )}

      {/* نافذة تأكيد البصمة ببصمة الهاتف الحقيقية */}
      {bioOpen && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 p-5" onClick={() => !bioBusy && setBioOpen(false)}>
          <div className="w-full max-w-xs rounded-3xl bg-white p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-base font-extrabold text-slate-800">
              {state === "none" ? "تأكيد بصمة الدخول" : "تأكيد بصمة الخروج"}
            </div>
            <p className="mb-5 text-xs text-slate-500">المس مستشعر البصمة في هاتفك للتأكيد</p>
            <button onClick={confirmBio} disabled={bioBusy}
              className={`mx-auto flex h-24 w-24 items-center justify-center rounded-full text-5xl text-white shadow-lg transition active:scale-95 disabled:opacity-70 ${bioBusy ? "animate-pulse bg-slate-500" : state === "none" ? "bg-gradient-to-br from-emerald-500 to-emerald-700" : "bg-gradient-to-br from-red-500 to-red-700"}`}>
              👆
            </button>
            <div className="mt-4 text-sm font-bold text-slate-600">{bioBusy ? "بانتظار البصمة…" : "اضغط للمس المستشعر"}</div>
            {bioErr && <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">{bioErr}</div>}
            <div className="mt-5 flex items-center justify-center gap-4 text-xs">
              <button onClick={() => !bioBusy && setBioOpen(false)} className="font-semibold text-slate-400 hover:text-slate-600">إلغاء</button>
              <span className="text-slate-200">|</span>
              <button onClick={reRegisterBio} disabled={bioBusy} className="font-semibold text-slate-400 hover:text-slate-600 disabled:opacity-50">هاتف جديد؟ سجّل البصمة</button>
            </div>
          </div>
        </div>
      )}

      {opsOpen && (
        <div className="fixed inset-0 z-[75]" onClick={() => setOpsOpen(false)}>
          <div className="absolute bottom-[76px] left-1/2 w-64 -translate-x-1/2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {ops.map((o) => (
              <button key={o.key} onClick={() => {
                setOpsOpen(false);
                if (o.key === "leave") setLeaveMode("day");
                else if (o.key === "tleave") setLeaveMode("time");
                else if (o.key === "adjust") setAdjOpen(true);
                else if (o.key === "salary") setSalaryOpen(true);
                else flash("هذه الميزة تُضاف في التحديث القادم");
              }}
                className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-right text-sm font-semibold text-slate-700 last:border-0 hover:bg-slate-50">
                <span className="text-lg">{o.icon}</span>{o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* الشريط السفلي الثابت */}
      <div className="fixed inset-x-0 bottom-0 z-[70] border-t border-slate-200 bg-white/95 px-4 pb-[max(10px,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-center gap-3">
          <button onClick={() => setOpsOpen((o) => !o)}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-100 font-bold text-slate-700 hover:bg-slate-200">
            ⚙️ عمليات <span className="text-xs">▾</span>
          </button>
          <button onClick={openBio} disabled={busy || state === "done"}
            className={`flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-2xl font-extrabold text-white shadow-md transition ${btn.cls} disabled:opacity-90`}>
            <span>{btn.icon}</span>{busy ? "..." : btn.label}
          </button>
        </div>
        {(checkIn || checkOut) && (
          <div className="mx-auto mt-1 max-w-md text-center text-[11px] text-slate-500">
            {checkIn && <>دخول: <b>{fmtTime(checkIn)}</b></>}{checkOut && <> · خروج: <b>{fmtTime(checkOut)}</b></>}
          </div>
        )}
      </div>
      {/* مساحة أسفل الصفحة كي لا يغطّي الشريط المحتوى */}
      <div className="h-24" />
    </>
  );
}
