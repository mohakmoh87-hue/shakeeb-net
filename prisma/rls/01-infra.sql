-- ============================================================================
-- RLS شكيب نت — 01: البنية التحتية للأدوار
-- يُنفَّذ باتصال اليوزر الرئيسي (مالك الجداول). آمن وقابل لإعادة التنفيذ (idempotent).
-- لا يغيّر أي صف بيانات موجود، ولا يؤثر على اتصال الموقع (المالك يتجاوز RLS).
-- ============================================================================

-- 1) دور المجموعة المشترك لكل عمّال الوكلاء (بلا دخول) — كل الصلاحيات تُمنح له،
--    وكل دور وكيل agent_<id>_worker يرث منه.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agent_worker') THEN
    CREATE ROLE agent_worker NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO agent_worker;

-- 2) جدول ربط الدور بالوكيل — مصدر الحقيقة الوحيد لهوية الدور.
--    قراءة فقط للأدوار (يمنع أي دور من انتحال وكيل آخر): لا يعتمد على متغيرات جلسة.
CREATE TABLE IF NOT EXISTS db_agent_roles (
  role_name text PRIMARY KEY,
  agent_id  integer NOT NULL
);
REVOKE ALL ON db_agent_roles FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON db_agent_roles FROM agent_worker;
GRANT SELECT ON db_agent_roles TO agent_worker;

ALTER TABLE db_agent_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS db_agent_roles_self ON db_agent_roles;
CREATE POLICY db_agent_roles_self ON db_agent_roles
  FOR SELECT TO agent_worker USING (role_name = session_user);

-- 3) دالة هوية الوكيل الحالي — تقرأ من جدول الربط حسب session_user (دور الدخول الفعلي؛
--    ثابت حتى داخل دوال SECURITY DEFINER بعكس current_user).
--    STABLE: تُقيَّم مرة واحدة لكل استعلام. للمالك (غير مسجَّل بالجدول) تعيد NULL،
--    لكن المالك يتجاوز RLS أصلاً فلا تُقيَّم سياساته.
CREATE OR REPLACE FUNCTION current_agent_id() RETURNS integer
LANGUAGE sql STABLE
SET search_path = public
AS $$ SELECT agent_id FROM db_agent_roles WHERE role_name = session_user $$;

-- 3ب) هواتف تنبيهات وكيل الجلسة (مدراء المكاتب + مدراء المستخدمين) — تخدم سياسة
--    الرسائل غير المربوطة بمشترك (تقارير المزامنة/اليومي). SECURITY DEFINER لأن
--    جدول users محظور كلياً على الأدوار؛ بلا معاملات فلا يمكن التجسس على وكيل آخر
--    (الهوية من session_user حصراً).
CREATE OR REPLACE FUNCTION agent_notify_phones() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t."managerPhone" FROM towers t
   WHERE t."agentId" = (SELECT agent_id FROM db_agent_roles WHERE role_name = session_user)
     AND t."managerPhone" IS NOT NULL
  UNION
  SELECT u."managerPhone" FROM users u
   WHERE u."agentId" = (SELECT agent_id FROM db_agent_roles WHERE role_name = session_user)
     AND u."managerPhone" IS NOT NULL
$$;
REVOKE ALL ON FUNCTION agent_notify_phones() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_notify_phones() TO agent_worker;

-- 4) عمود رابط قاعدة دور الوكيل على agents (إضافة عمود فقط — ليس في schema.prisma
--    عمداً كي لا يقرأه Prisma تلقائياً؛ يُقرأ/يُكتب حصراً بـSQL خام من اتصال المالك).
--    منع قراءته من الأدوار يتم بصلاحيات الأعمدة في 02-grants.sql (قائمة أعمدة لا تشمله).
ALTER TABLE agents ADD COLUMN IF NOT EXISTS "workerDbUrl" text;

-- 5) إنشاء/إعادة توليد دور وكيل: تُستدعى من اتصال المالك فقط.
--    SECURITY DEFINER بمالكٍ يملك CREATEROLE (اليوزر الرئيسي على Neon عضو neon_superuser).
--    إن وُجد الدور: تُبدَّل كلمة سره (نفس الدالة تخدم «إعادة توليد المفتاح»).
CREATE OR REPLACE FUNCTION create_agent_worker_role(p_agent_id integer, p_password text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text := 'agent_' || p_agent_id || '_worker';
BEGIN
  IF p_agent_id IS NULL OR p_agent_id <= 0 THEN
    RAISE EXCEPTION 'agent_id غير صالح';
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', r, p_password);
  ELSE
    EXECUTE format('CREATE ROLE %I WITH LOGIN PASSWORD %L', r, p_password);
  END IF;
  EXECUTE format('GRANT agent_worker TO %I', r);
  INSERT INTO db_agent_roles (role_name, agent_id) VALUES (r, p_agent_id)
    ON CONFLICT (role_name) DO UPDATE SET agent_id = EXCLUDED.agent_id;
  RETURN r;
END $$;

-- الدالة حسّاسة (تنشئ أدواراً): للمالك فقط
REVOKE ALL ON FUNCTION create_agent_worker_role(integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_agent_worker_role(integer, text) FROM agent_worker;

-- 6) السماح باستخدام المتسلسلات (لأي INSERT عبر الأدوار) — الحالية والمستقبلية
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agent_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO agent_worker;
