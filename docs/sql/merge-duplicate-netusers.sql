-- ═════════════════════════════════════════════════════════════════════════════
-- 🔗 دمجُ المشتركين المكرَّرين على اليوزر نفسِه — بإذن محمد 2026-08-21 (البند ٩)
--
-- السبب: حين تُعيد الشركةُ إنشاءَ حساب الساس (رقمٌ جديدٌ لليوزر نفسِه) كانت المزامنةُ
-- القديمة تُنشئ صفّاً ثانياً. فيبقى صفُّك الحقيقيُّ (بالوصولات والدين) معلَّقاً برقمِ
-- ساسٍ **ميت** لا تراه المزامنةُ أبداً، ويعيش الصفُّ الفارغُ بالرقم الحيّ.
--
-- القاعدة: **يبقى صاحبُ المال** (وصولاتٌ ⇐ قرضٌ ⇐ باقةٌ ⇐ الأقدم)، ويرث **رقمَ الساس
-- الحيَّ (الأكبر)** وأبعدَ تاريخِ انتهاء، وتُنقَل إليه كروتُ الصفّ الآخر. والصفُّ الفارغ
-- يُحذَف حذفاً ناعماً بوسم «#مدمج-…» فيُخلي اليوزر.
-- 🛡️ ومجموعةٌ لصفَّين فيها مالٌ **لا تُمَسّ إطلاقاً** — تُترَك لقرار محمد وتُعرَض في النهاية.
--
-- الاستعمال: الصقه كاملاً في psql على قاعدة الإنتاج. يعمل داخل معاملةٍ واحدة،
-- وآخرُ سطرٍ يعرض ملخّصاً. لو ظهر خطأٌ فلا شيءَ يُكتَب (ROLLBACK تلقائيّ).
-- ═════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TEMP TABLE dup_rows ON COMMIT DROP AS
WITH live AS (
  SELECT s.id, s."towerId", lower(btrim(s."netUser")) AS ukey, s."netUser",
         s."sasId", s."dateTo", s."packageId", s.address, s.note,
         (SELECT count(*) FROM subscription_entries e
           WHERE e."subscriberId" = s.id AND e."isDeleted" = false) AS receipts,
         (SELECT count(*) FROM loan_debts l
           WHERE l."subscriberId" = s.id AND l."isDeleted" = false) AS loans
  FROM subscribers s
  WHERE s."isDeleted" = false AND s."netUser" IS NOT NULL AND btrim(s."netUser") <> ''
),
grp AS (
  SELECT "towerId", ukey FROM live GROUP BY 1, 2 HAVING count(*) > 1
)
SELECT l.*,
       row_number() OVER (
         PARTITION BY l."towerId", l.ukey
         ORDER BY (l.receipts > 0) DESC, (l.loans > 0) DESC,
                  (l."packageId" IS NOT NULL) DESC, l.id ASC
       ) AS rnk,
       count(*) FILTER (WHERE l.receipts > 0) OVER (PARTITION BY l."towerId", l.ukey) AS money_rows,
       max(l."sasId")  OVER (PARTITION BY l."towerId", l.ukey) AS best_sas,
       max(l."dateTo") OVER (PARTITION BY l."towerId", l.ukey) AS best_date
FROM live l JOIN grp g ON g."towerId" = l."towerId" AND g.ukey = l.ukey;

-- المجموعاتُ الآمنة: صفٌّ واحدٌ فيه مالٌ على الأكثر
CREATE TEMP TABLE keepers ON COMMIT DROP AS
  SELECT * FROM dup_rows WHERE rnk = 1 AND money_rows <= 1;
CREATE TEMP TABLE merged ON COMMIT DROP AS
  SELECT d.* FROM dup_rows d JOIN keepers k ON k."towerId" = d."towerId" AND k.ukey = d.ukey
  WHERE d.rnk > 1;

-- ١· كروتُ الصفّ المدموج تنتقل إلى الباقي (المالُ يتبع صاحبَه)
UPDATE recharge_cards c SET "subscriberId" = k.id
  FROM merged m JOIN keepers k ON k."towerId" = m."towerId" AND k.ukey = m.ukey
 WHERE c."subscriberId" = m.id;

-- ٢· الباقي يرث رقمَ الساس الحيَّ وأبعدَ تاريخٍ وأيَّ باقةٍ/عنوانٍ ناقص
UPDATE subscribers s
   SET "sasId"     = k.best_sas,
       "dateTo"    = GREATEST(COALESCE(s."dateTo", k.best_date), k.best_date),
       "packageId" = COALESCE(s."packageId", (SELECT m."packageId" FROM merged m
                       WHERE m."towerId" = k."towerId" AND m.ukey = k.ukey AND m."packageId" IS NOT NULL LIMIT 1)),
       address     = COALESCE(NULLIF(btrim(COALESCE(s.address, '')), ''), (SELECT m.address FROM merged m
                       WHERE m."towerId" = k."towerId" AND m.ukey = k.ukey AND btrim(COALESCE(m.address, '')) <> '' LIMIT 1)),
       note        = COALESCE(s.note || E'\n', '') ||
                     '[دمج ' || to_char(now() AT TIME ZONE 'Asia/Baghdad', 'DD/MM/YYYY') ||
                     '] ورث رقمَ الساس ' || COALESCE(k.best_sas::text, '—') || ' من صفٍّ مكرَّرٍ للّيوزر نفسِه'
  FROM keepers k
 WHERE s.id = k.id;

-- ٣· الصفُّ المكرَّرُ يُحذَف حذفاً ناعماً ويُخلي اليوزر
UPDATE subscribers s
   SET "isDeleted" = true,
       "sasId"     = NULL,
       state       = 'مدموج',
       "netUser"   = s."netUser" || '#مدمج-' || to_char(now() AT TIME ZONE 'Asia/Baghdad', 'YYYYMMDD'),
       note        = COALESCE(s.note || E'\n', '') ||
                     '[دمج ' || to_char(now() AT TIME ZONE 'Asia/Baghdad', 'DD/MM/YYYY') ||
                     '] صفٌّ مكرَّرٌ أنشأته المزامنةُ القديمة — دُمج في #' || k.id::text
  FROM merged m JOIN keepers k ON k."towerId" = m."towerId" AND k.ukey = m.ukey
 WHERE s.id = m.id;

-- ٤· صفوفُ سجلّ المزامنة المعلَّقةُ للصفوف المدموجة لم يعد لها موضوع
UPDATE sync_log g SET status = 'done', note = 'دُمج المشتركُ المكرَّر — أُغلق تلقائيّاً', "handledAt" = now()
 WHERE g.status IN ('pending', 'ignored') AND g."subscriberId" IN (SELECT id FROM merged);

-- الملخّص: كم دُمج، وكم مجموعةً تُركت لقرارك (مالٌ في الصفَّين)
SELECT
  (SELECT count(*) FROM merged)  AS "صفوفٌ دُمجت",
  (SELECT count(*) FROM keepers) AS "مشتركون بقوا",
  (SELECT count(DISTINCT ("towerId", ukey)) FROM dup_rows WHERE money_rows > 1) AS "مجموعاتٌ تُركت (مالٌ في الصفَّين)";

COMMIT;
