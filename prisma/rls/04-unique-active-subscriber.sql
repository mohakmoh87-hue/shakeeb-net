-- قيد فريد جزئي: يمنع تكرار مشترك بنفس (المكتب, sasId) وهو غير محذوف.
-- جزئي (WHERE) لأن النسخ المدموجة تاريخياً تبقى محذوفة ناعماً بنفس القيم،
-- ولأن Prisma لا يدعم القيود الجزئية في المخطط — يُنشأ هنا ويُعاد إنشاؤه عند التعافي.
-- (سبب التكرار التاريخي: مزامنات متزامنة قبل إصلاح 2026-07-28 — 2,675 مجموعة دُمجت 2026-07-29)
CREATE UNIQUE INDEX IF NOT EXISTS subscribers_tower_sasid_active_key
  ON subscribers ("towerId", "sasId")
  WHERE "isDeleted" = false AND "sasId" IS NOT NULL AND "towerId" IS NOT NULL;
