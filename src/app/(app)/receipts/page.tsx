"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format";
import { usePermission } from "@/lib/usePermission";
import { askVoidEffect } from "@/lib/voidPrompt";

// سجل الوصولات العام (ب3 — صفحة النموذج المعتمد): قائمة منسدلة تبدّل بين
// وصولات المشتركين (التفعيلات) ووصولات المبيعات (الفواتير)، بحث، فرز بالأعمدة،
// إعادة طباعة وحذف (عكسي) للمحدّدين، ومجموع أسفلها.
type SubRow = {
  id: number; date: string | null; money: number | null; moneyIn: number | null;
  cardType: string | null; createdByUser: string | null; subscriberName: string | null; towerId: number | null;
  isMaster?: boolean | null; addPrice?: number | null;
};
type InvRow = {
  id: number; number: number | null; date: string | null; totalMy: number | null;
  waselHim: number | null; type: string | null; user: string | null; subscriberName: string | null; note: string | null;
  itemsText: string | null; towerId: number | null;
};
// الصف الموحّد: القيمة والواصل والدين وطريقة الدفع أعمدة مستقلة — كانت كلها
// مطوية في رقم واحد «المبلغ» رغم وجودها في القاعدة (طلب محمد 2026-08-04).
type Pay = "master" | "cash" | "debt" | "partial";
type Row = {
  id: number; ref: number; date: string | null; who: string; cat: string;
  value: number; amount: number; debt: number; pay: Pay;
  by: string; items: string | null; office: string;
};
const PAY_LABEL: Record<Pay, string> = { master: "🅜 ماستر", cash: "نقدي", debt: "دين", partial: "نقدي + دين" };
const PAY_CLASS: Record<Pay, string> = {
  master: "bg-indigo-50 text-indigo-700", cash: "bg-emerald-50 text-emerald-700",
  debt: "bg-rose-50 text-rose-700", partial: "bg-amber-50 text-amber-700",
};

const fmt = (n: number) => Number(n).toLocaleString("en-US");

export default function ReceiptsPage() {
  const router = useRouter();
  const { can } = usePermission();
  const [kind, setKind] = useState<"sub" | "inv">("sub");
  const [subRows, setSubRows] = useState<SubRow[]>([]);
  const [invRows, setInvRows] = useState<InvRow[]>([]);
  const [towers, setTowers] = useState<{ id: number; name: string | null }[]>([]);
  const [q, setQ] = useState("");
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<{ key: "ref" | "date" | "who" | "amount"; dir: 1 | -1 }>({ key: "ref", dir: -1 });
  const [busy, setBusy] = useState(false);
  // العدّ والمجاميع من الخادم — على كل المطابق لا على المحمّل (تدقيق 2026-08-04)
  const [matched, setMatched] = useState(0);
  const [srvSums, setSrvSums] = useState({ value: 0, collected: 0 });
  const [msg, setMsg] = useState("");

  // البحث يجري في الخادم (كان في المتصفح على المحمّل وحده فوصلٌ أقدم لا يُبحث عنه)
  useEffect(() => {
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ meta: "1" });
      if (q.trim()) qs.set("q", q.trim());
      if (kind === "sub") {
        fetch(`/api/subscriptions?${qs}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
          if (!d) return;
          setSubRows(d.rows ?? []); setMatched(d.matched ?? 0); setSrvSums(d.sums ?? { value: 0, collected: 0 });
        }).catch(() => {});
      } else {
        fetch(`/api/invoices?${qs}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
          if (!d) return;
          setInvRows(d.rows ?? []); setMatched(d.matched ?? 0); setSrvSums(d.sums ?? { value: 0, collected: 0 });
        }).catch(() => {});
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q, kind]);

  useEffect(() => {
    fetch("/api/towers").then((r) => (r.ok ? r.json() : [])).then(setTowers).catch(() => {});
  }, []);

  // اسم المكتب المسجّل للوصل — يظهر عموداً في السجلين (طلب محمد 2026-07-29)
  const officeName = (id: number | null) => (id == null ? "—" : towers.find((t) => t.id === id)?.name ?? "—");

  // توحيد الصفوف للجدول (المصدر حسب النوع المختار)
  const rows: Row[] = useMemo(() => {
    const list: Row[] =
      kind === "sub"
        ? subRows.map((e) => {
            // القيمة = مبلغ الاشتراك + أجور التوصيل · الواصل = ما قُبض · الدين = الفرق
            const value = (e.money ?? 0) + (e.addPrice ?? 0);
            const paid = e.moneyIn ?? 0;
            const debt = Math.max(0, value - paid);
            const pay: Pay = e.isMaster ? "master" : debt > 0 ? (paid > 0 ? "partial" : "debt") : "cash";
            return {
              id: e.id, ref: e.id, date: e.date, who: e.subscriberName ?? "—",
              cat: e.cardType ?? "تفعيل", value, amount: paid, debt, pay,
              by: e.createdByUser ?? "—", items: null, office: officeName(e.towerId),
            };
          })
        : invRows.map((v) => {
            // المفوتَر مقابل الواصل: الفرق دين على الزبون — كان الجدول يعرض الواصل وحده
            const value = v.totalMy ?? 0;
            const paid = v.waselHim ?? 0;
            const debt = Math.max(0, value - paid);
            const pay: Pay = v.type === "ماستر" ? "master" : debt > 0 ? (paid > 0 ? "partial" : "debt") : "cash";
            return {
              id: v.id, ref: v.number ?? v.id, date: v.date, who: v.subscriberName ?? (v.note?.match(/الزبون:\s*([^—]+)/)?.[1]?.trim() ?? "—"),
              cat: v.type ?? "بيع", value, amount: paid, debt, pay,
              by: v.user ?? "—", items: v.itemsText ?? null, office: officeName(v.towerId),
            };
          });
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? list.filter((r) =>
          String(r.ref).includes(needle) || r.who.toLowerCase().includes(needle) ||
          String(r.amount).includes(needle.replace(/,/g, "")) || r.cat.toLowerCase().includes(needle) ||
          r.office.toLowerCase().includes(needle))
      : list;
    const dir = sort.dir;
    return [...filtered].sort((a, b) => {
      if (sort.key === "ref") return (a.ref - b.ref) * dir;
      if (sort.key === "amount") return (a.amount - b.amount) * dir;
      if (sort.key === "who") return a.who.localeCompare(b.who, "ar") * dir;
      return ((a.date ?? "") < (b.date ?? "") ? -1 : 1) * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, subRows, invRows, towers, q, sort]);

  const sum = rows.reduce((s, r) => s + r.amount, 0);

  function toggleSort(key: "ref" | "date" | "who" | "amount") {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: -1 }));
  }
  function toggle(id: number) {
    setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.id));

  // إعادة طباعة صامتة للمحدّدين (تلتقطها حاسبة مكتب المشترك)
  async function reprint() {
    if (checked.size === 0 || busy) return;
    setBusy(true); setMsg("");
    let ok = 0;
    for (const id of checked) {
      const r = await fetch("/api/print", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: kind === "sub" ? "subscription" : "invoice", id }),
      }).catch(() => null);
      if (r?.ok) ok++;
    }
    setBusy(false);
    setMsg(`🖨️ أُرسل ${ok} وصلاً للطباعة`);
  }

  // حذف عكسي للمحدّدين (سؤال واحد يسري على الجميع)
  async function removeChecked() {
    if (checked.size === 0 || busy) return;
    const choice = await askVoidEffect(`${checked.size} وصلاً محدّداً`);
    if (!choice) return;
    setBusy(true); setMsg("");
    let ok = 0;
    for (const id of checked) {
      const r = await fetch(
        kind === "sub" ? `/api/subscription-entries/${id}/void` : `/api/invoices/${id}/void`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reverse: choice.reverse }) },
      ).catch(() => null);
      if (r?.ok) ok++;
    }
    setBusy(false); setChecked(new Set());
    setMsg(`🗑️ حُذف ${ok} وصلاً`);
    // إعادة الجلب
    fetch("/api/subscriptions").then((r) => (r.ok ? r.json() : [])).then(setSubRows).catch(() => {});
    fetch("/api/invoices").then((r) => (r.ok ? r.json() : [])).then(setInvRows).catch(() => {});
  }

  const arrow = (key: string) => (sort.key === key ? (sort.dir === -1 ? "↓" : "↑") : "↕");

  return (
    <div className="nst min-h-screen bg-ground p-4 md:p-[20px_22px_34px]">
      <div className="pg-h">
        <button className="back" onClick={() => router.push("/dashboard")}>→ رجوع</button>
        <h1>سجل الوصولات</h1>
      </div>
      <div className="card">
        <div className="ch">
          <select className="pgsel" value={kind} onChange={(e) => { setKind(e.target.value as "sub" | "inv"); setChecked(new Set()); setMsg(""); }}>
            <option value="sub">📄 وصولات المشتركين (التفعيلات)</option>
            <option value="inv">🛒 وصولات المبيعات (الفواتير)</option>
          </select>
          {/* 🧪 data-app-dock: شريطٌ سفليٌّ ثابتٌ نحيفٌ دائمُ الظهور في التجربة —
              نموذجُ «سجلّ الوصولات» الذي أرسله محمد 2026-08-19 (لا ورقةَ تُطوى هنا) */}
          <div data-app-dock className="hbtns">
            <button className="gbtn" onClick={() => void reprint()} disabled={checked.size === 0 || busy}>🖨️ إعادة طباعة</button>
            {can("receipts.void") && (
              <button className="gbtn danger" onClick={() => void removeChecked()} disabled={checked.size === 0 || busy}>🗑️ حذف</button>
            )}
          </div>
        </div>
        <div className="searchbar">
          <span className="sicon">🔍</span>
          <input className="sq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث برقم الوصل أو اسم المشترك أو المبلغ" />
        </div>
        {msg && <div style={{ margin: "0 16px 8px" }} className="rounded-lg bg-ok/10 px-3 py-1.5 text-center text-xs font-semibold text-ok">{msg}</div>}
        <div className="tscroll" style={{ maxHeight: "62vh", overflowY: "auto" }}>
          <table className="tbl">
            <thead><tr>
              <th className="cbcol"><input type="checkbox" className="cb" checked={allChecked}
                onChange={() => setChecked(allChecked ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
              <th className="srt" onClick={() => toggleSort("ref")}>رقم الوصل <i>{arrow("ref")}</i></th>
              <th className="srt" onClick={() => toggleSort("date")}>التاريخ <i>{arrow("date")}</i></th>
              <th className="srt" onClick={() => toggleSort("who")}>المشترك <i>{arrow("who")}</i></th>
              <th>الفئة</th>
              {kind === "inv" && <th>المواد</th>}
              <th>طريقة الدفع</th>
              <th className="num">القيمة</th>
              <th className="srt" onClick={() => toggleSort("amount")}>الواصل <i>{arrow("amount")}</i></th>
              <th className="num">الدين</th>
              <th>المستخدم</th>
              <th>المكتب</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={kind === "inv" ? 12 : 11} style={{ textAlign: "center", padding: 28, color: "var(--muted)" }}>لا وصولات</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className={checked.has(r.id) ? "picked" : ""}>
                  <td className="cbcol"><input type="checkbox" className="cb" checked={checked.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td className="ref num">{r.ref}</td>
                  <td className="num" dir="ltr">{formatDateTime(r.date)}</td>
                  <td>{r.who}</td>
                  <td>{r.cat}</td>
                  {kind === "inv" && <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }} title={r.items ?? undefined}>{r.items ?? "—"}</td>}
                  <td>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${PAY_CLASS[r.pay]}`}>{PAY_LABEL[r.pay]}</span>
                  </td>
                  <td className="num">{fmt(r.value)}</td>
                  <td className="num">{fmt(r.amount)}</td>
                  <td className="num" style={{ color: r.debt > 0 ? "var(--bad)" : "inherit", fontWeight: r.debt > 0 ? 700 : 400 }}>{r.debt ? fmt(r.debt) : "—"}</td>
                  <td>{r.by}</td>
                  <td>{r.office}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pg-f">
          <span>
            معروض {rows.length} من أصل {matched || rows.length} وصلاً
            {checked.size > 0 ? ` — محدّد ${checked.size}` : ""}
          </span>
          {/* المجموع من الخادم على **كل** المطابق — لا على المعروض وحده */}
          <span className="pg-tot">
            القيمة: <b>{fmt(srvSums.value)}</b> · الواصل: <b>{fmt(srvSums.collected)}</b> · الدين:{" "}
            <b>{fmt(Math.max(0, srvSums.value - srvSums.collected))}</b> د.ع
          </span>
        </div>
      </div>
    </div>
  );
}
