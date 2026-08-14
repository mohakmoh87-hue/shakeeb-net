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

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🕵️ **واجباتُ الحارس الموسَّعة** (طلبُ محمد 2026-08-14):
  // «وظيفةُ حارس المال دراسةُ **كلّ شذوذٍ ممكنٍ** يحدث للمال والمشتركين والمخازن
  //  ويُبلِّغ به» ثمّ «أريد **كلَّ** هذه البنود أن تكون واجباتِ حارس المال، وأيضاً
  //  يمكن تجاهُلُ أيّ حالةٍ من الحارس».
  //
  // وكلُّها مأخوذةٌ من `docs/MONEY-GUARD-CATALOGUE.md` — وكلُّ رقمٍ فيه **قِيس على
  // بيانات الإنتاج** قبل أن يُكتَب فحصُه، فلا فحصَ نظريّاً يُخرج سيلاً من الكذب.
  //
  // ⚠️ ودرسٌ محفورٌ في هذا الملفّ من قبل: فحصٌ بمعيارٍ ناقصٍ أخرج **٢٠٠ إنذارٍ كاذب**
  //   لوكيل شكيب. وفي مسحِ اليوم سقط بندٌ كامل («٢٥٦ تفعيلاً بلا قيدِ صندوقٍ بتسعةِ
  //   ملايين») لمّا تبيّن أنّ **٢٥٦ من ٢٥٦ تفعيلاتُ ماستر** ومالُها في `sourceType='master'`.
  //   فالقاعدة: **ما لا يُثبَت لا يُتَّهم**، وأيُّ فحصٍ يُخرج سيلاً فمُتَّهَمٌ هو أوّلاً.
  //
  // 🔒 والعزل في **شرطِ كلّ استعلام**: مكاتبُ الوكيل (T) أو `agentId` — لا فحصٌ سابقٌ عليه.
  // ═══════════════════════════════════════════════════════════════════════════════

  /** يُضيف فحصاً بأمانٍ: خطأُ استعلامٍ يصير ملاحظةً ولا يُسقط اللوحةَ كلَّها. */
  const add = async (
    key: string, name: string, sql: string,
    map: (x: Row) => Omit<HealthCase, "checkKey">,
  ): Promise<void> => {
    try {
      const r = await q(sql);
      checks.push({ key, name, ok: r.length === 0, cases: r.map((x) => ({ checkKey: key, ...map(x) })) });
    } catch (e) {
      checks.push({ key, name, ok: true, cases: [], note: `تعذّر الفحص: ${(e as Error).message}` });
    }
  };

  // ── أ-٢ · 🔴 كارتٌ مستخدَمٌ **بلا أيّ وصلٍ أصلاً** ──
  //
  // 🔴 **تصحيحٌ من محمد 2026-08-14**: «إذا فعّلتُ مشتركاً بالدَّين فهذا لا يُعتبر خطراً،
  //   فلماذا حسبتَه خطراً؟» — وكان معياري «بلا وصلٍ **بمبلغٍ مقبوض**»، والتفعيلُ على
  //   الدَّين وصلُه مسجَّلٌ بمقبوضٍ صفرٍ والمالُ متتبَّعٌ في دَين المشترك. فليس خطراً.
  // ⚖️ **وقِيس أثرُ خطئي**: ٥٨ حالةً بالمعيار القديم، منها **٤٤ تفعيلاتُ دَينٍ مشروعة**
  //   (٩٧٠٬٣٥٠ د.ع) ⇒ **٧٦٪ من الإنذار كان ظلماً**. والحقيقيُّ **١٤ كارتاً بـ٤٨٨٬٤٠٠**
  //   لا وصلَ لها أصلاً — لا قبضاً ولا دَيناً، أي كارتٌ خرج من المخزن بلا أثرٍ ماليّ.
  //   والدرسُ هو نفسُه الذي تكرّر مرّتَين اليوم: **معيارٌ ناقصٌ يُنتج إنذاراً كاملاً كاذباً**.
  // ونافذةُ ±٣ أيّامٍ لأنّ تاريخَ إدخالِ الوصل قد يختلف عن تاريخ مسحِ الكارت بيومٍ أو يومَين.
  await add("card_used_no_receipt", "كلُّ كارتٍ مستخدَمٍ له وصلٌ — قبضاً أو دَيناً", `
    SELECT r.id, r.serial, r.price, s.name AS sub, s."netUser",
           to_char(r."useDate" ${BG}, 'YYYY-MM-DD') AS at
      FROM recharge_cards r LEFT JOIN subscribers s ON s.id = r."subscriberId"
     WHERE r."agentId" = ${agentId} AND r."useDate" IS NOT NULL AND r."subscriberId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM subscription_entries e
             WHERE e."subscriberId" = r."subscriberId" AND e."isDeleted" = false
               AND e.date BETWEEN r."useDate" - INTERVAL '3 days' AND r."useDate" + INTERVAL '3 days')
       -- ⚖️ **زوالُ الأثر**: إن ذُكر سيريالُ الكارت في وصلٍ **بأيّ تاريخ** فقد سُجِّل ولو
       --    متأخّراً (تصحيحٌ يدويٌّ بعد الحادثة) ⇒ لا حالةَ تُفتَح. قِيس: ١ من ١٤.
       AND NOT EXISTS (SELECT 1 FROM subscription_entries e2
             WHERE e2.card2 = r.serial AND e2."isDeleted" = false)
     ORDER BY r."useDate" DESC LIMIT 200`, (x) => ({
    rowKey: `card:${s(x.id)}`,
    title: "كارتٌ استُخدم ولا وصلَ له أصلاً — لا قبضاً ولا دَيناً",
    detail: `سيريال ${s(x.serial)} · ${n(x.price)} د.ع · ${s(x.sub) || "؟"}${x.netUser ? ` (${s(x.netUser)})` : ""} · ${s(x.at)}`,
    how: "الكارتُ خرج من مخزنك ولا قيدَ للمشترك في تلك الأيّام: لا وصلَ قبضٍ ولا تفعيلاً على الدَّين. سجّل الوصلَ بتاريخه (قبضاً أو دَيناً)، أو تجاهَلِ الحالةَ إن كان تعويضاً أو تفعيلَ اختبار. ⚠️ والتفعيلُ على الدَّين **لا يُبلَّغ عنه** — فوصلُه مسجَّلٌ والمالُ في دَين المشترك.",
    severity: "critical", amount: n(x.price), at: s(x.at),
  }));

  // ── أ-٣ · 🔴 كروتٌ مستخدَمةٌ بسعرِ صفر — **مجموعةً بالفئة** لا صفّاً لكلّ كارت ──
  // 🔑 قِيست ٦٥ كارتاً لصفاء، وكلُّها **جذرٌ واحد**: سعرُ فئةٍ غيرُ مضبوط. فصفٌّ لكلّ كارتٍ
  //   يعني ٦٥ إنذاراً لعلاجٍ واحدٍ — والتجميعُ يجعل الحالةَ تقول ما يُفعَل: اضبط سعرَ الفئة.
  await add("card_used_zero_price", "كلُّ كارتٍ مستخدَمٍ له سعر", `
    SELECT r."packageId", count(*)::int AS n, p.name AS pkg,
           to_char(max(r."useDate") ${BG}, 'YYYY-MM-DD') AS at
      FROM recharge_cards r LEFT JOIN packages p ON p.id = r."packageId"
     WHERE r."agentId" = ${agentId} AND r."useDate" IS NOT NULL AND coalesce(r.price,0) = 0
     GROUP BY 1, 3 ORDER BY 2 DESC LIMIT 50`, (x) => ({
    rowKey: `zerocards:${s(x.packageId)}`,
    title: "كروتٌ استُخدمت بسعرِ صفر — لا تدخل ديونَ الكارتات",
    detail: `${n(x.n)} كارتاً من فئة «${s(x.pkg) || s(x.packageId) || "غيرِ محدَّدة"}» · آخرُها ${s(x.at)}`,
    how: "اضبط سعرَ هذه الفئة من «سعر الكارت لكل فئة» في هذه الصفحة — فالكروتُ الجديدةُ تأخذه تلقائيّاً. وأمّا القائمةُ فسعرُها يُصحَّح من صفحة الكروت (تحديدٌ جماعيٌّ ثمّ تعديلُ السعر).",
    severity: "critical", at: s(x.at),
  }));

  // ── أ-٤ · كروتُ مخزونٍ بسعرِ صفر — دَينٌ ناقصٌ مستقبلاً (قِيس ١١) ──
  await add("card_stock_zero_price", "كلُّ كارتٍ في المخزن له سعر", `
    SELECT r."packageId", count(*)::int AS n, p.name AS pkg
      FROM recharge_cards r LEFT JOIN packages p ON p.id = r."packageId"
     WHERE r."agentId" = ${agentId} AND r."useDate" IS NULL AND coalesce(r.price,0) = 0
     GROUP BY 1, 3 ORDER BY 2 DESC LIMIT 50`, (x) => ({
    rowKey: `zerostock:${s(x.packageId)}`,
    title: "كروتٌ في المخزن بلا سعر",
    detail: `${n(x.n)} كارتاً من فئة «${s(x.pkg) || s(x.packageId) || "غيرِ محدَّدة"}»`,
    how: "اضبط سعرَ الفئة قبل أن تُستخدَم — وإلّا استُخدمت بصفرٍ فنقص دَينُ الكارتات بمقدار أسعارها.",
    severity: "warn",
  }));

  // ── أ-٥ · كارتٌ مربوطٌ بمشتركٍ محذوفٍ أو غيرِ موجود ──
  await add("card_orphan_subscriber", "كلُّ كارتٍ مستخدَمٍ له مشتركٌ قائم", `
    SELECT r.id, r.serial, r.price, r."subscriberId" FROM recharge_cards r
     WHERE r."agentId" = ${agentId} AND r."subscriberId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM subscribers s WHERE s.id = r."subscriberId" AND s."isDeleted" = false)
     ORDER BY r.id DESC LIMIT 200`, (x) => ({
    rowKey: `card:${s(x.id)}`,
    title: "كارتٌ مربوطٌ بمشتركٍ غيرِ قائم",
    detail: `سيريال ${s(x.serial)} · ${n(x.price)} د.ع · المشترك #${s(x.subscriberId)}`,
    how: "إمّا يُعاد المشتركُ (إن حُذف خطأً) وإمّا يُفكّ ربطُ الكارت. والمالُ المقبوضُ عليه يبقى في الصندوق كما هو.",
    severity: "warn", amount: n(x.price),
  }));

  // ── أ-٧ · «حَجزٌ عالق» — **أُسقط الفحصُ بعد قياسه** (2026-08-14) ──
  //
  // 🔴 سأل محمد عن الكارت 444591277704832 «حُجز ٢٢:٠١ ولم يُستعمَل — اشرح وكيف أعالجه؟»
  //   فقُرئ الكودُ فتبيّن أنّ **لا شيءَ يُعالَج**: `recharge-cards/pull` يعدّ أيَّ حجزٍ
  //   أقدمَ من **خمس دقائق** منتهياً (`staleBefore`) ويأخذ الكارتَ عادةً. فالطابعُ الباقي
  //   على الصفّ **لا يمنع استخدامَه ولا يُخرجه من المخزن**: ٢٣ كارتاً من فئته متاحةٌ ومنها هو.
  //
  // ⚠️ وأسوأُ من الإنذار الكاذبِ **نصيحتُه الكاذبة**: كانت الحالةُ تقول «يُفكّ الحَجزُ من
  //   صفحة الكروت»، و`release` لا يُنادى إلّا من نافذة التفعيل عند الإلغاء — **فلا زرَّ
  //   فكٍّ في صفحة الكروت أصلاً**. فكانت تُرسل المالكَ إلى زرٍّ لا وجودَ له.
  //
  // والسببُ الحقيقيُّ للطابع: فُتحت نافذةُ «سحب كارت» ثمّ أُغلقت الصفحةُ أو انقطع الاتّصال
  // فلم يُنادَ `release`. وهو أثرٌ بلا ضرر، والكودُ يتجاوزه بعد خمس دقائق.
  //
  // 🔑 والقاعدةُ التي تعلّمتُها اليوم أربعَ مرّات: **إن لم يبقَ ضررٌ فلا حالة**. ولا يكفي
  //   أن يكون الشذوذُ حقيقيّاً — يجب أن يكون **ضرراً قائماً** وله علاجٌ موجودٌ فعلاً.

  // ── و-١ · حالاتُ الكروت المحذوفة التي حكم عليها الحارسُ ولم تُعالَج ──
  // 🔑 وهذه وصلةُ حارسِ الحذف بلوحةِ الحارس: فلا حكمٌ يُدفَن في جدولٍ لا يراه أحد.
  await add("deleted_card_verdicts", "لا حالةَ كارتٍ محذوفٍ تنتظر قراراً", `
    SELECT d.id, d.serial, d.price, d.verdict, d."sasInfo",
           to_char(d."deletedAt" ${BG}, 'YYYY-MM-DD HH24:MI') AS at, d."deletedBy"
      FROM deleted_card_logs d
     WHERE d."agentId" = ${agentId} AND d."handledAt" IS NULL
       AND d.verdict NOT IN ('normal','pending')
     ORDER BY d.id DESC LIMIT 200`, (x) => ({
    rowKey: `dcard:${s(x.id)}`,
    title: {
      "sold-unrecorded": "كارتٌ حُذف وهو مُفعَّلٌ في الساس والبرنامجُ يحسبه مخزوناً",
      "no-receipt": "كارتٌ حُذف وهو مُفعَّلٌ في الساس بلا وصلِ قبض",
      "bad-duration": "كارتٌ حُذف وتفعيلُه بمدّةٍ مقلوبة",
      "used-not-in-sas": "كارتٌ حُذف يقول البرنامجُ إنّه مستخدَمٌ ولا تفعيلَ له في الساس",
      "error": "كارتٌ حُذف وتعذّر فحصُه في الساس",
    }[s(x.verdict)] ?? `كارتٌ محذوفٌ بحكم ${s(x.verdict)}`,
    detail: `سيريال ${s(x.serial)} · ${n(x.price)} د.ع · حُذف ${s(x.at)} بيد ${s(x.deletedBy) || "؟"}${x.sasInfo ? ` · ${s(x.sasInfo)}` : ""}`,
    how: "افتح «حارسُ المال · الكروتُ المحذوفة» من أزرارِ هذه الصفحة: هناك أزرارُ العلاج — إعادةُ الكارت للمخزن، أو إعادتُه مستخدَماً ومربوطاً بمشتركه، أو تصحيحُ المدّة، أو إعادةُ الفحص.",
    severity: ["sold-unrecorded", "no-receipt"].includes(s(x.verdict)) ? "critical" : "warn",
    amount: n(x.price), at: s(x.at),
  }));

  // ── ج-١ · 🔴 مدّةُ تفعيلٍ مقلوبةٌ أو صفر — قِيس ١٥ قيداً (منها −٢٣ يوماً) ──
  // ⚖️ **مبدأُ «زوالِ الأثر» (تصحيحُ محمد 2026-08-14)**: «هذا مشتركٌ حُلّت مشكلتُه سابقاً
  //   فلماذا يُظهره لي الآن كأنّه حالةٌ يجب اتّخاذُ إجراءٍ لها؟ ألا يقارن الحارسُ ما تمّ على
  //   المشترك **بعد** الحالة الشاذّة؟» — وكان الفحصُ يقرأ **صفَّ الحادثة وحدَه**.
  //   فأُضيف شرطُ الضرر الباقي: انتهاءُ المشترك على صفّه.
  //   🎯 **وقِيس فوراً: ١٥ من ١٥** كان المشتركُ فيها نائلاً أيّامَه كاملةً — ومنها حالةُ
  //   مروان (دفع ٤٥٬٠٠٠ في ٠٩ آب وانتهاؤه ٠٩ أيلول = شهرٌ تامّ). أي أنّ **كلَّ** إنذارات
  //   هذا الفحص كانت ورقيّةً لا ماليّة. والمبدأ: **يُقاس الأثرُ الباقي لا لحظةُ الحادثة**.
  await add("entry_bad_duration", "كلُّ تفعيلٍ مدّتُه موجبة **والمشتركُ نال أيّامَه**", `
    SELECT e.id, e."moneyIn", s.name AS sub, s."netUser",
           (e."dateTo"::date - e."dateFrom"::date) AS days,
           to_char(s."dateTo" ${BG}, 'YYYY-MM-DD') AS sub_expiry,
           to_char(e.date ${BG}, 'YYYY-MM-DD') AS at
      FROM subscription_entries e JOIN subscribers s ON s.id = e."subscriberId"
     WHERE e."isDeleted" = false AND e."towerId" IN (${T})
       AND e."dateFrom" IS NOT NULL AND e."dateTo" IS NOT NULL AND e."dateTo" <= e."dateFrom"
       -- شرطُ الضرر الباقي: انتهاءُ المشترك لا يبلغ نهايةَ ما دُفع مقابلَه. فإن بلغه
       -- فالخللُ في الورقة وحدَها والخدمةُ وصلت ⇒ لا حالةَ تُفتَح ولا يُزعَج المالك.
       AND (s."dateTo" IS NULL OR s."dateTo" < e."dateTo")
     ORDER BY e.id DESC LIMIT 200`, (x) => ({
    rowKey: `entry:${s(x.id)}`,
    title: "تفعيلٌ بمدّةٍ مقلوبةٍ **والمشتركُ لم ينل أيّامَه**",
    detail: `وصل #${s(x.id)} · ${s(x.sub) || "؟"}${x.netUser ? ` (${s(x.netUser)})` : ""} · قبض ${n(x.moneyIn)} · المدّة ${n(x.days)} يوماً · انتهاؤه ${s(x.sub_expiry) || "غيرُ محدَّد"} · ${s(x.at)}`,
    how: "تاريخُ الانتهاء أقدمُ من البداية (أو مساوٍ لها) ⇒ صحّح تاريخَ الانتهاء من سجلّ تفعيلات المشترك. والمالُ مقبوضٌ والتفعيلُ في الساس قائمٌ عادةً، فالخللُ في الورقة لا في المال.",
    severity: "critical", amount: n(x.moneyIn), at: s(x.at),
  }));

  // ── ج-٢ · تفعيلٌ منح مدّةً بلا مالٍ مقبوضٍ ولا دَين ──
  await add("entry_days_no_money", "كلُّ تفعيلٍ ذي مدّةٍ له مالٌ أو دَين", `
    SELECT e.id, s.name AS sub, s."netUser", (e."dateTo"::date - e."dateFrom"::date) AS days,
           to_char(e.date ${BG}, 'YYYY-MM-DD') AS at
      FROM subscription_entries e LEFT JOIN subscribers s ON s.id = e."subscriberId"
     WHERE e."isDeleted" = false AND e."towerId" IN (${T})
       AND e."dateFrom" IS NOT NULL AND e."dateTo" > e."dateFrom"
       AND coalesce(e."moneyIn",0) = 0 AND coalesce(e.money,0) = 0
       AND e."isMaster" = false AND e.date > NOW() - INTERVAL '90 days'
       -- ⚖️ زوالُ الأثر: قيدُ صندوقٍ حيٌّ لهذا الوصل يعني أنّ المالَ سُجِّل لاحقاً
       AND NOT EXISTS (SELECT 1 FROM money_tx m WHERE m."sourceId" = e.id
             AND m."sourceType" IN ('activation','master') AND m."isDeleted" = false)
       -- ⚖️ **والعمليّةُ تُقاس لا الصفّ** (تصحيحُ محمد على وصل #٣٠٧٥ · ليث ستار):
       --   تفعيلٌ واحدٌ قد يُكتَب **وصلَين في يومٍ واحد** — أحدُهما لكلّ كارتٍ استُهلك —
       --   والمالُ يستقرّ على الأوّل، فيبقى الثاني بمدّةٍ بلا مال. وهو **سليمٌ تماماً**:
       --   المشتركُ دفع مرّةً وأخذ شهراً، والوصلانِ وجهانِ لعمليّةٍ واحدة.
       --   🎯 وقِيس: **٥ من ٥** حالاتٍ في هذا الفحص لها توأمٌ مدفوعٌ في نفس اليوم
       --   (٤٦٬٠٠٠ لليث · ٣٥٬٠٠٠ للأربعة) ومجموعُ أيّام العمليّة ٣٠–٣١ يوماً.
       --   فالشرطُ: لا وصلَ أخاً لنفس المشترك في نفس اليوم يحمل مالاً أو دَيناً.
       AND NOT EXISTS (SELECT 1 FROM subscription_entries z
             WHERE z."subscriberId" = e."subscriberId" AND z."isDeleted" = false AND z.id <> e.id
               AND z.date::date = e.date::date
               AND (coalesce(z."moneyIn",0) > 0 OR coalesce(z.money,0) > 0))
     ORDER BY e.id DESC LIMIT 100`, (x) => ({
    rowKey: `entry:${s(x.id)}`,
    title: "تفعيلٌ منح مدّةً بلا مالٍ ولا دَين",
    detail: `وصل #${s(x.id)} · ${s(x.sub) || "؟"}${x.netUser ? ` (${s(x.netUser)})` : ""} · ${n(x.days)} يوماً · ${s(x.at)}`,
    how: "إمّا يُسجَّل مبلغُ القبض، وإمّا يُحوَّل إلى دَينٍ على المشترك، وإمّا كان هديّةً أو تعويضاً — فتُجاهِلُ الحالةَ بسببها.",
    severity: "warn", at: s(x.at),
  }));

  // ── ب-٩ · تفعيلانِ متطابقانِ لمشتركٍ في دقيقةٍ واحدة (تنفيذٌ مزدوج) ──
  await add("entry_double_minute", "لا تفعيلَ مكرَّراً في الدقيقة نفسِها", `
    SELECT min(e.id) AS first_id, max(e.id) AS last_id, count(*)::int AS n,
           sum(coalesce(e."moneyIn",0)) AS total, e."subscriberId",
           to_char(min(e.date) ${BG}, 'YYYY-MM-DD HH24:MI') AS at
      FROM subscription_entries e
     WHERE e."isDeleted" = false AND e."towerId" IN (${T}) AND e.date IS NOT NULL
     GROUP BY e."subscriberId", date_trunc('minute', e.date)
    HAVING count(*) > 1
     ORDER BY 1 DESC LIMIT 100`, (x) => ({
    rowKey: `dup:${s(x.first_id)}`,
    title: "تفعيلانِ (أو أكثر) للمشترك نفسِه في دقيقةٍ واحدة",
    detail: `المشترك #${s(x.subscriberId)} · ${n(x.n)} وصولاتٍ بمجموع ${n(x.total)} · وصول #${s(x.first_id)}…#${s(x.last_id)} · ${s(x.at)}`,
    how: "أكثرُ ما يكون ضغطتَين على زرِّ التفعيل. راجِع الوصلَين: إن كان أحدُهما زائداً فأبطِله (ويُبطَل معه قيدُ صندوقه) وأرجِع كارتَه للمخزن.",
    severity: "critical", amount: n(x.total), at: s(x.at),
  }));

  // ── ج-٥ · مشتركٌ بلا مكتب — خارجَ كلّ قائمةٍ وكلّ عزل ──
  await add("subscriber_no_tower", "كلُّ مشتركٍ له مكتب", `
    SELECT s.id, s.name, s."netUser" FROM subscribers s
     WHERE s."isDeleted" = false AND s."towerId" IS NULL
       AND EXISTS (SELECT 1 FROM subscription_entries e WHERE e."subscriberId" = s.id AND e."towerId" IN (${T}))
     ORDER BY s.id DESC LIMIT 100`, (x) => ({
    rowKey: `sub:${s(x.id)}`,
    title: "مشتركٌ بلا مكتب — لا يظهر في أيّ قائمة",
    detail: `${s(x.name)}${x.netUser ? ` · ${s(x.netUser)}` : ""} · #${s(x.id)}`,
    how: "أسنِده إلى مكتبه من صفحة المشتركين. فمشتركٌ بلا مكتبٍ لا يراه مستخدمُ مكتبٍ ولا يدخل تقاريرَه.",
    severity: "critical",
  }));

  // ── ج-٣ · يوزرٌ مكرَّرٌ بين مشتركَين نشطَين — قِيس ٥٢ ──
  // 🚫 وقرارُ محمد 2026-08-14: «اترك موضوع الـ٥٢ يوزر الآن لا أريد تعديله» ⇒ للعلم فقط،
  //   ولا زرَّ إصلاحٍ ولا سببَ إنذار. فأيُّ دمجٍ **قرارُ مالٍ**: أيُّ الصفَّين صاحبُ الدَّين؟
  // 🔑 **حالةٌ واحدةٌ جامعةٌ لا صفٌّ لكلّ يوزر**: قِيست ٢٤ مجموعةً لشكيب وحدَه، ولو
  //   أُخرجت صفوفاً لَبقي المربّعُ برتقاليّاً أبداً ولزم ٢٤ ضغطةَ تجاهُلٍ لأمرٍ **موقوفٍ
  //   بقراره**. والتجميعُ يجعل تجاهُلاً واحداً يُسكتها، ولا يُخفي رقماً — فالعددُ في نصّها.
  await add("dup_netuser", "لا يوزرَ مكرَّراً بين مشتركَين", `
    SELECT g.groups, g.extra FROM (
      SELECT count(*)::int AS groups, coalesce(sum(k - 1), 0)::int AS extra FROM (
        SELECT s."netUser", count(*) AS k FROM subscribers s
         WHERE s."isDeleted" = false AND s."towerId" IN (${T})
           AND s."netUser" IS NOT NULL AND s."netUser" <> ''
         GROUP BY 1 HAVING count(*) > 1) t) g
     WHERE g.groups > 0`, (x) => ({
    rowKey: "dupuser:all",
    title: "يوزراتٌ مكرَّرةٌ بين مشتركَين أو أكثر",
    detail: `${n(x.groups)} مجموعةً · ${n(x.extra)} صفّاً زائداً`,
    how: "موقوفٌ بطلبك (٢٠٢٦-٠٨-١٤): «اترك موضوع الـ٥٢ يوزر الآن». والمزامنةُ توقّفت عن إنتاج جديدٍ، والصفوفُ القائمةُ تُترَك كما هي — فأيُّ دمجٍ قرارُ مالٍ: أيُّ الصفَّين صاحبُ الدَّين؟",
    severity: "info",
  }));

  // ── ب-٢ · 🔴 فاتورةٌ محذوفةٌ ومالُها حيٌّ في الصندوق — قِيس ١ بـ٢٥٬٠٠٠ ──
  await add("invoice_deleted_tx_live", "كلُّ قيدِ فاتورةٍ له فاتورةٌ قائمة", `
    SELECT m.id, m."moneyIn", m."sourceId", to_char(m.date ${BG}, 'YYYY-MM-DD HH24:MI') AS at
      FROM money_tx m
     WHERE m."isDeleted" = false AND m."sourceType" IN ('invoice','sale','master-invoice')
       AND m."towerId" IN (${T}) AND m."sourceId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = m."sourceId" AND i."isDeleted" = false)
     ORDER BY m.date DESC LIMIT 100`, (x) => ({
    rowKey: `tx:${s(x.id)}`,
    title: "مالُ فاتورةٍ في الصندوق وفاتورتُه محذوفة",
    detail: `قيد #${s(x.id)} · ${n(x.moneyIn)} · فاتورة #${s(x.sourceId)} غيرُ قائمة · ${s(x.at)}`,
    how: "نفسُ حالةِ الوصلِ المُبطَل: إمّا يُبطَل القيدُ (إن رُدّ المالُ) وإمّا تُعاد الفاتورةُ (إن بقي المالُ عندك بحقّ). والقرارُ لك — والبرنامجُ لا يُخمّن في مال.",
    severity: "critical", amount: n(x.moneyIn), at: s(x.at),
  }));

  // ── د-١ · بندُ فاتورةٍ حيٌّ في فاتورةٍ محذوفة ⇒ بيعٌ حُذف ومخزونٌ لم يرجع (قِيس ٢) ──
  await add("invoice_item_orphan", "لا بندَ بيعٍ في فاتورةٍ محذوفة", `
    SELECT t.id, t."invoiceId", t.count, t.price, x.name AS item
      FROM invoice_items t
      JOIN invoices i ON i.id = t."invoiceId"
      LEFT JOIN items x ON x.id = t."itemId"
     WHERE t."isDeleted" = false AND i."isDeleted" = true AND i."towerId" IN (${T})
     ORDER BY t.id DESC LIMIT 100`, (x) => ({
    rowKey: `iitem:${s(x.id)}`,
    title: "قطعةٌ مبيعةٌ في فاتورةٍ محذوفة — هل رجعت للمخزن؟",
    detail: `${s(x.item) || "مادّة"} · عدد ${n(x.count)} · سعر ${n(x.price)} · فاتورة #${s(x.invoiceId)} محذوفة`,
    how: "حُذفت الفاتورةُ وبقي بندُها: راجِع كميّةَ المادّة في المخزن — إن لم ترجع فأضِفها، ثمّ احذف البندَ ليتّسق السجلّ.",
    severity: "warn", amount: n(x.count) * n(x.price),
  }));

  // ── د-٣ · مادّةٌ بكميّةٍ سالبة (بيعٌ فوق المخزون) ──
  await add("item_negative_count", "لا مادّةَ بكميّةٍ سالبة", `
    SELECT i.id, i.name, i.count, i.category FROM items i
     WHERE i."isDeleted" = false AND i."towerId" IN (${T}) AND coalesce(i.count,0) < 0
     ORDER BY i.count ASC LIMIT 100`, (x) => ({
    rowKey: `item:${s(x.id)}`,
    title: "مادّةٌ كميّتُها سالبة — بيعٌ فوق المخزون",
    detail: `${s(x.name)}${x.category ? ` · ${s(x.category)}` : ""} · الكميّة ${n(x.count)}`,
    how: "إمّا نقصٌ في إدخال شراءٍ سابقٍ، وإمّا بيعٌ مكرَّر. صحّح الجردَ من صفحة المخزن بعد مراجعةِ فواتيرِ المادّة.",
    severity: "critical",
  }));

  // ── د-٤ · فاتورةٌ نشطةٌ بلا بنود (مالٌ بلا سلعة) ──
  await add("invoice_no_items", "كلُّ فاتورةٍ لها بنود", `
    SELECT i.id, i.number, i."totalMy", to_char(i.date ${BG}, 'YYYY-MM-DD') AS at
      FROM invoices i
     WHERE i."isDeleted" = false AND i."towerId" IN (${T})
       AND NOT EXISTS (SELECT 1 FROM invoice_items t WHERE t."invoiceId" = i.id AND t."isDeleted" = false)
     ORDER BY i.id DESC LIMIT 100`, (x) => ({
    rowKey: `inv:${s(x.id)}`,
    title: "فاتورةٌ بلا بنود",
    detail: `فاتورة #${s(x.number) || s(x.id)} · الإجماليّ ${n(x.totalMy)} · ${s(x.at)}`,
    how: "إمّا أُضيفت بنودُها ثمّ حُذفت، وإمّا لم تُكمَل. أضِف بنودَها أو احذف الفاتورةَ — فمالٌ بلا سلعةٍ لا يُفسَّر لاحقاً.",
    severity: "warn", amount: n(x.totalMy), at: s(x.at),
  }));

  // ── د-٥ · مجموعُ بنودِ الفاتورة ≠ الإجماليّ المسجَّل ──
  await add("invoice_total_mismatch", "إجماليُّ كلِّ فاتورةٍ يطابق بنودَها", `
    SELECT q.id, q.t, q.sum_items, to_char(q.d ${BG}, 'YYYY-MM-DD') AS at FROM (
      SELECT i.id, i."totalMy" AS t, i.date AS d,
             coalesce(sum(x.price * x.count), 0) AS sum_items
        FROM invoices i
        LEFT JOIN invoice_items x ON x."invoiceId" = i.id AND x."isDeleted" = false
       WHERE i."isDeleted" = false AND i."towerId" IN (${T})
       GROUP BY 1,2,3) q
     WHERE abs(coalesce(q.t,0) - q.sum_items) > 1
     ORDER BY q.id DESC LIMIT 100`, (x) => ({
    rowKey: `inv:${s(x.id)}`,
    title: "إجماليُّ الفاتورة لا يطابق مجموعَ بنودها",
    detail: `فاتورة #${s(x.id)} · المسجَّل ${n(x.t)} · مجموعُ البنود ${n(x.sum_items)} · الفرق ${Math.abs(n(x.t) - n(x.sum_items))} · ${s(x.at)}`,
    how: "أُعيد تعديلُ بندٍ بعد حفظِ الفاتورة عادةً. افتح الفاتورةَ واحفظها من جديدٍ ليُعاد حسابُ إجماليّها.",
    severity: "warn", amount: Math.abs(n(x.t) - n(x.sum_items)), at: s(x.at),
  }));

  // ── د-٨ · فاتورةٌ بلا مكتب ──
  await add("invoice_no_tower", "كلُّ فاتورةٍ لها مكتب", `
    SELECT i.id, i.number, i."totalMy" FROM invoices i
     WHERE i."isDeleted" = false AND i."towerId" IS NULL
       AND i."userId" IN (SELECT id FROM users WHERE "agentId" = ${agentId})
     ORDER BY i.id DESC LIMIT 100`, (x) => ({
    rowKey: `inv:${s(x.id)}`,
    title: "فاتورةٌ بلا مكتب — تختفي عن تقارير المكاتب",
    detail: `فاتورة #${s(x.number) || s(x.id)} · ${n(x.totalMy)}`,
    how: "أسنِدها إلى مكتبها من صفحة الفواتير.",
    severity: "warn", amount: n(x.totalMy),
  }));

  // ── هـ-١ · 🔴 كشفُ راتبٍ بصافٍ سالب — قِيس ٥ كشوف (أكبرُها −٥٠٠٬٦١٢) ──
  await add("salary_negative_net", "لا كشفَ راتبٍ بصافٍ سالب", `
    SELECT id, "technicianName", net, "baseEarned", "attendanceDeductions", "periodFrom", "periodTo"
      FROM salary_statements
     WHERE "agentId" = ${agentId} AND "cancelledAt" IS NULL AND net < 0
     ORDER BY net ASC LIMIT 100`, (x) => ({
    rowKey: `sal:${s(x.id)}`,
    title: "كشفُ راتبٍ صافيه سالب — الخصومُ تتجاوز المستحقّ",
    detail: `${s(x.technicianName)} · مستحقّ ${n(x.baseEarned)} · خصوم ${n(x.attendanceDeductions)} · الصافي ${n(x.net)} · ${s(x.periodFrom)} → ${s(x.periodTo)}`,
    how: "الفنيُّ لا يُطالَب بمالٍ من راتبه: راجِع الخصومَ وامسح ما لا يستحقّه بزرِّ «إلغاء الخصم» من حضور الفنيّين (بملاحظةٍ إلزاميّة). وترحيلُ المتبقّي للشهر التالي يحتاج بناءً لم يُنفَّذ بعد (ب-٠٠).",
    severity: "critical", amount: Math.abs(n(x.net)),
  }));

  // ── هـ-٣ · حضورٌ بلا خروجٍ من أيّامٍ ماضية ──
  await add("attendance_open_past", "لا حضورَ بلا خروجٍ من أيّامٍ ماضية", `
    SELECT a.id, t.name, to_char(a."checkIn" ${BG}, 'YYYY-MM-DD HH24:MI') AS at
      FROM attendances a JOIN technicians t ON t.id = a."technicianId"
     WHERE a."checkOut" IS NULL AND a."checkIn" < NOW() - INTERVAL '20 hours'
       AND t."agentId" = ${agentId}
     ORDER BY a."checkIn" ASC LIMIT 100`, (x) => ({
    rowKey: `att:${s(x.id)}`,
    title: "فنيٌّ بصم حضوراً ولم يبصم خروجاً",
    detail: `${s(x.name)} · حضورُه ${s(x.at)}`,
    how: "يُختَم اليومُ من صفحة حضور الفنيّين. والبرنامجُ يختم أمسَ المفتوحَ تلقائياً، فبقاءُ الصفِّ يعني يوماً أقدمَ من ذلك.",
    severity: "warn", at: s(x.at),
  }));


  // ═══════ الدفعةُ الثانية من واجبات الحارس (2026-08-14 · إكمالُ القائمة) ═══════

  // ── ج-٨ · تفعيلانِ متقاطعانِ للمشترك نفسِه (مدّتان تتداخلان) ──
  // 🔑 وهذا يُلتقَط ما لا تُلتقطه «دقيقةٌ واحدة»: تفعيلٌ ثانٍ بعد ساعاتٍ أو أيّامٍ ومدّتُه
  //   تُغطّي مدّةً سارية ⇒ المشتركُ دفع مرّتَين لأيّامٍ واحدة، أو نُقص من رصيدك بلا مقابل.
  await add("entry_overlap", "لا مدّتَي تفعيلٍ متداخلتَين لمشتركٍ واحد", `
    SELECT a.id AS first_id, b.id AS last_id, a."subscriberId",
           coalesce(a."moneyIn",0) + coalesce(b."moneyIn",0) AS total,
           s.name AS sub, s."netUser",
           to_char(b."dateFrom" ${BG}, 'YYYY-MM-DD') AS at,
           (a."dateTo"::date - b."dateFrom"::date) AS overlap_days
      FROM subscription_entries a
      JOIN subscription_entries b ON b."subscriberId" = a."subscriberId" AND b.id > a.id
      LEFT JOIN subscribers s ON s.id = a."subscriberId"
     WHERE a."isDeleted" = false AND b."isDeleted" = false
       AND a."towerId" IN (${T}) AND b."towerId" IN (${T})
       AND a."dateFrom" IS NOT NULL AND a."dateTo" IS NOT NULL
       AND b."dateFrom" IS NOT NULL AND b."dateTo" IS NOT NULL
       AND a."dateTo" > a."dateFrom" AND b."dateTo" > b."dateFrom"
       AND b."dateFrom" < a."dateTo" AND b."dateTo" > a."dateFrom"
     ORDER BY b.id DESC LIMIT 100`, (x) => ({
    rowKey: `ovl:${s(x.first_id)}:${s(x.last_id)}`,
    title: "مدّتا تفعيلٍ متداخلتانِ لمشتركٍ واحد",
    detail: `${s(x.sub) || "؟"}${x.netUser ? ` (${s(x.netUser)})` : ""} · وصلا #${s(x.first_id)} و#${s(x.last_id)} · تقاطعٌ ${n(x.overlap_days)} يوماً · المجموع ${n(x.total)}`,
    how: "المشتركُ دفع مرّتَين عن أيّامٍ واحدة (أو فُعِّل مرّتَين خطأً). راجِع الوصلَين: يُبطَل الزائدُ ويُرحَّل المتبقّي، أو تُصحَّح بدايةُ الثاني ليبدأ من انتهاء الأوّل.",
    severity: "critical", amount: n(x.total), at: s(x.at),
  }));

  // ── أ-٦ · كارتٌ مستخدَمٌ بلا مشترك — مالٌ بلا وجهٍ يُنسَب إليه ──
  await add("card_used_no_subscriber", "كلُّ كارتٍ مستخدَمٍ له مشترك", `
    SELECT r.id, r.serial, r.price, to_char(r."useDate" ${BG}, 'YYYY-MM-DD') AS at
      FROM recharge_cards r
     WHERE r."agentId" = ${agentId} AND r."useDate" IS NOT NULL AND r."subscriberId" IS NULL
     ORDER BY r."useDate" DESC LIMIT 100`, (x) => ({
    rowKey: `card:${s(x.id)}`,
    title: "كارتٌ مُعلَّمٌ مستخدَماً بلا مشترك",
    detail: `سيريال ${s(x.serial)} · ${n(x.price)} د.ع · ${s(x.at)}`,
    how: "ابحث عن سيريالِه في تفعيلات الساس (زرُّ «ربط كارت» في الكروت الوهميّة يفعلها) لتعرف لمن فُعِّل، ثمّ اربِطه بمشتركه. فكارتٌ بلا مشتركٍ مالٌ لا يُنسَب لأحد.",
    severity: "warn", amount: n(x.price), at: s(x.at),
  }));

  // ── أ-٩ · سيريالٌ واحدٌ عند وكيلَين (تكرارُ استيرادٍ يُضاعف دَينَ الكارتات) ──
  // ⚠️ والقيدُ `@@unique(agentId, serial)` يمنعُه **داخل** الوكيل لا بينهم.
  await add("card_serial_cross_agent", "لا سيريالَ كارتٍ عند وكيلَين", `
    SELECT r.id, r.serial, r.price, r."agentId" FROM recharge_cards r
     WHERE r."agentId" = ${agentId} AND r.serial IS NOT NULL
       AND EXISTS (SELECT 1 FROM recharge_cards z WHERE z.serial = r.serial
                     AND z."agentId" IS NOT NULL AND z."agentId" <> ${agentId})
     ORDER BY r.id DESC LIMIT 100`, (x) => ({
    rowKey: `card:${s(x.id)}`,
    title: "سيريالُ كارتٍ موجودٌ عند وكيلٍ آخرَ أيضاً",
    detail: `سيريال ${s(x.serial)} · ${n(x.price)} د.ع`,
    how: "إمّا خطأُ استيرادٍ (نفسُ الملفّ رُفع لوكيلَين) وإمّا الكارتُ ليس لك. راجِع وجبةَ الإدخال — فكلُّ نسخةٍ زائدةٍ تزيد دَينَ الكارتات بسعرها.",
    severity: "critical", amount: n(x.price),
  }));

  // ── ب-٥ · حركةٌ بمبلغٍ صفرٍ من الطرفَين — قيدٌ فارغٌ يشوّش الحساب ──
  await add("tx_zero_amount", "لا قيدَ صندوقٍ بمبلغٍ صفر", `
    SELECT m.id, m."sourceType", to_char(m.date ${BG}, 'YYYY-MM-DD HH24:MI') AS at, m.notes
      FROM money_tx m
     WHERE m."isDeleted" = false AND m."towerId" IN (${T})
       AND coalesce(m."moneyIn",0) = 0 AND coalesce(m."moneyOut",0) = 0
     ORDER BY m.date DESC LIMIT 100`, (x) => ({
    rowKey: `tx:${s(x.id)}`,
    title: "قيدٌ ماليٌّ بمبلغِ صفرٍ في الطرفَين",
    detail: `قيد #${s(x.id)} · ${s(x.sourceType) || "—"} · ${s(x.notes) || ""} · ${s(x.at)}`,
    how: "قيدٌ فارغٌ لا يُغيّر رصيداً ولكنّه يشوّش السجلّ. احذفه من صفحة المقبوضات/المصروفات، أو أدخِل مبلغَه الصحيح إن كان ناقصاً.",
    severity: "warn", at: s(x.at),
  }));

  // ── ب-١٠ · حركةٌ لمكتبٍ محذوف — مالٌ في مكتبٍ لا يظهر في أيّ قائمة ──
  await add("tx_deleted_tower", "لا قيدَ ماليٍّ لمكتبٍ محذوف", `
    SELECT m.id, m."moneyIn", m."moneyOut", t.name AS office,
           to_char(m.date ${BG}, 'YYYY-MM-DD') AS at
      FROM money_tx m JOIN towers t ON t.id = m."towerId"
     WHERE m."isDeleted" = false AND t."isDeleted" = true AND t."agentId" = ${agentId}
     ORDER BY m.date DESC LIMIT 100`, (x) => ({
    rowKey: `tx:${s(x.id)}`,
    title: "قيدٌ ماليٌّ في مكتبٍ محذوف",
    detail: `قيد #${s(x.id)} · قبض ${n(x.moneyIn)} · صرف ${n(x.moneyOut)} · المكتب «${s(x.office)}» محذوف · ${s(x.at)}`,
    how: "المكتبُ محذوفٌ ومالُه باقٍ: انقل القيدَ إلى مكتبٍ قائم، أو أعِد تفعيلَ المكتب إن حُذف خطأً. فقيدٌ في مكتبٍ محذوفٍ لا يدخل تقريراً ولا يُحاسَب.",
    severity: "critical", amount: n(x.moneyIn) || n(x.moneyOut), at: s(x.at),
  }));

  // ── ج-٦ · مشتركٌ محذوفٌ وله دَينٌ أو رصيد ──
  await add("deleted_sub_balance", "لا مشتركَ محذوفٍ له دَينٌ أو رصيد", `
    SELECT s.id, s.name, s."netUser", s.carry FROM subscribers s
     WHERE s."isDeleted" = true AND coalesce(s.carry,0) <> 0 AND s."towerId" IN (${T})
     ORDER BY abs(coalesce(s.carry,0)) DESC LIMIT 100`, (x) => ({
    rowKey: `sub:${s(x.id)}`,
    title: n(x.carry) > 0 ? "مشتركٌ محذوفٌ وعليه دَين" : "مشتركٌ محذوفٌ وله رصيدٌ عندك",
    detail: `${s(x.name)}${x.netUser ? ` · ${s(x.netUser)}` : ""} · ${n(x.carry) > 0 ? "دَينُه" : "رصيدُه"} ${Math.abs(n(x.carry))}`,
    how: n(x.carry) > 0
      ? "الدَّينُ يختفي من القوائم بحذفِ المشترك ويبقى في القاعدة. إن كان مقبوضاً فسجّله، وإن كان ميئوساً منه فصفِّره قبل الحذف — أو تجاهَلِ الحالةَ إن أقررتَ إسقاطَه."
      : "رصيدٌ لمشتركٍ محذوف: يُردّ له نقداً (فتُسجّل صرفاً بمقداره) أو يُصفَّر بقرارك.",
    severity: "warn", amount: Math.abs(n(x.carry)),
  }));

  // ── د-٦ · بيعٌ بأقلَّ من سعرِ الشراء (خسارةٌ صامتة) ──
  await add("sale_below_cost", "لا بيعَ بأقلَّ من سعرِ الشراء", `
    SELECT t.id, x.name AS item, t.count, t.price, t."buyPrice", t."invoiceId"
      FROM invoice_items t
      JOIN invoices i ON i.id = t."invoiceId"
      LEFT JOIN items x ON x.id = t."itemId"
     WHERE t."isDeleted" = false AND i."isDeleted" = false AND i."towerId" IN (${T})
       AND coalesce(t."buyPrice",0) > 0 AND coalesce(t.price,0) > 0 AND t.price < t."buyPrice"
     ORDER BY (t."buyPrice" - t.price) * t.count DESC LIMIT 100`, (x) => ({
    rowKey: `iitem:${s(x.id)}`,
    title: "قطعةٌ بيعت بأقلَّ من سعرِ شرائها",
    detail: `${s(x.item) || "مادّة"} · شراء ${n(x.buyPrice)} · بيع ${n(x.price)} · عدد ${n(x.count)} · فاتورة #${s(x.invoiceId)}`,
    how: "إبلاغٌ فقط — فقرارُ البيع بخسارةٍ قرارُك (تصفيةٌ أو مجاملة). وإن كان خطأَ إدخالٍ فصحّح السعرَ من الفاتورة.",
    severity: "warn", amount: (n(x.buyPrice) - n(x.price)) * n(x.count),
  }));

  // ── د-٧ · بندٌ يشير إلى مادّةٍ محذوفةٍ أو غيرِ موجودة ──
  await add("invoice_item_no_material", "كلُّ بندِ بيعٍ له مادّةٌ قائمة", `
    SELECT t.id, t."invoiceId", t.count, t.price, t."itemId"
      FROM invoice_items t
      JOIN invoices i ON i.id = t."invoiceId"
     WHERE t."isDeleted" = false AND i."isDeleted" = false AND i."towerId" IN (${T})
       AND t."itemId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM items x WHERE x.id = t."itemId" AND x."isDeleted" = false)
     ORDER BY t.id DESC LIMIT 100`, (x) => ({
    rowKey: `iitem:${s(x.id)}`,
    title: "بندُ بيعٍ يشير إلى مادّةٍ غيرِ قائمة",
    detail: `مادّة #${s(x.itemId)} · عدد ${n(x.count)} · سعر ${n(x.price)} · فاتورة #${s(x.invoiceId)}`,
    how: "حُذفت المادّةُ وبقي بيعُها: إن حُذفت خطأً فأعِدها، وإلّا فالبندُ صحيحٌ تاريخيّاً — تجاهَلِ الحالةَ فالمالُ مقبوضٌ والسلعةُ خرجت.",
    severity: "warn", amount: n(x.count) * n(x.price),
  }));

  // ── د-٩ · مادّةٌ تحت حدّها الأدنى — تنبيهُ شراءٍ لا شذوذ ──
  await add("item_below_min", "لا مادّةَ تحت حدّها الأدنى", `
    SELECT i.id, i.name, i.count, i."minCount" FROM items i
     WHERE i."isDeleted" = false AND i."towerId" IN (${T})
       AND coalesce(i."minCount",0) > 0 AND coalesce(i.count,0) <= i."minCount"
     ORDER BY (coalesce(i.count,0) - i."minCount") ASC LIMIT 100`, (x) => ({
    rowKey: `item:${s(x.id)}`,
    title: "مادّةٌ وصلت حدَّها الأدنى",
    detail: `${s(x.name)} · المتوفّر ${n(x.count)} · الحدُّ الأدنى ${n(x.minCount)}`,
    how: "تنبيهُ شراءٍ لا خللٌ ماليّ: اطلب المادّةَ أو اخفِض حدَّها الأدنى من صفحة المخزن. ويُتجاهَل إن لم تُرِد تنبيهاتِ المخزن.",
    severity: "info",
  }));

  // ── ز-٢ · جدولٌ فيه عزلٌ بلا سياسةِ RLS — **نُقل إلى `npm run check:money`** ──
  // 🔒 وسببُ النقل: بنيةُ القاعدة **ليست شأنَ الوكيل المستأجر**. فصفاءُ والشدنُ لا يعنيهما
  //   أنّ جدولاً بلا سياسةٍ، وإظهارُه لهم ضجيجٌ وكشفُ داخليّاتٍ في آنٍ واحد. وهو شأنُ
  //   محمد وحدَه ⇒ مكانُه سكربتُ المالك لا لوحةُ الوكيل. (وقد اصطاد ٣ جداولَ فعلاً.)

  // ═══════ 🔍 «أين الكارت؟» — الحارسُ يفحص بنفسه (طلبُ محمد 2026-08-14) ═══════
  //
  // «كان يجب على حارس المال أن **يفحص أوّلاً أين الكارت** وبعدها يُعطي الحالة» ·
  // «أعتقد أنّ هذه الكروتَ **رجعت إلى المخزن** من الوهميّ وتمّ إعادةُ استخدامها — أريد
  //  فحصَ جميع الكروت» · «ويجب أن يعمل الحارسُ كلَّ هذه الأمور **بنفسه** بدل أن أُخبرَك».
  //
  // 🔴 **وما كشفه القياسُ على الإنتاج، ونظريّةُ محمد أصابت جوهرَه**: الكارتُ يُبطَل وصلُه
  //   فيرجع للمخزن (`useDate=null`)، ثمّ يُستخدَم لمشتركٍ آخر — **لكنّه في الساس مُستهلَكٌ
  //   للأوّل**. فالمالُ يُقبَض مرّتَين على كارتٍ واحدٍ وشهرٍ واحد. أمثلةٌ مقيسة:
  //     • `490548619878085` — مروان ١٠ آب (٤٥٬٠٠٠) ثمّ ليث ١٣ آب (٤٦٬٠٠٠)
  //     • `377061353405719` — مشتركان في **٢٦ دقيقة**
  //     • `371078030969621` — ومعه تحذيرٌ صريح «الساس ما زال منتهياً عند التأكيد»

  // ── ١) سيريالٌ واحدٌ في تفعيلَين حيَّين لمشتركَين مختلفَين ──
  // 🔑 **ولا يحتاج ساساً أصلاً**: كارتٌ لشهرٍ واحدٍ فلا يخدم مشتركَين. قِيس: ٣ سيريالاتٍ
  //   بـ٢٣٠٬٠٠٠ — وهي أوضحُ صورةٍ لِما وصفه محمد.
  await add("card_serial_reused", "لا سيريالَ كارتٍ في تفعيلَين لمشتركَين", `
    SELECT e.card2 AS serial, count(*)::int AS entries,
           sum(coalesce(e."moneyIn",0)) AS money_total,
           string_agg(DISTINCT s.name, ' ← ') AS names,
           to_char(min(e.date) ${BG}, 'YYYY-MM-DD') AS first_at,
           to_char(max(e.date) ${BG}, 'YYYY-MM-DD') AS last_at,
           min(e.id) AS first_id, max(e.id) AS last_id
      FROM subscription_entries e JOIN subscribers s ON s.id = e."subscriberId"
     WHERE e."isDeleted" = false AND e.card2 IS NOT NULL AND e.card2 <> ''
       AND e."towerId" IN (${T})
     GROUP BY 1 HAVING count(DISTINCT e."subscriberId") > 1
     ORDER BY 3 DESC LIMIT 100`, (x) => ({
    rowKey: `reused:${s(x.serial)}`,
    title: "سيريالُ كارتٍ واحدٍ في تفعيلَين لمشتركَين مختلفَين",
    detail: `سيريال ${s(x.serial)} · ${n(x.entries)} تفعيلاتٍ بمجموع ${n(x.money_total)} · ${s(x.names)} · ${s(x.first_at)} → ${s(x.last_at)} (وصلا #${s(x.first_id)} و#${s(x.last_id)})`,
    how: "كارتٌ واحدٌ لشهرٍ واحدٍ فلا يخدم مشتركَين. وأكثرُ ما يحدث: أُبطل وصلُ الأوّل فرجع الكارتُ للمخزن ثمّ استُخدم للثاني — والساسُ استهلكه للأوّل. راجِع الوصلَين في الساس بزرّ «ربط كارت»: مَن نال الشهرَ فعلاً؟ ثمّ صحّح سيريالَ الوصل الآخر بالكارت الذي خدمه حقّاً، أو أبطِله إن لم يُخدَم.",
    severity: "critical", amount: n(x.money_total), at: s(x.last_at),
  }));

  // ── ٢) الساسُ يقول إنّ صاحبَ الكارت غيرُ الذي في البرنامج ──
  // 🔑 **يُقرأ من جدول الفحص لا من الساس مباشرةً**: البحثُ ~١.٥ث للكارت، والمسحُ الدوريُّ
  //   يُثبّت الحكمَ أوّلاً فتظهر الحالةُ **مفحوصةً** لا سؤالاً معلَّقاً (طلبُ محمد الصريح).
  await add("card_sas_mismatch", "كلُّ كارتٍ صاحبُه في الساس هو صاحبُه في البرنامج", `
    SELECT k.serial, k."sasUsername", k."sasName", k."sasCreatedAt", k."sasNewExpiry",
           s.name AS prog_name, s."netUser" AS prog_user, r.price,
           to_char(k."checkedAt" ${BG}, 'YYYY-MM-DD HH24:MI') AS at
      FROM card_sas_checks k
      LEFT JOIN subscribers s ON s.id = k."subscriberId"
      LEFT JOIN recharge_cards r ON r.id = k."cardId"
     WHERE k."agentId" = ${agentId} AND k.verdict = 'mismatch'
     ORDER BY k."checkedAt" DESC LIMIT 200`, (x) => ({
    rowKey: `sasmm:${s(x.serial)}`,
    title: "كارتٌ خدم مشتركاً في الساس والبرنامجُ ينسبه لآخر",
    detail: `سيريال ${s(x.serial)}${x.price ? ` · ${n(x.price)} د.ع` : ""} · البرنامج: ${s(x.prog_name) || "بلا مشترك"}${x.prog_user ? ` (${s(x.prog_user)})` : ""} · **الساس: ${s(x.sasName)} (${s(x.sasUsername)})** · فُعِّل ${s(x.sasCreatedAt)} · انتهاؤه ${s(x.sasNewExpiry)} · فُحص ${s(x.at)}`,
    how: "الساسُ هو الحقيقةُ في مَن نال الخدمة. فإمّا رُبط الكارتُ بالمشترك الخطأ في البرنامج (فيُصحَّح الربط)، وإمّا أُدخل سيريالٌ مستهلَكٌ في تفعيلٍ جديد (فيُصحَّح سيريالُ الوصل بالكارت الذي خدمه فعلاً). والمالُ لا يُمَسّ حتى تُقرِّر.",
    severity: "critical", amount: n(x.price), at: s(x.at),
  }));

  // ── ٣) كارتٌ في المخزن والساسُ يقول إنّه مُستهلَك ──
  // وهذا جوابُ سؤال محمد «أين هذه الكروتُ الآن؟» في أخطرِ صوره: كارتٌ يحسبه البرنامجُ
  // متاحاً وسيُستخدم مرّةً أخرى — فيُقبَض ثمنُه ولا خدمةَ خلفه.
  await add("card_stock_used_in_sas", "لا كارتَ في المخزن مُستهلَكٌ في الساس", `
    SELECT k.serial, k."sasName", k."sasUsername", k."sasCreatedAt", r.price,
           to_char(k."checkedAt" ${BG}, 'YYYY-MM-DD HH24:MI') AS at
      FROM card_sas_checks k
      JOIN recharge_cards r ON r.id = k."cardId"
     WHERE k."agentId" = ${agentId} AND k."sasUsername" IS NOT NULL AND r."useDate" IS NULL
     ORDER BY k."checkedAt" DESC LIMIT 200`, (x) => ({
    rowKey: `stockused:${s(x.serial)}`,
    title: "كارتٌ في مخزنك وهو **مُستهلَكٌ في الساس**",
    detail: `سيريال ${s(x.serial)}${x.price ? ` · ${n(x.price)} د.ع` : ""} · الساس: ${s(x.sasName)} (${s(x.sasUsername)}) · فُعِّل ${s(x.sasCreatedAt)} · فُحص ${s(x.at)}`,
    how: "لا تُعِد استخدامَه: الساسُ استهلكه ولن يمنح يوماً. أزِله من المخزن (أو علّمه مستخدَماً لمن خدمه) — وإلّا قُبض ثمنُه من مشتركٍ ولا خدمةَ خلفه. وراجِع كيف رجع للمخزن: إبطالُ وصلٍ يُرجع الكارتَ آليّاً.",
    severity: "critical", amount: n(x.price), at: s(x.at),
  }));

  // ── ٤) تقدُّمُ المسح — فلا يظنّ المالكُ أنّ «صفراً» تعني السلامةَ وهي تعني «لم يُفحَص» ──
  // ⚠️ وهذا البندُ إحاطةٌ لا حالة: يظهر ما دام الفحصُ ناقصاً، ويختفي حين يكتمل.
  await add("card_sweep_progress", "فحصُ الكروت في الساس مكتمل", `
    SELECT (SELECT count(*)::int FROM recharge_cards WHERE "agentId" = ${agentId} AND serial IS NOT NULL) AS total,
           (SELECT count(*)::int FROM card_sas_checks WHERE "agentId" = ${agentId}) AS checked
     WHERE (SELECT count(*)::int FROM card_sas_checks WHERE "agentId" = ${agentId})
         < (SELECT count(*)::int FROM recharge_cards WHERE "agentId" = ${agentId} AND serial IS NOT NULL)`,
    (x) => ({
      rowKey: "sweep:progress",
      title: "فحصُ الكروت في الساس ما زال جارياً",
      detail: `فُحص ${n(x.checked)} من ${n(x.total)} كارتاً · والمسحُ يعمل صامتاً بدفعاتٍ صغيرة`,
      how: "لا إجراءَ منك: الحارسُ يفحص دفعةً كلَّ عشر دقائق (بحثُ الساس ~١.٥ث للكارت فلا يُستعجل). والمهمُّ أن تعرف أنّ **غيابَ حالةٍ الآن لا يعني سلامةَ ما لم يُفحَص بعد** — وهذا البندُ يختفي حين يكتمل المسح.",
      severity: "info",
    }));


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
