"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ActivationModal, { type ActSubscriber } from "@/components/ActivationModal";
import AddDebtModal from "@/components/AddDebtModal";
import MapButton from "@/components/MapButton";
import PrintNowButton from "@/components/PrintNowButton";
import { formatDate, formatDateTime } from "@/lib/format";
import { usePermission } from "@/lib/usePermission";
import { askVoidEffect } from "@/lib/voidPrompt";

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
  const [logView, setLogView] = useState<"receipts" | "maintenance" | "invoices" | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [maintLogs, setMaintLogs] = useState<MaintLog[]>([]);
  const [invRows, setInvRows] = useState<InvRow[]>([]);
  // نافذة التحرير (تعديل / مشترك جديد)
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<Partial<Subscriber>>({});
  // تنبيه واتساب + حالة واتساب المكاتب
  const [waNotice, setWaNotice] = useState<"no-phone" | "bad-phone" | "no-whatsapp" | null>(null);
  const waCheckId = useRef<number | null>(null);
  const [waOffices, setWaOffices] = useState<{ ready: number; total: number } | null>(null);
  // نافذة عمليات 🛠️
  const [opsSub, setOpsSub] = useState<Subscriber | null>(null);
  const [opsBusy, setOpsBusy] = useState(false);
  const [opsMsg, setOpsMsg] = useState("");
  const [opsChosen, setOpsChosen] = useState<string | null>(null);
  const [opsPhone, setOpsPhone] = useState("");
  const [opsNote, setOpsNote] = useState("");
  const [opsAmount, setOpsAmount] = useState("");
  // تسديد دين
  const [payDebtOpen, setPayDebtOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payBusy, setPayBusy] = useState(false);
  const [payErr, setPayErr] = useState("");
  const [summaryBusy, setSummaryBusy] = useState(false);

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
      if (d?.offices) setWaOffices({ ready: d.offices.filter((o: { state: string }) => o.state === "ready").length, total: d.offices.length });
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

  function openLog(view: "receipts" | "maintenance" | "invoices") {
    if (!selected) return;
    setLogView(view); setMoreMenu(false);
    if (view === "receipts") loadReceipts();
    if (view === "maintenance") fetch(`/api/subscribers/${selected.id}/maintenance`).then((r) => { if (r.ok) r.json().then((d) => setMaintLogs(d.logs ?? [])); });
    if (view === "invoices") fetch("/api/invoices").then((r) => (r.ok ? r.json() : [])).then((rows: InvRow[]) => setInvRows(rows.filter((x) => x.subscriberId === selected.id))).catch(() => setInvRows([]));
  }

  async function voidReceipt(id: number) {
    const choice = await askVoidEffect("هذا الوصل");
    if (!choice) return;
    const res = await fetch(`/api/subscription-entries/${id}/void`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reverse: choice.reverse }) });
    if (res.ok) { loadReceipts(); load(query, showAllTowers); }
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
    setChecked(new Set()); setDelMenu(false); setSelectedId(null); load(query, showAllTowers);
  }
  async function deleteAllSubs() {
    if (!confirm("⚠️ حذف جميع المشتركين نهائياً؟")) return;
    if (!confirm("تأكيد أخير: حذف الكل؟")) return;
    await fetch("/api/subscribers/bulk-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) });
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
  function closeOps() { setOpsSub(null); setOpsChosen(null); setOpsPhone(""); setOpsNote(""); setOpsAmount(""); }
  async function sendToField(operation: string) {
    if (!opsSub) return;
    setOpsBusy(true); setOpsMsg("");
    const res = await fetch("/api/field/from-subscriber", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscriberId: opsSub.id, operation, extraPhone: opsPhone.trim() || undefined, note: opsNote.trim() || undefined, subAmount: operation === "توصيل" ? (Number(opsAmount) || 0) : undefined }),
    });
    setOpsBusy(false);
    if (res.ok) { setOpsMsg(`✓ تمت إضافة «${opsSub.name ?? ""}» إلى عمود «${operation}» في إدارة الفنيين`); closeOps(); }
    else { const d = await res.json().catch(() => ({})); setOpsMsg(d.error ?? "تعذّرت الإضافة"); }
  }

  const remaining = selected ? daysLeft(selected.dateTo) : 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      {/* ترويسة الأزرار — صفّ واحد لا ينكسر، يمرّر أفقياً */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-line px-2 py-1.5 [scrollbar-width:thin]">
        <HBtn primary label="+ مشترك جديد" onClick={() => openEdit(null)} />
        <HBtn label="✏️ تعديل" onClick={() => selected && openEdit(selected)} disabled={!selected} />
        {can("subscribers.delete") && <HBtn label="🗑️ حذف" onClick={() => setDelMenu(true)} />}
        <HBtn label="📑 ديون المشتركين" onClick={() => router.push("/debts")} />
        <HBtn label="💬 ارسال رسالة للكل" onClick={() => router.push("/messages/compose")} />
        {can("subscribers.import") && <HBtn label="⬇️ استيراد من SAS4" onClick={() => router.push("/subscribers/sas4")} />}
        <label className="mr-auto flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[11px] font-semibold text-ink-2">
          <input type="checkbox" checked={showAllTowers} onChange={(e) => setShowAllTowers(e.target.checked)} />
          عرض جميع المشتركين من كل المكاتب
        </label>
        {waOffices && (
          <span title="حالة واتساب المكاتب" className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${waOffices.ready === waOffices.total ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad"}`}>
            {waOffices.ready === waOffices.total ? "🟢" : "🔴"} واتساب {waOffices.ready}/{waOffices.total}
          </span>
        )}
      </div>

      {/* البحث */}
      <div className="flex items-center gap-1 border-b border-line p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load(query, showAllTowers)}
          placeholder="بحث بالاسم أو رقم الهاتف أو اليوزر أو اسم المكتب"
          className="flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:border-navy-3"
        />
        <button onClick={() => load(query, showAllTowers)} className="rounded-lg bg-navy px-3 py-1.5 text-white">🔍</button>
      </div>

      {msg && <div className="border-b border-line bg-ok/10 px-3 py-1.5 text-center text-xs font-semibold text-ok">{msg}</div>}

      {/* شريط خيارات المشترك — يظهر عند اختيار صفّ */}
      {selected && (
        <div className="relative flex items-center gap-1.5 overflow-x-auto border-b border-line bg-surface-2 px-2 py-1.5 [scrollbar-width:thin]">
          <button onClick={() => setActivating(selected)} className="shrink-0 rounded-lg bg-ok px-4 py-1.5 text-sm font-extrabold text-white shadow hover:brightness-110">⚡ تفعيل</button>
          <HBtn label="🧾 سجل الوصولات" onClick={() => openLog("receipts")} />
          <HBtn label="🛠️ سجل الصيانات" onClick={() => openLog("maintenance")} />
          <span className="mx-1 h-5 w-px shrink-0 bg-line" />
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${remaining > 0 ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad"}`}>{remaining} يوم</span>
          <button onClick={() => { setPayDebtOpen(true); setPayAmount(""); setPayErr(""); }} disabled={(selected.carry ?? 0) <= 0}
            className="shrink-0 rounded-full bg-bad/10 px-2.5 py-1 text-[11px] font-bold text-bad disabled:opacity-50" title="تسديد دين">
            الديون {fmt(selected.carry)}
          </button>
          <span className="shrink-0 rounded-full bg-fuchsia-50 px-2.5 py-1 text-[11px] font-bold text-fuchsia-700">🎁 {fmt(selected.rewardBalance)}</span>
          <MapButton subscriberId={selected.id} />
          <div className="relative shrink-0">
            <button onClick={() => setMoreMenu((v) => !v)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm font-bold text-ink-2 hover:bg-surface-2">⋯ المزيد</button>
            {moreMenu && (
              <div className="absolute left-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl">
                <MoreItem label="🧾 وصولات الفواتير" onClick={() => openLog("invoices")} />
                <MoreItem label={summaryBusy ? "جارٍ الإرسال..." : "💬 ارسال ملخص"} onClick={() => void sendSummary()} />
                <MoreItem label="💵 تسديد اشتراك" onClick={() => { setMoreMenu(false); setPayDebtOpen(true); setPayAmount(""); setPayErr(""); }} />
                <MoreItem label="💲 تسديد فواتير" onClick={() => router.push("/debts")} />
                <MoreItem label="📝 اضافة مذكرة" onClick={() => router.push("/tickets")} />
                <MoreItem label="🅰️ اضافة ديون سابقة" onClick={() => { setMoreMenu(false); setAddingDebt(selected); }} />
                {can("rewards.clear") && <MoreItem label="🎁 حذف كود المكافأة" danger onClick={() => { setMoreMenu(false); void clearReward(); }} />}
              </div>
            )}
          </div>
          <span className="mr-auto shrink-0 text-xs font-bold text-ink">{selected.name}</span>
          <button onClick={() => { setSelectedId(null); setMoreMenu(false); }} className="shrink-0 rounded-full px-2 text-base leading-none text-muted hover:bg-black/5" title="إغلاق">✕</button>
        </div>
      )}

      {/* الجدول */}
      <div className="min-h-0 flex-1 overflow-auto" onClick={() => setMoreMenu(false)}>
        <table className="w-full text-right text-xs [&_td]:tabular-nums">
          <thead className="sticky top-0 z-10 bg-surface-2 text-ink-2">
            <tr>
              <th className="p-2"><input type="checkbox" checked={subs.length > 0 && checked.size === subs.length} onChange={toggleCheckAll} /></th>
              <th className="hidden p-2 sm:table-cell">ت</th>
              <th className="p-2">اسم المشترك</th>
              <th className="p-2">عمليات</th>
              <th className="hidden p-2 sm:table-cell">اليوزر</th>
              <th className="p-2">رقم الهاتف</th>
              <th className="hidden p-2 sm:table-cell">المكتب</th>
              <th className="hidden p-2 sm:table-cell">الأيام</th>
            </tr>
          </thead>
          <tbody>
            {subs.map((s, i) => {
              const d = daysLeft(s.dateTo);
              return (
                <tr key={s.id} onClick={() => selectRow(s)}
                  className={`cursor-pointer border-t border-line hover:bg-surface-2 ${selectedId === s.id ? "bg-navy/5" : ""}`}>
                  <td className="p-2" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={checked.has(s.id)} onChange={() => toggleCheck(s.id)} />
                  </td>
                  <td className="hidden p-2 text-muted sm:table-cell">{i + 1}</td>
                  <td className="p-2 font-medium text-ink">{s.name}</td>
                  <td className="p-2" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => { setOpsSub(s); setOpsMsg(""); }}
                      className="whitespace-nowrap rounded-lg border border-navy/25 bg-navy/5 px-2 py-1 text-[11px] font-semibold text-navy-3 hover:bg-navy/10" title="صيانة / اعادة / توصيل / تحويل">
                      🛠️
                    </button>
                  </td>
                  <td className="hidden p-2 sm:table-cell" dir="ltr">{s.netUser ?? "—"}</td>
                  <td className="p-2" dir="ltr">{s.phone ?? "—"}</td>
                  <td className="hidden p-2 sm:table-cell">{towerName(s.towerId)}</td>
                  <td className={`hidden p-2 font-bold sm:table-cell ${d > 0 ? "text-ok" : "text-bad"}`}>{d}</td>
                </tr>
              );
            })}
            {subs.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-muted">لا نتائج</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-line bg-surface-2 px-3 py-1.5 text-xs font-bold text-ink-2">
        <span>{total > subs.length ? `عرض ${subs.length} من ${total}` : subs.length}</span>
        {total > subs.length && <span className="font-normal text-orange-d">🔍 اكتب في البحث لإيجاد الباقي</span>}
      </div>

      {/* ===== النوافذ ===== */}

      {/* سجل الوصولات / الصيانات / وصولات الفواتير */}
      {logView && selected && (
        <Modal onClose={() => setLogView(null)} wide>
          <div className="mb-3 text-center text-base font-extrabold text-ink">
            {logView === "receipts" ? "سجل وصولات المشترك" : logView === "maintenance" ? "سجل صيانات المشترك" : "وصولات الفواتير"} — {selected.name}
          </div>
          <div className="max-h-[62vh] overflow-auto rounded-lg border border-line">
            {logView === "receipts" ? (
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
          <div className="max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-center text-lg font-bold text-ink">عمليات المشترك</div>
            <div className="mb-4 text-center text-sm text-muted">{opsSub.name ?? opsSub.netUser ?? `مشترك #${opsSub.id}`}</div>
            {!opsChosen ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {FIELD_OPS.map((op) => (
                    <button key={op.key} disabled={opsBusy}
                      onClick={() => { setOpsChosen(op.key); setOpsPhone(""); setOpsNote(""); setOpsAmount(""); }}
                      className="flex flex-col items-center gap-1 rounded-xl border border-line bg-surface-2 py-4 font-semibold text-ink hover:border-navy-3 disabled:opacity-50">
                      <span className="text-2xl">{op.icon}</span>
                      <span>{op.key}</span>
                    </button>
                  ))}
                </div>
                <button onClick={closeOps} className="mt-4 w-full rounded-lg bg-surface-2 py-2 text-ink-2">إلغاء</button>
              </>
            ) : (
              <>
                <div className="mb-3 rounded-lg bg-navy/5 px-3 py-2 text-center text-sm font-semibold text-navy-3">
                  {FIELD_OPS.find((o) => o.key === opsChosen)?.icon} {opsChosen}
                </div>
                {opsChosen === "توصيل" && (
                  <>
                    <label className="mb-1 block text-xs font-semibold text-indigo-600">💵 مبلغ الاشتراك (يظهر على وجه البطاقة ليعرف الفني كم يأخذ من الزبون)</label>
                    <input type="number" value={opsAmount} onChange={(e) => setOpsAmount(e.target.value)} dir="ltr" placeholder="مثال: 25000" className="mb-3 w-full rounded-lg border border-indigo-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
                  </>
                )}
                <label className="mb-1 block text-xs font-semibold text-muted">رقم هاتف إضافي (اختياري)</label>
                <input value={opsPhone} onChange={(e) => setOpsPhone(e.target.value)} dir="ltr" placeholder={opsSub.phone ? `الأصلي: ${opsSub.phone}` : "07..."} className="mb-3 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-navy-3" />
                <label className="mb-1 block text-xs font-semibold text-muted">ملاحظة (اختيارية)</label>
                <textarea value={opsNote} onChange={(e) => setOpsNote(e.target.value)} rows={3} placeholder="تفاصيل أو ملاحظة للفني..." className="mb-3 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-navy-3" />
                <p className="mb-3 text-[11px] text-muted">تُضاف مع رقم المشترك الأصلي إلى البطاقة. اتركها فارغة واضغط موافق لإنشاء البطاقة كالمعتاد.</p>
                <div className="flex gap-2">
                  <button onClick={() => sendToField(opsChosen)} disabled={opsBusy} className="flex-1 rounded-lg bg-navy py-2.5 font-bold text-white disabled:opacity-50">{opsBusy ? "..." : "موافق"}</button>
                  <button onClick={() => setOpsChosen(null)} disabled={opsBusy} className="rounded-lg bg-surface-2 px-4 py-2.5 font-semibold text-ink-2">رجوع</button>
                </div>
              </>
            )}
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
function HBtn({ label, onClick, disabled, primary }: { label: string; onClick?: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition ${
        primary ? "bg-orange text-white shadow hover:brightness-105"
          : "border border-line bg-surface text-ink-2 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
      }`}>
      {label}
    </button>
  );
}
function MoreItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`block w-full px-3 py-2 text-right text-xs font-semibold hover:bg-surface-2 ${danger ? "text-bad" : "text-ink"}`}>
      {label}
    </button>
  );
}
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
