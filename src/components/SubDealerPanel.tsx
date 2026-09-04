"use client";

import { useEffect, useState } from "react";

type Panel = { id: number; label: string; username: string | null };
type Sub = { sasId: number; username: string; name: string | null; phone: string | null; expiration: string | null; days: number; activatedAt?: string | null };
type Cand = { mine: Sub; suspect: Sub; score: number; signals: string[]; gapDays: number | null };
type Counts = { mine: number; unified: number; inRange: number; suspects: number };
type Result = { counts: Counts; from: string; to: string; candidates: Cand[] };
type LastAuto = { id: number; panelId: number | null; from: string; to: string; counts: Counts; candidates: Cand[]; at: string };

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const fmtDate = (s: string | null | undefined) => { if (!s) return "—"; const d = new Date(s); return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }); };
const fmtDateTime = (s: string | null | undefined) => { if (!s) return "—"; const d = new Date(s); return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); };

function scoreColor(n: number) {
  if (n >= 90) return "bg-rose-600 text-white";
  if (n >= 65) return "bg-orange-500 text-white";
  return "bg-amber-400 text-amber-950";
}

// تصدير Excel: CSV بترميز UTF-8 (BOM) — يفتحه إكسل مباشرةً ويعرض العربيّةَ صحيحة، بلا مكتبة
function exportCsv(rows: Cand[], filename: string) {
  const head = ["الثقة", "اسمي (منتهٍ)", "يوزري", "هاتفي", "انتهى", "اسم المشتبه", "يوزر المشتبه", "هاتف المشتبه", "فُعِّل", "الإشارات", "الفجوة (يوم)"];
  const esc = (v: unknown) => {
    let s = String(v ?? "");
    // تحييدُ حقن صيغ إكسل: أسماءُ الموحّد قد تكون معادِيةً (حساب السب-ديلر). سابقةُ اقتباسٍ
    //   تجعل الخليّةَ نصّاً لا معادلةً (=, +, -, @, tab, CR).
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [head.map(esc).join(",")];
  for (const c of rows) lines.push([c.score, c.mine.name, c.mine.username, c.mine.phone, fmtDate(c.mine.expiration), c.suspect.name, c.suspect.username, c.suspect.phone, fmtDate(c.suspect.activatedAt), c.signals.join(" | "), c.gapDays ?? ""].map(esc).join(","));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CountsBar({ counts }: { counts: Counts }) {
  return (
    <div className="mb-3 flex flex-wrap gap-2 text-xs">
      <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">مشتركيك: {counts.mine.toLocaleString("en-US")}</span>
      <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">الموحّد: {counts.unified.toLocaleString("en-US")}</span>
      <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">فُعِّل في المدى: {counts.inRange.toLocaleString("en-US")}</span>
      <span className={`rounded-full px-3 py-1 font-extrabold ${counts.suspects > 0 ? "bg-rose-600 text-white" : "bg-emerald-100 text-emerald-700"}`}>
        مشتبَهٌ بهم: {counts.suspects.toLocaleString("en-US")}
      </span>
    </div>
  );
}

function ExportBtn({ rows, tag }: { rows: Cand[]; tag: string }) {
  if (rows.length === 0) return null;
  return (
    <button onClick={() => exportCsv(rows, `subdealer-${tag}-${ymd(new Date())}.csv`)}
      className="rounded-lg border border-emerald-600 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100">
      📄 استخراج Excel
    </button>
  );
}

function CandTable({ candidates }: { candidates: Cand[] }) {
  if (candidates.length === 0) return <div className="rounded-lg bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">لا اشتباهَ ضمن هذا المدى ✓</div>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="p-2 text-center">الثقة</th>
            <th className="p-2 text-right">مشتركك (منتهٍ — ساسك)</th>
            <th className="p-2 text-right">المشتبَه (مفعّل — الموحّد)</th>
            <th className="p-2 text-center">الإشارة</th>
            <th className="p-2 text-center">الفجوة</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c, i) => (
            <tr key={i} className="border-t border-slate-100 align-top">
              <td className="p-2 text-center"><span className={`inline-block rounded-full px-2 py-0.5 font-extrabold ${scoreColor(c.score)}`}>{c.score}</span></td>
              <td className="p-2 text-right">
                <div className="font-bold text-slate-800">{c.mine.name ?? "—"}</div>
                <div className="text-slate-500" dir="ltr">{c.mine.phone ?? "—"} · {c.mine.username}</div>
                <div className="text-rose-600">انتهى: {fmtDate(c.mine.expiration)}</div>
              </td>
              <td className="p-2 text-right">
                <div className="font-bold text-slate-800">{c.suspect.name ?? "—"}</div>
                <div className="text-slate-500" dir="ltr">{c.suspect.phone ?? "—"} · {c.suspect.username}</div>
                <div className="text-emerald-700">فُعِّل: {fmtDate(c.suspect.activatedAt)}</div>
              </td>
              <td className="p-2 text-center">
                <div className="flex flex-wrap justify-center gap-1">
                  {c.signals.map((s, j) => <span key={j} className="rounded bg-indigo-50 px-1.5 py-0.5 font-semibold text-indigo-700">{s}</span>)}
                </div>
              </td>
              <td className="p-2 text-center font-semibold text-slate-600">{c.gapDays == null ? "—" : `${c.gapDays} يوم`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SubDealerPanel() {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [myPanelIds, setMyPanelIds] = useState<number[]>([]);
  const [uniUser, setUniUser] = useState("");
  const [uniPass, setUniPass] = useState("");
  const [savedUser, setSavedUser] = useState<string | null>(null);
  const [from, setFrom] = useState(ymd(new Date(Date.now() - 90 * 864e5)));
  const [to, setTo] = useState(ymd(new Date()));
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [lastAuto, setLastAuto] = useState<LastAuto | null>(null);
  const [showAuto, setShowAuto] = useState(false);

  useEffect(() => {
    fetch("/api/manager/sub-dealer-check").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setPanels(d.panels ?? []);
      // اللوحاتُ المحفوظةُ للفحص التلقائيّ تُنتقى تلقائيّاً؛ وإلّا الوحيدةُ إن كانت واحدة
      if (Array.isArray(d.savedPanelIds) && d.savedPanelIds.length) setMyPanelIds(d.savedPanelIds);
      else if ((d.panels ?? []).length === 1) setMyPanelIds([d.panels[0].id]);
      if (d.savedUnifiedUser) { setSavedUser(d.savedUnifiedUser); setUniUser(d.savedUnifiedUser); }
      if (d.lastAuto) setLastAuto(d.lastAuto);
    }).catch(() => {});
  }, []);

  const togglePanel = (id: number) => setMyPanelIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  async function run() {
    setErr(""); setRes(null); setBusy(true);
    try {
      const r = await fetch("/api/manager/sub-dealer-check", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ myPanelIds, unifiedUser: uniUser, unifiedPass: uniPass, from, to, save }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.error ?? "تعذّر الفحص"); return; }
      setRes(d);
      if (save && uniPass) { setSavedUser(uniUser); setUniPass(""); }
    } catch { setErr("تعذّر الاتصال بالخادم"); }
    finally { setBusy(false); }
  }

  return (
    <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xl">🕵️</span>
        <h3 className="text-base font-extrabold text-slate-800">فحص sub dealer — كشفُ سرقة المشتركين</h3>
      </div>
      <p className="mb-4 text-xs leading-6 text-slate-500">
        يقارن مشتركيك المنتهين في <b>ساسك</b> بمشتركي <b>الساس الموحّد</b> (المفعّلين بحساب الوكيل الآخر) بالاسم والهاتف،
        ويعرض المشتبَه بهم بدرجة ثقة. <b>اختر كلَّ مكاتبك التي يغطّيها الموحّد</b> (وإلّا ظهر مشتركو مكتبك الآخر كمشتبَهين كذباً)،
        وأدخل اعتماد الساس الموحّد، وحدّد المدى. <b>عند حفظ اللوحات والاعتماد</b> يعمل الفحصُ <b>تلقائيّاً كلَّ ليلة</b> ويصلك إشعارٌ عند مشتبَهٍ جديد.
      </p>

      {lastAuto && (
        <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
          <button onClick={() => setShowAuto((v) => !v)} className="flex w-full items-center justify-between text-right">
            <span className="text-xs font-bold text-indigo-800">
              🌙 آخر فحصٍ تلقائيّ — {fmtDateTime(lastAuto.at)}
              {lastAuto.counts.suspects > 0
                ? <span className="mr-2 rounded-full bg-rose-600 px-2 py-0.5 font-extrabold text-white">{lastAuto.counts.suspects} مشتبَه</span>
                : <span className="mr-2 rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700">لا اشتباه</span>}
            </span>
            <span className="text-xs text-indigo-500">{showAuto ? "▲ إخفاء" : "▼ عرض"}</span>
          </button>
          {showAuto && (
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between">
                <CountsBar counts={lastAuto.counts} />
                <ExportBtn rows={lastAuto.candidates} tag="auto" />
              </div>
              <CandTable candidates={lastAuto.candidates} />
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="text-xs font-bold text-slate-600">
          مكاتبك التي يغطّيها الموحّد
          <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-300 p-2">
            {panels.length === 0 ? <div className="p-1 text-slate-400">لا لوحاتٌ متاحة</div> : panels.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm font-normal hover:bg-slate-50">
                <input type="checkbox" checked={myPanelIds.includes(p.id)} onChange={() => togglePanel(p.id)} />
                <span className="text-slate-700">{p.label}{p.username ? <span className="text-slate-400" dir="ltr"> ({p.username})</span> : ""}</span>
              </label>
            ))}
          </div>
          {myPanelIds.length > 0 && <div className="mt-1 font-normal text-emerald-600">محدَّدٌ {myPanelIds.length} مكتب</div>}
        </div>
        <div className="grid grid-cols-2 gap-2 self-start">
          <label className="text-xs font-bold text-slate-600">من
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" />
          </label>
          <label className="text-xs font-bold text-slate-600">إلى
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" />
          </label>
        </div>
        <label className="text-xs font-bold text-slate-600">
          يوزر الساس الموحّد
          <input value={uniUser} onChange={(e) => setUniUser(e.target.value)} placeholder="username" dir="ltr"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-bold text-slate-600">
          باسورد الساس الموحّد {savedUser && <span className="font-normal text-emerald-600">(محفوظٌ — اتركه فارغاً لاستعماله)</span>}
          <input type="password" value={uniPass} onChange={(e) => setUniPass(e.target.value)} placeholder={savedUser ? "••••••• (محفوظ)" : "password"} dir="ltr"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={run} disabled={busy}
          className="rounded-xl bg-mynet-blue px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50">
          {busy ? "جارٍ الفحص… (قد يستغرق دقيقة)" : "🔍 فحص"}
        </button>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
          حفظ المكاتب + اعتماد الموحّد (مشفَّراً) للفحص التلقائيّ الليليّ
        </label>
        {err && <span className="text-xs font-bold text-rose-600">{err}</span>}
      </div>

      {res && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <CountsBar counts={res.counts} />
            <ExportBtn rows={res.candidates} tag="manual" />
          </div>
          <CandTable candidates={res.candidates} />
        </div>
      )}
    </div>
  );
}
