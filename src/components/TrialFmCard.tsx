"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ChampionEmoji from "@/components/ChampionEmoji";
import WaStatusBadge from "@/components/WaStatusBadge";
import AchievementsModal from "@/components/AchievementsModal";
import { hasTrialSkin } from "@/components/trialSkin";
import { slaStateOf, type SlaCard } from "@/lib/odooSla";
import { useTrialOffice } from "@/components/TrialOfficeContext";

// ═════════ 🧪 مربّعُ «إدارة الفنيّين» في رئيسيّة النموذج (شاشة أ) ═════════
//
// من نموذج «واجهات تطبيق شكيب» المعتمَد: العمودُ الأيسرُ في رئيسيّة التطبيق —
// شريطُ عدَدَي المشتركين ← حلقةُ الإنجاز مع الوسائل (منجزة/متبقّية/مؤجّلة/تذاكر أودو)
// ← شريطُ المتصدّر ← زرُّ «سجلّ الوصولات» العريض.
//
// 🛡️ لا يعمل إلّا تحت علَم التجربة: بلا الكعكة يرجع null قبل أيّ جلبٍ — فصفرُ
//    كلفةٍ وصفرُ أثرٍ على الإنتاج. والبياناتُ من مساراتٍ قائمةٍ معزولةٍ بالجلسة
//    أصلاً (board/achievements/stats) — لا مسارَ جديدَ ولا عزلَ جديد.
//
// 🔗 يتبع اختيارَ المكتب المشترك (منتقي التقرير اليومي) عبر TrialOfficeContext:
//    «كلّ المكاتب» ⇒ جمعُ لوحاتِ الوكيل، ومكتبٌ محدّد ⇒ لوحتُه وحدها — والفعّالون/المتّصلون كذلك.
export type TrialFmDemo = {
  done: number; left: number; odoo: number; postponed?: number;
  leader: { name: string; points: number } | null;
  // تصحيح محمد 2026-08-19: الرقمان هما الفعّالون والمتّصلون — لا الكلّيّ
  subs: { active: number; online: number | null } | null;
};

type Office = { id: number; name: string | null };

// demo: صفحةُ المعاينة تمرّر أرقاماً جاهزةً فتُرسم البطاقةُ بلا جلبٍ ولا علَم
export default function TrialFmCard({ demo, offices = [], isAdmin = false }: { demo?: TrialFmDemo; offices?: Office[]; isAdmin?: boolean }) {
  const { office } = useTrialOffice();
  const [on, setOn] = useState(!!demo);
  // منجزة اليوم · متبقّية · مؤجّلة (إلى يومٍ قادم) — تُحسب في الخادم بحدود يوم بغداد
  const [completed, setCompleted] = useState(demo?.done ?? 0);
  const [remaining, setRemaining] = useState(demo?.left ?? 0);
  const [postponed, setPostponed] = useState(demo?.postponed ?? 0);
  const [odoo, setOdoo] = useState(demo?.odoo ?? 0);
  // ⏳ إنذارُ مهلة أودو في المربّع (فحص محمد 2026-08-19): عددُ التذاكر المفتوحة التي
  //    تجاوزت عتبةَ الإنذار — بالعتبات الافتراضيّة لأنّ المربّعَ قد يجمع كلَّ المكاتب
  const [odooHot, setOdooHot] = useState(0);
  const [portalOn, setPortalOn] = useState(true); // سوبر سيل مفعّلة؟ — عند الإطفاء يُمحى اسمُها من تلميح مهلة أودو
  const [leader, setLeader] = useState<{ name: string; points: number } | null>(demo?.leader ?? null);
  // 🔴 لقطة محمد (2026-08-19): «عند الضغط على الفني فهد يفتح صفحة ادارة الفنيين وليس
  //    نافذة انجازات الفنيين كما في السابق» — فالشارةُ تفتح النافذةَ لا الرابط
  const [rankOpen, setRankOpen] = useState(false);
  const [subs, setSubs] = useState<{ active: number; online: number | null } | null>(demo?.subs ?? null);

  // ثابتان لا يتبعان المكتب: تفعيلُ سوبر سيل والمتصدّر (على مستوى الوكيل)
  useEffect(() => {
    if (demo) return;
    if (!hasTrialSkin()) return;
    setOn(true);
    fetch("/api/app/config").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setPortalOn(d.portalEnabled !== false); }).catch(() => {});
    fetch("/api/field/achievements?leader=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.leader?.name) setLeader({ name: d.leader.name, points: Number(d.leader.points ?? 0) }); })
      .catch(() => {});
  }, [demo]);

  // اللوحةُ والفعّالون/المتّصلون يتبعان المكتبَ المختار
  const officeKey = offices.map((o) => o.id).join(",");
  useEffect(() => {
    if (demo) return;
    if (!hasTrialSkin()) return;
    let stop = false;
    const now = new Date();
    const readBoard = (d: { completedToday?: number; remainingOpen?: number; postponedOpen?: number; odooOpen?: number; cards?: SlaCard[] } | null) => {
      const cards = (d?.cards ?? []) as SlaCard[];
      const hot = cards.reduce((n, c) => { const lv = slaStateOf(c, now).level; return n + (lv === "danger" || lv === "over" ? 1 : 0); }, 0);
      return {
        completed: Number(d?.completedToday ?? 0),
        remaining: Number(d?.remainingOpen ?? 0),
        postponed: Number(d?.postponedOpen ?? 0),
        odoo: Number(d?.odooOpen ?? 0),
        hot,
      };
    };
    const load = async () => {
      try {
        const agg = { completed: 0, remaining: 0, postponed: 0, odoo: 0, hot: 0 };
        if (isAdmin && office === "all" && offices.length > 0) {
          const boards = await Promise.all(
            offices.map((o) => fetch(`/api/field/board?officeId=${o.id}&counts=1`).then((r) => (r.ok ? r.json() : null)).catch(() => null)),
          );
          if (stop) return;
          // 🔒 مكاتبُ مجموعةٍ تتشارك لوحةً واحدة (sharedFieldWith) تُرجِع نفسَ اللوحة بأرقامها كاملةً —
          //    فتُحسَب كلُّ لوحةٍ مرّةً واحدةً بمعرّفها لئلّا تتضاعف أرقامُ المجموعة.
          const seenBoards = new Set<number>();
          for (const b of boards) {
            if (!b) continue;
            const bid = b.board?.id;
            if (typeof bid === "number") { if (seenBoards.has(bid)) continue; seenBoards.add(bid); }
            const x = readBoard(b);
            agg.completed += x.completed; agg.remaining += x.remaining; agg.postponed += x.postponed; agg.odoo += x.odoo; agg.hot += x.hot;
          }
        } else {
          const qs = isAdmin && office !== "all" ? `?officeId=${office}&counts=1` : "?counts=1";
          const b = await fetch(`/api/field/board${qs}`).then((r) => (r.ok ? r.json() : null));
          if (stop) return;
          const x = readBoard(b);
          agg.completed = x.completed; agg.remaining = x.remaining; agg.postponed = x.postponed; agg.odoo = x.odoo; agg.hot = x.hot;
        }
        if (stop) return;
        setCompleted(agg.completed); setRemaining(agg.remaining); setPostponed(agg.postponed); setOdoo(agg.odoo); setOdooHot(agg.hot);
        setOn(true);
      } catch { setOn(true); }
    };
    const loadSubs = async () => {
      try {
        const r = await fetch("/api/subscribers/stats");
        const d = await r.json().catch(() => null);
        if (stop || !d?.offices) return;
        // مكتبٌ محدّد ⇒ أرقامه وحده؛ وإلّا (الكلّ/غير المدير) ⇒ جمعُ ما يُرجعه المسار
        let active = 0, online = 0, onlineKnown = false;
        const ids = isAdmin && office !== "all" ? [String(office)] : Object.keys(d.offices);
        for (const id of ids) {
          const o = (d.offices as Record<string, { active?: number; online?: number | null }>)[id];
          if (!o) continue;
          active += Number(o.active ?? 0);
          if (o.online != null) { online += Number(o.online); onlineKnown = true; }
        }
        setSubs({ active, online: onlineKnown ? online : null });
      } catch { /* */ }
    };
    void load();
    void loadSubs();
    return () => { stop = true; };
  }, [demo, office, isAdmin, officeKey, offices]);

  if (!on) return null;

  const all = completed + remaining;
  const pct = all > 0 ? Math.round((completed / all) * 100) : 0;
  const fmt = (n: number) => n.toLocaleString("en-US");

  return (
    <div data-trial-fm className="tfm">
      {/* مؤشّرُ الواتساب فوق كلّ شيء — أعلى الرقمَين (طلب محمد 2026-08-19) */}
      <div className="tfm-wa"><WaStatusBadge /></div>
      {subs && (
        <Link href="/all-subscribers" className="tfm-subs" title="الفعّالون والمتّصلون — اضغط لفتح قائمة المشتركين">
          <span title="المشتركون الفعّالون"><i className="tfm-dot" style={{ background: "#86efac" }} />{fmt(subs.active)}</span>
          <span title="المتّصلون الآن"><i className="tfm-dot" style={{ background: "#a5e3ff" }} />{subs.online == null ? "—" : fmt(subs.online)}</span>
        </Link>
      )}
      <Link href="/field-management" className="tfm-main" title="اضغط لفتح إدارة الفنيّين">
        <h4>إدارة الفنيّين</h4>
        <div className="tfm-row">
          <div className="tfm-ring" style={{ background: `conic-gradient(#0a4f8a 0 ${pct}%, #d7e8f7 ${pct}% 100%)` }}>
            <i>{pct}٪</i>
          </div>
          <div className="tfm-legend">
            <div><span>منجزة</span><b>{fmt(completed)}</b></div>
            <div><span>متبقّية</span><b>{fmt(remaining)}</b></div>
            <div><span>مؤجّلة</span><b>{fmt(postponed)}</b></div>
            <div className={odooHot > 0 ? "tfm-sla" : undefined} title={odooHot > 0 ? `⏳ ${odooHot} تذكرة تجاوزت ${portalOn ? "مهلةَ سوبر سيل" : "المهلة"}` : undefined}>
              <span>تذاكر أودو{odooHot > 0 ? " ⏳" : ""}</span><b>{fmt(odoo)}</b>
            </div>
          </div>
        </div>
        {leader && (
          // الشارةُ داخل رابط البطاقة ⇒ توقفُ التصعيدَ والانتقالَ وتفتح نافذةَ الإنجازات
          <button
            type="button"
            className="tfm-badge"
            style={{ width: "100%", border: 0, cursor: "pointer" }}
            title="اضغط لفتح إنجازات الفنيّين"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRankOpen(true); }}
          >
            <ChampionEmoji size={30} />
            <span className="tfm-nm">{leader.name}</span>
            <span className="tfm-pill">{leader.points.toLocaleString("en-US", { maximumFractionDigits: 1 })}</span>
          </button>
        )}
      </Link>
      <Link href="/receipts" className="tfm-receipts" title="اضغط لفتح سجلّ الوصولات">سجلّ الوصولات</Link>
      {rankOpen && <AchievementsModal onClose={() => setRankOpen(false)} />}
    </div>
  );
}
