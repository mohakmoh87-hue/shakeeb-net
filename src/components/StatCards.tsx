"use client";

import { useEffect, useState } from "react";
import { localSasBase } from "@/lib/localSas";

// بطاقات الإحصاء الأربع بأعلى الشاشة الرئيسية (الطراز الجديد — ب2):
// المشتركين (فعال/الكلي، محلياً كل 5 ثوانٍ — أ5) · المصروفات والمقبوضات ·
// فاتورة المبيع (+منحنى مقارنة بالشهر السابق) · إدارة الفنيين (دائرة منجز/متبقٍّ)
type Report = { invoiceCount: number; invoiceIn: number; expenses: number; total: number };

const fmt = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("en-US");

export default function StatCards({ initialReport, towerIds }: { initialReport: Report; towerIds: number[] }) {
  return (
    <section className="grid grid-cols-2 gap-2 xl:grid-cols-4 xl:gap-3">
      <SubsCard towerIds={towerIds} />
      <MoneyCard r={initialReport} />
      <InvoiceCard r={initialReport} />
      <FieldCard />
    </section>
  );
}

function Card({ title, icon, dark, children }: { title: string; icon: string; dark?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-xl border p-3 shadow-sm ${dark ? "border-transparent text-white" : "border-line bg-surface text-ink"}`}
      style={dark ? { background: "linear-gradient(160deg, var(--navy-3) 0%, var(--navy) 100%)" } : undefined}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className={`text-xs font-bold ${dark ? "text-white/85" : "text-ink-2"}`}>{title}</span>
        <span className="text-base">{icon}</span>
      </div>
      {children}
    </div>
  );
}

// ١ · المشتركين — نفس آلية أ5: كل 5 ثوانٍ من حاسبة المكتب حصراً؛ وبدونها قراءة سحابية واحدة
function SubsCard({ towerIds }: { towerIds: number[] }) {
  const [stats, setStats] = useState<{ active: number; total: number } | null>(null);
  const [live, setLive] = useState(false);
  const key = towerIds.join(",");

  useEffect(() => {
    if (!key) return;
    let stop = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    (async () => {
      const base = await localSasBase();
      if (stop) return;
      if (base) {
        const load = async () => {
          try {
            const r = await fetch(`${base}/stats/subscribers?towers=${key}`);
            const d = await r.json().catch(() => null);
            if (!stop && r.ok && d && typeof d.total === "number") { setStats({ active: d.active, total: d.total }); setLive(true); }
          } catch { /* العامل توقّف مؤقتاً — نُبقي آخر أرقام */ }
        };
        void load();
        timer = setInterval(load, 5000);
      } else {
        try {
          const r = await fetch("/api/subscribers/stats");
          const d = await r.json().catch(() => null);
          if (!stop && r.ok && d && typeof d.total === "number") setStats(d);
        } catch { /* */ }
      }
    })();
    return () => { stop = true; if (timer) clearInterval(timer); };
  }, [key]);

  return (
    <Card title="المشتركين" icon="👥" dark>
      <div className="flex items-end justify-around gap-2">
        <div className="text-center">
          <div className="mb-0.5 flex items-center justify-center gap-1 text-[10px] text-white/70">
            <i className="h-1.5 w-1.5 rounded-full" style={{ background: "#3ad9a8" }} /> الفعالين
          </div>
          <div className="text-xl font-extrabold tabular-nums">{stats ? fmt(stats.active) : "—"}</div>
        </div>
        <div className="text-center">
          <div className="mb-0.5 flex items-center justify-center gap-1 text-[10px] text-white/70">
            <i className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--orange)" }} /> الكلي
          </div>
          <div className="text-xl font-extrabold tabular-nums">{stats ? fmt(stats.total) : "—"}</div>
        </div>
      </div>
      {live && <div className="mt-1 text-center text-[9px] text-white/50">⚡ مباشر من حاسبة المكتب</div>}
    </Card>
  );
}

// ٢ · المصروفات والمقبوضات (اليوم)
function MoneyCard({ r }: { r: Report }) {
  const received = r.total + r.expenses;
  return (
    <Card title="المصروفات والمقبوضات" icon="💵">
      <div className="space-y-1 text-xs">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-ink-2"><b className="text-ok">↓</b> المقبوضات</span>
          <b className="tabular-nums text-ok">{fmt(received)}</b>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-ink-2"><b className="text-bad">↑</b> المصروفات</span>
          <b className="tabular-nums text-bad">{fmt(r.expenses)}</b>
        </div>
        <div className="flex items-center justify-between border-t border-line pt-1">
          <span className="font-bold">الصافي</span>
          <b className="tabular-nums text-sm">{fmt(r.total)}</b>
        </div>
      </div>
    </Card>
  );
}

// ٣ · فاتورة المبيع — عدد ومبلغ اليوم + منحنى الشهر الحالي مقابل نفس المدة من السابق
function InvoiceCard({ r }: { r: Report }) {
  const [s, setS] = useState<{ thisDays: number[]; lastDays: number[]; thisTotal: number; lastTotal: number } | null>(null);
  useEffect(() => {
    fetch("/api/reports/invoices/summary").then((x) => (x.ok ? x.json() : null)).then((d) => d && setS(d)).catch(() => {});
  }, []);
  const delta = s && s.lastTotal > 0 ? Math.round(((s.thisTotal - s.lastTotal) / s.lastTotal) * 100) : null;
  return (
    <Card title="فاتورة المبيع" icon="🛒">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-lg font-extrabold tabular-nums">{fmt(r.invoiceIn)}</div>
          <div className="text-[10px] text-muted">{r.invoiceCount} فاتورة اليوم</div>
        </div>
        <div className="text-left">
          {s && <Spark thisDays={s.thisDays} lastDays={s.lastDays} />}
          {delta != null ? (
            <div className={`text-[10px] font-bold ${delta >= 0 ? "text-ok" : "text-bad"}`}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}% عن الشهر الماضي</div>
          ) : (
            <span className="rounded-full bg-orange/15 px-2 py-0.5 text-[10px] font-bold text-orange-d">جديد</span>
          )}
        </div>
      </div>
    </Card>
  );
}

// منحنى صغير: تراكمي الشهر الحالي (برتقالي) فوق السابق (رمادي)
function Spark({ thisDays, lastDays }: { thisDays: number[]; lastDays: number[] }) {
  const cum = (a: number[]) => a.reduce<number[]>((acc, v) => (acc.push((acc[acc.length - 1] ?? 0) + v), acc), []);
  const A = cum(thisDays), B = cum(lastDays);
  const max = Math.max(1, ...A, ...B);
  const W = 84, H = 26;
  const path = (a: number[]) => a.map((v, i) => `${i === 0 ? "M" : "L"}${(i / Math.max(1, a.length - 1)) * W},${H - (v / max) * (H - 2)}`).join(" ");
  return (
    <svg width={W} height={H} className="mb-0.5 block" aria-hidden>
      <path d={path(B)} fill="none" stroke="var(--muted)" strokeWidth="1.5" opacity=".55" />
      <path d={path(A)} fill="none" stroke="var(--orange)" strokeWidth="2" />
    </svg>
  );
}

// ٤ · إدارة الفنيين — دائرة منجز/متبقٍّ من لوحة البطاقات (٨-ج: تُحسب في المتصفح)
function FieldCard() {
  const [v, setV] = useState<{ done: number; rest: number } | null>(null);
  useEffect(() => {
    fetch("/api/field/board").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d?.cards) return;
      const done = d.cards.filter((c: { done?: boolean }) => c.done).length;
      setV({ done, rest: d.cards.length - done });
    }).catch(() => {});
  }, []);
  const total = (v?.done ?? 0) + (v?.rest ?? 0);
  const pct = total ? (v!.done / total) : 0;
  const R = 16, C = 2 * Math.PI * R;
  return (
    <Card title="إدارة الفنيين" icon="🛠️">
      <div className="flex items-center justify-between gap-2">
        <div className="space-y-0.5 text-[11px]">
          <div className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-ok" /> منجز <b className="tabular-nums">{v?.done ?? "—"}</b></div>
          <div className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--orange)" }} /> متبقٍّ <b className="tabular-nums">{v?.rest ?? "—"}</b></div>
        </div>
        <svg width="44" height="44" viewBox="0 0 40 40" className="shrink-0 -rotate-90">
          <circle cx="20" cy="20" r={R} fill="none" stroke="var(--line)" strokeWidth="5" />
          <circle cx="20" cy="20" r={R} fill="none" stroke="var(--ok)" strokeWidth="5"
            strokeDasharray={`${pct * C} ${C}`} strokeLinecap="round" />
          <text x="20" y="21" textAnchor="middle" dominantBaseline="middle" className="rotate-90 fill-current text-[9px] font-bold" style={{ transformOrigin: "20px 20px" }}>
            {total ? `${Math.round(pct * 100)}%` : "—"}
          </text>
        </svg>
      </div>
    </Card>
  );
}
