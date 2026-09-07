"use client";

import { useCallback, useEffect, useState } from "react";

type Tier = { id: number; name: string; price: number; stock: number };
type Target = { targetAgentId: number; name: string; notifyPhone: string; remaining: number; transferred: number; paid: number };
type Wa = { enabled: boolean; baseUrl: string; instanceId: string; tokenSet: boolean };
type Me = { username: string; tiers: Tier[]; totalStock: number; targets: Target[]; wa: Wa };
type Pkg = { id: number; name: string | null; priceDinar: number | null };
type LedgerRow = { kind: string; id: number; amount: number; count: number | null; unitPrice?: number | null; note: string | null; at: string };
type SearchRow = { kind: string; id: number; targetAgentId: number; agentName: string; amount: number; count: number | null; note: string | null; at: string };

const money = (n: number) => (n ?? 0).toLocaleString("en-US");
const fmtDate = (s: string) => { try { return new Date(s).toLocaleString("en-GB", { hour12: false }); } catch { return s; } };

async function post(path: string, body: unknown) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, d };
}

const TABS = [
  { k: "stock", t: "المخزن والفئات" },
  { k: "transfer", t: "تحويل كروت" },
  { k: "debts", t: "الديون" },
  { k: "search", t: "بحث" },
  { k: "settings", t: "إعدادات" },
] as const;

export default function CardsDashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<string>("stock");
  const [msg, setMsg] = useState("");

  const loadMe = useCallback(() => { fetch("/api/cards/me").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setMe(d); }); }, []);
  useEffect(() => { loadMe(); }, [loadMe]);

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(""), 4000); }

  if (!me) return <div dir="rtl" className="p-6 text-slate-400">جاري التحميل...</div>;

  return (
    <div dir="rtl" className="mx-auto min-h-screen max-w-4xl bg-slate-50 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800">🃏 موزّع الكروت</h1>
          <div className="text-xs text-slate-500">الحساب: <b dir="ltr">{me.username}</b> · في المخزن: <b>{money(me.totalStock)}</b> كارت</div>
        </div>
        <button onClick={async () => { await fetch("/api/cards/logout", { method: "POST" }); window.location.reload(); }} className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 hover:bg-slate-200">خروج</button>
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((x) => (
          <button key={x.k} onClick={() => setTab(x.k)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === x.k ? "bg-emerald-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>{x.t}</button>
        ))}
      </div>

      {msg && <div className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">{msg}</div>}

      {tab === "stock" && <StockTab me={me} reload={loadMe} flash={flash} />}
      {tab === "transfer" && <TransferTab me={me} reload={loadMe} flash={flash} />}
      {tab === "debts" && <DebtsTab me={me} reload={loadMe} flash={flash} />}
      {tab === "search" && <SearchTab me={me} />}
      {tab === "settings" && <SettingsTab me={me} reload={loadMe} flash={flash} />}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 rounded-xl border border-slate-200 bg-white p-4">{children}</div>;
}
const inp = "rounded-lg border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60";

function StockTab({ me, reload, flash }: { me: Me; reload: () => void; flash: (t: string) => void }) {
  const [nt, setNt] = useState({ name: "", price: "" });
  const [pasteTier, setPasteTier] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Card>
        <div className="mb-2 font-semibold text-slate-800">الفئاتُ وأسعارُها</div>
        <div className="mb-3 space-y-2">
          {me.tiers.length === 0 && <div className="text-xs text-slate-400">لا فئاتٍ بعد — أضِف فئةً أدناه.</div>}
          {me.tiers.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border border-slate-100 p-2 text-sm">
              <span className="font-semibold text-slate-700">{t.name}</span>
              <span className="text-slate-500">{money(t.price)} د.ع</span>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">مخزن: {money(t.stock)}</span>
              <span className="flex-1" />
              <button onClick={async () => { const name = prompt("اسم الفئة", t.name)?.trim(); if (!name) return; const price = Number(prompt("السعر", String(t.price))); if (!Number.isFinite(price)) return; const { ok, d } = await post("/api/cards/tiers", { id: t.id, name, price }); flash(ok ? "✓ حُدِّثت" : d.error); reload(); }} className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-slate-200">تعديل</button>
              <button onClick={async () => { if (!confirm("حذفُ الفئة؟")) return; const r = await fetch(`/api/cards/tiers?id=${t.id}`, { method: "DELETE" }); const d = await r.json().catch(() => ({})); flash(r.ok ? "✓ حُذفت" : d.error); reload(); }} className="rounded bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100">حذف</button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} placeholder="اسم الفئة (مثل 100 ميكا)" className={inp} />
          <input value={nt.price} onChange={(e) => setNt({ ...nt, price: e.target.value })} dir="ltr" inputMode="numeric" placeholder="السعر للوكيل" className={`${inp} w-32`} />
          <button className={btn} onClick={async () => { if (!nt.name.trim()) return; const { ok, d } = await post("/api/cards/tiers", { name: nt.name.trim(), price: Number(nt.price) || 0 }); flash(ok ? "✓ أُضيفت" : d.error); if (ok) setNt({ name: "", price: "" }); reload(); }}>+ فئة</button>
        </div>
      </Card>

      <Card>
        <div className="mb-2 font-semibold text-slate-800">إضافةُ كروتٍ للمخزن (لصقُ الأكواد)</div>
        <div className="mb-2 text-[11px] text-slate-500">كلُّ سطرٍ = سيريال [رقم] [باسورد] (يفصلها فراغ/فاصلة/تاب). المكرّرُ يُتجاهَل.</div>
        <select value={pasteTier} onChange={(e) => setPasteTier(e.target.value)} className={`${inp} mb-2 block`}>
          <option value="">— اختر الفئة —</option>
          {me.tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} dir="ltr" rows={5} placeholder="12345 6789 1111&#10;22222 3333 4444" className={`${inp} mb-2 block w-full font-mono`} />
        <button disabled={busy} className={btn} onClick={async () => { if (!pasteTier || !pasteText.trim()) return; setBusy(true); const { ok, d } = await post("/api/cards/stock", { tierId: Number(pasteTier), text: pasteText }); setBusy(false); if (ok) { flash(`✓ أُضيف ${d.added} كارت (مكرّر: ${d.duplicates})`); setPasteText(""); reload(); } else flash(d.error); }}>إضافة للمخزن</button>
      </Card>
    </>
  );
}

function TransferTab({ me, reload, flash }: { me: Me; reload: () => void; flash: (t: string) => void }) {
  const [targetAgentId, setTargetAgentId] = useState("");
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [targetPackageId, setTargetPackageId] = useState("");
  const [tierId, setTierId] = useState("");
  const [count, setCount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!targetAgentId) { setPackages([]); return; }
    fetch(`/api/cards/target-packages?targetAgentId=${targetAgentId}`).then((r) => (r.ok ? r.json() : null)).then((d) => setPackages(d?.packages ?? []));
    setTargetPackageId("");
  }, [targetAgentId]);

  const tier = me.tiers.find((t) => String(t.id) === tierId);

  return (
    <Card>
      <div className="mb-3 font-semibold text-slate-800">تحويلُ كروتٍ إلى وكيل</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-600">الوكيل الهدف
          <select value={targetAgentId} onChange={(e) => setTargetAgentId(e.target.value)} className={`${inp} mt-1 block w-full`}>
            <option value="">— اختر —</option>
            {me.targets.map((t) => <option key={t.targetAgentId} value={t.targetAgentId}>{t.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">باقةُ الوكيل الهدف
          <select value={targetPackageId} onChange={(e) => setTargetPackageId(e.target.value)} className={`${inp} mt-1 block w-full`} disabled={!targetAgentId}>
            <option value="">— اختر —</option>
            {packages.map((p) => <option key={p.id} value={p.id}>{p.name ?? `#${p.id}`}{p.priceDinar ? ` (${money(p.priceDinar)})` : ""}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">الفئة (من مخزنك)
          <select value={tierId} onChange={(e) => setTierId(e.target.value)} className={`${inp} mt-1 block w-full`}>
            <option value="">— اختر —</option>
            {me.tiers.map((t) => <option key={t.id} value={t.id}>{t.name} — مخزن {money(t.stock)} — سعر {money(t.price)}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">العدد
          <input value={count} onChange={(e) => setCount(e.target.value)} dir="ltr" inputMode="numeric" placeholder="0" className={`${inp} mt-1 block w-full`} />
        </label>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة (اختياريّة)" className={`${inp} my-2 block w-full`} />
      {tier && count && Number(count) > 0 && <div className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">المبلغُ الإجماليّ: <b>{money((tier.price || 0) * Number(count))}</b> د.ع</div>}
      <button disabled={busy} className={btn} onClick={async () => {
        if (!targetAgentId || !targetPackageId || !tierId || !(Number(count) > 0)) { flash("أكمِل الحقول"); return; }
        setBusy(true);
        const { ok, d } = await post("/api/cards/transfer", { targetAgentId: Number(targetAgentId), tierId: Number(tierId), targetPackageId: Number(targetPackageId), count: Number(count), note });
        setBusy(false);
        if (ok) { flash(`✓ حُوِّل ${d.count} كارت بمبلغ ${money(d.total)} — المتبقّي على الوكيل ${money(d.remaining)}`); setCount(""); setNote(""); reload(); }
        else flash(d.error);
      }}>تحويل</button>
    </Card>
  );
}

function DebtsTab({ me, reload, flash }: { me: Me; reload: () => void; flash: (t: string) => void }) {
  const [sel, setSel] = useState<number | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [debt, setDebt] = useState<{ transferred: number; paid: number; remaining: number } | null>(null);
  const [pay, setPay] = useState("");
  const [note, setNote] = useState("");

  const openTarget = useCallback((id: number) => {
    setSel(id);
    fetch(`/api/cards/debts?targetAgentId=${id}`).then((r) => (r.ok ? r.json() : null)).then((d) => { setLedger(d?.ledger ?? []); setDebt(d?.debt ?? null); });
  }, []);

  return (
    <>
      <Card>
        <div className="mb-2 font-semibold text-slate-800">ديونُ الوكلاء</div>
        <div className="space-y-2">
          {me.targets.length === 0 && <div className="text-xs text-slate-400">لا وكلاءَ بعد (يحدّدهم مالكُ النظام).</div>}
          {me.targets.map((t) => (
            <button key={t.targetAgentId} onClick={() => openTarget(t.targetAgentId)} className={`flex w-full items-center gap-2 rounded-lg border p-2 text-right text-sm ${sel === t.targetAgentId ? "border-emerald-400 bg-emerald-50" : "border-slate-100 hover:bg-slate-50"}`}>
              <span className="font-semibold text-slate-700">{t.name}</span>
              <span className="flex-1" />
              <span className={`font-bold ${t.remaining > 0 ? "text-red-600" : "text-emerald-600"}`}>{money(t.remaining)} د.ع</span>
            </button>
          ))}
        </div>
      </Card>

      {sel != null && (
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <div className="font-semibold text-slate-800">{me.targets.find((t) => t.targetAgentId === sel)?.name}</div>
            {debt && <div className="text-sm">المتبقّي: <b className={debt.remaining > 0 ? "text-red-600" : "text-emerald-600"}>{money(debt.remaining)}</b></div>}
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input value={pay} onChange={(e) => setPay(e.target.value)} dir="ltr" inputMode="numeric" placeholder="مبلغ التسديد" className={`${inp} w-36`} />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة" className={`${inp} w-40`} />
            <button className={btn} onClick={async () => { if (!(Number(pay) > 0)) return; const { ok, d } = await post("/api/cards/pay", { targetAgentId: sel, amount: Number(pay), note }); if (ok) { flash(`✓ سُدِّد — المتبقّي ${money(d.remaining)}`); setPay(""); setNote(""); openTarget(sel); reload(); } else flash(d.error); }}>تسديد</button>
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {ledger.map((r) => (
              <div key={`${r.kind}-${r.id}`} className="flex items-center gap-2 rounded border border-slate-100 px-2 py-1 text-xs">
                <span className={r.kind === "transfer" ? "text-red-600" : "text-emerald-600"}>{r.kind === "transfer" ? "تعبئة" : "تسديد"}</span>
                <span className="font-semibold">{money(r.amount)}</span>
                {r.count != null && <span className="text-slate-400">({r.count} كارت)</span>}
                {r.note && <span className="text-slate-400">— {r.note}</span>}
                <span className="flex-1" />
                <span className="text-slate-400" dir="ltr">{fmtDate(r.at)}</span>
              </div>
            ))}
          </div>
        </Card>
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
  }

  return (
    <Card>
      <div className="mb-2 font-semibold text-slate-800">بحثٌ في التعبئة والتسديد</div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={inp}><option value="all">الكل</option><option value="transfer">تعبئة</option><option value="payment">تسديد</option></select>
        <select value={targetAgentId} onChange={(e) => setTargetAgentId(e.target.value)} className={inp}><option value="">كلُّ الوكلاء</option>{me.targets.map((t) => <option key={t.targetAgentId} value={t.targetAgentId}>{t.name}</option>)}</select>
        <input value={from} onChange={(e) => setFrom(e.target.value)} type="date" className={inp} />
        <input value={to} onChange={(e) => setTo(e.target.value)} type="date" className={inp} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحثٌ نصّيّ" className={inp} />
        <button className={btn} onClick={run}>بحث</button>
      </div>
      <div className="max-h-96 space-y-1 overflow-y-auto">
        {rows.length === 0 && <div className="text-xs text-slate-400">لا نتائج.</div>}
        {rows.map((r) => (
          <div key={`${r.kind}-${r.id}`} className="flex items-center gap-2 rounded border border-slate-100 px-2 py-1 text-xs">
            <span className={r.kind === "transfer" ? "text-red-600" : "text-emerald-600"}>{r.kind === "transfer" ? "تعبئة" : "تسديد"}</span>
            <span className="font-semibold text-slate-700">{r.agentName}</span>
            <span className="font-semibold">{money(r.amount)}</span>
            {r.count != null && <span className="text-slate-400">({r.count})</span>}
            {r.note && <span className="text-slate-400">— {r.note}</span>}
            <span className="flex-1" />
            <span className="text-slate-400" dir="ltr">{fmtDate(r.at)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SettingsTab({ me, reload, flash }: { me: Me; reload: () => void; flash: (t: string) => void }) {
  const [wa, setWa] = useState({ enabled: me.wa.enabled, baseUrl: me.wa.baseUrl, instanceId: me.wa.instanceId, token: "" });
  const [pw, setPw] = useState({ current: "", next: "" });
  const [phones, setPhones] = useState<Record<number, string>>(Object.fromEntries(me.targets.map((t) => [t.targetAgentId, t.notifyPhone])));

  return (
    <>
      <Card>
        <div className="mb-2 font-semibold text-slate-800">واتساب API (لإشعارات التعبئة/التسديد)</div>
        <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={wa.enabled} onChange={(e) => setWa({ ...wa, enabled: e.target.checked })} /> مُفعّل</label>
        <input value={wa.baseUrl} onChange={(e) => setWa({ ...wa, baseUrl: e.target.value })} dir="ltr" placeholder="https://api.ultramsg.com (أو بوّابة متوافقة)" className={`${inp} mb-2 block w-full`} />
        <input value={wa.instanceId} onChange={(e) => setWa({ ...wa, instanceId: e.target.value })} dir="ltr" placeholder="Instance ID" className={`${inp} mb-2 block w-full`} />
        <input value={wa.token} onChange={(e) => setWa({ ...wa, token: e.target.value })} dir="ltr" placeholder={me.wa.tokenSet ? "••••• (محفوظٌ — اتركه فارغاً للإبقاء)" : "Token"} className={`${inp} mb-2 block w-full`} />
        <button className={btn} onClick={async () => { const { ok, d } = await post("/api/cards/wa", wa); flash(ok ? "✓ حُفِظ" : d.error); if (ok) { setWa({ ...wa, token: "" }); reload(); } }}>حفظ الواتساب</button>
      </Card>

      <Card>
        <div className="mb-2 font-semibold text-slate-800">أرقامُ إشعارِ الوكلاء</div>
        <div className="space-y-2">
          {me.targets.map((t) => (
            <div key={t.targetAgentId} className="flex items-center gap-2 text-sm">
              <span className="w-32 truncate font-semibold text-slate-700">{t.name}</span>
              <input value={phones[t.targetAgentId] ?? ""} onChange={(e) => setPhones({ ...phones, [t.targetAgentId]: e.target.value })} dir="ltr" placeholder="07XXXXXXXXX" className={`${inp} w-40`} />
              <button className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200" onClick={async () => { const { ok, d } = await post("/api/cards/target", { targetAgentId: t.targetAgentId, notifyPhone: phones[t.targetAgentId] ?? "" }); flash(ok ? "✓ حُفِظ" : d.error); }}>حفظ</button>
            </div>
          ))}
          {me.targets.length === 0 && <div className="text-xs text-slate-400">لا وكلاءَ بعد.</div>}
        </div>
      </Card>

      <Card>
        <div className="mb-2 font-semibold text-slate-800">تغييرُ كلمة المرور</div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} type="password" dir="ltr" placeholder="الحاليّة" className={inp} />
          <input value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} type="password" dir="ltr" placeholder="الجديدة (٨+)" className={inp} />
          <button className={btn} onClick={async () => { const { ok, d } = await post("/api/cards/password", { currentPassword: pw.current, newPassword: pw.next }); flash(ok ? "✓ تغيّرت كلمةُ المرور" : d.error); if (ok) setPw({ current: "", next: "" }); }}>تغيير</button>
        </div>
      </Card>
    </>
  );
}
