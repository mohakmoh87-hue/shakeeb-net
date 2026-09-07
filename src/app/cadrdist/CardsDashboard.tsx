"use client";

import { useCallback, useEffect, useState } from "react";

type Tier = { id: number; name: string; price: number; stock: number };
type Target = { targetAgentId: number; name: string; alias: string; notifyPhone: string; remaining: number; transferred: number; paid: number; stock: number };
type Wa = { enabled: boolean; baseUrl: string; instanceId: string; tokenSet: boolean };
type Me = { username: string; tiers: Tier[]; totalStock: number; targets: Target[]; wa: Wa };
type Pkg = { id: number; name: string | null; priceDinar: number | null; stock: number };
type LedgerRow = { kind: string; id: number; amount: number; count: number | null; unitPrice?: number | null; note: string | null; at: string };
type SearchRow = { kind: string; id: number; targetAgentId: number; agentName: string; amount: number; count: number | null; note: string | null; at: string };

const money = (n: number) => (n ?? 0).toLocaleString("en-US");
const fmtDate = (s: string) => { try { return new Date(s).toLocaleString("en-GB", { hour12: false }); } catch { return s; } };
const label = (t: { alias?: string; name: string }) => (t.alias && t.alias.trim() ? t.alias : t.name);

async function post(path: string, body: unknown) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, d };
}

const glass = "rounded-2xl border border-white/10 bg-white/[0.04] shadow-xl shadow-black/30 backdrop-blur-sm";
const input = "w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/15 [&>option]:bg-slate-800 [&>option]:text-slate-100 [color-scheme:dark]";
const btnPrimary = "inline-flex items-center justify-center gap-1 rounded-xl bg-gradient-to-l from-emerald-500 to-teal-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-900/40 transition hover:from-emerald-400 hover:to-teal-400 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50";
const btnGhost = "rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10";

const TABS = [
  { k: "stock", t: "المخزن والفئات", icon: "📦" },
  { k: "transfer", t: "تحويل كروت", icon: "📤" },
  { k: "debts", t: "الوكلاء والديون", icon: "💳" },
  { k: "search", t: "بحث", icon: "🔎" },
  { k: "settings", t: "إعدادات", icon: "⚙️" },
] as const;

function Section({ title, subtitle, children, accent }: { title: string; subtitle?: string; children: React.ReactNode; accent?: string }) {
  return (
    <div className={`${glass} mb-4 overflow-hidden`}>
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3.5">
        <span className={`h-8 w-1.5 rounded-full ${accent ?? "bg-gradient-to-b from-cyan-400 to-emerald-400"}`} />
        <div>
          <div className="font-bold text-slate-100">{title}</div>
          {subtitle && <div className="text-[11px] leading-4 text-slate-400">{subtitle}</div>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export default function CardsDashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<string>("stock");
  const [msg, setMsg] = useState("");

  const loadMe = useCallback(() => { fetch("/api/cards/me").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setMe(d); }); }, []);
  useEffect(() => { loadMe(); }, [loadMe]);

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(""), 4500); }

  if (!me) {
    return (
      <div dir="rtl" className="flex min-h-screen items-center justify-center bg-[#0a0f1e] text-slate-400">
        <div className="flex items-center gap-3"><span className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-400" /> جاري التحميل...</div>
      </div>
    );
  }

  const totalDebt = me.targets.reduce((a, t) => a + (t.remaining || 0), 0);

  return (
    <div dir="rtl" className="min-h-screen bg-[#0a0f1e] text-slate-100">
      <div className="pointer-events-none fixed inset-0 select-none overflow-hidden opacity-[0.04]">
        <div className="absolute -right-10 top-10 text-[220px] leading-none">♠</div>
        <div className="absolute right-1/3 top-1/2 text-[180px] leading-none">♦</div>
        <div className="absolute -left-8 bottom-4 text-[220px] leading-none">♣</div>
      </div>

      <div className="relative mx-auto max-w-5xl px-4 pb-16 pt-4">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-amber-300 via-amber-400 to-orange-500 text-2xl shadow-lg shadow-amber-900/40">🃏</div>
            <div>
              <h1 className="bg-gradient-to-l from-cyan-300 to-emerald-300 bg-clip-text text-xl font-black text-transparent">موزّع الكروت</h1>
              <div className="text-xs text-slate-400">الحساب: <b dir="ltr" className="text-slate-200">{me.username}</b></div>
            </div>
          </div>
          <button onClick={async () => { await fetch("/api/cards/logout", { method: "POST" }); window.location.reload(); }} className={btnGhost}>خروج ←</button>
        </header>

        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon="📦" label="كروتٌ في مخزنك" value={money(me.totalStock)} tone="cyan" />
          <Stat icon="💰" label="مجموع الديون" value={money(totalDebt)} suffix="د.ع" tone={totalDebt > 0 ? "rose" : "emerald"} />
          <Stat icon="👥" label="الوكلاء" value={String(me.targets.length)} tone="violet" />
          <Stat icon="🗂️" label="الفئات" value={String(me.tiers.length)} tone="amber" />
        </div>

        <div className={`${glass} mb-4 flex flex-wrap gap-1 p-1.5`}>
          {TABS.map((x) => (
            <button
              key={x.k}
              onClick={() => setTab(x.k)}
              className={`flex-1 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-bold transition ${tab === x.k ? "bg-gradient-to-l from-cyan-500 to-emerald-500 text-white shadow-lg shadow-emerald-900/30" : "text-slate-300 hover:bg-white/5"}`}
            >
              <span className="ml-1">{x.icon}</span>{x.t}
            </button>
          ))}
        </div>

        {tab === "stock" && <StockTab me={me} reload={loadMe} flash={flash} />}
        {tab === "transfer" && <TransferTab me={me} reload={loadMe} flash={flash} />}
        {tab === "debts" && <DebtsTab me={me} reload={loadMe} flash={flash} />}
        {tab === "search" && <SearchTab me={me} />}
        {tab === "settings" && <SettingsTab me={me} reload={loadMe} flash={flash} />}
      </div>

      {msg && (
        <div className="fixed bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-2xl border border-white/10 bg-slate-800/95 px-5 py-3 text-sm font-semibold text-slate-100 shadow-2xl shadow-black/50 backdrop-blur">
          {msg}
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value, suffix, tone }: { icon: string; label: string; value: string; suffix?: string; tone: "cyan" | "emerald" | "rose" | "violet" | "amber" }) {
  const tones: Record<string, string> = {
    cyan: "from-cyan-500/15 to-cyan-500/5 text-cyan-300",
    emerald: "from-emerald-500/15 to-emerald-500/5 text-emerald-300",
    rose: "from-rose-500/15 to-rose-500/5 text-rose-300",
    violet: "from-violet-500/15 to-violet-500/5 text-violet-300",
    amber: "from-amber-500/15 to-amber-500/5 text-amber-300",
  };
  return (
    <div className={`${glass} bg-gradient-to-br ${tones[tone]} p-3.5`}>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-400"><span>{icon}</span>{label}</div>
      <div className="text-2xl font-black tabular-nums text-slate-100">{value}{suffix && <span className="mr-1 text-xs font-bold text-slate-400">{suffix}</span>}</div>
    </div>
  );
}

function StockTab({ me, reload, flash }: { me: Me; reload: () => void; flash: (t: string) => void }) {
  const [nt, setNt] = useState({ name: "", price: "" });
  const [pasteTier, setPasteTier] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Section title="الفئاتُ وأسعارُها" subtitle="سعرُ الكارت الواحد الذي يُحتسب على الوكيل عند التحويل" accent="bg-gradient-to-b from-amber-400 to-orange-500">
        <div className="mb-4 space-y-2">
          {me.tiers.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-slate-500">لا فئاتٍ بعد — أضِف فئةً أدناه.</div>}
          {me.tiers.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <span className="font-bold text-slate-100">{t.name}</span>
              <span className="rounded-lg bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-300">{money(t.price)} د.ع</span>
              <span className="rounded-lg bg-cyan-500/10 px-2 py-0.5 text-xs font-semibold text-cyan-300">مخزن: {money(t.stock)}</span>
              <span className="flex-1" />
              <button onClick={async () => { const name = prompt("اسم الفئة", t.name)?.trim(); if (!name) return; const price = Number(prompt("السعر", String(t.price))); if (!Number.isFinite(price)) return; const { ok, d } = await post("/api/cards/tiers", { id: t.id, name, price }); flash(ok ? "✓ حُدِّثت" : d.error); reload(); }} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-white/10">تعديل</button>
              <button onClick={async () => { if (!confirm("حذفُ الفئة؟")) return; const r = await fetch(`/api/cards/tiers?id=${t.id}`, { method: "DELETE" }); const d = await r.json().catch(() => ({})); flash(r.ok ? "✓ حُذفت" : d.error); reload(); }} className="rounded-lg bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/20">حذف</button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <input value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} placeholder="اسم الفئة (مثل 100 ميكا)" className={`${input} sm:w-56`} />
          <input value={nt.price} onChange={(e) => setNt({ ...nt, price: e.target.value })} dir="ltr" inputMode="numeric" placeholder="السعر للوكيل" className={`${input} sm:w-40`} />
          <button className={btnPrimary} onClick={async () => { if (!nt.name.trim()) return; const { ok, d } = await post("/api/cards/tiers", { name: nt.name.trim(), price: Number(nt.price) || 0 }); flash(ok ? "✓ أُضيفت الفئة" : d.error); if (ok) setNt({ name: "", price: "" }); reload(); }}>+ فئة</button>
        </div>
      </Section>

      <Section title="إضافةُ كروتٍ للمخزن" subtitle="لصقُ الأكواد — كلُّ سطرٍ كارتٌ واحد (رقمُ الكارت فقط). المكرّرُ يُتجاهَل.">
        <select value={pasteTier} onChange={(e) => setPasteTier(e.target.value)} className={`${input} mb-3`}>
          <option value="">— اختر الفئة —</option>
          {me.tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} dir="ltr" rows={6} placeholder="12345&#10;13323&#10;15555" className={`${input} mb-3 font-mono`} />
        <button disabled={busy} className={btnPrimary} onClick={async () => { if (!pasteTier || !pasteText.trim()) { flash("اختر الفئةَ والصق الأكواد"); return; } setBusy(true); const { ok, d } = await post("/api/cards/stock", { tierId: Number(pasteTier), text: pasteText }); setBusy(false); if (ok) { flash(`✓ أُضيف ${d.added} كارت (مكرّر: ${d.duplicates})`); setPasteText(""); reload(); } else flash(d.error); }}>{busy ? "جارٍ الإضافة..." : "إضافة للمخزن"}</button>
      </Section>
    </>
  );
}

function TransferTab({ me, reload, flash }: { me: Me; reload: () => void; flash: (t: string) => void }) {
  const [targetAgentId, setTargetAgentId] = useState("");
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [targetTotalStock, setTargetTotalStock] = useState<number | null>(null);
  const [targetPackageId, setTargetPackageId] = useState("");
  const [tierId, setTierId] = useState("");
  const [count, setCount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!targetAgentId) { setPackages([]); setTargetTotalStock(null); return; }
    setTargetPackageId("");
    fetch(`/api/cards/target-packages?targetAgentId=${targetAgentId}`).then((r) => (r.ok ? r.json() : null)).then((d) => { setPackages(d?.packages ?? []); setTargetTotalStock(d?.totalStock ?? 0); });
  }, [targetAgentId]);

  const tier = me.tiers.find((t) => String(t.id) === tierId);
  const target = me.targets.find((t) => String(t.targetAgentId) === targetAgentId);
  const selPkg = packages.find((p) => String(p.id) === targetPackageId);

  return (
    <Section title="تحويلُ كروتٍ إلى وكيل" subtitle="اختر الوكيلَ وباقتَه وفئةَ مخزنك والعدد — يُسحب من مخزنك ويُضاف لمخزن الوكيل ويُسجَّل ديناً">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold text-slate-300">الوكيل الهدف
          <select value={targetAgentId} onChange={(e) => setTargetAgentId(e.target.value)} className={`${input} mt-1.5`}>
            <option value="">— اختر —</option>
            {me.targets.map((t) => <option key={t.targetAgentId} value={t.targetAgentId}>{label(t)} — مخزنه {money(t.stock)} كارت</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-300">باقةُ الوكيل الهدف
          <select value={targetPackageId} onChange={(e) => setTargetPackageId(e.target.value)} className={`${input} mt-1.5`} disabled={!targetAgentId}>
            <option value="">— اختر —</option>
            {packages.map((p) => <option key={p.id} value={p.id}>{p.name ?? `#${p.id}`}{p.priceDinar ? ` (${money(p.priceDinar)})` : ""} — متوفّر {money(p.stock)}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-300">الفئة (من مخزنك)
          <select value={tierId} onChange={(e) => setTierId(e.target.value)} className={`${input} mt-1.5`}>
            <option value="">— اختر —</option>
            {me.tiers.map((t) => <option key={t.id} value={t.id}>{t.name} — مخزن {money(t.stock)} — سعر {money(t.price)}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-300">العدد
          <input value={count} onChange={(e) => setCount(e.target.value)} dir="ltr" inputMode="numeric" placeholder="0" className={`${input} mt-1.5`} />
        </label>
      </div>

      {target && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/[0.07] px-3 py-2.5 text-sm">
          <span className="text-slate-300">مخزنُ <b className="text-slate-100">{label(target)}</b> حاليّاً:</span>
          <span className="rounded-lg bg-cyan-500/15 px-2 py-0.5 font-bold text-cyan-300">{money(targetTotalStock ?? target.stock)} كارت</span>
          {selPkg && <span className="rounded-lg bg-white/5 px-2 py-0.5 text-xs text-slate-300">من باقة «{selPkg.name ?? selPkg.id}»: <b className="text-cyan-300">{money(selPkg.stock)}</b></span>}
          <span className="flex-1" />
          <span className={`text-xs font-semibold ${target.remaining > 0 ? "text-rose-300" : "text-emerald-300"}`}>دينُه: {money(target.remaining)} د.ع</span>
        </div>
      )}

      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة (اختياريّة)" className={`${input} my-3`} />
      {tier && count && Number(count) > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-xl border border-emerald-400/20 bg-emerald-500/[0.07] px-4 py-3">
          <span className="text-sm text-slate-300">المبلغُ الإجماليّ</span>
          <span className="text-xl font-black tabular-nums text-emerald-300">{money((tier.price || 0) * Number(count))} <span className="text-xs font-bold text-slate-400">د.ع</span></span>
        </div>
      )}
      <button disabled={busy} className={`${btnPrimary} w-full`} onClick={async () => {
        if (!targetAgentId || !targetPackageId || !tierId || !(Number(count) > 0)) { flash("أكمِل الحقول"); return; }
        setBusy(true);
        const { ok, d } = await post("/api/cards/transfer", { targetAgentId: Number(targetAgentId), tierId: Number(tierId), targetPackageId: Number(targetPackageId), count: Number(count), note });
        setBusy(false);
        if (ok) { flash(`✓ حُوِّل ${d.count} كارت بمبلغ ${money(d.total)} — المتبقّي على الوكيل ${money(d.remaining)}`); setCount(""); setNote(""); reload(); if (targetAgentId) fetch(`/api/cards/target-packages?targetAgentId=${targetAgentId}`).then((r) => (r.ok ? r.json() : null)).then((dd) => { if (dd) { setPackages(dd.packages ?? []); setTargetTotalStock(dd.totalStock ?? 0); } }); }
        else flash(d.error);
      }}>{busy ? "جارٍ التحويل..." : "📤 تحويل"}</button>
    </Section>
  );
}

function DebtsTab({ me, reload, flash }: { me: Me; reload: () => void; flash: (t: string) => void }) {
  const [sel, setSel] = useState<number | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [debt, setDebt] = useState<{ transferred: number; paid: number; remaining: number } | null>(null);
  const [pkgStock, setPkgStock] = useState<Pkg[]>([]);
  const [pay, setPay] = useState("");
  const [note, setNote] = useState("");

  const openTarget = useCallback((id: number) => {
    setSel(id);
    setPkgStock([]);
    fetch(`/api/cards/debts?targetAgentId=${id}`).then((r) => (r.ok ? r.json() : null)).then((d) => { setLedger(d?.ledger ?? []); setDebt(d?.debt ?? null); });
    fetch(`/api/cards/target-packages?targetAgentId=${id}`).then((r) => (r.ok ? r.json() : null)).then((d) => setPkgStock(d?.packages ?? []));
  }, []);

  const selTarget = me.targets.find((t) => t.targetAgentId === sel);

  return (
    <>
      <Section title="الوكلاءُ والديون" subtitle="مخزنُ كلِّ وكيلٍ حاليّاً ودينُه عليك — اضغط الوكيلَ للتفاصيل والتسديد">
        <div className="grid gap-2 sm:grid-cols-2">
          {me.targets.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-slate-500">لا وكلاءَ بعد (يحدّدهم مالكُ النظام).</div>}
          {me.targets.map((t) => (
            <button key={t.targetAgentId} onClick={() => openTarget(t.targetAgentId)} className={`flex flex-col gap-2 rounded-xl border p-3 text-right transition ${sel === t.targetAgentId ? "border-cyan-400/50 bg-cyan-500/[0.08]" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"}`}>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-100">{label(t)}</span>
                {t.alias?.trim() ? <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">{t.name}</span> : null}
                <span className="flex-1" />
                <span className={`rounded-lg px-2 py-0.5 text-xs font-bold ${t.remaining > 0 ? "bg-rose-500/10 text-rose-300" : "bg-emerald-500/10 text-emerald-300"}`}>{money(t.remaining)} د.ع</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <span>📦 مخزنه:</span>
                <span className="rounded-md bg-cyan-500/10 px-2 py-0.5 font-bold text-cyan-300">{money(t.stock)} كارت</span>
              </div>
            </button>
          ))}
        </div>
      </Section>

      {sel != null && selTarget && (
        <Section title={label(selTarget)} subtitle={`${selTarget.alias?.trim() ? selTarget.name + " · " : ""}مخزنه: ${money(selTarget.stock)} كارت`} accent="bg-gradient-to-b from-rose-400 to-rose-600">
          <div className="mb-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <span className="text-sm text-slate-300">المتبقّي عليه</span>
            {debt && <span className={`text-xl font-black tabular-nums ${debt.remaining > 0 ? "text-rose-300" : "text-emerald-300"}`}>{money(debt.remaining)} <span className="text-xs font-bold text-slate-400">د.ع</span></span>}
          </div>
          <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="mb-2 text-xs font-bold text-slate-400">📦 مخزونُه حسب الباقة</div>
            {pkgStock.length === 0 ? (
              <div className="text-xs text-slate-500">لا باقاتٍ لهذا الوكيل.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {pkgStock.map((p) => (
                  <span key={p.id} className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${p.stock > 0 ? "bg-cyan-500/10 text-cyan-300" : "bg-rose-500/10 text-rose-300"}`}>
                    {p.name ?? `#${p.id}`}: <b className="tabular-nums">{money(p.stock)}</b>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <input value={pay} onChange={(e) => setPay(e.target.value)} dir="ltr" inputMode="numeric" placeholder="مبلغ التسديد" className={`${input} sm:w-40`} />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة" className={`${input} sm:w-44`} />
            <button className={btnPrimary} onClick={async () => { if (!(Number(pay) > 0)) { flash("أدخِل مبلغاً"); return; } const { ok, d } = await post("/api/cards/pay", { targetAgentId: sel, amount: Number(pay), note }); if (ok) { flash(`✓ سُدِّد — المتبقّي ${money(d.remaining)}`); setPay(""); setNote(""); openTarget(sel); reload(); } else flash(d.error); }}>💵 تسديد</button>
          </div>
          <div className="max-h-80 space-y-1.5 overflow-y-auto pl-1">
            {ledger.length === 0 && <div className="text-xs text-slate-500">لا حركاتٍ بعد.</div>}
            {ledger.map((r) => (
              <div key={`${r.kind}-${r.id}`} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
                <span className={`rounded-md px-2 py-0.5 font-bold ${r.kind === "transfer" ? "bg-rose-500/10 text-rose-300" : "bg-emerald-500/10 text-emerald-300"}`}>{r.kind === "transfer" ? "تعبئة" : "تسديد"}</span>
                <span className="font-bold tabular-nums text-slate-100">{money(r.amount)}</span>
                {r.count != null && <span className="text-slate-400">({r.count} كارت)</span>}
                {r.note && <span className="truncate text-slate-400">— {r.note}</span>}
                <span className="flex-1" />
                <span className="text-slate-500" dir="ltr">{fmtDate(r.at)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function SearchTab({ me }: { me: Me }) {
  const [kind, setKind] = useState("all");
  const [targetAgentId, setTargetAgentId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [ran, setRan] = useState(false);

  async function run() {
    const p = new URLSearchParams();
    p.set("kind", kind);
    if (targetAgentId) p.set("targetAgentId", targetAgentId);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (q) p.set("q", q);
    const r = await fetch(`/api/cards/search?${p.toString()}`);
    const d = await r.json().catch(() => ({ rows: [] }));
    setRows(d.rows ?? []);
    setRan(true);
  }

  return (
    <Section title="بحثٌ في التعبئة والتسديد" subtitle="بالنوع أو الوكيل أو المدى الزمنيّ أو نصٍّ حرّ">
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={input}><option value="all">الكل</option><option value="transfer">تعبئة</option><option value="payment">تسديد</option></select>
        <select value={targetAgentId} onChange={(e) => setTargetAgentId(e.target.value)} className={input}><option value="">كلُّ الوكلاء</option>{me.targets.map((t) => <option key={t.targetAgentId} value={t.targetAgentId}>{label(t)}</option>)}</select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحثٌ نصّيّ" className={input} />
        <input value={from} onChange={(e) => setFrom(e.target.value)} type="date" className={input} />
        <input value={to} onChange={(e) => setTo(e.target.value)} type="date" className={input} />
        <button className={btnPrimary} onClick={run}>🔎 بحث</button>
      </div>
      <div className="max-h-96 space-y-1.5 overflow-y-auto pl-1">
        {ran && rows.length === 0 && <div className="text-xs text-slate-500">لا نتائج.</div>}
        {rows.map((r) => (
          <div key={`${r.kind}-${r.id}`} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
            <span className={`rounded-md px-2 py-0.5 font-bold ${r.kind === "transfer" ? "bg-rose-500/10 text-rose-300" : "bg-emerald-500/10 text-emerald-300"}`}>{r.kind === "transfer" ? "تعبئة" : "تسديد"}</span>
            <span className="font-bold text-slate-100">{r.agentName}</span>
            <span className="tabular-nums text-slate-200">{money(r.amount)}</span>
            {r.count != null && <span className="text-slate-400">({r.count})</span>}
            {r.note && <span className="truncate text-slate-400">— {r.note}</span>}
            <span className="flex-1" />
            <span className="text-slate-500" dir="ltr">{fmtDate(r.at)}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function SettingsTab({ me, reload, flash }: { me: Me; reload: () => void; flash: (t: string) => void }) {
  const [wa, setWa] = useState({ enabled: me.wa.enabled, baseUrl: me.wa.baseUrl, instanceId: me.wa.instanceId, token: "" });
  const [pw, setPw] = useState({ current: "", next: "" });
  const [phones, setPhones] = useState<Record<number, string>>(Object.fromEntries(me.targets.map((t) => [t.targetAgentId, t.notifyPhone])));
  const [aliases, setAliases] = useState<Record<number, string>>(Object.fromEntries(me.targets.map((t) => [t.targetAgentId, t.alias])));

  return (
    <>
      <Section title="واتساب API" subtitle="لإرسال إشعارِ كلِّ تعبئةٍ وتسديدٍ إلى رقم الوكيل" accent="bg-gradient-to-b from-green-400 to-emerald-500">
        <label className="mb-3 flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
          <input type="checkbox" checked={wa.enabled} onChange={(e) => setWa({ ...wa, enabled: e.target.checked })} className="h-4 w-4 accent-emerald-500" /> مُفعّل
        </label>
        <input value={wa.baseUrl} onChange={(e) => setWa({ ...wa, baseUrl: e.target.value })} dir="ltr" placeholder="https://api.ultramsg.com (أو بوّابة متوافقة)" className={`${input} mb-2`} />
        <input value={wa.instanceId} onChange={(e) => setWa({ ...wa, instanceId: e.target.value })} dir="ltr" placeholder="Instance ID" className={`${input} mb-2`} />
        <input value={wa.token} onChange={(e) => setWa({ ...wa, token: e.target.value })} dir="ltr" placeholder={me.wa.tokenSet ? "••••• (محفوظٌ — اتركه فارغاً للإبقاء)" : "Token"} className={`${input} mb-3`} />
        <button className={btnPrimary} onClick={async () => { const { ok, d } = await post("/api/cards/wa", wa); flash(ok ? "✓ حُفِظ الواتساب" : d.error); if (ok) { setWa({ ...wa, token: "" }); reload(); } }}>حفظ الواتساب</button>
      </Section>

      <Section title="الوكلاء: الاسمُ المستعار ورقمُ الإشعار" subtitle="اسمٌ تعرفُ به الوكيلَ (يظهر لك وحدَك) + رقمُ واتساب لإشعاراته">
        <div className="space-y-2">
          {me.targets.length === 0 && <div className="text-xs text-slate-500">لا وكلاءَ بعد.</div>}
          {me.targets.map((t) => (
            <div key={t.targetAgentId} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="mb-2 text-xs text-slate-400">الاسمُ الأصليّ: <b className="text-slate-200">{t.name}</b></div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[11px] font-bold text-slate-400">اسمٌ مستعار (لك وحدك)
                  <input value={aliases[t.targetAgentId] ?? ""} onChange={(e) => setAliases({ ...aliases, [t.targetAgentId]: e.target.value })} placeholder={t.name} className={`${input} mt-1 sm:w-48`} />
                </label>
                <label className="text-[11px] font-bold text-slate-400">رقمُ الإشعار
                  <input value={phones[t.targetAgentId] ?? ""} onChange={(e) => setPhones({ ...phones, [t.targetAgentId]: e.target.value })} dir="ltr" placeholder="07XXXXXXXXX" className={`${input} mt-1 sm:w-44`} />
                </label>
                <button className={btnGhost} onClick={async () => { const { ok, d } = await post("/api/cards/target", { targetAgentId: t.targetAgentId, alias: aliases[t.targetAgentId] ?? "", notifyPhone: phones[t.targetAgentId] ?? "" }); flash(ok ? "✓ حُفِظ" : d.error); if (ok) reload(); }}>حفظ</button>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="تغييرُ كلمة المرور" subtitle="غيّر كلمةَ مرورك — يُطلب إدخالُ الحاليّة">
        <div className="flex flex-wrap items-end gap-2">
          <input value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} type="password" dir="ltr" placeholder="الحاليّة" className={`${input} sm:w-44`} />
          <input value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} type="password" dir="ltr" placeholder="الجديدة (٨+)" className={`${input} sm:w-44`} />
          <button className={btnPrimary} onClick={async () => { const { ok, d } = await post("/api/cards/password", { currentPassword: pw.current, newPassword: pw.next }); flash(ok ? "✓ تغيّرت كلمةُ المرور" : d.error); if (ok) setPw({ current: "", next: "" }); }}>تغيير</button>
        </div>
      </Section>
    </>
  );
}
