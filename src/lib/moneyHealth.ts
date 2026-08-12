import { prisma } from "@/lib/prisma";

// ===== «سلامة المال» — الحارسُ نفسُه، لكن داخل الموقع (طلب محمد 2026-08-12) =====
// نصُّه: «يكون في حسابات المدير **سلامة المال**، وعند الضغط عليه تُفتح صفحةٌ فيها الحالاتُ
// الموجودة **ولا تكرارَ فيها أبداً**، وكلُّ حالةٍ فيها تفاصيلُها وطريقةُ حلّها، كما يمكن حلُّها
// **بضغطة زر**، وأيضاً يمكنه ضغط **تجاهل** فلا تُعاد له مرّةً أخرى. **ولا داعيَ لتنبيهٍ بالإيميل
// ولا أيّ شيءٍ آخر** — فالوكيلُ عندما يرى خللاً ماليّاً يتوجّه إلى هذه الصفحة ليرى كلّ شيء».
//
// والأصلُ سكربتُ `scripts/check-money-invariants.mjs` — مُختبَرٌ على الإنتاج، واصطاد من أوّل
// تشغيلٍ ٤٥٬٠٠٠ في الصندوق بلا وصل (وصلٌ أُبطل والمالُ بقي). فهذه المكتبةُ تنقل حقائقَه
// إلى الموقع بهويّةٍ لكلّ حالة كي يُمكن **تجاهلُها** و**حلُّها**.
//
// 🔒 والعزل: كلُّ استعلامٍ مقصورٌ على مكاتب الوكيل — ولا يُقبل `agentId` من العميل، بل من الجلسة.

export type HealthSeverity = "critical" | "warn" | "info";

export type HealthCase = {
  checkKey: string; // مفتاحُ الحقيقة (ثابتٌ في الكود)
  rowKey: string; // هويّةُ الحالة بعينها — بها يُتجاهَل ويُمنع التكرار
  title: string; // ما الخلل
  detail: string; // تفاصيلُه بالأرقام والوقت
  how: string; // كيف يُحَلّ
  severity: HealthSeverity;
  amount?: number;
  at?: string; // وقتُ الحادثة (بغداد)
  fix?: string; // مفتاحُ الحلّ الآليّ إن كان له حلٌّ بضغطة زر
};

export type HealthCheck = {
  key: string;
  name: string;
  ok: boolean;
  cases: HealthCase[];
  note?: string;
};

const BG = `+ interval '3 hours'`; // بغداد = UTC+3 بلا توقيتٍ صيفيّ — والعمودُ يحفظ UTC بلا منطقة

/** مكاتبُ الوكيل — أساسُ كلّ ترشيح. فارغةٌ ⇒ لا شيءَ يُفحَص (ولا يُكشف مالُ غيره). */
async function towerIdsOf(agentId: number): Promise<number[]> {
  const rows = await prisma.tower.findMany({ where: { agentId }, select: { id: true } });
  return rows.map((r) => r.id);
}

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => Number(v ?? 0);

export async function runMoneyHealth(agentId: number): Promise<{ checks: HealthCheck[]; summary: Row }> {
  const towers = await towerIdsOf(agentId);
  const T = towers.length ? towers.join(",") : "-1";
  const checks: HealthCheck[] = [];
  const q = async (sql: string): Promise<Row[]> => (await prisma.$queryRawUnsafe<Row[]>(sql)) ?? [];

  // ── ١) مبلغٌ سالبٌ أو كسريٌّ في الصندوق ──
  // الصندوقُ لا يحمل سالباً أصلاً (`moneyIn/moneyOut` منفصلان)، والكسرُ يُسقط تسديدَ الراتب.
  try {
    const r = await q(`SELECT id, "towerId", "sourceType", "moneyIn", "moneyOut",
        to_char(date ${BG}, 'YYYY-MM-DD HH24:MI') AS at
      FROM money_tx WHERE "isDeleted" = false AND "towerId" IN (${T})
        AND (coalesce("moneyIn",0) < 0 OR coalesce("moneyOut",0) < 0
             OR coalesce("moneyIn",0) <> trunc(coalesce("moneyIn",0))
             OR coalesce("moneyOut",0) <> trunc(coalesce("moneyOut",0)))
      ORDER BY date DESC LIMIT 200`);
    checks.push({
      key: "tx_negative_or_fraction", name: "لا مبلغَ سالباً ولا كسريّاً في الصندوق", ok: r.length === 0,
      cases: r.map((x) => ({
        checkKey: "tx_negative_or_fraction", rowKey: `tx:${s(x.id)}`,
        title: "قيدٌ ماليٌّ بمبلغٍ سالبٍ أو كسريّ",
        detail: `قيد #${s(x.id)} · نوعه ${s(x.sourceType) || "—"} · قبض ${n(x.moneyIn)} · صرف ${n(x.moneyOut)} · ${s(x.at)}`,
        how: "صحّح المبلغَ من صفحة المصروفات/المقبوضات (تعديل القيد)، أو أبطله وسجّله صحيحاً. والكسرُ صار مرفوضاً عند الإدخال، فهذا قيدٌ قديم.",
        severity: "critical", amount: n(x.moneyIn) || n(x.moneyOut), at: s(x.at),
      })),
    });
  } catch (e) { checks.push({ key: "tx_negative_or_fraction", name: "لا مبلغَ سالباً ولا كسريّاً في الصندوق", ok: true, cases: [], note: `تعذّر الفحص: ${(e as Error).message}` }); }

  // ── ٢) وصلُ تفعيلٍ قابضٌ بلا قيدٍ في الصندوق ──
  // 🔴 والقيدُ المقابلُ قد يكون **نقديّاً أو ماستر**: بورتي الأولى قصرته على 'activation' فأخرجت
  // **٢٠٠ إنذارٍ كاذب** لوكيل شكيب بينما السكربتُ المُختبَر يقول «سليم». والقاعدةُ التي كسرتُها
  // ثمّ عدتُ إليها: **ما لا يُثبَت لا يُتَّهم** — وأيُّ فحصٍ يُخرج سيلاً فمُتَّهَمٌ هو أوّلاً لا البيانات.
  try {
    const r = await q(`SELECT e.id, e."towerId", e."moneyIn",
        to_char(e.date ${BG}, 'YYYY-MM-DD HH24:MI') AS at
      FROM subscription_entries e
      WHERE e."isDeleted" = false AND coalesce(e."moneyIn",0) > 0 AND e."towerId" IN (${T})
        AND NOT EXISTS (SELECT 1 FROM money_tx m WHERE m."isDeleted" = false
              AND m."sourceId" = e.id AND m."sourceType" IN ('activation','master'))
      ORDER BY e.date DESC LIMIT 200`);
    checks.push({
      key: "entry_without_tx", name: "كلُّ وصلِ تفعيلٍ قابضٍ له قيدٌ في الصندوق", ok: r.length === 0,
      cases: r.map((x) => ({
        checkKey: "entry_without_tx", rowKey: `entry:${s(x.id)}`,
        title: "وصلُ تفعيلٍ قبض مالاً ولا قيدَ له في الصندوق",
        detail: `وصل #${s(x.id)} · قبض ${n(x.moneyIn)} · ${s(x.at)}`,
        how: "المالُ مقبوضٌ ولا يظهر في الصندوق ⇒ إمّا يُسجَّل قيدُ قبضٍ مقابله، أو يُبطَل الوصلُ إن كان خطأً. راجِع الوصلَ أوّلاً.",
        severity: "critical", amount: n(x.moneyIn), at: s(x.at),
      })),
    });
  } catch (e) { checks.push({ key: "entry_without_tx", name: "كلُّ وصلِ تفعيلٍ قابضٍ له قيدٌ في الصندوق", ok: true, cases: [], note: `تعذّر الفحص: ${(e as Error).message}` }); }

  // ── ٣) قيدُ تفعيلٍ في الصندوق بلا وصلٍ قائم ──
  // 🎯 هذه هي التي اصطادت ٤٥٬٠٠٠: وصلٌ أُبطل والمالُ بقي في الصندوق.
  try {
    const r = await q(`SELECT m.id, m."towerId", m."moneyIn", m."sourceId",
        to_char(m.date ${BG}, 'YYYY-MM-DD HH24:MI') AS at
      FROM money_tx m
      WHERE m."isDeleted" = false AND m."sourceType" = 'activation' AND m."towerId" IN (${T})
        AND m."sourceId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM subscription_entries e
              WHERE e.id = m."sourceId" AND e."isDeleted" = false)
      ORDER BY m.date DESC LIMIT 200`);
    checks.push({
      key: "tx_without_entry", name: "كلُّ قيدِ تفعيلٍ له وصلٌ قائم", ok: r.length === 0,
      cases: r.map((x) => ({
        checkKey: "tx_without_entry", rowKey: `tx:${s(x.id)}`,
        title: "مالُ تفعيلٍ في الصندوق ووصلُه مُبطَل",
        detail: `قيد #${s(x.id)} · ${n(x.moneyIn)} · وصلُه #${s(x.sourceId)} غيرُ قائم · ${s(x.at)}`,
        how: "الوصلُ أُبطل والمالُ بقي. إمّا يُبطَل القيدُ أيضاً (إن رُدّ المالُ للمشترك) أو يُعاد الوصلُ (إن بقي المالُ عندك بحقّ). القرارُ لك — والبرنامجُ لا يُخمّن في مالٍ.",
        severity: "critical", amount: n(x.moneyIn), at: s(x.at),
      })),
    });
  } catch (e) { checks.push({ key: "tx_without_entry", name: "كلُّ قيدِ تفعيلٍ له وصلٌ قائم", ok: true, cases: [], note: `تعذّر الفحص: ${(e as Error).message}` }); }

  // ── ٤) تسديدُ راتبٍ مزدوجٌ لنفس الفترة ──
  try {
    const r = await q(`WITH cancelled AS (
        SELECT DISTINCT "entityId"::int AS sid FROM audit_logs
        WHERE action = 'SALARY_CANCEL' AND "entityId" ~ '^[0-9]+$'
      )
      SELECT s."technicianId", s."technicianName", s."periodFrom", s."periodTo",
             count(*)::int AS n, sum(coalesce(s."paidAmount", s.net))::int AS total,
             min(s.id) AS first_id, max(s.id) AS last_id
      FROM salary_statements s
      WHERE s.id NOT IN (SELECT sid FROM cancelled) AND s."agentId" = ${agentId}
        AND s."cancelledAt" IS NULL
      GROUP BY 1,2,3,4 HAVING count(*) > 1
      ORDER BY 3 DESC LIMIT 100`);
    checks.push({
      key: "double_salary", name: "لا تسديدَ راتبٍ مزدوجاً لنفس الفترة", ok: r.length === 0,
      cases: r.map((x) => ({
        checkKey: "double_salary", rowKey: `sal:${s(x.technicianId)}:${s(x.periodFrom)}:${s(x.periodTo)}`,
        title: "راتبٌ سُدِّد أكثرَ من مرّةٍ للفترة نفسِها",
        detail: `${s(x.technicianName)} · ${s(x.periodFrom)} → ${s(x.periodTo)} · ${n(x.n)} كشوفٍ بمجموع ${n(x.total)} (كشوف #${s(x.first_id)}…#${s(x.last_id)})`,
        how: "ألغِ الكشفَ الزائدَ من سجلّ رواتب الفنيّ (يُلغى معه قيدُ صرفه). وقد أُضيف فهرسٌ فريدٌ يمنع تكرارَه مستقبلاً.",
        severity: "critical", amount: n(x.total),
      })),
    });
  } catch (e) { checks.push({ key: "double_salary", name: "لا تسديدَ راتبٍ مزدوجاً لنفس الفترة", ok: true, cases: [], note: `تعذّر الفحص: ${(e as Error).message}` }); }

  // ── ٥) قيدٌ ماليٌّ بلا مكتب ──
  // صمّامُ أمان: قيدٌ بلا مكتبٍ يختفي عن كلّ القوائم فلا يُرى ولا يُحاسَب.
  try {
    const r = await q(`SELECT m.id, m."sourceType", m."moneyIn", m."moneyOut",
        to_char(m.date ${BG}, 'YYYY-MM-DD HH24:MI') AS at
      FROM money_tx m
      WHERE m."isDeleted" = false AND m."towerId" IS NULL
        AND m."userId" IN (SELECT id FROM users WHERE "agentId" = ${agentId})
      ORDER BY m.date DESC LIMIT 100`);
    checks.push({
      key: "tx_without_office", name: "كلُّ قيدٍ ماليٍّ له مكتب", ok: r.length === 0,
      cases: r.map((x) => ({
        checkKey: "tx_without_office", rowKey: `tx:${s(x.id)}`,
        title: "قيدٌ ماليٌّ بلا مكتب — يختفي عن كلّ القوائم",
        detail: `قيد #${s(x.id)} · ${s(x.sourceType) || "—"} · قبض ${n(x.moneyIn)} · صرف ${n(x.moneyOut)} · ${s(x.at)}`,
        how: "افتح المصروفات/المقبوضات بمُرشِّح «بلا مكتب» وأسنِده إلى مكتبه — فقيدٌ بلا مكتبٍ لا يظهر في أيّ تقرير.",
        severity: "warn", amount: n(x.moneyIn) || n(x.moneyOut), at: s(x.at),
      })),
    });
  } catch (e) { checks.push({ key: "tx_without_office", name: "كلُّ قيدٍ ماليٍّ له مكتب", ok: true, cases: [], note: `تعذّر الفحص: ${(e as Error).message}` }); }

  // ── ٦) مشتركون لهم رصيدٌ (carry سالب) — لا شاشةَ تُظهرهم ──
  try {
    const r = await q(`SELECT s.id, s.name, s."netUser", s.carry, s."towerId"
      FROM subscribers s
      WHERE s."isDeleted" = false AND coalesce(s.carry,0) < 0 AND s."towerId" IN (${T})
      ORDER BY s.carry ASC LIMIT 200`);
    checks.push({
      key: "credit_subscribers", name: "مشتركون لهم رصيدٌ عندك", ok: r.length === 0,
      cases: r.map((x) => ({
        checkKey: "credit_subscribers", rowKey: `sub:${s(x.id)}`,
        title: "مشتركٌ له رصيدٌ عندك (دفع أكثرَ من دَينه)",
        detail: `${s(x.name)}${x.netUser ? ` · ${s(x.netUser)}` : ""} · رصيدُه ${Math.abs(n(x.carry))}`,
        how: "رصيدٌ يُحتسب له في تفعيله القادم تلقائياً. ولا خللَ فيه — يُتجاهَل إن أردتَ إخفاءه، أو يُردّ له نقداً فتسجّل صرفاً بمقداره.",
        severity: "info", amount: Math.abs(n(x.carry)),
      })),
    });
  } catch (e) { checks.push({ key: "credit_subscribers", name: "مشتركون لهم رصيدٌ عندك", ok: true, cases: [], note: `تعذّر الفحص: ${(e as Error).message}` }); }

  // ── ٧) أرقامُ إحاطةٍ (لا حالاتٍ) ──
  let summary: Row = {};
  try {
    const r = await q(`SELECT
        (SELECT count(*)::int FROM money_tx WHERE "isDeleted" = false AND "towerId" IN (${T})) AS tx_live,
        (SELECT count(*)::int FROM money_tx WHERE "isDeleted" = true  AND "towerId" IN (${T})) AS tx_deleted,
        (SELECT count(*)::int FROM salary_statements WHERE "agentId" = ${agentId}) AS statements,
        (SELECT count(*)::int FROM subscribers WHERE "isDeleted" = false AND coalesce(carry,0) > 0 AND "towerId" IN (${T})) AS debtors,
        (SELECT coalesce(sum(carry),0)::int FROM subscribers WHERE "isDeleted" = false AND coalesce(carry,0) > 0 AND "towerId" IN (${T})) AS debt_total`);
    summary = r[0] ?? {};
  } catch { /* الإحاطةُ زينة */ }

  return { checks, summary };
}
