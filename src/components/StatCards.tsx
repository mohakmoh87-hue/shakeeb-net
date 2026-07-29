"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { localSasBase } from "@/lib/localSas";

// بطاقات الإحصاء الأربع — مطابقة حرفياً للنموذج المعتمد (أصناف .nst في globals.css):
// المشتركين (داكنة: الفعالين والمتصلين + الكلي) · المصروفات والمقبوضات (سطران +
// شريط نسبة + الصافي) · فاتورة المبيع (عدد + اتجاه + منحنى مساحي) · إدارة الفنيين (دونات).
// «الفعالين/المتصلين» كل 5 ثوانٍ من حاسبة المكتب حصراً (أ5) — بلا مرور على السحابة.
type Report = { invoiceCount: number; invoiceIn: number; expenses: number; total: number };

const fmt = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("en-US");

export default function StatCards({ initialReport, towerIds }: { initialReport: Report; towerIds: number[] }) {
  return (
    <section className="stats max-[1050px]:!grid-cols-2">
      <SubsCard towerIds={towerIds} />
      <MoneyCard r={initialReport} />
      <InvoiceCard r={initialReport} />
      <FieldCard />
    </section>
  );
}

// ١ · المشتركين (داكنة) — الفعالين والمتصلين، والكلي سطراً صغيراً
function SubsCard({ towerIds }: { towerIds: number[] }) {
  const [stats, setStats] = useState<{ active: number; total: number; online: number | null } | null>(null);
  const [live, setLive] = useState(false);
  const key = towerIds.join(",");

  // شرط محمد الصارم: الفعالون والمتصلون من حاسبة المكتب حصراً — لا مرور على
  // Azure/Aiven بأي شكل. بلا حاسبة مكتب تظهر «—» ويُعاد البحث عنها كل 15 ثانية.
  useEffect(() => {
    if (!key) return;
    let stop = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const start = async () => {
      const base = await localSasBase();
      if (stop) return;
      if (!base) { retry = setTimeout(start, 15000); return; }
      const load = async () => {
        try {
          const r = await fetch(`${base}/stats/subscribers?towers=${key}`);
          const d = await r.json().catch(() => null);
          if (!stop && r.ok && d && typeof d.total === "number") {
            setStats({ active: d.active, total: d.total, online: typeof d.online === "number" ? d.online : null });
            setLive(true);
          }
        } catch { /* العامل توقّف مؤقتاً — نُبقي آخر أرقام */ }
      };
      void load();
      poll = setInterval(load, 5000);
    };
    void start();
    return () => { stop = true; if (poll) clearInterval(poll); if (retry) clearTimeout(retry); };
  }, [key]);

  // الضغط على البطاقة ينتقل لقائمة المشتركين أسفل الشاشة (البطاقات كلها قابلة للضغط — طلب محمد)
  const scrollToBoard = () => document.getElementById("subs-board")?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div className="stat dark" role="button" onClick={scrollToBoard} title="الانتقال لقائمة المشتركين">
      <div className="st-top"><span className="st-lb">المشتركين</span><span className="st-ic">👥</span></div>
      <div className="twoup">
        <div className="tu">
          <div className="tu-lb"><i className="dot" style={{ background: "#3ad9a8" }} /> الفعالين</div>
          <div className="tu-vl">{stats ? fmt(stats.active) : "—"}</div>
        </div>
        <div className="tu">
          {/* أزرق سماوي ساطع #4db5ff — واضح جداً على خلفية البطاقة اللاجوردية (طلب محمد) */}
          <div className="tu-lb"><i className="dot" style={{ background: "#4db5ff" }} /> المتصلين</div>
          <div className="tu-vl">{stats?.online != null ? fmt(stats.online) : "—"}</div>
        </div>
      </div>
      <div className="st-sub" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>الكلي: <b className="num">{stats ? fmt(stats.total) : "—"}</b></span>
        {live
          ? <span title="يتحدّث كل 5 ثوانٍ من حاسبة المكتب مباشرة — بلا مرور على السحابة">⚡ مباشر</span>
          : <span title="الأرقام تأتي من حاسبة المكتب حصراً — شغّلها لتظهر">⏳ بانتظار حاسبة المكتب</span>}
      </div>
    </div>
  );
}

// ٢ · المصروفات والمقبوضات — سطران + شريط نسبة + الصافي
function MoneyCard({ r }: { r: Report }) {
  const received = r.total + r.expenses;
  const sum = received + r.expenses;
  const inPct = sum > 0 ? Math.round((received / sum) * 100) : 50;
  return (
    <Link href="/cashbox" className="stat" style={{ textDecoration: "none", color: "inherit" }} title="فتح المصروفات والمقبوضات">
      <div className="st-top"><span className="st-lb">المصروفات والمقبوضات</span><span className="st-ic">💵</span></div>
      <div className="flow">
        <div className="flow-line">
          <span className="fa in">↓</span>
          <span className="fa-lb">المقبوضات</span>
          <span className="fa-vl">{fmt(received)}</span>
        </div>
        <div className="flow-line">
          <span className="fa out">↑</span>
          <span className="fa-lb">المصروفات</span>
          <span className="fa-vl">{fmt(r.expenses)}</span>
        </div>
      </div>
      <div className="ratio" role="img" aria-label={`المقبوضات ${inPct} بالمئة والمصروفات ${100 - inPct} بالمئة`}>
        <span className="r-in" style={{ width: `${inPct}%` }} />
        <span className="r-out" style={{ width: `${100 - inPct}%` }} />
      </div>
      <div className="net">الصافي <b style={{ color: r.total < 0 ? "var(--bad)" : "var(--ok)" }}>{fmt(r.total)}</b> <small>د.ع</small></div>
    </Link>
  );
}

// ٣ · فاتورة المبيع — عدد + وسام اتجاه + المبلغ + منحنى مساحي
function InvoiceCard({ r }: { r: Report }) {
  const [s, setS] = useState<{ thisDays: number[]; lastDays: number[]; thisTotal: number; lastTotal: number } | null>(null);
  useEffect(() => {
    fetch("/api/reports/invoices/summary").then((x) => (x.ok ? x.json() : null)).then((d) => d && setS(d)).catch(() => {});
  }, []);
  const delta = s && s.lastTotal > 0 ? Math.round(((s.thisTotal - s.lastTotal) / s.lastTotal) * 100) : null;
  const days = s ? [...s.lastDays, ...s.thisDays].slice(-7) : [];
  return (
    <Link href="/invoices" className="stat" style={{ textDecoration: "none", color: "inherit" }} title="فتح فاتورة المبيع">
      <div className="st-top"><span className="st-lb">فاتورة المبيع</span><span className="st-ic">🛒</span></div>
      <div className="inv-row">
        <span className="st-vl">{r.invoiceCount}</span>
        {delta != null ? (
          <span className="trend" style={delta < 0 ? { background: "rgba(229,56,79,.12)", color: "var(--bad)" } : undefined}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%
          </span>
        ) : (
          <span className="trend">جديد</span>
        )}
      </div>
      <div className="inv-amt">{fmt(r.invoiceIn)} <small>د.ع</small></div>
      <Spark values={days} />
    </Link>
  );
}

// المنحنى المساحي (تعبئة متدرّجة + خط + نقطة نهاية) — كما في النموذج
function Spark({ values }: { values: number[] }) {
  const W = 150, H = 34;
  if (values.length < 2) return <div style={{ height: H }} />;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 6 - (v / max) * (H - 12)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [ex, ey] = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="فواتير آخر سبعة أيام">
      <defs>
        <linearGradient id="spg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f5a623" stopOpacity=".55" />
          <stop offset="100%" stopColor="#f5a623" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#spg)" />
      <path d={line} fill="none" stroke="#f5a623" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={ex} cy={ey} r="3" fill="#f5a623" />
    </svg>
  );
}

// ٤ · إدارة الفنيين — دونات بقوسين (لاجورد منجزة + برتقالي متبقّية)
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
  const pct = total ? v!.done / total : 0;
  const R = 28, C = 2 * Math.PI * R, GAP = 4;
  const doneLen = Math.max(0, pct * C - GAP), restLen = Math.max(0, (1 - pct) * C - GAP);
  return (
    <Link href="/field-management" className="stat" style={{ textDecoration: "none", color: "inherit" }} title="فتح إدارة الفنيين">
      <div className="st-top"><span className="st-lb">🛠️ إدارة الفنيين</span><span className="st-ic">📋</span></div>
      <div className="fieldrow">
        <div className="sm-donut">
          <svg width="74" height="74" viewBox="0 0 74 74" role="img" aria-label={`أُنجز ${Math.round(pct * 100)} بالمئة من البطاقات`}>
            <circle cx="37" cy="37" r={R} fill="none" stroke="var(--line)" strokeWidth="11" />
            {total > 0 && (
              <>
                <circle cx="37" cy="37" r={R} fill="none" stroke="var(--navy)" strokeWidth="11" strokeLinecap="round"
                  strokeDasharray={`${doneLen} ${C - doneLen}`} />
                <circle cx="37" cy="37" r={R} fill="none" stroke="var(--orange)" strokeWidth="11" strokeLinecap="round"
                  strokeDasharray={`${restLen} ${C - restLen}`} strokeDashoffset={-(doneLen + GAP)} />
              </>
            )}
          </svg>
          <div className="dc"><b>{total ? `${Math.round(pct * 100)}%` : "—"}</b></div>
        </div>
        <div className="fnums">
          <div className="fnum"><span className="lf"><i className="dot" style={{ background: "var(--navy)" }} /> منجزة</span><b>{v?.done ?? "—"}</b></div>
          <div className="fnum"><span className="lf"><i className="dot" style={{ background: "var(--orange)" }} /> متبقّية</span><b>{v?.rest ?? "—"}</b></div>
        </div>
      </div>
    </Link>
  );
}
