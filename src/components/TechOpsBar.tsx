"use client";

import { useEffect, useState } from "react";
import TechLeaveModal from "./TechLeaveModal";
import TechAdjustments from "./TechAdjustments";
import SalaryModal from "./SalaryModal";

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

  useEffect(() => {
    fetch("/api/field/attendance").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d?.role === "technician") { setState(d.state); setCheckIn(d.checkIn); setCheckOut(d.checkOut); }
    });
  }, []);

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(""), 4200); }

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

  async function stamp() {
    if (busy || state === "done") return;
    const action = state === "none" ? "in" : "out";
    if (action === "out" && !confirm("تأكيد تسجيل الخروج الآن؟")) return;
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
          <button onClick={stamp} disabled={busy || state === "done"}
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
