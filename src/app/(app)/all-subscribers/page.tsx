"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { usePermission } from "@/lib/usePermission";
import { formatExpiry, formatDateTime } from "@/lib/format";
import { askVoidEffect } from "@/lib/voidPrompt";

// ===== صفحة «كلّ المشتركين» (طلب محمد 2026-08-09) — تُفتح من مربّع المشتركين بالرئيسيّة =====
// قائمة كلّ المشتركين (كلّ مكتبٍ بمكتبه، والمدير يرى الكلّ) + تحديد بمربّعات + تحديد الكلّ،
// وفلاتر: ينتهي خلال ١/٢/٣ أيّام أو إلى تاريخ · فعّال/متصل/منتهي/الكل · منتهون بين تاريخين · بحث،
// وإرسالُ رسالةٍ للمحدَّدين، وطباعةُ وصولاتهم بقالب «وصل المشترك» الخاصّ.
type Row = {
  id: number; name: string | null; phone: string | null; address: string | null; netUser: string | null;
  dateTo: string | null; carry: number; waEnabled: boolean; office: string | null; towerId: number | null;
  packageName: string | null; price: number; online: boolean | null;
};
type Office = { id: number; name: string | null };
// ===== قائمة «المفعّلون» (طلب محمد 2026-09-23) — سطرٌ لكلّ تفعيل بين تاريخين =====
// المبالغ تصل فقط لمن يملك مشاهدة الحسابات أو التقارير (showMoney من الخادم).
type Act = {
  id: number; date: string | null; subscriberId: number | null; name: string | null; netUser: string | null;
  phone: string | null; office: string | null; towerId: number | null; package: string | null;
  isMaster: boolean; by: string | null; times: number;
  price?: number; paid?: number; addPrice?: number; carry?: number;
};
// يومُ بغداد (UTC+3) بصيغة YYYY-MM-DD — لا يومُ المتصفّح
const baghdadToday = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
// القوالب الفعّالة من /api/sms-templates/effective: نصّ المكتب ← الوكيل ← الافتراضيّ،
// زائداً القوالب الحرّة. (قراءة صفوف القاعدة وحدها كانت تُظهر القائمة فارغة — بلاغ محمد.)
type Tpl = { key: string; type: string; text: string; scope: "office" | "agent" | "default" | "custom" };
const SCOPE_TAG: Record<string, string> = { office: " — قالب المكتب", agent: " — قالب الوكيل", default: " — افتراضيّ", custom: "" };

// الأسماء العربيّة للقوالب التلقائيّة (كما في صفحة إدارة القوالب) — وما ليس منها فهو قالبٌ حرّ
// أنشأه المدير باسمه، فيُعرض اسمه كما هو.
const TPL_NAMES: Record<string, string> = {
  activation: "تفعيل الاشتراك", expiring: "تذكير قبل الانتهاء", debtPaid: "تسديد دين",
  debts: "مطالبة بالديون", maintenance: "الصيانة/التنصيب", reward: "منح المكافأة",
  rewardUsed: "استخدام المكافأة", subSummary: "ملخص الاشتراك (وصل)", noAnswer: "ميجاوب (لم يرد)",
  loan: "قرض فزعة", other: "أخرى (عام)",
};

const fmt = (n: number | null | undefined) => (n == null ? "0" : Number(n).toLocaleString("en-US"));

export default function AllSubscribersPage() {
  const { can, me } = usePermission();
  const sp = useSearchParams();

  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [offices, setOffices] = useState<Office[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  // الفلاتر
  const [office, setOffice] = useState<string>(sp.get("office") ?? "all");
  const [status, setStatus] = useState<"all" | "active" | "online" | "expired" | "activated">("all");
  const [days, setDays] = useState<string>(""); // "" | "1" | "2" | "3"
  const [until, setUntil] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");

  // قائمة «المفعّلون»: مداها مستقلّ عن مدى الانتهاء، ويبدأ بيوم بغداد الحاليّ
  const [acts, setActs] = useState<Act[]>([]);
  const [actFrom, setActFrom] = useState(baghdadToday());
  const [actTo, setActTo] = useState(baghdadToday());
  const [showMoney, setShowMoney] = useState(false);
  const [actSums, setActSums] = useState<{ paid: number } | null>(null);
  const [actSort, setActSort] = useState<{ key: keyof Act; dir: 1 | -1 }>({ key: "id", dir: -1 });
  const [sort, setSort] = useState<{ key: keyof Row; dir: 1 | -1 } | null>(null);

  // إرسال رسالة
  const [sendOpen, setSendOpen] = useState(false);
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [tplErr, setTplErr] = useState(""); // سببُ عدم ظهور القوالب (يُعرَض بدل الصمت)
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  // القوالب الفعّالة — تُجلب لمكتب العرض (تخصيص المكتب يغلب قالب الوكيل)
  const loadTpls = useCallback(() => {
    const qs = office !== "all" ? `?officeId=${office}` : "";
    setTplErr("");
    fetch(`/api/sms-templates/effective${qs}`)
      .then(async (r) => {
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? `خطأ ${r.status}`); }
        return r.json();
      })
      .then((d) => setTpls(Array.isArray(d?.templates) ? d.templates : []))
      .catch((e) => { setTpls([]); setTplErr((e as Error).message || "تعذّر جلب القوالب"); });
  }, [office]);
  useEffect(() => { loadTpls(); }, [loadTpls]);

  useEffect(() => {
    fetch("/api/towers").then((r) => (r.ok ? r.json() : [])).then((d) => setOffices(Array.isArray(d) ? d : [])).catch(() => {});
    loadTpls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadActs = useCallback(() => {
    setLoading(true); setMsg("");
    const p = new URLSearchParams({ office, from: actFrom, to: actTo, limit: "2000" });
    if (q.trim()) p.set("q", q.trim());
    fetch(`/api/subscribers/activations?${p.toString()}`)
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok || !d) throw new Error(d?.error ?? "تعذّر جلب التفعيلات");
        return d;
      })
      .then((d) => {
        setActs(d.rows ?? []); setTotal(d.total ?? 0); setShowMoney(!!d.showMoney);
        setActSums(d.sums ?? null); setChecked(new Set());
        if (d.truncated) setMsg("المعروض أوّل ٢٠٠٠ تفعيل — ضيّق المدى لرؤية الباقي");
      })
      .catch((e) => { setActs([]); setTotal(0); setMsg((e as Error).message); })
      .finally(() => setLoading(false));
  }, [office, actFrom, actTo, q]);

  const load = useCallback(() => {
    if (status === "activated") { loadActs(); return; }
    setLoading(true); setMsg("");
    const p = new URLSearchParams({ office, status, limit: "1000" });
    if (days) p.set("days", days);
    if (until) p.set("until", until);
    if (from && to) { p.set("from", from); p.set("to", to); }
    if (q.trim()) p.set("q", q.trim());
    fetch(`/api/subscribers/query?${p.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) { setMsg("تعذّر جلب القائمة"); return; }
        setRows(d.rows ?? []); setTotal(d.total ?? 0); setChecked(new Set());
      })
      .catch(() => setMsg("تعذّر الاتصال"))
      .finally(() => setLoading(false));
  }, [office, status, days, until, from, to, q, loadActs]);

  useEffect(() => { load(); }, [load]);

  // الترتيب: ضغطةٌ على العنوان تصاعديّاً وضغطةٌ تعكسه — للجدولين معاً
  const cmp = (a: unknown, b: unknown, dir: 1 | -1) => {
    const empty = (v: unknown) => v == null || v === "";
    if (empty(a) && empty(b)) return 0;
    if (empty(a)) return 1;
    if (empty(b)) return -1;
    if (typeof a === "number" && typeof b === "number") return (a - b) * dir;
    if (typeof a === "boolean" && typeof b === "boolean") return ((a ? 1 : 0) - (b ? 1 : 0)) * dir;
    return String(a).localeCompare(String(b), "ar", { numeric: true }) * dir;
  };
  const sortedActs = useMemo(
    () => [...acts].sort((a, b) => cmp(a[actSort.key], b[actSort.key], actSort.dir)),
    [acts, actSort],
  );
  const sortedRows = useMemo(
    () => (sort ? [...rows].sort((a, b) => cmp(a[sort.key], b[sort.key], sort.dir)) : rows),
    [rows, sort],
  );
  const toggleActSort = (key: keyof Act) => setActSort((s) => (s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: 1 }));
  const toggleSort = (key: keyof Row) => setSort((s) => (s && s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: 1 }));
  const actArrow = (key: keyof Act) => (actSort.key === key ? (actSort.dir === 1 ? " ↑" : " ↓") : " ↕");
  const rowArrow = (key: keyof Row) => (sort?.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : " ↕");

  // تصدير إكسل: CSV بترميز UTF-8 (BOM) — يفتحه إكسل بعربيّةٍ سليمة، بلا مكتبة
  function exportActs() {
    const head = ["رقم الوصل", "التاريخ", "المشترك", "اليوزر", "الهاتف", "المكتب", "الباقة",
      ...(showMoney ? ["السعر", "الواصل", "الإضافة", "الدين المرحّل"] : []), "النوع", "بواسطة", "مكرّر"];
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(cell).join(",")];
    for (const a of sortedActs) {
      lines.push([
        a.id, a.date ? formatDateTime(a.date) : "", a.name ?? "", a.netUser ?? "", a.phone ?? "", a.office ?? "", a.package ?? "",
        ...(showMoney ? [a.price ?? 0, a.paid ?? 0, a.addPrice ?? 0, a.carry ?? 0] : []),
        a.isMaster ? "ماستر" : "تفعيل", a.by ?? "", a.times,
      ].map(cell).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `activations-${actFrom}_${actTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // حذف وصل تفعيل — نفس مسار سجلّ الوصولات المحروس (عكسيٌّ أو ورقيّ)، لصاحب الصلاحية وحده
  async function removeAct(a: Act) {
    if (busy) return;
    const choice = await askVoidEffect(`وصل التفعيل #${a.id} — ${a.name ?? "مشترك"}`);
    if (!choice) return;
    setBusy(true); setMsg("");
    const r = await fetch(`/api/subscription-entries/${a.id}/void`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reverse: choice.reverse }),
    }).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    setBusy(false);
    setMsg(r?.ok ? `🗑️ حُذف وصل التفعيل #${a.id}` : (d?.error ?? "تعذّر حذف الوصل"));
    if (r?.ok) loadActs();
  }

  const allOn = rows.length > 0 && checked.size === rows.length;
  const toggleAll = () => setChecked(allOn ? new Set() : new Set(rows.map((r) => r.id)));
  const toggle = (id: number) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // إرسالٌ صامتٌ في الخلفيّة (طلب محمد 2026-08-09): النافذة تُغلق فوراً ويتنقّل المستخدم
  // بحرّيّة — الخادم يُكمل الإرسال مفصولاً (١٠ ثوانٍ بين رسالة وأخرى)، والنتيجة تظهر في
  // «سجل الرسائل» رسالةً رسالةً. فلا انتظارَ دقائقَ أمام نافذةٍ مفتوحة.
  async function sendMessages() {
    if (!checked.size || !text.trim()) return;
    const n = checked.size;
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "WHATSAPP", text, target: "list", subscriberIds: [...checked], background: true }),
      });
      const d = await r.json().catch(() => ({}));
      setBusy(false);
      if (r.ok) {
        setSendOpen(false); setText("");
        setMsg(`📨 بدأ الإرسال في الخلفيّة لـ ${d.total ?? n} مشترك — يمكنك التنقّل بحرّيّة، وتظهر النتيجة في «سجل الرسائل»`);
      } else {
        setMsg(d.error ?? "تعذّر الإرسال");
      }
    } catch { setBusy(false); setMsg("تعذّر الاتصال بالخادم"); }
  }

  async function printReceipts() {
    if (!checked.size) return;
    if (!confirm(`طباعة ${checked.size} وصل مشترك على طابعة المكتب؟`)) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/print", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "notice", ids: [...checked] }),
      });
      const d = await r.json().catch(() => ({}));
      setBusy(false);
      setMsg(r.ok
        ? `🖨️ أُرسلت ${d.queued ?? 0} وصل للطباعة${d.workerOnline ? "" : " — ⚠️ حاسبة المكتب غير متصلة الآن، ستُطبع عند تشغيلها"}`
        : (d.error ?? "تعذّرت الطباعة"));
    } catch { setBusy(false); setMsg("تعذّر الاتصال بالخادم"); }
  }

  if (!me) return <div className="p-6 text-slate-400">جاري التحميل...</div>;
  if (!can("subscribers.manage")) {
    return <div className="p-6"><PageHeader title="كلّ المشتركين" /><div className="rounded-lg bg-red-50 px-4 py-3 text-red-600">ليس لديك صلاحية عرض المشتركين.</div></div>;
  }
  const isAdmin = !!me.isAdmin;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="كلّ المشتركين" subtitle="تحديدٌ جماعيّ · فلاتر الانتهاء والاتصال · إرسال رسائل · طباعة وصولات" />

      {/* الفلاتر */}
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        {isAdmin && offices.length > 1 && (
          <L label="المكتب">
            <select value={office} onChange={(e) => setOffice(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              <option value="all">كل المكاتب</option>
              {offices.map((o) => <option key={o.id} value={o.id}>{o.name ?? `#${o.id}`}</option>)}
            </select>
          </L>
        )}
        <L label="الحالة">
          <select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); }} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="all">الكل</option>
            <option value="active">الفعّالين</option>
            <option value="online">المتصلين الآن</option>
            <option value="expired">المنتهين</option>
            <option value="activated">المفعّلين</option>
          </select>
        </L>
        {status === "activated" && (
          <L label="تفعيلات بين تاريخين">
            <div className="flex items-center gap-1">
              <input type="date" value={actFrom} onChange={(e) => setActFrom(e.target.value)} dir="ltr" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
              <span className="text-slate-400">→</span>
              <input type="date" value={actTo} onChange={(e) => setActTo(e.target.value)} dir="ltr" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
              <button onClick={() => { const t = baghdadToday(); setActFrom(t); setActTo(t); }}
                className="rounded-lg bg-slate-100 px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200">اليوم</button>
            </div>
          </L>
        )}
        <L label="ينتهي خلال">
          <select value={days} onChange={(e) => { setDays(e.target.value); setUntil(""); setFrom(""); setTo(""); }} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">—</option>
            <option value="1">يوم واحد</option>
            <option value="2">يومين</option>
            <option value="3">٣ أيّام</option>
            <option value="7">٧ أيّام</option>
          </select>
        </L>
        <L label="ينتهي إلى تاريخ">
          <input type="date" value={until} onChange={(e) => { setUntil(e.target.value); setDays(""); setFrom(""); setTo(""); }} dir="ltr" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
        </L>
        <L label="منتهون بين تاريخين">
          <div className="flex items-center gap-1">
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setDays(""); setUntil(""); }} dir="ltr" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
            <span className="text-slate-400">→</span>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setDays(""); setUntil(""); }} dir="ltr" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
        </L>
        <L label="بحث">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم / يوزر / هاتف / عنوان" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
        </L>
        <button onClick={() => { setStatus("all"); setDays(""); setUntil(""); setFrom(""); setTo(""); setQ(""); }}
          className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-200">مسح الفلاتر</button>
      </div>

      {/* شريط الإجراءات */}
      <div data-app-bar className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        {status === "activated" ? (
          <>
            <span className="text-sm font-bold text-slate-700">التفعيلات: {fmt(total)}</span>
            {showMoney && actSums && <span className="text-sm text-slate-500">· مجموع الواصل: <b className="text-emerald-700">{fmt(actSums.paid)}</b></span>}
            <div className="flex-1" />
            <button onClick={exportActs} disabled={!acts.length}
              className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40">📊 تصدير إكسل</button>
          </>
        ) : (
          <>
            <span className="text-sm font-bold text-slate-700">المجموع: {fmt(total)}</span>
            <span className="text-sm text-slate-500">· المحدَّد: <b className="text-mynet-blue">{checked.size}</b></span>
            <div className="flex-1" />
            <button onClick={() => { setSendOpen(true); setMsg(""); }} disabled={!checked.size || busy}
              className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40">📩 إرسال رسالة للمحدَّدين</button>
            <button onClick={printReceipts} disabled={!checked.size || busy}
              className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40">🖨️ طباعة وصولاتهم</button>
          </>
        )}
      </div>
      {msg && <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">{msg}</div>}

      {/* جدول التفعيلات — سطرٌ لكلّ تفعيل، وترتيبٌ بكلّ عمود */}
      {status === "activated" ? (
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-right text-xs">
            <thead className="sticky top-0 bg-slate-50 text-slate-600">
              <tr>
                {([["id", "رقم الوصل"], ["date", "الوقت"], ["name", "المشترك"], ["netUser", "اليوزر"],
                   ["office", "المكتب"], ["package", "الباقة"],
                   ...(showMoney ? [["price", "السعر"], ["paid", "الواصل"], ["addPrice", "الإضافة"], ["carry", "الدين المرحّل"]] : []),
                   ["isMaster", "النوع"], ["by", "بواسطة"], ["times", "مكرّر"]] as [keyof Act, string][]).map(([k, label]) => (
                  <th key={k} className="cursor-pointer select-none p-2 hover:text-mynet-blue" onClick={() => toggleActSort(k)}>{label}<i className="not-italic text-slate-400">{actArrow(k)}</i></th>
                ))}
                {can("receipts.void") && <th className="p-2"></th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={14} className="p-8 text-center text-slate-400">جاري التحميل…</td></tr>
              ) : sortedActs.length === 0 ? (
                <tr><td colSpan={14} className="p-8 text-center text-slate-400">لا تفعيلات في هذا المدى</td></tr>
              ) : sortedActs.map((a) => (
                <tr key={a.id} className={`border-t border-slate-100 ${a.times > 1 ? "bg-amber-50" : ""}`}>
                  <td className="p-2 text-slate-500" dir="ltr">{a.id}</td>
                  <td className="whitespace-nowrap p-2 text-slate-600" dir="ltr">{a.date ? formatDateTime(a.date) : "—"}</td>
                  <td className="p-2 font-semibold text-slate-800">{a.name ?? "—"}</td>
                  <td className="p-2 text-slate-500" dir="ltr">{a.netUser ?? "—"}</td>
                  <td className="p-2 text-slate-500">{a.office ?? "—"}</td>
                  <td className="p-2 text-slate-500">{a.package ?? "—"}</td>
                  {showMoney && <td className="p-2 text-slate-600">{fmt(a.price)}</td>}
                  {showMoney && <td className="p-2 font-bold text-emerald-700">{fmt(a.paid)}</td>}
                  {showMoney && <td className="p-2 text-slate-500">{a.addPrice ? fmt(a.addPrice) : "—"}</td>}
                  {showMoney && <td className={`p-2 font-bold ${(a.carry ?? 0) > 0 ? "text-red-600" : "text-slate-400"}`}>{(a.carry ?? 0) > 0 ? fmt(a.carry) : "—"}</td>}
                  <td className="p-2">{a.isMaster ? <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-semibold text-indigo-700">🅜 ماستر</span> : <span className="text-slate-500">تفعيل</span>}</td>
                  <td className="p-2 text-slate-500">{a.by ?? "—"}</td>
                  <td className="p-2">{a.times > 1 ? <span className="rounded bg-amber-200 px-1.5 py-0.5 font-extrabold text-amber-900">{a.times}×</span> : <span className="text-slate-300">—</span>}</td>
                  {can("receipts.void") && (
                    <td className="p-2">
                      <button onClick={() => void removeAct(a)} disabled={busy}
                        className="rounded-lg bg-red-50 px-2 py-1 text-[11px] font-bold text-red-600 hover:bg-red-100 disabled:opacity-40">🗑️ حذف</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
      /* الجدول */
      <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-right text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-600">
            <tr>
              <th className="p-2"><input type="checkbox" checked={allOn} onChange={toggleAll} title="تحديد الكل" className="h-4 w-4" /></th>
              {([["name", "المشترك"], ["netUser", "اليوزر"], ["phone", "الهاتف"], ["address", "العنوان"],
                 ["packageName", "الباقة"], ["dateTo", "الانتهاء"], ["carry", "الدين"], ["office", "المكتب"]] as [keyof Row, string][]).map(([k, label]) => (
                <th key={k} className="cursor-pointer select-none p-2 hover:text-mynet-blue" onClick={() => toggleSort(k)}>{label}<i className="not-italic text-slate-400">{rowArrow(k)}</i></th>
              ))}
              {status === "online" && <th className="p-2">الاتصال</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="p-8 text-center text-slate-400">جاري التحميل…</td></tr>
            ) : sortedRows.length === 0 ? (
              <tr><td colSpan={10} className="p-8 text-center text-slate-400">لا مشتركين مطابقين</td></tr>
            ) : sortedRows.map((r) => (
              <tr key={r.id} className={`border-t border-slate-100 ${checked.has(r.id) ? "bg-blue-50" : ""}`} onClick={() => toggle(r.id)} style={{ cursor: "pointer" }}>
                <td className="p-2"><input type="checkbox" checked={checked.has(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} className="h-4 w-4" /></td>
                <td className="p-2 font-semibold text-slate-800">{r.name ?? "—"}</td>
                <td className="p-2 text-slate-500" dir="ltr">{r.netUser ?? "—"}</td>
                <td className="p-2 text-slate-500" dir="ltr">{r.phone ?? "—"}</td>
                <td className="p-2 text-slate-500">{r.address ?? "—"}</td>
                <td className="p-2 text-slate-500">{r.packageName ?? "—"}</td>
                <td className="whitespace-nowrap p-2 text-slate-600" dir="ltr">{formatExpiry(r.dateTo)}</td>
                <td className={`p-2 font-bold ${r.carry > 0 ? "text-red-600" : "text-slate-400"}`}>{r.carry > 0 ? fmt(r.carry) : "—"}</td>
                <td className="p-2 text-slate-500">{r.office ?? "—"}</td>
                {status === "online" && <td className="p-2">{r.online ? <span className="text-emerald-600">🟢 متّصل</span> : "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {/* نافذة إرسال الرسالة */}
      {sendOpen && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => !busy && setSendOpen(false)}>
          <div className="my-auto max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-center text-lg font-extrabold text-slate-800">📩 إرسال رسالة لـ {checked.size} مشترك</div>
            {tpls.length > 0 ? (
              <select onChange={(e) => { const t = tpls.find((x) => x.key === e.target.value); if (t?.text) setText(t.text); }}
                className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">— اختر قالباً جاهزاً ({tpls.length}) —</option>
                {tpls.map((t) => (
                  <option key={t.key} value={t.key}>
                    {TPL_NAMES[t.type] ?? t.type}{SCOPE_TAG[t.scope] ?? ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {tplErr ? `تعذّر جلب القوالب: ${tplErr}` : "لا قوالب متاحة — أنشئها من صفحة «قوالب الرسائل»، أو اكتب النصّ يدويّاً أدناه."}
              </div>
            )}
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="نصّ الرسالة… يمكنك استعمال {اسم_المشترك} {اسم_المستخدم} {تاريخ_الانتهاء} {العنوان}"
              className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <p className="mb-3 text-[11px] text-slate-400">
              تُرسَل عبر واتساب مكتب كلّ مشترك، بفاصل ١٠ ثوانٍ بين رسالة وأخرى.
              <b className="text-slate-500"> النافذة تُغلق فوراً والإرسال يكمل صامتاً في الخلفيّة</b> — تابعه من «سجل الرسائل».
            </p>
            <div className="flex gap-2">
              <button onClick={sendMessages} disabled={busy || !text.trim()} className="flex-1 rounded-lg bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? "…" : "إرسال"}</button>
              <button onClick={() => setSendOpen(false)} disabled={busy} className="rounded-lg bg-slate-100 px-4 py-2.5 font-semibold text-slate-600">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (<label className="block"><span className="mb-1 block text-[11px] font-semibold text-slate-500">{label}</span>{children}</label>);
}
