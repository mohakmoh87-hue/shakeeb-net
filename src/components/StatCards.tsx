"use client";

import { useEffect, useState } from "react";
import AchievementsModal from "@/components/AchievementsModal";
import ChampionEmoji from "@/components/ChampionEmoji";
import Link from "next/link";
import { localSasBase } from "@/lib/localSas";
import { onMoneyRefresh } from "@/lib/moneyRefresh";
import { isPageActive } from "@/lib/usePolling";

// بطاقات الإحصاء الأربع — مطابقة حرفياً للنموذج المعتمد (أصناف .nst في globals.css):
// المشتركين (داكنة: الفعالين والمتصلين + الكلي) · المصروفات والمقبوضات (سطران +
// شريط نسبة + الصافي) · فاتورة المبيع (عدد + اتجاه + منحنى مساحي) · إدارة الفنيين (دونات).
// «الفعالين/المتصلين» كل 5 ثوانٍ من حاسبة المكتب حصراً (أ5) — بلا مرور على السحابة.
type Report = { invoiceCount: number; invoiceIn: number; expenses: number; total: number };
type Office = { id: number; name: string | null };

const fmt = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("en-US");

// مفتاح يوم العراق (YYYY-MM-DD) — نفس اليوم الذي تُحسب به أرقام البطاقات
function todayKey() {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export default function StatCards({ initialReport, towerIds, offices, isAdmin }: { initialReport: Report; towerIds: number[]; offices: Office[]; isAdmin: boolean }) {
  return (
    <section className="stats max-[1050px]:!grid-cols-2">
      <SubsCard towerIds={towerIds} offices={offices} isAdmin={isAdmin} />
      <MoneyCard offices={offices} isAdmin={isAdmin} />
      <InvoiceCard r={initialReport} offices={offices} isAdmin={isAdmin} />
      <FieldCard offices={offices} isAdmin={isAdmin} />
    </section>
  );
}

// ١ · المشتركين (داكنة) — الفعالين والمتصلين، والكلي سطراً صغيراً
function SubsCard({ towerIds, offices, isAdmin }: { towerIds: number[]; offices: Office[]; isAdmin: boolean }) {
  const [stats, setStats] = useState<{ active: number; total: number; online: number | null } | null>(null);
  const [live, setLive] = useState(false);
  const [cloudAt, setCloudAt] = useState<string | null>(null); // وقت آخر رفعة من حاسبات المكاتب
  // المدير يختار مكتباً أو الكل؛ المستخدم مكتبه فقط (towerIds تأتي بمكتبه وحده)
  const [officeSel, setOfficeSel] = useState<"all" | number>("all");
  const key = officeSel === "all" ? towerIds.join(",") : String(officeSel);

  // الأولوية للعامل المحلي (حي كل 5 ثوانٍ بلا سحابة — داخل المكتب)؛ وبدونه:
  // أرقام الحاسبات المرفوعة للقاعدة تُقرأ كل 10 دقائق (قرار محمد 2026-07-30 —
  // كانت 5 وخُفّفت لإطالة نوم التطبيق بعد نفاد منحة تموز المجانية)،
  // فيرى محمد الأرقام من أي مكان، ويُستأنف البحث عن عامل محلي كل 15 ثانية.
  useEffect(() => {
    if (!key) return;
    let stop = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let cloudPoll: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const ids = key.split(",").map(Number);

    const loadCloud = async () => {
      try {
        const r = await fetch("/api/subscribers/stats");
        const d = await r.json().catch(() => null);
        if (stop || !r.ok || !d?.offices) return;
        let active = 0, total = 0, online = 0, onlineKnown = false, any = false;
        for (const id of ids) {
          const o = d.offices[String(id)];
          if (!o) continue;
          any = true; active += o.active; total += o.total;
          if (o.online != null) { online += o.online; onlineKnown = true; }
        }
        if (any) { setStats({ active, total, online: onlineKnown ? online : null }); setCloudAt(d.at ?? null); }
      } catch { /* */ }
    };

    const start = async () => {
      const base = await localSasBase();
      if (stop) return;
      if (!base) {
        // بلا عامل محلي: المخزون السحابي (مرة فوراً ثم كل 10 دقائق) + إعادة البحث عن العامل
        // — والتبويب المخفي يصمت (حمية يقظة Azure)، وعند العودة تُجلب القراءة فوراً
        if (!cloudPoll) { void loadCloud(); cloudPoll = setInterval(() => { if (isPageActive()) void loadCloud(); }, 10 * 60 * 1000); }
        retry = setTimeout(start, 15000);
        return;
      }
      if (cloudPoll) { clearInterval(cloudPoll); cloudPoll = null; }
      const load = async () => {
        try {
          const r = await fetch(`${base}/stats/subscribers?towers=${key}`);
          const d = await r.json().catch(() => null);
          if (!stop && r.ok && d && typeof d.total === "number") {
            setStats({ active: d.active, total: d.total, online: typeof d.online === "number" ? d.online : null });
            setLive(true); setCloudAt(null);
          }
        } catch { /* العامل توقّف مؤقتاً — نُبقي آخر أرقام */ }
      };
      void load();
      poll = setInterval(load, 5000);
    };
    // العودة للتبويب أثناء وضع القراءة السحابية = قراءة فورية (لا انتظار الدورة)
    const onVis = () => { if (isPageActive() && cloudPoll) void loadCloud(); };
    document.addEventListener("visibilitychange", onVis);
    void start();
    return () => {
      stop = true;
      if (poll) clearInterval(poll);
      if (cloudPoll) clearInterval(cloudPoll);
      if (retry) clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [key]);

  // الضغط على البطاقة ينتقل لقائمة المشتركين أسفل الشاشة (البطاقات كلها قابلة للضغط — طلب محمد)
  const scrollToBoard = () => document.getElementById("subs-board")?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div className="stat dark" role="button" onClick={scrollToBoard} title="الانتقال لقائمة المشتركين">
      <div className="st-top">
        <span className="st-lb">المشتركين</span>
        {isAdmin && offices.length > 1 && (
          <select
            className="st-sel"
            value={officeSel}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onChange={(e) => setOfficeSel(e.target.value === "all" ? "all" : Number(e.target.value))}
          >
            <option value="all">كل المكاتب</option>
            {offices.map((o) => <option key={o.id} value={o.id}>{o.name ?? `#${o.id}`}</option>)}
          </select>
        )}
        <span className="st-ic">👥</span>
      </div>
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
          : stats && cloudAt
            ? <span title="أرقام مرفوعة من حاسبات المكاتب كل 5 دقائق — تُقرأ كل 10 دقائق">🕐 {new Date(cloudAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
            : <span title="تظهر الأرقام حين ترفعها حاسبات المكاتب (كل 5 دقائق) أو من عامل محلي">⏳ بانتظار حاسبات المكاتب</span>}
      </div>
    </div>
  );
}

// ٢ · المصروفات والمقبوضات — سطران + شريط نسبة + الصافي.
// أرقامها من صندوق اليدوي فقط (ما سُجّل في حساب المصروفات والمقبوضات ووصولاته)
// لا مبالغ الاشتراكات ولا الفواتير، ولِيَوم العراق الحالي فقط — تتحدّث يومياً
// وتتصفّر بعد منتصف الليل كبقية أرقام الرئيسية (طلبا محمد 2026-07-29).
function MoneyCard({ offices, isAdmin }: { offices: Office[]; isAdmin: boolean }) {
  const [s, setS] = useState<{ totalIn: number; totalOut: number; balance: number } | null>(null);
  const [officeSel, setOfficeSel] = useState<"all" | number>("all");
  // tick: يعاد الجلب عند أي تغيّر مالي وعند العودة للصفحة (بلا مؤقّت — قرار محمد)
  const [tick, setTick] = useState(0);
  useEffect(() => onMoneyRefresh(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    let stop = false;
    const qs = officeSel === "all" ? "" : `?officeId=${officeSel}`;
    fetch(`/api/money/summary${qs}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (!stop && d) setS(d); }).catch(() => {});
    return () => { stop = true; };
  }, [officeSel, tick]);
  const totalIn = s?.totalIn ?? 0, totalOut = s?.totalOut ?? 0, net = totalIn - totalOut;
  const sum = totalIn + totalOut;
  const inPct = sum > 0 ? Math.round((totalIn / sum) * 100) : 50;
  return (
    // البطاقة تعرض **يوم العراق الحالي** بينما الصفحة كانت تُفتح على كل الأزمنة —
    // فتضغط رقماً وتصل إلى صفحة لا تجد فيها ما يجمعه. الرابط الآن يحمل اليوم والمكتب.
    <Link
      href={"/cashbox?from=" + todayKey() + "&to=" + todayKey() + (officeSel === "all" ? "" : "&office=" + officeSel)}
      className="stat" style={{ textDecoration: "none", color: "inherit" }} title="فتح المصروفات والمقبوضات — مفلترة على اليوم ونفس المكتب">
      <div className="st-top">
        <span className="st-lb">المصروفات والمقبوضات</span>
        {isAdmin && offices.length > 1 && (
          <select
            className="st-sel-l"
            value={officeSel}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onChange={(e) => setOfficeSel(e.target.value === "all" ? "all" : Number(e.target.value))}
          >
            <option value="all">كل المكاتب</option>
            {offices.map((o) => <option key={o.id} value={o.id}>{o.name ?? `#${o.id}`}</option>)}
          </select>
        )}
        <span className="st-ic">💵</span>
      </div>
      <div className="flow">
        <div className="flow-line">
          <span className="fa in">↓</span>
          <span className="fa-lb">المقبوضات</span>
          <span className="fa-vl">{s ? fmt(totalIn) : "—"}</span>
        </div>
        <div className="flow-line">
          <span className="fa out">↑</span>
          <span className="fa-lb">المصروفات</span>
          <span className="fa-vl">{s ? fmt(totalOut) : "—"}</span>
        </div>
      </div>
      <div className="ratio" role="img" aria-label={`المقبوضات ${inPct} بالمئة والمصروفات ${100 - inPct} بالمئة`}>
        <span className="r-in" style={{ width: `${inPct}%` }} />
        <span className="r-out" style={{ width: `${100 - inPct}%` }} />
      </div>
      <div className="net">الصافي <b style={{ color: net < 0 ? "var(--bad)" : "var(--ok)" }}>{s ? fmt(net) : "—"}</b> <small>د.ع</small></div>
    </Link>
  );
}

// ٣ · فاتورة المبيع — عدد + وسام اتجاه + المبلغ + منحنى مساحي.
// المدير يختار مكتباً أو الكل (طلب محمد 2026-07-29) — العدد والمبلغ والمنحنى كلها تتبع الاختيار
function InvoiceCard({ r, offices, isAdmin }: { r: Report; offices: Office[]; isAdmin: boolean }) {
  const [s, setS] = useState<{ thisDays: number[]; lastDays: number[]; thisTotal: number; lastTotal: number; todayCount?: number; todayIn?: number } | null>(null);
  const [officeSel, setOfficeSel] = useState<"all" | number>("all");
  // tick: يعاد الجلب عند أي تغيّر مالي وعند العودة للصفحة (بلا مؤقّت — قرار محمد)
  const [tick, setTick] = useState(0);
  useEffect(() => onMoneyRefresh(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    let stop = false;
    const qs = officeSel === "all" ? "" : `?officeId=${officeSel}`;
    fetch(`/api/reports/invoices/summary${qs}`).then((x) => (x.ok ? x.json() : null)).then((d) => { if (!stop && d) setS(d); }).catch(() => {});
    return () => { stop = true; };
  }, [officeSel, tick]);
  const delta = s && s.lastTotal > 0 ? Math.round(((s.thisTotal - s.lastTotal) / s.lastTotal) * 100) : null;
  const days = s ? [...s.lastDays, ...s.thisDays].slice(-7) : [];
  return (
    <Link href="/invoices" className="stat" style={{ textDecoration: "none", color: "inherit" }} title="فتح فاتورة المبيع">
      <div className="st-top">
        <span className="st-lb">فاتورة المبيع</span>
        {isAdmin && offices.length > 1 && (
          <select
            className="st-sel-l"
            value={officeSel}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onChange={(e) => setOfficeSel(e.target.value === "all" ? "all" : Number(e.target.value))}
          >
            <option value="all">كل المكاتب</option>
            {offices.map((o) => <option key={o.id} value={o.id}>{o.name ?? `#${o.id}`}</option>)}
          </select>
        )}
        <span className="st-ic">🛒</span>
      </div>
      <div className="inv-row">
        <span className="st-vl">{s?.todayCount ?? r.invoiceCount}</span>
        {delta != null ? (
          <span className="trend" style={delta < 0 ? { background: "rgba(229,56,79,.12)", color: "var(--bad)" } : undefined}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%
          </span>
        ) : (
          <span className="trend">جديد</span>
        )}
      </div>
      <div className="inv-amt">{fmt(s?.todayIn ?? r.invoiceIn)} <small>د.ع</small></div>
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
function FieldCard({ offices, isAdmin }: { offices: Office[]; isAdmin: boolean }) {
  const [v, setV] = useState<{ done: number; rest: number } | null>(null);
  // 👑 متصدّر فترة الراتب — مسابقةٌ تبدأ مع الفترة وتُصفَّر مع نهايتها (طلب محمد 2026-08-05)
  const [king, setKing] = useState<{ name: string; office: string | null; cards: number; points: number; avgMin: number | null } | null>(null);
  const [rankOpen, setRankOpen] = useState(false); // نافذة الترتيب — تُفتح مكانها بلا مغادرة الشاشة
  useEffect(() => {
    let stop = false;
    fetch("/api/field/achievements?leader=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!stop && d?.leader) setKing(d.leader); })
      .catch(() => {});
    return () => { stop = true; };
  }, []);
  const [officeSel, setOfficeSel] = useState<"all" | number>("all");
  useEffect(() => {
    let stop = false;
    const count = (cards: { done?: boolean }[]) => {
      const done = cards.filter((c) => c.done).length;
      return { done, rest: cards.length - done };
    };
    (async () => {
      try {
        if (isAdmin && officeSel === "all" && offices.length > 0) {
          // كل المكاتب: جمع لوحات مكاتب الوكيل كلها
          const boards = await Promise.all(
            offices.map((o) => fetch(`/api/field/board?officeId=${o.id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)),
          );
          if (stop) return;
          let done = 0, rest = 0;
          for (const b of boards) {
            if (!b?.cards) continue;
            const c = count(b.cards);
            done += c.done; rest += c.rest;
          }
          setV({ done, rest });
        } else {
          // مكتب محدّد (مدير) أو مكتب المستخدم (يحدّده الخادم تلقائياً)
          const qs = isAdmin && officeSel !== "all" ? `?officeId=${officeSel}` : "";
          const d = await fetch(`/api/field/board${qs}`).then((r) => (r.ok ? r.json() : null));
          if (!stop && d?.cards) setV(count(d.cards));
        }
      } catch { /* */ }
    })();
    return () => { stop = true; };
  }, [isAdmin, officeSel, offices]);
  const total = (v?.done ?? 0) + (v?.rest ?? 0);
  const pct = total ? v!.done / total : 0;
  const R = 28, C = 2 * Math.PI * R, GAP = 4;
  const doneLen = Math.max(0, pct * C - GAP), restLen = Math.max(0, (1 - pct) * C - GAP);
  return (
    <>
    <Link href="/field-management" className="stat" style={{ textDecoration: "none", color: "inherit" }} title="فتح إدارة الفنيين">
      <div className="st-top">
        <span className="st-lb">🛠️ إدارة الفنيين</span>
        {isAdmin && offices.length > 1 && (
          <select
            className="st-sel-l"
            value={officeSel}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onChange={(e) => setOfficeSel(e.target.value === "all" ? "all" : Number(e.target.value))}
          >
            <option value="all">كل المكاتب</option>
            {offices.map((o) => <option key={o.id} value={o.id}>{o.name ?? `#${o.id}`}</option>)}
          </select>
        )}
        <span className="st-ic">📋</span>
      </div>
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
      {/* 👑 متصدّر الفترة: اسمٌ واحد لكل المكاتب، يبقى حتى يتجاوزه غيره أو تنتهي الفترة */}
      {king && (
        <div
          role="button"
          tabIndex={0}
          className="crown"
          title={`نقاط ${king.points} · ${king.cards} بطاقة${king.avgMin != null ? ` · متوسط ${king.avgMin} د` : ""} — اضغط لترتيب كل الفنيين`}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRankOpen(true); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setRankOpen(true); } }}
        >
          <ChampionEmoji size={66} className="crown-ic" />
          <span className="crown-nm">{king.name}</span>
          <span className="crown-pt">{king.points}</span>
        </div>
      )}
    </Link>
    {/* النافذة خارج الرابط: الضغط على التاج يفتح التفاصيل وحدها بلا فتح الصفحة */}
    {rankOpen && <AchievementsModal onClose={() => setRankOpen(false)} />}
    </>
  );
}
