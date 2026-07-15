// نظام المعرّفات المُنطَّقة (Ranged IDs) لِـ local-first بلا تصادم بين الحواسيب.
// السحابة (Neon) = العقدة 0 → نطاقها [1, STRIDE). كل حاسبة عقدة K → نطاقها [K×STRIDE, (K+1)×STRIDE).
// STRIDE = 100 مليون → يكفي ~21 عقدة ضمن نوع Int (حدّه ~2.147 مليار) بلا تغيير نوع أو ترحيل بيانات.
export const ID_STRIDE = 100_000_000; // 10^8
export const MAX_NODE = 20; // العقدة القصوى ضمن Int

// أدنى معرّف لعقدة K
export function nodeRangeStart(nodeNumber: number): number {
  return nodeNumber * ID_STRIDE;
}

// SQL يضبط كل تسلسلات المعرّفات في القاعدة المحلية لتبدأ من نطاق العقدة.
// يُطبَّق على قاعدة العقدة المحلية فقط (لا على Neon). آمن على قاعدة فارغة/جديدة.
export function applyNodeOffsetSql(nodeNumber: number): string {
  const start = nodeRangeStart(nodeNumber);
  // لكل تسلسل في المخطّط العام: اجعل قيمته التالية = max(القيمة الحالية, نطاق العقدة)
  // حتى لا نُرجِع تسلسلاً تجاوز النطاق (احتياط)، ونضمن بقاء المعرّفات ضمن نطاق العقدة.
  return `
DO $$
DECLARE r RECORD;
DECLARE cur BIGINT;
BEGIN
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
    SELECT last_value INTO cur FROM pg_sequences WHERE schemaname='public' AND sequencename = r.sequencename;
    IF cur IS NULL OR cur < ${start} THEN
      EXECUTE format('ALTER SEQUENCE public.%I RESTART WITH %s', r.sequencename, ${start});
    END IF;
  END LOOP;
END $$;`;
}
