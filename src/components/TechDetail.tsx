"use client";

import { useEffect, useState } from "react";
import SalaryModal from "./SalaryModal";

type Statement = {
  daysPaid: number; baseEarned: number; overtime: number; bonuses: number; credits: number;
  attendanceDeductions: number; confirmedDeductions: number; advances: number; net: number; carryIn: number; due: number;
};
type SalaryResp = { name?: string; salary?: number; statement: Statement; period: { from: string; to: string } | null };
type AttRow = { id: number; dayKey: string; checkIn: string | null; checkOut: string | null; lateDeduction: number; earlyDeduction: number };
type LeaveRow = { id: number; dayKey: string; kind: string; paid: boolean; startMin: number | null; endMin: number | null; reason: string; status: string; decidedBy: string | null };
type LeaveResp = { period: { from: string; to: string }; quota: number; paidTaken: number; paidPending: number; unpaidTaken: number; timeTaken: number; remaining: number; leaves: LeaveRow[] };

const money = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("en-US");
const hm = (iso: string | null) => { if (!iso) return "—"; try { return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Baghdad" }); } catch { return "—"; } };
const mm = (m: number | null) => (m == null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);

const TABS = [{ k: "salary", t: "💰 الراتب" }, { k: "att", t: "🕒 الحضور" }, { k: "leave", t: "🌿 الإجازات" }] as const;

export default function TechDetail({ technicianId, name, onSettled, onClose }: { technicianId: number; name: string; onSettled?: () => void; onClose: () => void }) {
  const [tab, setTab] = useState<string>("salary");
  const [sal, setSal] = useState<SalaryResp | null>(null);
  const [att, setAtt] = useState<AttRow[] | null>(null);
  const [lv, setLv] = useState<LeaveResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [openSalary, setOpenSalary] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const [sR, lR] = await Promise.all([
        fetch(`/api/field/salary?technicianId=${technicianId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`/api/field/leaves?technicianId=${technicianId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (!alive) return;
      if (sR) setSal(sR);
      if (lR) setLv(lR);
      const period = sR?.period ?? lR?.period ?? null;
      const q = period ? `&from=${period.from}&to=${period.to}` : "";
      const aR = await fetch(`/api/field/attendance?technicianId=${technicianId}${q}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!alive) return;
      if (aR) setAtt(aR.log ?? []);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [technicianId]);

  const period = sal?.period ?? lv?.period ?? null;
  const st = sal?.statement;

  return (
    <div dir="rtl" className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center sm:p-3" onClick={onClose}>
      <div className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-slate-50 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>

        {/* ترويسة */}
        <div className="shrink-0 bg-gradient-to-l from-blue-700 to-sky-600 px-4 pb-3 pt-4 text-white">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15 text-2xl">👷</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-black">{name}</div>
              <div className="text-xs text-white/80">فترة الراتب: {period ? <span dir="ltr">{period.from} → {period.to}</span> : "—"}</div>
            </div>
            <button onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15 text-lg hover:bg-white/25">✕</button>
          </div>
          <div className="mt-3 flex gap-1 rounded-2xl bg-black/15 p-1">
            {TABS.map((x) => (
              <button key={x.k} onClick={() => setTab(x.k)} className={`flex-1 whitespace-nowrap rounded-xl px-1 py-2 text-sm font-extrabold transition ${tab === x.k ? "bg-white text-blue-700 shadow" : "text-white/85"}`}>{x.t}</button>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {loading && <div className="py-10 text-center text-sm text-slate-400">جاري التحميل...</div>}

          {/* ===== الراتب ===== */}
          {!loading && tab === "salary" && (
            st ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Tile label="الصافي" value={money(st.net)} tone="emerald" />
                  <Tile label="المستحق" value={money(sal?.statement.due)} tone="blue" />
                  <Tile label="أيام محتسبة" value={String(st.daysPaid)} tone="slate" />
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="mb-2 text-xs font-bold text-slate-500">تفصيل الراتب</div>
                  <div className="divide-y divide-slate-100 text-sm">
                    <Row label="الأساس" val={`+${money(st.baseEarned)}`} />
                    {st.overtime > 0 && <Row label="إضافيّ" val={`+${money(st.overtime)}`} cls="text-emerald-700" />}
                    {st.bonuses > 0 && <Row label="مكافآت" val={`+${money(st.bonuses)}`} cls="text-emerald-700" />}
                    {st.credits > 0 && <Row label="إضافات/إرجاع" val={`+${money(st.credits)}`} cls="text-emerald-700" />}
                    {st.attendanceDeductions > 0 && <Row label="خصم الحضور (تأخير/خروج مبكّر)" val={`−${money(st.attendanceDeductions)}`} cls="text-rose-600" />}
                    {st.confirmedDeductions > 0 && <Row label="خصومات مؤكّدة" val={`−${money(st.confirmedDeductions)}`} cls="text-rose-600" />}
                    {st.advances > 0 && <Row label="سلف" val={`−${money(st.advances)}`} cls="text-rose-600" />}
                    {st.carryIn !== 0 && <Row label="مرحّل من الفترة السابقة" val={money(st.carryIn)} cls={st.carryIn < 0 ? "text-rose-600" : "text-emerald-700"} />}
                  </div>
                  <div className="mt-2 flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2">
                    <span className="text-sm font-bold text-emerald-800">الصافي</span>
                    <span className="text-lg font-black tabular-nums text-emerald-800">{money(st.net)}</span>
                  </div>
                </div>
                <button onClick={() => setOpenSalary(true)} className="w-full rounded-2xl bg-blue-600 py-3 text-sm font-extrabold text-white shadow active:scale-[.99] hover:bg-blue-700">فتح كشف الراتب الكامل / التسديد ←</button>
              </>
            ) : <Note text="لا صلاحيّةَ لعرض الراتب (تحتاج صلاحيّة الرواتب)." />
          )}

          {/* ===== الحضور ===== */}
          {!loading && tab === "att" && (
            att ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Tile label="حضور" value={String(att.length)} tone="slate" />
                  <Tile label="تأخير" value={String(att.filter((a) => a.lateDeduction > 0).length)} tone="amber" />
                  <Tile label="خروج مبكّر" value={String(att.filter((a) => a.earlyDeduction > 0).length)} tone="rose" />
                </div>
                <div className="space-y-1.5">
                  {att.length === 0 && <Note text="لا بصماتٍ في هذه الفترة." />}
                  {att.map((a) => {
                    const ded = (a.lateDeduction ?? 0) + (a.earlyDeduction ?? 0);
                    return (
                      <div key={a.id} className={`rounded-xl border p-2.5 ${ded > 0 ? "border-amber-200 bg-amber-50/40" : "border-slate-200 bg-white"}`}>
                        <div className="flex items-center justify-between">
                          <span className="font-bold tabular-nums text-slate-800" dir="ltr">{a.dayKey}</span>
                          {ded > 0 ? <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">خصم {money(ded)}</span> : <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">حضور</span>}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                          <span>دخول <b className="tabular-nums text-slate-700" dir="ltr">{hm(a.checkIn)}</b></span>
                          <span>خروج <b className="tabular-nums text-slate-700" dir="ltr">{hm(a.checkOut)}</b></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : <Note text="تعذّر تحميلُ الحضور." />
          )}

          {/* ===== الإجازات ===== */}
          {!loading && tab === "leave" && (
            lv ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                    <div className="text-[11px] font-semibold text-emerald-700">إجازات براتب</div>
                    <div className="mt-0.5 text-xl font-black tabular-nums text-emerald-800">{lv.paidTaken} <span className="text-sm font-bold text-emerald-600">/ {lv.quota}</span></div>
                    <div className="text-[11px] text-emerald-700">المتبقّي: <b>{lv.remaining}</b></div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="text-[11px] font-semibold text-slate-500">بلا راتب</div>
                    <div className="mt-0.5 text-xl font-black tabular-nums text-slate-800">{lv.unpaidTaken}</div>
                    <div className="text-[11px] text-slate-400">لا حدّ</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 rounded-2xl border border-sky-200 bg-sky-50 p-3 text-center"><div className="text-[11px] font-semibold text-sky-700">⏱️ زمنيّة</div><div className="mt-0.5 text-xl font-black tabular-nums text-sky-800">{lv.timeTaken}</div></div>
                  {lv.paidPending > 0 && <div className="flex-1 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-center"><div className="text-[11px] font-semibold text-amber-700">معلّقة (تحجز الحصّة)</div><div className="mt-0.5 text-xl font-black tabular-nums text-amber-800">{lv.paidPending}</div></div>}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="mb-2 text-xs font-bold text-slate-500">أيّام الإجازات بالضبط (فترة الراتب)</div>
                  <div className="space-y-1.5">
                    {lv.leaves.length === 0 && <div className="py-2 text-center text-xs text-slate-400">لا إجازاتٍ في هذه الفترة.</div>}
                    {lv.leaves.map((l) => {
                      const type = l.kind === "time" ? { t: "زمنيّة", c: "bg-sky-100 text-sky-700", b: "border-sky-100 bg-sky-50/50" } : l.paid ? { t: "براتب", c: "bg-emerald-100 text-emerald-700", b: "border-emerald-100 bg-emerald-50/50" } : { t: "بلا راتب", c: "bg-slate-100 text-slate-600", b: "border-slate-100 bg-white" };
                      const stt = l.status === "approved" ? { t: "معتمدة", c: "bg-emerald-100 text-emerald-700" } : l.status === "pending" ? { t: "معلّقة", c: "bg-amber-100 text-amber-700" } : { t: "مرفوضة", c: "bg-rose-100 text-rose-700" };
                      return (
                        <div key={l.id} className={`flex items-start gap-2 rounded-xl border p-2.5 ${type.b}`}>
                          <span className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${type.c}`}>{type.t}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-bold tabular-nums text-slate-800" dir="ltr">{l.dayKey}{l.kind === "time" && l.startMin != null ? ` · ${mm(l.startMin)}–${mm(l.endMin)}` : ""}</div>
                            <div className="truncate text-xs text-slate-500">{l.reason}{l.decidedBy ? ` · ${l.decidedBy}` : ""}</div>
                          </div>
                          <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${stt.c}`}>{stt.t}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : <Note text="لا صلاحيّةَ لعرض الإجازات (تحتاج صلاحيّة الرواتب)." />
          )}
        </div>
      </div>

      {openSalary && (
        <SalaryModal technicianId={technicianId} name={name} onClose={() => setOpenSalary(false)} onSettled={() => { setOpenSalary(false); onSettled?.(); }} />
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: "emerald" | "blue" | "slate" | "amber" | "rose" }) {
  const tones: Record<string, string> = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800", blue: "border-blue-200 bg-blue-50 text-blue-800",
    slate: "border-slate-200 bg-white text-slate-800", amber: "border-amber-200 bg-amber-50 text-amber-800", rose: "border-rose-200 bg-rose-50 text-rose-800",
  };
  return (
    <div className={`rounded-2xl border p-3 text-center ${tones[tone]}`}>
      <div className="text-[11px] font-semibold opacity-80">{label}</div>
      <div className="mt-0.5 text-lg font-black leading-tight tabular-nums">{value}</div>
    </div>
  );
}
function Row({ label, val, cls }: { label: string; val: string; cls?: string }) {
  return <div className="flex items-center justify-between py-2"><span className="text-slate-600">{label}</span><span className={`font-bold tabular-nums ${cls ?? "text-slate-800"}`}>{val}</span></div>;
}
function Note({ text }: { text: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-400">{text}</div>;
}
