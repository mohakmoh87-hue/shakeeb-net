"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ActivationModal, { type ActSubscriber } from "@/components/ActivationModal";
import AddDebtModal from "@/components/AddDebtModal";
import MapButton from "@/components/MapButton";
import PrintNowButton from "@/components/PrintNowButton";
import { formatDate, formatDateTime } from "@/lib/format";
import { usePermission } from "@/lib/usePermission";
import FieldSettlementCard from "@/components/FieldSettlementCard";
import { askVoidEffect } from "@/lib/voidPrompt";
import { announceMoneyChanged } from "@/lib/moneyRefresh";

// جدول المشتركين في الشاشة الرئيسية (ب2) — يحلّ محلّ صفحة /subscribers:
// آخر 100 تفعيل من الأحدث للأقدم، بحث فوقه، ترويسة أزرار بصفّ واحد،
// شريط خيارات المشترك يظهر بالضغط على الصفّ، وقائمة «المزيد»، ونافذة عمليات 🛠️.
// المنطق منقول من صفحة المشتركين القديمة كما هو (نفس المسارات والنوافذ).

type Subscriber = {
  id: number; name: string | null; phone: string | null; address: string | null;
  packageId: number | null; towerId: number | null; carry: number | null;
  dateTo: string | null; netUser: string | null; sasId: number | null;
  note: string | null; smsEnabled: number | null; waEnabled: boolean | null;
  transferredTo: string | null; rewardBalance: number | null; rewardCode: string | null;
};
type Pkg = { id: number; name: string | null; priceDinar: number | null };
type Tower = { id: number; name: string | null; loginUrl: string | null; activationTemplate: string | null; activationMode: string | null };
type Receipt = { id: number; date: string | null; dateTo: string | null; money: number | null; moneyIn: number | null; moneyCarry: number | null; cardType: string | null; month: string | null };
type MaintLog = { id: number; details: string; technicianName: string | null; kind: string | null; durationSec: number | null; amount: number | null; date: string };
type InvRow = { id: number; number: number | null; date: string | null; totalMy: number | null; waselHim: number | null; type: string | null; note: string | null; subscriberId: number | null };

const FIELD_OPS = [
  { key: "صيانة", icon: "🔧" }, { key: "اعادة", icon: "🔁" },
  { key: "توصيل", icon: "🔌" }, { key: "تحويل", icon: "↪️" },
] as const;

const fmt = (n: number | null | undefined) => (n == null ? "0" : Number(n).toLocaleString("en-US"));
const daysLeft = (dateTo: string | null) => {
  if (!dateTo) return 0;
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dt = new Date(dateTo);
  const expMid = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  return Math.round((expMid - todayMid) / 86400000);
};

export default function SubscribersBoard() {
  const router = useRouter();
  const { can } = usePermission();
  const [subs, setSubs] = useState<Subscriber[]>([]);
  const [total, setTotal] = useState(0);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [towers, setTowers] = useState<Tower[]>([]);
  const [query, setQuery] = useState("");
  const [showAllTowers, setShowAllTowers] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState("");
  const [delMenu, setDelMenu] = useState(false);
  const [moreMenu, setMoreMenu] = useState(false);
  const [activating, setActivating] = useState<Subscriber | null>(null);
  const [addingDebt, setAddingDebt] = useState<Subscriber | null>(null);
  // نوافذ السجلات
  const [logView, setLogView] = useState<"receipts" | "maintenance" | "invoices" | "debt" | "reward" | null>(null);
  // سجل المكافأة: منح واستخدام وعكس — لم يكن في الواجهة ما يكشف تراكمها
  const [rewardLog, setRewardLog] = useState<{
    subscriber: { code: string | null; balance: number; grants: number };
    logs: { id: number; kind: string; amount: number; code: string | null; context: string | null; createdAt: string; createdByName: string | null; balanceAfter: number }[];
    granted: number; redeemed: number; reversed: number; expected: number;
  } | null>(null);
  // دفتر الدين: الدين كان رقماً واحداً بلا تاريخ ولا مصدر (المرحلة ٧)
  const [debtLog, setDebtLog] = useState<{
    rows: { key: string; date: string | null; kind: string; added: number; paid: number; note: string | null; by: string | null }[];
    totals: { added: number; paid: number; expected: number; carry: number; diff: number };
  } | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [maintLogs, setMaintLogs] = useState<MaintLog[]>([]);
  const [invRows, setInvRows] = useState<InvRow[]>([]);
  // نافذة التحرير (تعديل / مشترك جديد)
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<Partial<Subscriber>>({});
  // تنبيه واتساب + حالة واتساب المكاتب
  const [waNotice, setWaNotice] = useState<"no-phone" | "bad-phone" | "no-whatsapp" | null>(null);
  const waCheckId = useRef<number | null>(null);
  const [waOffices, setWaOffices] = useState<{ ready: number; total: number; downNames: string[] } | null>(null);
  // نافذة عمليات 🛠️
  const [opsSub, setOpsSub] = useState<Subscriber | null>(null);
  const [opsBusy, setOpsBusy] = useState(false);
  const [opsMsg, setOpsMsg] = useState("");
  const [opsChosen, setOpsChosen] = useState<string | null>(null);
  const [opsPhone, setOpsPhone] = useState("");
  const [opsNote, setOpsNote] = useState("");
  const [opsAmount, setOpsAmount] = useState("");
  // اختيار الفني (اختياري تماماً — كالهاتف والملاحظة): فارغ ⇒ التوزيع التلقائي إن كان مفعَّلاً
  const [opsTech, setOpsTech] = useState("");
  const [opsTechs, setOpsTechs] = useState<{ id: number; name: string }[]>([]);
  // تسديد دين
  const [payDebtOpen, setPayDebtOpen] = useState(false);
  // استبدال المشترك (نفس اليوزر لساكن جديد) — بياناته تُسحب من SAS تلقائياً بلا ملء يدوي
  const [replacing, setReplacing] = useState<Subscriber | null>(null);
  const [repPrev, setRepPrev] = useState<{
    old: { id: number; name: string | null; netUser: string | null; carry: number };
    sas: { name: string | null; phone: string | null; packageName: string | null; expiration: string | null; enabled: boolean };
    matchedPackage: { id: number; name: string | null } | null;
  } | null>(null);
  const [repErr, setRepErr] = useState("");
  const [repBusy, setRepBusy] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payBusy, setPayBusy] = useState(false);
  const [payErr, setPayErr] = useState("");
  const [summaryBusy, setSummaryBusy] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  // النقر خارج البطاقة يغلق شريط خيارات المشترك وقائمة «المزيد» (طلب محمد)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setSelectedId(null); setMoreMenu(false);
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const selected = subs.find((s) => s.id === selectedId) ?? null;
  const towerName = (id: number | null | undefined) => towers.find((t) => t.id === id)?.name ?? "—";

  // الجلب: بلا بحث = آخر 100 تفعيل؛ مع بحث = المسار الأبجدي المعتاد
  const load = useCallback((q = "", all = false) => {
    const base = q ? `/api/subscribers?q=${encodeURIComponent(q)}` : "/api/subscribers?recent=1";
    fetch(`${base}${all ? "&all=1" : ""}`).then((r) => {
      if (!r.ok) return;
      const t = Number(r.headers.get("X-Total-Count"));
      setTotal(Number.isFinite(t) ? t : 0);
      r.json().then(setSubs);
    });
  }, []);

  useEffect(() => {
    fetch("/api/packages").then((r) => void (r.ok && r.json().then(setPackages)));
    fetch("/api/towers").then((r) => void (r.ok && r.json().then(setTowers)));
    // حالة واتساب المكاتب (يسار الترويسة)
    fetch("/api/whatsapp/offices-status").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d?.offices) {
        const down = (d.disconnected ?? []) as { name: string | null }[];
        setWaOffices({
          ready: d.offices.filter((o: { state: string }) => o.state === "ready").length,
          total: d.offices.length,
          downNames: down.map((o) => o.name ?? "؟"),
        });
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(query, showAllTowers), 250);
    return () => clearTimeout(t);
  }, [query, showAllTowers, load]);

  // فحص واتساب المشترك عند فتحه (تنبيه بحت — نفس سلوك الصفحة القديمة)
  function checkWhatsApp(s: Subscriber) {
    setWaNotice(null);
    waCheckId.current = s.id;
    const digits = (s.phone ?? "").replace(/\D/g, "");
    if (digits.length === 0) { setWaNotice("no-phone"); return; }
    if (digits.length !== 10 && digits.length !== 11) { setWaNotice("bad-phone"); return; }
    fetch(`/api/whatsapp/subscriber-check?subscriberId=${s.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && waCheckId.current === s.id && d.status === "no-whatsapp") setWaNotice("no-whatsapp"); })
      .catch(() => {});
  }

  // الضغط على صفّ: يفتح شريط الخيارات؛ الضغط على الصفّ المفتوح يغلقه
  function selectRow(s: Subscriber) {
    if (selectedId === s.id) { setSelectedId(null); setMoreMenu(false); return; }
    setSelectedId(s.id); setMoreMenu(false); setMsg("");
    checkWhatsApp(s);
  }

  // ===== السجلات (نوافذ) =====
  const loadReceipts = useCallback(() => {
    if (!selectedId) { setReceipts([]); return; }
    fetch(`/api/subscriptions?subscriberId=${selectedId}`).then((r) => { if (r.ok) r.json().then(setReceipts); });
  }, [selectedId]);

  function openLog(view: "receipts" | "maintenance" | "invoices" | "debt" | "reward") {
    if (!selected) return;
    setLogView(view); setMoreMenu(false);
    if (view === "receipts") loadReceipts();
    if (view === "reward") {
      setRewardLog(null);
      fetch(`/api/rewards/log?subscriberId=${selected.id}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setRewardLog(d); }).catch(() => {});
    }
    if (view === "debt") {
      setDebtLog(null);
      fetch(`/api/subscribers/${selected.id}/debt-log`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setDebtLog(d); }).catch(() => {});
    }
    if (view === "maintenance") fetch(`/api/subscribers/${selected.id}/maintenance`).then((r) => { if (r.ok) r.json().then((d) => setMaintLogs(d.logs ?? [])); });
    if (view === "invoices") fetch("/api/invoices").then((r) => (r.ok ? r.json() : [])).then((rows: InvRow[]) => setInvRows(rows.filter((x) => x.subscriberId === selected.id))).catch(() => setInvRows([]));
  }

  async function voidReceipt(id: number) {
    const choice = await askVoidEffect("هذا الوصل");
    if (!choice) return;
    const res = await fetch(`/api/subscription-entries/${id}/void`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reverse: choice.reverse }) });
    if (res.ok) { announceMoneyChanged(); loadReceipts(); load(query, showAllTowers); }
    else { const d = await res.json().catch(() => ({})); alert(d.error ?? "تعذّر الحذف"); }
  }

  // ===== إجراءات شريط الخيارات =====
  async function clearReward() {
    if (!selected) return;
    if (!confirm(`حذف كود ورصيد مكافأة «${selected.name ?? ""}» نهائياً؟`)) return;
    const res = await fetch("/api/rewards/clear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriberId: selected.id }) });
    if (res.ok) load(query, showAllTowers);
    else { const d = await res.json().catch(() => ({})); alert(d.error ?? "تعذّر الحذف"); }
  }

  async function sendSummary() {
    if (!selected || summaryBusy) return;
    setSummaryBusy(true); setMsg("");
    const res = await fetch(`/api/subscribers/${selected.id}/summary`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setSummaryBusy(false); setMoreMenu(false);
    setMsg(res.ok ? "✓ أُرسل ملخص الاشتراك واتساب للمشترك" : (d.error ?? "تعذّر إرسال الملخص"));
  }

  async function payDebt() {
    if (!selected || payBusy) return;
    const n = Number(payAmount) || 0;
    if (n <= 0) { setPayErr("أدخل مبلغاً صحيحاً أو اضغط + لتسديد كامل الدين"); return; }
    setPayBusy(true); setPayErr("");
    const r = await fetch(`/api/debts/${selected.id}/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: n }) });
    const d = await r.json().catch(() => ({}));
    setPayBusy(false);
    if (!r.ok) { setPayErr(d.error ?? "تعذّر التسديد"); return; }
    setPayDebtOpen(false); setPayAmount("");
    setMsg(`✓ سُدِّد ${n.toLocaleString("en-US")} د.ع — المتبقّي ${Number(d.newCarry ?? 0).toLocaleString("en-US")} د.ع`);
    announceMoneyChanged();
    load(query, showAllTowers);
  }

  // ===== استبدال المشترك: القديم يبقى أرشيفاً حياً (ويوزره يوسم «سابق») والجديد يأخذ اليوزر =====
  async function openReplace(s: Subscriber) {
    setMoreMenu(false); setReplacing(s); setRepPrev(null); setRepErr("");
    try {
      const r = await fetch(`/api/subscribers/${s.id}/replace`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setRepErr(d.error ?? "تعذّر جلب بيانات SAS"); return; }
      setRepPrev(d);
    } catch { setRepErr("تعذّر الاتصال بالخادم"); }
  }
  async function doReplace() {
    if (!replacing || repBusy) return;
    setRepBusy(true); setRepErr("");
    const r = await fetch(`/api/subscribers/${replacing.id}/replace`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    setRepBusy(false);
    if (!r.ok) { setRepErr(d.error ?? "فشل الاستبدال"); return; }
    setReplacing(null);
    setMsg(`✓ تم الاستبدال — اليوزر انتقل إلى «${d.sas?.name ?? "المشترك الجديد"}» والسجل القديم محفوظ بوسم «سابق»`);
    if (d.newId) setSelectedId(d.newId);
    load(query, showAllTowers);
  }

  // ===== الحذف الجماعي =====
  function toggleCheck(id: number) { setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  function toggleCheckAll() { setChecked((s) => (s.size === subs.length ? new Set() : new Set(subs.map((x) => x.id)))); }
  async function deleteCurrentList() {
    const ids = checked.size > 0 ? [...checked] : subs.map((s) => s.id);
    if (ids.length === 0) return;
    if (!confirm(`حذف ${ids.length} مشترك من القائمة الحالية؟`)) return;
    await fetch("/api/subscribers/bulk-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    announceMoneyChanged(); // حذف المشترك قد يعكس حركات مالية لليوم
    setChecked(new Set()); setDelMenu(false); setSelectedId(null); load(query, showAllTowers);
  }
  async function deleteAllSubs() {
    if (!confirm("⚠️ حذف جميع المشتركين نهائياً؟")) return;
    if (!confirm("تأكيد أخير: حذف الكل؟")) return;
    await fetch("/api/subscribers/bulk-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) });
    announceMoneyChanged();
    setChecked(new Set()); setDelMenu(false); setSelectedId(null); load(query, showAllTowers);
  }

  // ===== التحرير =====
  function openEdit(sub: Subscriber | null) {
    setForm(sub ? { ...sub } : { waEnabled: true });
    setEditOpen(true); setMsg("");
  }
  const set = (k: keyof Subscriber, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  async function save() {
    if (!form.name?.trim()) { setMsg("الاسم مطلوب"); return; }
    const editingId = form.id ?? null;
    const res = await fetch(editingId ? `/api/subscribers/${editingId}` : "/api/subscribers",
      { method: editingId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (res.ok) {
      const saved = await res.json();
      setMsg("✓ تم الحفظ"); setEditOpen(false); setSelectedId(saved.id);
      load(query, showAllTowers);
      checkWhatsApp({ ...(form as Subscriber), id: saved.id });
    } else {
      const d = await res.json().catch(() => ({}));
      setMsg(d.error ?? "فشل الحفظ");
    }
  }

  // ===== عمليات 🛠️ =====
  // قائمة فنيي مكتب المشترك — كانت لا تُجلب إطلاقاً فتبقى القائمة فارغة دائماً
  // (اختيار الفني في «عمليات» المشترك بلا خيارات — بلاغ محمد ٤ آب).
  function loadOpsTechs(towerId: number | null) {
    setOpsTechs([]);
    const qs = towerId != null ? "?officeId=" + towerId : "";
    fetch("/api/field/technicians" + qs)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.technicians) setOpsTechs(d.technicians.map((t: { id: number; name: string }) => ({ id: t.id, name: t.name }))); })
      .catch(() => {});
  }

  function closeOps() { setOpsSub(null); setOpsChosen(null); setOpsPhone(""); setOpsNote(""); setOpsAmount(""); setOpsTech(""); setOpsTechs([]); }
  async function sendToField(operation: string) {
    if (!opsSub) return;
    setOpsBusy(true); setOpsMsg("");
    const res = await fetch("/api/field/from-subscriber", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscriberId: opsSub.id, operation, extraPhone: opsPhone.trim() || undefined, note: opsNote.trim() || undefined, subAmount: operation === "توصيل" ? (Number(opsAmount) || 0) : undefined, technicianId: opsTech ? Number(opsTech) : undefined }),
    });
    setOpsBusy(false);
    if (res.ok) { setOpsMsg(`✓ تمت إضافة «${opsSub.name ?? ""}» إلى عمود «${operation}» في إدارة الفنيين`); closeOps(); }
    else { const d = await res.json().catch(() => ({})); setOpsMsg(d.error ?? "تعذّرت الإضافة"); }
  }


  return (
    <div className="card" id="subs-board" ref={rootRef}>
      {/* ترويسة النموذج: العنوان + صفّ الأزرار الواحد + «مشترك جديد» وحالة واتساب */}
      <div className="ch">
        <div className="hbtns">
          {can("subscribers.import") && <Link className="gbtn" href="/subscribers/sas4">🔄 استيراد من SAS4</Link>}
          <Link className="gbtn" href="/debts">📑 ديون المشتركين</Link>
          <Link className="gbtn" href="/messages/compose">💬 ارسال رسالة للكل</Link>
          <button className="gbtn" onClick={() => selected && openEdit(selected)} disabled={!selected}>✏️ تعديل</button>
          {can("subscribers.delete") && <button className="gbtn danger" onClick={() => setDelMenu(true)}>🗑️ حذف</button>}
          <span className="newgrp">
            <button className="obtn" onClick={() => openEdit(null)}>+ مشترك جديد</button>
            {waOffices && (
              <button
                className={`wa ${waOffices.ready === waOffices.total ? "up" : "down"}`}
                onClick={() => router.push("/towers")}
                title={waOffices.ready === waOffices.total ? "كل مكاتب الواتساب متصلة" : `اضغط لفتح صفحة ربط QR — غير متصل: ${waOffices.downNames.join("، ")}`}
              >
                <span className="wa-d" />
                {waOffices.ready === waOffices.total
                  ? "واتساب متصل"
                  : `واتساب غير متصل ${waOffices.total - waOffices.ready} مكتب`}
              </button>
            )}
          </span>
        </div>
      </div>

      {/* البحث + «جميع مشتركين المكاتب» */}
      <div className="searchbar">
        <span className="sicon">🔍</span>
        <input
          className="sq"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load(query, showAllTowers)}
          placeholder="بحث بالاسم أو رقم الهاتف أو اليوزر أو اسم المكتب"
        />
        <label className="allofc">
          <input type="checkbox" className="cb" checked={showAllTowers} onChange={(e) => setShowAllTowers(e.target.checked)} />
          جميع مشتركين المكاتب
        </label>
      </div>

      {msg && <div style={{ margin: "0 16px 8px" }} className="rounded-lg bg-ok/10 px-3 py-1.5 text-center text-xs font-semibold text-ok">{msg}</div>}

      {/* الجدول — صفّ الخيارات (subrow) يلتحم بالصفّ المحدَّد كما في النموذج */}
      <div className="tscroll subs-scroll" onClick={() => setMoreMenu(false)}>
        <table className="tbl subs">
          <thead>
            <tr>
              <th className="cbcol"><input type="checkbox" className="cb" title="تحديد الكل" checked={subs.length > 0 && checked.size === subs.length} onChange={toggleCheckAll} /></th>
              <th>اسم المشترك</th><th>عمليات</th><th>اليوزر</th><th>رقم الهاتف</th><th>المكتب</th>
            </tr>
          </thead>
          <tbody>
            {subs.map((s) => {
              const isActive = selectedId === s.id;
              return [
                <tr key={s.id} onClick={() => selectRow(s)}
                  className={`clickable ${checked.has(s.id) ? "picked" : ""} ${isActive ? "active" : ""}`}>
                  <td className="cbcol" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="cb" checked={checked.has(s.id)} onChange={() => toggleCheck(s.id)} />
                  </td>
                  <td>{s.name}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="op" title="عمليات المشترك" onClick={() => { setOpsSub(s); setOpsMsg(""); loadOpsTechs(s.towerId); }}>🛠️</button>
                  </td>
                  <td dir="ltr">{s.netUser ?? "—"}</td>
                  <td className="num" dir="ltr">{s.phone ?? "—"}</td>
                  <td>{towerName(s.towerId)}</td>
                </tr>,
                isActive && (() => {
                  const d = daysLeft(s.dateTo);
                  return (
                    <tr key={`${s.id}-bar`} className="subrow"><td colSpan={6}>
                      <div className="subbar">
                        <div className="sb-row">
                          <button className="sb-act go" onClick={() => setActivating(s)}>⚡ تفعيل</button>
                          <span className="sb-sep" />
                          <span className={`sb-chip c-days ${d < 0 ? "bad" : d > 7 ? "ok" : ""}`}>الأيام المتبقية <b>{d}</b></span>
                          <button className={`sb-chip c-debt ${(s.carry ?? 0) <= 0 ? "zero" : ""}`} style={{ border: 0, cursor: "pointer", fontFamily: "inherit" }}
                            disabled={(s.carry ?? 0) <= 0}
                            onClick={() => { setPayDebtOpen(true); setPayAmount(""); setPayErr(""); }}
                            title="تسديد دين">
                            الديون <b>{fmt(s.carry)}</b>
                          </button>
                          <span className="sb-chip c-rew">كود المكافأة <b>{fmt(s.rewardBalance)}</b></span>
                          {/* مبلغ الاشتراك = سعر فئة المشترك (طلب محمد) */}
                          <span className="sb-chip c-sub">مبلغ الاشتراك <b>{fmt(packages.find((p) => p.id === s.packageId)?.priceDinar ?? 0)}</b></span>
                          <button className={`sb-act ${moreMenu ? "on" : ""}`} aria-haspopup="true"
                            onClick={(e) => {
                              e.stopPropagation();
                              const scroller = (e.currentTarget as HTMLElement).closest(".subs-scroll") as HTMLElement | null;
                              setMoreMenu((v) => !v);
                              // آخر مشترك بالقائمة: إظهار اللوحة المنفتحة كاملة — محاذاة نهايتها
                              // بحافة القائمة، مع دفعة تمرير احتياطية إن بقيت مخفية
                              if (!moreMenu) setTimeout(() => {
                                const p = document.querySelector(".sb-panel") as HTMLElement | null;
                                if (!p) return;
                                p.scrollIntoView({ block: "end", behavior: "smooth" });
                                if (scroller) {
                                  const pr = p.getBoundingClientRect();
                                  const sr = scroller.getBoundingClientRect();
                                  if (pr.bottom > sr.bottom) scroller.scrollTop += pr.bottom - sr.bottom + 8;
                                }
                              }, 60);
                            }}>⋯ المزيد</button>
                          <button className="sb-x" style={{ marginInlineStart: "auto" }} onClick={() => { setSelectedId(null); setMoreMenu(false); }} aria-label="إلغاء التحديد">✕</button>
                        </div>
                        {moreMenu && (
                          <div className="sb-panel" onClick={(e) => e.stopPropagation()}>
                            <button className="sb-act" onClick={() => openLog("receipts")}>📄 سجل الوصولات</button>
                            <button className="sb-act" onClick={() => openLog("debt")}>📕 دفتر الدين</button>
                            <button className="sb-act" onClick={() => openLog("reward")}>🎁 سجل المكافأة</button>
                            <button className="sb-act" onClick={() => openLog("maintenance")}>🔧 سجل الصيانات</button>
                            <MapButton subscriberId={s.id} />
                            <button className="sb-act" onClick={() => openLog("invoices")}>🧾 وصولات الفواتير</button>
                            <button className="sb-act" onClick={() => void sendSummary()}>{summaryBusy ? "جارٍ الإرسال..." : "💬 ارسال ملخص"}</button>
                            <button className="sb-act" onClick={() => { setMoreMenu(false); setPayDebtOpen(true); setPayAmount(""); setPayErr(""); }}>💵 تسديد اشتراك</button>
                            <button className="sb-act" onClick={() => router.push("/debts")}>💲 تسديد فواتير</button>
                            <button className="sb-act" onClick={() => router.push("/tickets")}>📝 اضافة مذكرة</button>
                            <button className="sb-act" onClick={() => void openReplace(s)}>↔️ استبدال المشترك</button>
                            <button className="sb-act sb-danger" onClick={() => { setMoreMenu(false); setAddingDebt(s); }}>🅰️ اضافة ديون سابقة</button>
                            {can("rewards.clear") && <button className="sb-act sb-danger" onClick={() => { setMoreMenu(false); void clearReward(); }}>🎁 حذف كود المكافأة</button>}
                          </div>
                        )}
                      </div>
                    </td></tr>
                  );
                })(),
              ];
            })}
            {subs.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: 28, color: "var(--muted)" }}>لا نتائج</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 16px", fontSize: 11, fontWeight: 700, color: "var(--ink-2)", borderTop: "1px solid var(--line)" }}>
        <span>{total > subs.length ? `عرض ${subs.length} من ${total}` : subs.length}</span>
        {total > subs.length && <span style={{ color: "var(--orange-d)", fontWeight: 400 }}>🔍 اكتب في البحث لإيجاد الباقي</span>}
      </div>

      {/* تحصيل الفنيين — شريط أفقي أسفل المشتركين (كما في النموذج) */}
      <FieldSettlementCard />


      {/* ===== النوافذ ===== */}

      {/* سجل الوصولات / الصيانات / وصولات الفواتير */}
      {logView && selected && (
        <Modal onClose={() => setLogView(null)} wide>
          <div className="mb-3 text-center text-base font-extrabold text-ink">
            {logView === "receipts" ? "سجل وصولات المشترك" : logView === "maintenance" ? "سجل صيانات المشترك" : logView === "debt" ? "دفتر دين المشترك" : logView === "reward" ? "سجل مكافأة المشترك" : "وصولات الفواتير"} — {selected.name}
          </div>
          <div className="max-h-[62vh] overflow-auto rounded-lg border border-line">
            {logView === "reward" ? (
              !rewardLog ? (
                <div className="p-8 text-center text-muted">جاري التحميل...</div>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-2 p-3 text-center text-xs">
                    <div><div className="text-muted">مُنح</div><b className="text-ok">{fmt(rewardLog.granted)}</b></div>
                    <div><div className="text-muted">استُخدم</div><b>{fmt(rewardLog.redeemed)}</b></div>
                    <div><div className="text-muted">عُكس</div><b className="text-bad">{fmt(rewardLog.reversed)}</b></div>
                    <div><div className="text-muted">الرصيد الآن</div><b>{fmt(rewardLog.subscriber.balance)}</b></div>
                  </div>
                  {rewardLog.expected !== rewardLog.subscriber.balance && (
                    <div className="mx-3 mb-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
                      ⚠️ فرق {fmt(Math.abs(rewardLog.expected - rewardLog.subscriber.balance))} بين الرصيد ومجموع سجلّه — أي أن الرصيد عُدِّل من خارج المنح والاستخدام.
                    </div>
                  )}
                  <div className="px-3 pb-1 text-[11px] text-muted">الكود الحالي: <b>{rewardLog.subscriber.code ?? "—"}</b> · عدد المنح المتراكمة: {rewardLog.subscriber.grants}</div>
                  <table className="tbl">
                    <thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>الكود</th><th>السياق</th><th>الرصيد بعده</th><th>بواسطة</th></tr></thead>
                    <tbody>
                      {rewardLog.logs.length === 0 ? (
                        <tr><td colSpan={7} className="p-6 text-center text-muted">لا مكافآت لهذا المشترك</td></tr>
                      ) : rewardLog.logs.map((r) => (
                        <tr key={r.id}>
                          <td className="num" dir="ltr">{formatDateTime(r.createdAt)}</td>
                          <td>{r.kind === "grant" ? "منح" : r.kind === "redeem" ? "استخدام" : r.kind === "reverse" ? "عكس منح" : r.kind}</td>
                          <td className="num" style={{ color: r.kind === "grant" ? "var(--ok)" : "var(--bad)" }}>{fmt(r.amount)}</td>
                          <td dir="ltr">{r.code ?? "—"}</td>
                          <td>{r.context ?? "—"}</td>
                          <td className="num">{fmt(r.balanceAfter)}</td>
                          <td>{r.createdByName ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )
            ) : logView === "debt" ? (
              !debtLog ? (
                <div className="p-8 text-center text-muted">جاري التحميل...</div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 p-3 text-center text-xs">
                    <div><div className="text-muted">أُضيف ديناً</div><b className="text-bad">{fmt(debtLog.totals.added)}</b></div>
                    <div><div className="text-muted">سُدِّد/أُسقط</div><b className="text-ok">{fmt(debtLog.totals.paid)}</b></div>
                    <div><div className="text-muted">الدين الحالي</div><b>{fmt(debtLog.totals.carry)}</b></div>
                  </div>
                  {debtLog.totals.diff !== 0 && (
                    <div className="mx-3 mb-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
                      ⚠️ فرق {fmt(Math.abs(debtLog.totals.diff))} بين الدين المسجَّل ومجموع مصادره —
                      أي أن الدين عُدِّل يوماً من خارج التفعيلات والفواتير والتسديدات.
                    </div>
                  )}
                  <table className="tbl">
                    <thead><tr><th>التاريخ</th><th>النوع</th><th>أُضيف</th><th>سُدِّد</th><th>التفصيل</th><th>بواسطة</th></tr></thead>
                    <tbody>
                      {debtLog.rows.length === 0 ? (
                        <tr><td colSpan={6} className="p-6 text-center text-muted">لا حركات دين لهذا المشترك</td></tr>
                      ) : debtLog.rows.map((r) => (
                        <tr key={r.key}>
                          <td className="num" dir="ltr">{r.date ? formatDateTime(r.date) : "—"}</td>
                          <td>{r.kind}</td>
                          <td className="num" style={{ color: r.added ? "var(--bad)" : undefined }}>{r.added ? fmt(r.added) : "—"}</td>
                          <td className="num" style={{ color: r.paid ? "var(--ok)" : undefined }}>{r.paid ? fmt(r.paid) : "—"}</td>
                          <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }} title={r.note ?? undefined}>{r.note ?? "—"}</td>
                          <td>{r.by ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )
            ) : logView === "receipts" ? (
              <table className="w-full text-right text-xs [&_td]:tabular-nums">
                <thead className="sticky top-0 bg-surface-2 text-ink-2"><tr>
                  <th className="p-2">#</th><th className="p-2">التاريخ والوقت</th><th className="p-2">الباقة</th>
                  <th className="p-2">أشهر</th><th className="p-2">القيمة</th><th className="p-2">الواصل</th>
                  <th className="p-2">الدين</th><th className="p-2">ينتهي</th><th className="p-2"></th>
                </tr></thead>
                <tbody>
                  {receipts.length === 0 ? <tr><td colSpan={9} className="p-6 text-center text-muted">لا توجد وصولات لهذا المشترك</td></tr>
                    : receipts.map((rc) => (
                      <tr key={rc.id} className="border-t border-line">
                        <td className="p-2 text-muted">{rc.id}</td>
                        <td className="p-2" dir="ltr">{formatDateTime(rc.date)}</td>
                        <td className="p-2">{rc.cardType ?? "—"}</td>
                        <td className="p-2">{rc.month ?? "—"}</td>
                        <td className="p-2">{fmt(rc.money)}</td>
                        <td className="p-2 text-ok">{fmt(rc.moneyIn)}</td>
                        <td className="p-2 text-bad">{fmt(rc.moneyCarry)}</td>
                        <td className="p-2" dir="ltr">{formatDate(rc.dateTo)}</td>
                        <td className="p-2"><div className="flex gap-1.5">
                          <PrintNowButton kind="subscription" id={rc.id} />
                          {can("receipts.void") && <button onClick={() => voidReceipt(rc.id)} className="rounded bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-bad hover:bg-red-100" title="حذف عكسي">🗑</button>}
                        </div></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : logView === "maintenance" ? (
              <table className="w-full text-right text-xs">
                <thead className="sticky top-0 bg-surface-2 text-ink-2"><tr>
                  <th className="p-2">التاريخ والوقت</th><th className="p-2">النوع</th><th className="p-2">التفاصيل</th><th className="p-2">المبلغ</th><th className="p-2">الفني</th><th className="p-2">المدة</th>
                </tr></thead>
                <tbody>
                  {maintLogs.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-muted">لا توجد صيانات لهذا المشترك</td></tr>
                    : maintLogs.map((m) => (
                      <tr key={m.id} className="border-t border-line align-top">
                        <td className="whitespace-nowrap p-2" dir="ltr">{new Date(m.date).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                        <td className="whitespace-nowrap p-2">{m.kind ?? "صيانة"}</td>
                        <td className="p-2 text-ink">{m.details}</td>
                        <td className="whitespace-nowrap p-2 font-semibold text-ok">{m.amount != null ? fmt(m.amount) : "—"}</td>
                        <td className="whitespace-nowrap p-2 text-ink-2">{m.technicianName ?? "—"}</td>
                        <td className="whitespace-nowrap p-2 text-ink-2">{m.durationSec != null ? (m.durationSec >= 3600 ? `${Math.floor(m.durationSec / 3600)}س ${Math.floor((m.durationSec % 3600) / 60)}د` : m.durationSec >= 60 ? `${Math.floor(m.durationSec / 60)}د` : `${m.durationSec}ث`) : "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-right text-xs [&_td]:tabular-nums">
                <thead className="sticky top-0 bg-surface-2 text-ink-2"><tr>
                  <th className="p-2">#</th><th className="p-2">التاريخ</th><th className="p-2">النوع</th><th className="p-2">الإجمالي</th><th className="p-2">الواصل</th><th className="p-2">ملاحظة</th>
                </tr></thead>
                <tbody>
                  {invRows.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-muted">لا فواتير لهذا المشترك</td></tr>
                    : invRows.map((v) => (
                      <tr key={v.id} className="border-t border-line">
                        <td className="p-2 text-muted">{v.number ?? v.id}</td>
                        <td className="p-2" dir="ltr">{formatDateTime(v.date)}</td>
                        <td className="p-2">{v.type ?? "بيع"}</td>
                        <td className="p-2">{fmt(v.totalMy)}</td>
                        <td className="p-2 text-ok">{fmt(v.waselHim)}</td>
                        <td className="p-2 text-ink-2">{v.note ?? "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
          <button onClick={() => setLogView(null)} className="mt-3 w-full rounded-lg bg-surface-2 py-2 text-sm text-ink-2 hover:bg-line">إغلاق</button>
        </Modal>
      )}

      {/* نافذة التحرير */}
      {editOpen && (
        <Modal onClose={() => setEditOpen(false)}>
          <div className="mb-3 text-center text-base font-extrabold text-ink">{form.id ? "تعديل بيانات المشترك" : "إضافة مشترك جديد"}</div>
          <FRow label="الاسم"><FInp v={form.name} onChange={(v) => set("name", v)} /></FRow>
          <FRow label="اليوزر"><FInp v={form.netUser} onChange={(v) => set("netUser", v)} dir="ltr" /></FRow>
          <FRow label="الهاتف"><FInp v={form.phone} onChange={(v) => set("phone", v)} dir="ltr" /></FRow>
          <FRow label="المكتب">
            <select value={form.towerId ?? ""} onChange={(e) => set("towerId", Number(e.target.value) || null)} className="w-full rounded border border-line bg-surface px-2 py-1.5 text-sm">
              <option value="">—</option>
              {towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </FRow>
          <FRow label="فئة الاشتراك">
            <select value={form.packageId ?? ""} onChange={(e) => set("packageId", Number(e.target.value) || null)} className="w-full rounded border border-line bg-surface px-2 py-1.5 text-sm">
              <option value="">—</option>
              {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </FRow>
          <FRow label="العنوان"><FInp v={form.address} onChange={(v) => set("address", v)} /></FRow>
          <FRow label="ملاحظات">
            <textarea value={form.note ?? ""} onChange={(e) => set("note", e.target.value)} rows={2} className="w-full rounded border border-line bg-surface px-2 py-1.5 text-sm" />
          </FRow>
          <FRow label="واتساب">
            <label className="flex items-center gap-2 text-xs text-ink-2">
              <input type="checkbox" checked={form.waEnabled !== false} onChange={(e) => set("waEnabled", e.target.checked)} className="h-4 w-4 accent-emerald-600" />
              استلام رسائل واتساب
            </label>
          </FRow>
          {msg && <div className="mt-2 rounded bg-blue-50 px-2 py-1 text-center text-xs text-navy-3">{msg}</div>}
          <div className="mt-3 flex gap-2">
            <button onClick={() => void save()} className="flex-1 rounded-lg bg-ok py-2.5 text-sm font-bold text-white">💾 حفظ</button>
            <button onClick={() => setEditOpen(false)} className="rounded-lg bg-surface-2 px-4 py-2.5 text-sm text-ink-2">إلغاء</button>
          </div>
        </Modal>
      )}

      {/* خيارات الحذف */}
      {delMenu && (
        <Modal onClose={() => setDelMenu(false)}>
          <h3 className="mb-4 text-center text-lg font-bold text-ink">حذف المشتركين</h3>
          <button onClick={deleteCurrentList} className="mb-2 w-full rounded-lg bg-red-600 py-3 font-semibold text-white hover:bg-red-700">
            🗑️ حذف القائمة الحالية
            <span className="block text-xs font-normal opacity-90">{checked.size > 0 ? `المحدّدون: ${checked.size}` : `المعروضون الآن: ${subs.length}`}</span>
          </button>
          <button onClick={deleteAllSubs} className="mb-3 w-full rounded-lg border border-red-300 bg-red-50 py-3 font-semibold text-red-700 hover:bg-red-100">
            حذف جميع المشتركين
            <span className="block text-xs font-normal opacity-80">كل المشتركين في قاعدة البيانات</span>
          </button>
          <button onClick={() => setDelMenu(false)} className="w-full rounded-lg bg-surface-2 py-2 text-ink-2">إلغاء</button>
        </Modal>
      )}

      {/* تنبيه واتساب */}
      {selected && waNotice && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/60 p-4" onClick={() => setWaNotice(null)}>
          <div onClick={(e) => e.stopPropagation()} className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-surface p-7 text-center shadow-2xl">
            <div className={`mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full text-5xl ${waNotice === "no-whatsapp" ? "bg-red-100" : "bg-amber-100"}`}>
              {waNotice === "no-whatsapp" ? "⚠️" : "📵"}
            </div>
            <h2 className={`mb-2 text-2xl font-extrabold ${waNotice === "no-whatsapp" ? "text-red-700" : "text-amber-700"}`}>تنبيه واتساب</h2>
            <p className="mb-1 text-lg font-bold text-ink">المشترك «{selected.name ?? "—"}»</p>
            <p className="mb-1 text-base text-ink-2">
              {waNotice === "no-phone" ? "لا يملك رقم هاتف"
                : waNotice === "bad-phone" ? `رقم هاتفه غير صحيح (${(selected.phone ?? "").replace(/\D/g, "").length} أرقام — يجب أن يكون ١٠ أو ١١)`
                : "لا يملك واتساب على رقمه"}
            </p>
            <p className="mb-5 text-sm text-muted">لن تصله رسائل واتساب.</p>
            <button onClick={() => setWaNotice(null)} className="w-full rounded-xl bg-navy py-3 text-lg font-bold text-white">حسناً</button>
          </div>
        </div>
      )}

      {/* نافذة عمليات 🛠️ (صيانة/اعادة/توصيل/تحويل بخطوتين) */}
      {opsSub && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={closeOps}>
          <div className="ops-sheet max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="ops-head">
              <h3>عمليات المشترك</h3>
              <div className="who">{opsSub.name ?? opsSub.netUser ?? `مشترك #${opsSub.id}`}</div>
            </div>
            <div className="ops-body">
              {!opsChosen ? (
                <>
                  <div className="ops-grid">
                    {FIELD_OPS.map((op) => (
                      <button key={op.key} disabled={opsBusy} className="ops-btn"
                        onClick={() => { setOpsChosen(op.key); setOpsPhone(""); setOpsNote(""); setOpsAmount(""); }}>
                        <span className="e">{op.icon}</span>
                        <span>{op.key}</span>
                      </button>
                    ))}
                  </div>
                  <button onClick={closeOps} className="ops-cancel">إلغاء</button>
                </>
              ) : (
                <>
                  <div className="ops-chip">{FIELD_OPS.find((o) => o.key === opsChosen)?.icon} {opsChosen}</div>
                  {opsChosen === "توصيل" && (
                    <>
                      <label className="ops-lb amt">💵 مبلغ الاشتراك (يظهر على وجه البطاقة ليعرف الفني كم يأخذ من الزبون)</label>
                      <input type="number" className="ops-in" value={opsAmount} onChange={(e) => setOpsAmount(e.target.value)} dir="ltr" placeholder="مثال: 25000" />
                    </>
                  )}
                  <label className="ops-lb">رقم هاتف إضافي (اختياري)</label>
                  <input className="ops-in" value={opsPhone} onChange={(e) => setOpsPhone(e.target.value)} dir="ltr" placeholder={opsSub.phone ? `الأصلي: ${opsSub.phone}` : "07..."} />
                  <label className="ops-lb">الفني (اختياري)</label>
                  <select className="ops-in" value={opsTech} onChange={(e) => setOpsTech(e.target.value)}>
                    <option value="">— بلا فني (توزيع تلقائي إن كان مفعَّلاً) —</option>
                    {opsTechs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <label className="ops-lb">ملاحظة (اختيارية)</label>
                  <textarea className="ops-in" value={opsNote} onChange={(e) => setOpsNote(e.target.value)} rows={3} placeholder="تفاصيل أو ملاحظة للفني..." />
                  <p className="ops-hint">تُضاف مع رقم المشترك الأصلي إلى البطاقة. اتركها فارغة واضغط موافق لإنشاء البطاقة كالمعتاد.</p>
                  <div className="ops-acts">
                    <button className="ops-ok" onClick={() => sendToField(opsChosen)} disabled={opsBusy}>{opsBusy ? "..." : "موافق"}</button>
                    <button className="ops-back" onClick={() => setOpsChosen(null)} disabled={opsBusy}>رجوع</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* إشعار نتيجة العملية */}
      {opsMsg && (() => {
        const okRes = opsMsg.startsWith("✓");
        return (
          <div className="pointer-events-none fixed inset-x-0 top-3 z-[75] flex justify-center px-3">
            <div className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-4 py-3 text-sm font-semibold shadow-2xl ${okRes ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-400 bg-amber-50 text-amber-900"}`}>
              <span className="flex-1 whitespace-pre-line leading-relaxed">{opsMsg}</span>
              <button onClick={() => setOpsMsg("")} className="shrink-0 rounded-full px-2 text-lg leading-none text-muted hover:bg-black/10" title="إغلاق">✕</button>
            </div>
          </div>
        );
      })()}

      {/* نافذة تسديد الدين */}
      {payDebtOpen && selected && (
        <Modal onClose={() => setPayDebtOpen(false)}>
          <h3 className="mb-1 text-lg font-bold text-ink">💵 تسديد دين: {selected.name}</h3>
          <div className="mb-3 flex items-center justify-between rounded-lg bg-red-50 px-3 py-2">
            <span className="text-sm text-ink-2">الدين الحالي عليه:</span>
            <span className="text-lg font-extrabold text-bad">{fmt(selected.carry)} د.ع</span>
          </div>
          <label className="mb-1 block text-xs font-semibold text-muted">المبلغ الواصل</label>
          <div className="mb-2 flex gap-2">
            <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="اكتب المبلغ يدوياً..." dir="ltr"
              className="flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-navy-3" />
            <button onClick={() => setPayAmount(String(selected.carry ?? 0))} title="تسديد كامل الدين" className="rounded-lg bg-ok px-4 py-2 text-lg font-extrabold text-white">+</button>
          </div>
          <p className="mb-2 text-[11px] text-muted">اضغط «+» ليصل كامل المبلغ، أو اكتب المبلغ الواصل يدوياً فقط.</p>
          {payErr && <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-bad">{payErr}</div>}
          <div className="flex gap-2">
            <button onClick={() => void payDebt()} disabled={payBusy} className="flex-1 rounded-lg bg-ok py-2.5 font-bold text-white disabled:opacity-50">{payBusy ? "جارٍ التسديد..." : "✓ تسديد"}</button>
            <button onClick={() => setPayDebtOpen(false)} className="rounded-lg bg-surface-2 px-4 py-2.5 font-semibold text-ink-2">إلغاء</button>
          </div>
        </Modal>
      )}

      {/* نافذة استبدال المشترك — البيانات من SAS تلقائياً (حدّثها هناك أولاً) */}
      {replacing && (
        <Modal onClose={() => setReplacing(null)}>
          <h3 className="mb-1 text-lg font-bold text-ink">↔️ استبدال المشترك — نفس اليوزر لساكن جديد</h3>
          <p className="mb-3 text-[11px] leading-relaxed text-muted">
            حدّث معلومات الساكن الجديد في لوحة SAS أولاً (الاسم/الهاتف/الباقة/الانتهاء) — البيانات أدناه مسحوبة من SAS الآن.
            السجل القديم يبقى بكل تاريخه ودينه ويوزره يوسم «سابق»، ويبقى ضمن «رسالة للكل» لاستهداف تاركي الخدمة.
          </p>
          {repErr ? (
            <>
              <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-bad">{repErr}</div>
              <div className="flex gap-2">
                <button onClick={() => void openReplace(replacing)} className="flex-1 rounded-lg bg-navy-3 py-2.5 font-bold text-white">🔄 إعادة المحاولة</button>
                <button onClick={() => setReplacing(null)} className="rounded-lg bg-surface-2 px-4 py-2.5 font-semibold text-ink-2">إغلاق</button>
              </div>
            </>
          ) : !repPrev ? (
            <div className="rounded-lg bg-surface-2 px-3 py-6 text-center text-sm text-muted">⏳ جارٍ القراءة من SAS...</div>
          ) : (
            <>
              <div className="mb-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
                <div className="mb-1 text-[11px] font-bold text-muted">السجل القديم (يبقى محفوظاً)</div>
                <div className="font-semibold text-ink">{repPrev.old.name ?? "—"}</div>
                <div className="text-xs text-ink-2" dir="ltr">{repPrev.old.netUser}</div>
                {repPrev.old.carry > 0 && <div className="mt-1 text-xs font-semibold text-bad">دين بذمته: {fmt(repPrev.old.carry)} د.ع (يبقى عليه)</div>}
              </div>
              <div className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                <div className="mb-1 text-[11px] font-bold text-emerald-700">الساكن الجديد — كما في SAS الآن</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink">
                  <span>الاسم: <b>{repPrev.sas.name ?? "—"}</b></span>
                  <span dir="ltr">📞 {repPrev.sas.phone ?? "—"}</span>
                  <span>الباقة: <b>{repPrev.sas.packageName ?? "—"}</b></span>
                  <span>الانتهاء: <b dir="ltr">{repPrev.sas.expiration ? repPrev.sas.expiration.slice(0, 10) : "—"}</b></span>
                  <span>الحالة: {repPrev.sas.enabled ? "✅ مفعّل" : "⛔ موقوف"}</span>
                  <span>{repPrev.matchedPackage ? `تطابق باقاتنا: ${repPrev.matchedPackage.name}` : "⚠️ الباقة لا تطابق باقاتنا — سيبقى على باقة السجل"}</span>
                </div>
              </div>
              {repErr && <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-bad">{repErr}</div>}
              <div className="flex gap-2">
                <button onClick={() => void doReplace()} disabled={repBusy} className="flex-1 rounded-lg bg-ok py-2.5 font-bold text-white disabled:opacity-50">
                  {repBusy ? "جارٍ الاستبدال..." : "↔️ تنفيذ الاستبدال"}
                </button>
                <button onClick={() => void openReplace(replacing)} title="إعادة السحب من SAS" className="rounded-lg bg-navy-3 px-3 py-2.5 font-bold text-white">🔄</button>
                <button onClick={() => setReplacing(null)} className="rounded-lg bg-surface-2 px-4 py-2.5 font-semibold text-ink-2">إلغاء</button>
              </div>
            </>
          )}
        </Modal>
      )}

      {activating && (
        <ActivationModal
          subscriber={activating as ActSubscriber}
          packages={packages}
          tower={towers.find((t) => t.id === activating.towerId)}
          onClose={() => setActivating(null)}
          onDone={() => { setActivating(null); load(query, showAllTowers); }}
        />
      )}

      {addingDebt && (
        <AddDebtModal
          subscriber={{ id: addingDebt.id, name: addingDebt.name ?? null, netUser: addingDebt.netUser ?? null, carry: addingDebt.carry ?? null }}
          onClose={() => setAddingDebt(null)}
          onDone={() => { setAddingDebt(null); load(query, showAllTowers); }}
        />
      )}
    </div>
  );
}

/* ===== عناصر مساعدة ===== */
function Modal({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className={`max-h-[92dvh] w-full ${wide ? "max-w-3xl" : "max-w-sm"} overflow-y-auto rounded-2xl bg-surface p-5 shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
function FRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <label className="w-24 shrink-0 text-left text-xs font-semibold text-ink-2">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}
function FInp({ v, onChange, dir }: { v?: string | null; onChange: (v: string) => void; dir?: string }) {
  return <input value={v ?? ""} dir={dir} onChange={(e) => onChange(e.target.value)} className="w-full rounded border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-navy-3" />;
}
