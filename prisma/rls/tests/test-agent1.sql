-- مصفوفة اختبارات العزل — تُنفَّذ بدور agent_1_worker على قاعدة الاختبار
-- كل سطر ناتج: PASS أو FAIL مع اسم الاختبار
\pset tuples_only on
\pset format unaligned

-- هوية الدور
SELECT CASE WHEN current_agent_id() = 1 THEN 'PASS' ELSE 'FAIL' END || ' | current_agent_id=1';

-- ===== القراءة: يرى صفوف وكيله فقط (المجموع = ما يراه) =====
SELECT CASE WHEN (SELECT count(*) FROM agents) = 1
         AND (SELECT name FROM agents) = 'وكيل1' THEN 'PASS' ELSE 'FAIL' END || ' | agents: صف وكيله فقط';
SELECT CASE WHEN (SELECT count(*) FROM towers) = 2 THEN 'PASS' ELSE 'FAIL' END || ' | towers: مكتباه فقط (2)';
SELECT CASE WHEN (SELECT count(*) FROM subscribers) = 2 THEN 'PASS' ELSE 'FAIL' END || ' | subscribers: مشتركاه فقط (2)';
SELECT CASE WHEN (SELECT count(*) FROM subscribers WHERE id = 211) = 0 THEN 'PASS' ELSE 'FAIL' END || ' | مشترك الوكيل الآخر غير مرئي';
SELECT CASE WHEN (SELECT count(*) FROM technicians) = 1 THEN 'PASS' ELSE 'FAIL' END || ' | technicians (1)';
SELECT CASE WHEN (SELECT count(*) FROM recharge_cards) = 1 AND (SELECT serial FROM recharge_cards) = 'PIN-A1'
       THEN 'PASS' ELSE 'FAIL' END || ' | recharge_cards: كارته فقط';
SELECT CASE WHEN (SELECT count(*) FROM attendances) = 1 THEN 'PASS' ELSE 'FAIL' END || ' | attendances (1)';
SELECT CASE WHEN (SELECT count(*) FROM money_tx) = 1 AND (SELECT "moneyIn" FROM money_tx) = 1000
       THEN 'PASS' ELSE 'FAIL' END || ' | money_tx: حركته فقط';
SELECT CASE WHEN (SELECT count(*) FROM task_cards) = 1 AND (SELECT count(*) FROM card_photos) = 1
       THEN 'PASS' ELSE 'FAIL' END || ' | سلسلة البطاقات والصور';
SELECT CASE WHEN (SELECT count(*) FROM invoice_items) = 1 THEN 'PASS' ELSE 'FAIL' END || ' | invoice_items عبر الفاتورة';
SELECT CASE WHEN (SELECT count(*) FROM maintenance_logs) = 1 THEN 'PASS' ELSE 'FAIL' END || ' | maintenance_logs عبر المشترك';
SELECT CASE WHEN (SELECT count(*) FROM wa_relays) = 1 AND (SELECT count(*) FROM wa_sessions) = 1
       THEN 'PASS' ELSE 'FAIL' END || ' | مُرحِّل وجلسة واتساب مكتبه فقط';
SELECT CASE WHEN (SELECT count(*) FROM hybrid_workers) = 2 THEN 'PASS' ELSE 'FAIL' END || ' | hybrid_workers: حاسبته + غير المعتمدة (2)';
SELECT CASE WHEN (SELECT count(*) FROM messages) = 4 THEN 'PASS' ELSE 'FAIL' END || ' | messages: رسائله الأربع فقط';
SELECT CASE WHEN (SELECT count(*) FROM messages WHERE text LIKE 'م2%') = 0 THEN 'PASS' ELSE 'FAIL' END || ' | رسائل الوكيل الآخر غير مرئية';
SELECT CASE WHEN (SELECT count(*) FROM system_settings) >= 2 THEN 'PASS' ELSE 'FAIL' END || ' | system_settings مقروءة (مشتركة)';
SELECT CASE WHEN (SELECT count(*) FROM map_points) = 1 THEN 'PASS' ELSE 'FAIL' END || ' | map_points مقروءة (مرجع عام)';
SELECT CASE WHEN array(SELECT agent_notify_phones() ORDER BY 1) = ARRAY['07711000001','07811000011']
       THEN 'PASS' ELSE 'FAIL' END || ' | agent_notify_phones: هواتف وكيله فقط';

-- ===== UPDATE/DELETE على صفوف الوكيل الآخر: صفر صفوف =====
WITH u AS (UPDATE subscribers SET name = 'hack' WHERE id = 211 RETURNING 1)
SELECT CASE WHEN (SELECT count(*) FROM u) = 0 THEN 'PASS' ELSE 'FAIL' END || ' | UPDATE مشترك وكيل آخر = 0 صف';
WITH u AS (UPDATE towers SET name = 'hack' WHERE id = 21 RETURNING 1)
SELECT CASE WHEN (SELECT count(*) FROM u) = 0 THEN 'PASS' ELSE 'FAIL' END || ' | UPDATE مكتب وكيل آخر = 0 صف';
WITH u AS (UPDATE recharge_cards SET "useDate" = now() WHERE id = 802 RETURNING 1)
SELECT CASE WHEN (SELECT count(*) FROM u) = 0 THEN 'PASS' ELSE 'FAIL' END || ' | UPDATE كارت وكيل آخر = 0 صف';
WITH d AS (DELETE FROM messages WHERE id = 3601 RETURNING 1)
SELECT CASE WHEN (SELECT count(*) FROM d) = 0 THEN 'PASS' ELSE 'FAIL' END || ' | DELETE رسالة وكيل آخر = 0 صف';

-- ===== UPDATE على صفوف وكيله: يعمل =====
WITH u AS (UPDATE attendances SET "checkOut" = now() WHERE id = 1101 RETURNING 1)
SELECT CASE WHEN (SELECT count(*) FROM u) = 1 THEN 'PASS' ELSE 'FAIL' END || ' | UPDATE حضور وكيله يعمل';
WITH u AS (UPDATE technicians SET "supportTowerId" = NULL WHERE id = 1001 RETURNING 1)
SELECT CASE WHEN (SELECT count(*) FROM u) = 1 THEN 'PASS' ELSE 'FAIL' END || ' | UPDATE فني وكيله يعمل';

-- ===== INSERT: مرفوض لوكيل آخر (WITH CHECK)، مسموح لوكيله =====
DO $$ BEGIN
  INSERT INTO subscribers (name, "towerId") VALUES ('تسلل', 21);
  RAISE NOTICE 'FAIL | INSERT مشترك بمكتب وكيل آخر لم يُرفض!';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS | INSERT مشترك بمكتب وكيل آخر مرفوض (%)', SQLSTATE;
END $$;
DO $$ BEGIN
  INSERT INTO notifications ("agentId", type, title, body) VALUES (2, 'checkin', 'تسلل', 'x');
  RAISE NOTICE 'FAIL | INSERT إشعار لوكيل آخر لم يُرفض!';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS | INSERT إشعار لوكيل آخر مرفوض (%)', SQLSTATE;
END $$;
DO $$ BEGIN
  INSERT INTO messages (channel, phone, text, status)
  VALUES ('WHATSAPP'::"MessageChannel", '07821000021', 'تسلل', 'PENDING'::"MessageStatus");
  RAISE NOTICE 'FAIL | INSERT رسالة لهاتف مدير وكيل آخر لم يُرفض!';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS | INSERT رسالة لهاتف وكيل آخر مرفوض (%)', SQLSTATE;
END $$;
DO $$ DECLARE n int; BEGIN
  INSERT INTO subscribers (name, "towerId") VALUES ('جديد-مزامنة', 11) RETURNING id INTO n;
  RAISE NOTICE 'PASS | INSERT مشترك لوكيله يعمل (id=%)', n;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAIL | INSERT مشترك لوكيله فشل (%)', SQLSTATE;
END $$;
DO $$ BEGIN
  INSERT INTO messages (channel, phone, text, status)
  VALUES ('WHATSAPP'::"MessageChannel", '07811000011', 'تقرير جديد', 'PENDING'::"MessageStatus");
  RAISE NOTICE 'PASS | INSERT تقرير لمدير مكتبه يعمل';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAIL | INSERT تقرير لمدير مكتبه فشل (%)', SQLSTATE;
END $$;
DO $$ BEGIN
  INSERT INTO adjustments ("technicianId", "agentId", kind, source, amount, reason, "dayKey")
  VALUES (1001, 1, 'deduction', 'missed-checkout', 100, 'غرامة', '2026-07-18');
  RAISE NOTICE 'PASS | INSERT خصم (غرامة الخروج) يعمل';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAIL | INSERT خصم فشل (%)', SQLSTATE;
END $$;

-- ===== الجداول المحظورة كلياً =====
DO $$ BEGIN
  PERFORM count(*) FROM users;
  RAISE NOTICE 'FAIL | users مقروء!';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS | users محظور تماماً';
END $$;
DO $$ BEGIN
  PERFORM count(*) FROM install_tokens;
  RAISE NOTICE 'FAIL | install_tokens مقروء!';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS | install_tokens محظور تماماً';
END $$;
DO $$ BEGIN
  PERFORM count(*) FROM manager_tx;
  RAISE NOTICE 'FAIL | manager_tx مقروء!';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS | manager_tx محظور تماماً';
END $$;
DO $$ BEGIN
  PERFORM count(*) FROM groups;
  RAISE NOTICE 'FAIL | groups مقروء!';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS | groups (قديمة) محظور';
END $$;

-- ===== عمود السرّ على agents محجوب، وبقية الأعمدة تعمل =====
DO $$ BEGIN
  PERFORM "workerDbUrl" FROM agents;
  RAISE NOTICE 'FAIL | workerDbUrl مقروء!';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS | عمود workerDbUrl محجوب عن الدور';
END $$;
DO $$ BEGIN
  PERFORM "backupEmail", "salaryPeriodFrom" FROM agents;
  RAISE NOTICE 'PASS | أعمدة agents المسموحة مقروءة';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAIL | أعمدة agents المسموحة فشلت (%)', SQLSTATE;
END $$;

-- ===== audit_logs: إدراج بلا userId فقط، وبلا قراءة =====
DO $$ BEGIN
  INSERT INTO audit_logs (action) VALUES ('SYNC_TEST');
  RAISE NOTICE 'PASS | INSERT توثيق مزامنة (بلا userId) يعمل';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAIL | INSERT توثيق فشل (%)', SQLSTATE;
END $$;
DO $$ BEGIN
  INSERT INTO audit_logs (action, "userId") VALUES ('SPOOF', 902);
  RAISE NOTICE 'FAIL | INSERT توثيق بـuserId لم يُرفض!';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS | INSERT توثيق بـuserId مرفوض (%)', SQLSTATE;
END $$;
DO $$ BEGIN
  PERFORM count(*) FROM audit_logs;
  RAISE NOTICE 'FAIL | audit_logs مقروء!';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS | audit_logs قراءة محظورة';
END $$;

-- ===== منع DDL =====
DO $$ BEGIN
  EXECUTE 'CREATE TABLE hack_t (id int)';
  RAISE NOTICE 'FAIL | CREATE TABLE نجح!';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS | DDL محظور (لا CREATE)';
END $$;

-- ===== انتحال الهوية: جدول الربط قراءة فقط =====
DO $$ BEGIN
  UPDATE db_agent_roles SET agent_id = 2 WHERE role_name = current_user;
  RAISE NOTICE 'FAIL | تعديل db_agent_roles نجح!';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS | db_agent_roles قراءة فقط (لا انتحال)';
END $$;

-- ===== أداء قائمة المشتركين (خطة الاستعلام كنموذج للعامل) =====
\pset tuples_only off
EXPLAIN (COSTS OFF) SELECT * FROM subscribers WHERE "isDeleted" = false ORDER BY name LIMIT 50;
