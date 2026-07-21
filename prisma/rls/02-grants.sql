-- ============================================================================
-- RLS شكيب نت — 02: صلاحيات دور المجموعة agent_worker
-- المبدأ: أدنى صلاحية تُبقي كل وظائف العامل المحلي تعمل (مزامنة، واتساب، مُرحِّل،
-- نسخ احتياطي، خروج تلقائي، إشعارات) — مشتقّة من جرد فعلي لكل قراءات/كتابات العامل.
-- بلا أي صلاحيات DDL. قابل لإعادة التنفيذ.
-- ============================================================================

-- تنظيف: سحب أي صلاحيات سابقة ثم منح المطلوب بدقة
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM agent_worker;
GRANT SELECT ON db_agent_roles TO agent_worker; -- أعيدت بعد REVOKE الشامل

-- ---------- agents: قراءة أعمدة محدّدة فقط (بلا workerDbUrl السرّي) ----------
GRANT SELECT (id, name, "officeCap", "planExpiry", "isTrial", approved,
              "backupEmail", "salaryPeriodFrom", "salaryPeriodTo",
              "isDeleted", "createdAt", "updatedAt")
  ON agents TO agent_worker;

-- ---------- قراءة + كتابة كاملة (رسائل ومُرحِّل الواتساب وأوامر الطباعة) ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON messages   TO agent_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON wa_relays  TO agent_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON print_jobs TO agent_worker; -- الطباعة الصامتة

-- ---------- قراءة + إنشاء + تحديث ----------
GRANT SELECT, INSERT, UPDATE ON subscribers    TO agent_worker; -- المزامنة تنشئ وتحدّث
GRANT SELECT, INSERT, UPDATE ON wa_sessions    TO agent_worker; -- upsert حالة الجلسة
GRANT SELECT, INSERT, UPDATE ON hybrid_workers TO agent_worker; -- تسجيل الحاسبة ونبضتها

-- ---------- قراءة + إنشاء ----------
GRANT SELECT, INSERT ON adjustments   TO agent_worker; -- غرامة نسيان الخروج
GRANT SELECT, INSERT ON notifications TO agent_worker; -- إشعارات الأحداث

-- audit_logs: إدراج فقط (توثيق المزامنة بلا userId) — لا قراءة إطلاقاً
GRANT INSERT ON audit_logs TO agent_worker;

-- ---------- قراءة + تحديث ----------
GRANT SELECT, UPDATE ON towers         TO agent_worker; -- آخر تذكير/تقرير
GRANT SELECT, UPDATE ON attendances    TO agent_worker; -- الخروج التلقائي
GRANT SELECT, UPDATE ON recharge_cards TO agent_worker; -- تصحيح حالة الكروت
GRANT SELECT, UPDATE ON technicians    TO agent_worker; -- إنهاء الدعم

-- ---------- قراءة + حذف ----------
GRANT SELECT, DELETE ON push_subscriptions TO agent_worker; -- حذف الاشتراكات الميتة

-- ---------- قراءة فقط (تقارير/نسخ احتياطي/حسابات) ----------
GRANT SELECT ON packages, tower_info, accounts, subscription_entries, money_tx,
                invoices, invoice_items, items, custodies, tickets, card_types,
                sms_templates, reward_logs, salary_statements, leaves,
                task_boards, task_lists, task_cards, card_photos,
                maintenance_logs, system_settings
  TO agent_worker;

-- ---------- مراجع عامة مشتركة (قراءة فقط) ----------
GRANT SELECT ON map_points, push_types, ticket_types, ticket_priorities, ticket_states
  TO agent_worker;

-- ---------- بلا أي صلاحية (حسّاسة أو لا يحتاجها العامل إطلاقاً) ----------
-- users          : حسابات الدخول وكلمات السر — العامل لا يقرؤها أبداً (تحقّق بالجرد)
-- install_tokens : رموز التنصيب
-- manager_tx     : حركات حساب المدير (تُدار من الموقع فقط)
-- groups, boxes, box_deps, months, notes, events : جداول قديمة لا يلمسها العامل
-- (لا حاجة لأي GRANT — الغياب = منع كامل)
