-- ============================================================================
-- RLS شكيب نت — 03: تفعيل أمن مستوى الصف والسياسات — كل جدول بقرار صريح
-- يُنفَّذ باتصال اليوزر الرئيسي (مالك الجداول).
-- مبدآن حاكمان:
--   * لا FORCE ROW LEVEL SECURITY إطلاقاً — مالك الجداول (اتصال الموقع على Vercel)
--     يتجاوز RLS بالكامل، فالموقع لا يتأثر بأي شيء هنا.
--   * كل السياسات تستند إلى current_agent_id() المشتقّة من دور الدخول نفسه
--     (جدول db_agent_roles القراءة-فقط) — لا متغيرات جلسة يضبطها العميل.
-- قابل لإعادة التنفيذ (DROP POLICY IF EXISTS ثم CREATE).
-- ============================================================================

-- ============================ الفئة أ: agentId مباشرة ============================
-- سياسة واحدة لكل الأوامر: USING تحصر القراءة/التعديل/الحذف بصفوف الوكيل،
-- وWITH CHECK يمنع إدخال/تحويل أي صف لوكيل آخر.

-- agents: الدور يرى صفّ وكيله فقط (قراءة فقط أصلاً بالصلاحيات، والأعمدة السرّية
-- محجوبة بقائمة أعمدة GRANT في 02)
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_agents ON agents;
CREATE POLICY rls_agents ON agents FOR SELECT TO agent_worker
  USING (id = current_agent_id());

ALTER TABLE towers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_towers ON towers;
CREATE POLICY rls_towers ON towers TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_packages ON packages;
CREATE POLICY rls_packages ON packages TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

ALTER TABLE sms_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_sms_templates ON sms_templates;
CREATE POLICY rls_sms_templates ON sms_templates TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

ALTER TABLE recharge_cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_recharge_cards ON recharge_cards;
CREATE POLICY rls_recharge_cards ON recharge_cards TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_tickets ON tickets;
CREATE POLICY rls_tickets ON tickets TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

ALTER TABLE technicians ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_technicians ON technicians;
CREATE POLICY rls_technicians ON technicians TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

ALTER TABLE attendances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_attendances ON attendances;
CREATE POLICY rls_attendances ON attendances TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

ALTER TABLE leaves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_leaves ON leaves;
CREATE POLICY rls_leaves ON leaves TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

ALTER TABLE adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_adjustments ON adjustments;
CREATE POLICY rls_adjustments ON adjustments TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

ALTER TABLE salary_statements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_salary_statements ON salary_statements;
CREATE POLICY rls_salary_statements ON salary_statements TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_notifications ON notifications;
CREATE POLICY rls_notifications ON notifications TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_push_subscriptions ON push_subscriptions;
CREATE POLICY rls_push_subscriptions ON push_subscriptions TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

ALTER TABLE reward_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_reward_logs ON reward_logs;
CREATE POLICY rls_reward_logs ON reward_logs TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

ALTER TABLE card_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_card_types ON card_types;
CREATE POLICY rls_card_types ON card_types TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

-- loan_debts: ديون قروض فزعة — المزامنة تقرؤها لتتجاهل أصحاب القروض (قراءة فقط بالصلاحيات؛
-- الكتابة خادميّة بدور المالك). عزل بالوكيل مباشرةً عبر agentId.
ALTER TABLE loan_debts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_loan_debts ON loan_debts;
CREATE POLICY rls_loan_debts ON loan_debts TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

-- hybrid_workers: الحاسبة تسجّل نفسها قبل اعتماد المدير (agentId فارغ حينها)
ALTER TABLE hybrid_workers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_hybrid_workers ON hybrid_workers;
CREATE POLICY rls_hybrid_workers ON hybrid_workers TO agent_worker
  USING ("agentId" = current_agent_id() OR "agentId" IS NULL)
  WITH CHECK ("agentId" = current_agent_id() OR "agentId" IS NULL);

-- ====================== الفئة ب: towerId ← مكاتب الوكيل ======================

ALTER TABLE tower_info ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_tower_info ON tower_info;
CREATE POLICY rls_tower_info ON tower_info TO agent_worker
  USING ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()))
  WITH CHECK ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()));

ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_subscribers ON subscribers;
CREATE POLICY rls_subscribers ON subscribers TO agent_worker
  USING ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()))
  WITH CHECK ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()));

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_accounts ON accounts;
CREATE POLICY rls_accounts ON accounts TO agent_worker
  USING ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()))
  WITH CHECK ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()));

ALTER TABLE subscription_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_subscription_entries ON subscription_entries;
CREATE POLICY rls_subscription_entries ON subscription_entries TO agent_worker
  USING ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()))
  WITH CHECK ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()));

ALTER TABLE money_tx ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_money_tx ON money_tx;
CREATE POLICY rls_money_tx ON money_tx TO agent_worker
  USING ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()))
  WITH CHECK ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()));

ALTER TABLE items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_items ON items;
CREATE POLICY rls_items ON items TO agent_worker
  USING ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()))
  WITH CHECK ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()));

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_invoices ON invoices;
CREATE POLICY rls_invoices ON invoices TO agent_worker
  USING ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()))
  WITH CHECK ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()));

ALTER TABLE custodies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_custodies ON custodies;
CREATE POLICY rls_custodies ON custodies TO agent_worker
  USING ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()))
  WITH CHECK ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()));

ALTER TABLE task_boards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_task_boards ON task_boards;
CREATE POLICY rls_task_boards ON task_boards TO agent_worker
  USING ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()))
  WITH CHECK ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()));

ALTER TABLE wa_relays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_wa_relays ON wa_relays;
CREATE POLICY rls_wa_relays ON wa_relays TO agent_worker
  USING ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()))
  WITH CHECK ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()));

ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_print_jobs ON print_jobs;
CREATE POLICY rls_print_jobs ON print_jobs TO agent_worker
  USING ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()))
  WITH CHECK ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()));

ALTER TABLE wa_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_wa_sessions ON wa_sessions;
CREATE POLICY rls_wa_sessions ON wa_sessions TO agent_worker
  USING ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()))
  WITH CHECK ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()));

-- ====================== الفئة ج: تابعة عبر وسيط (سلاسل IN) ======================

-- task_lists ← task_boards ← towers
ALTER TABLE task_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_task_lists ON task_lists;
CREATE POLICY rls_task_lists ON task_lists TO agent_worker
  USING ("boardId" IN (SELECT b.id FROM task_boards b JOIN towers t ON t.id = b."towerId"
                        WHERE t."agentId" = current_agent_id()))
  WITH CHECK ("boardId" IN (SELECT b.id FROM task_boards b JOIN towers t ON t.id = b."towerId"
                             WHERE t."agentId" = current_agent_id()));

-- task_cards ← task_lists ← task_boards ← towers
ALTER TABLE task_cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_task_cards ON task_cards;
CREATE POLICY rls_task_cards ON task_cards TO agent_worker
  USING ("listId" IN (SELECT l.id FROM task_lists l
                       JOIN task_boards b ON b.id = l."boardId"
                       JOIN towers t ON t.id = b."towerId"
                       WHERE t."agentId" = current_agent_id()))
  WITH CHECK ("listId" IN (SELECT l.id FROM task_lists l
                            JOIN task_boards b ON b.id = l."boardId"
                            JOIN towers t ON t.id = b."towerId"
                            WHERE t."agentId" = current_agent_id()));

-- card_photos ← task_cards (سلسلة كاملة)
ALTER TABLE card_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_card_photos ON card_photos;
CREATE POLICY rls_card_photos ON card_photos TO agent_worker
  USING ("cardId" IN (SELECT c.id FROM task_cards c
                       JOIN task_lists l ON l.id = c."listId"
                       JOIN task_boards b ON b.id = l."boardId"
                       JOIN towers t ON t.id = b."towerId"
                       WHERE t."agentId" = current_agent_id()))
  WITH CHECK ("cardId" IN (SELECT c.id FROM task_cards c
                            JOIN task_lists l ON l.id = c."listId"
                            JOIN task_boards b ON b.id = l."boardId"
                            JOIN towers t ON t.id = b."towerId"
                            WHERE t."agentId" = current_agent_id()));

-- invoice_items ← invoices ← towers
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_invoice_items ON invoice_items;
CREATE POLICY rls_invoice_items ON invoice_items TO agent_worker
  USING ("invoiceId" IN (SELECT i.id FROM invoices i JOIN towers t ON t.id = i."towerId"
                          WHERE t."agentId" = current_agent_id()))
  WITH CHECK ("invoiceId" IN (SELECT i.id FROM invoices i JOIN towers t ON t.id = i."towerId"
                               WHERE t."agentId" = current_agent_id()));

-- maintenance_logs ← subscribers ← towers
ALTER TABLE maintenance_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_maintenance_logs ON maintenance_logs;
CREATE POLICY rls_maintenance_logs ON maintenance_logs TO agent_worker
  USING ("subscriberId" IN (SELECT s.id FROM subscribers s JOIN towers t ON t.id = s."towerId"
                             WHERE t."agentId" = current_agent_id()))
  WITH CHECK ("subscriberId" IN (SELECT s.id FROM subscribers s JOIN towers t ON t.id = s."towerId"
                                  WHERE t."agentId" = current_agent_id()));

-- messages: مربوطة بمشترك الوكيل، أو برقم هاتف تنبيهات الوكيل (تقارير المزامنة/اليومي
-- إلى مدراء المكاتب/المستخدمين — عبر دالة agent_notify_phones المقيّدة)، أو برقم
-- هاتف مشتركي الوكيل (رسائل محادثات بلا subscriberId)
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_messages ON messages;
CREATE POLICY rls_messages ON messages TO agent_worker
  USING (
    ("subscriberId" IS NOT NULL AND "subscriberId" IN
       (SELECT s.id FROM subscribers s JOIN towers t ON t.id = s."towerId"
         WHERE t."agentId" = current_agent_id()))
    OR (phone IS NOT NULL AND phone IN (SELECT agent_notify_phones()))
    OR (phone IS NOT NULL AND phone IN
       (SELECT s.phone FROM subscribers s JOIN towers t ON t.id = s."towerId"
         WHERE t."agentId" = current_agent_id() AND s.phone IS NOT NULL))
    -- نفس فرع WITH CHECK: بلا مقابلٍ هنا يفشل INSERT … RETURNING الذي يولّده Prisma فيُفقَد
    -- صفّ السجلّ صامتاً. والعزل محفوظ: الشرط هو agentId = وكيل هذه الحاسبة نفسه.
    OR (phone IS NOT NULL AND "agentId" IS NOT NULL AND "agentId" = current_agent_id())
  )
  WITH CHECK (
    ("subscriberId" IS NOT NULL AND "subscriberId" IN
       (SELECT s.id FROM subscribers s JOIN towers t ON t.id = s."towerId"
         WHERE t."agentId" = current_agent_id()))
    OR (phone IS NOT NULL AND phone IN (SELECT agent_notify_phones()))
    OR (phone IS NOT NULL AND phone IN
       (SELECT s.phone FROM subscribers s JOIN towers t ON t.id = s."towerId"
         WHERE t."agentId" = current_agent_id() AND s.phone IS NOT NULL))
    -- 2026-08-09 (مهلة أودو): هاتف تذكرة سوبر سيل قد لا يطابق أيّ مشترك عندنا (صيغةٌ مختلفة،
    -- أو تذكرة Change Team لغير مشتركينا). فيُقبَل صفّ السجلّ إن كان **موسوماً بوكيل هذه الحاسبة
    -- صريحاً** — والصفّ سجلٌّ بعديّ لا يُرسل شيئاً، والعزل محفوظ بالشرط نفسه.
    OR (phone IS NOT NULL AND "agentId" IS NOT NULL AND "agentId" = current_agent_id())
  );

-- audit_logs: إدراج فقط لصفوف بلا userId (توثيق المزامنة) — لا قراءة إطلاقاً
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_audit_logs_insert ON audit_logs;
CREATE POLICY rls_audit_logs_insert ON audit_logs FOR INSERT TO agent_worker
  WITH CHECK ("userId" IS NULL);

-- ==================== الفئة د: مراجع عامة مشتركة (قراءة فقط) ====================

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_system_settings_read ON system_settings;
CREATE POLICY rls_system_settings_read ON system_settings FOR SELECT TO agent_worker
  USING (true);

-- كتابة العامل محصورة بمفتاحيه فقط (2026-07-30): رفعات عدّاد المشتركين subStats:{وكيله}
-- وبصمة إصدار الكود workerVer:{معرّف حاسبته} — لا يكتب أي إعداد آخر (شعارات/قوالب/أسرار)
DROP POLICY IF EXISTS rls_system_settings_worker_insert ON system_settings;
CREATE POLICY rls_system_settings_worker_insert ON system_settings FOR INSERT TO agent_worker
  WITH CHECK (type = 'subStats:' || current_agent_id()::text OR type LIKE 'workerVer:%');
DROP POLICY IF EXISTS rls_system_settings_worker_update ON system_settings;
CREATE POLICY rls_system_settings_worker_update ON system_settings FOR UPDATE TO agent_worker
  USING (type = 'subStats:' || current_agent_id()::text OR type LIKE 'workerVer:%')
  WITH CHECK (type = 'subStats:' || current_agent_id()::text OR type LIKE 'workerVer:%');

ALTER TABLE map_points ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_map_points_read ON map_points;
CREATE POLICY rls_map_points_read ON map_points FOR SELECT TO agent_worker
  USING (true);

ALTER TABLE push_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_push_types_read ON push_types;
CREATE POLICY rls_push_types_read ON push_types FOR SELECT TO agent_worker
  USING (true);

ALTER TABLE ticket_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_ticket_types_read ON ticket_types;
CREATE POLICY rls_ticket_types_read ON ticket_types FOR SELECT TO agent_worker
  USING (true);

ALTER TABLE ticket_priorities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_ticket_priorities_read ON ticket_priorities;
CREATE POLICY rls_ticket_priorities_read ON ticket_priorities FOR SELECT TO agent_worker
  USING (true);

ALTER TABLE ticket_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_ticket_states_read ON ticket_states;
CREATE POLICY rls_ticket_states_read ON ticket_states FOR SELECT TO agent_worker
  USING (true);

-- ============ الفئة هـ: حسّاسة أو غير لازمة للعامل — منع كامل ============
-- (تفعيل RLS بلا أي سياسة للأدوار + لا GRANT في 02 = رفض تام بطبقتين)

ALTER TABLE users          ENABLE ROW LEVEL SECURITY; -- كلمات سر الدخول
ALTER TABLE install_tokens ENABLE ROW LEVEL SECURITY; -- رموز التنصيب
ALTER TABLE manager_tx     ENABLE ROW LEVEL SECURITY; -- حسابات المدير (موقع فقط)
-- ═════ 🛡️ جداولُ حارس المال — عزلٌ بـagentId كبقيّة جداول الوكيل (2026-08-14) ═════
-- والقاعدةُ التي تُطبَّق هنا: **كلُّ كتابةٍ جديدة = GRANT + سياسة**، ومكانُها هذان
-- الملفّان لا سكربتُ نشرٍ عابر — وإلّا فقدَ العزلُ عند أوّل استعادة.
ALTER TABLE deleted_card_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_deleted_card_logs ON deleted_card_logs;
CREATE POLICY rls_deleted_card_logs ON deleted_card_logs TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

ALTER TABLE guard_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_guard_assignments ON guard_assignments;
CREATE POLICY rls_guard_assignments ON guard_assignments TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

ALTER TABLE card_sas_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_card_sas_checks ON card_sas_checks;
CREATE POLICY rls_card_sas_checks ON card_sas_checks TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

-- ═════ 🔒 خمسةُ جداولٍ اصطادها اختبارُ التغطية (2026-08-14) ═════
-- **حالتان مختلفتان، والفرقُ مقيسٌ على الإنتاج:**
--  • `sas_panels` و`money_health_ignores`: **لهما سياسةٌ على الإنتاج فعلاً** (أُنشئت من
--    سكربتَي نشرِهما) وكانتا **غائبتَين عن هذا الملفّ** ⇒ استعادةٌ تُعيدهما مكشوفتَين.
--  • `managers` و`card_completions` و`map_point_proposals`: بلا سياسةٍ **وبلا أيّ إذنٍ
--    للعامل** (قِيس: صفرُ GRANT) — فتشغيلُ RLS عليها لا يمنع شيئاً قائماً ويسدّ البابَ
--    قبل أوّلِ كتابةٍ من حاسبةِ مكتب. وهي الثلاثةُ التي يُبلّغ عنها `npm run check:money`.
ALTER TABLE sas_panels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_sas_panels ON sas_panels;
CREATE POLICY rls_sas_panels ON sas_panels TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

ALTER TABLE money_health_ignores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_money_health_ignores ON money_health_ignores;
CREATE POLICY rls_money_health_ignores ON money_health_ignores TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

ALTER TABLE managers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_managers ON managers;
CREATE POLICY rls_managers ON managers TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

ALTER TABLE card_completions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_card_completions ON card_completions;
CREATE POLICY rls_card_completions ON card_completions TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

ALTER TABLE map_point_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_map_point_proposals ON map_point_proposals;
CREATE POLICY rls_map_point_proposals ON map_point_proposals TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

-- 📋 سجلّ المزامنة الموحَّد (2026-08-20) — تكتبه المزامنةُ من الحاسبات (agent_worker)
-- فالمنحُ والسياسةُ واجبان: SELECT/INSERT/UPDATE + عزلُ agentId.
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_sync_log ON sync_log;
CREATE POLICY rls_sync_log ON sync_log TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

-- 📈 قواعدُ ربح الشركة (2026-08-22) — إعداداتُ عرضٍ لا قيودٌ ماليّة، يقرؤها ويكتبها
-- الموقعُ وحدَه. والسياسةُ تُسدّ البابَ من يومه الأوّل: لا يرى وكيلٌ قواعدَ غيرِه أبداً.
ALTER TABLE profit_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_profit_rules ON profit_rules;
CREATE POLICY rls_profit_rules ON profit_rules TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

-- 📬 الرسائل الداخليّة المنبثقة (2026-08-20) — يقرؤها ويكتبها الموقعُ وحدَه، لكنّ
-- العزل لا يكون مشروطاً: السياسةُ تسدّ أيَّ وصولِ عاملٍ مستقبليٍّ من يومه الأوّل.
ALTER TABLE internal_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_internal_messages ON internal_messages;
CREATE POLICY rls_internal_messages ON internal_messages TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

ALTER TABLE groups         ENABLE ROW LEVEL SECURITY; -- قديمة
ALTER TABLE boxes          ENABLE ROW LEVEL SECURITY; -- قديمة
ALTER TABLE box_deps       ENABLE ROW LEVEL SECURITY; -- قديمة
ALTER TABLE months         ENABLE ROW LEVEL SECURITY; -- قديمة
ALTER TABLE notes          ENABLE ROW LEVEL SECURITY; -- قديمة
ALTER TABLE events         ENABLE ROW LEVEL SECURITY; -- قديمة
