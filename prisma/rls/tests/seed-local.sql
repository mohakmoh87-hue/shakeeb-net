-- بذور اختبار RLS المحلية — وكيلان ببيانات في كل فئة سياسات (تُنفَّذ كمالك على قاعدة اختبار فقط)
BEGIN;

INSERT INTO agents (id, name, "workerDbUrl") VALUES
  (1, 'وكيل1', 'postgres://SECRET-AGENT1'),
  (2, 'وكيل2', 'postgres://SECRET-AGENT2');

INSERT INTO users (id, "fullName", username, password, "isAdmin", "isOwner", "agentId", "managerPhone", "updatedAt") VALUES
  (900, 'المالك', 'owner-t', 'x', true, true, NULL, NULL, now()),
  (901, 'مدير1', 'mgr1-t', 'x', true, false, 1, '07711000001', now()),
  (902, 'مدير2', 'mgr2-t', 'x', true, false, 2, '07722000002', now());

INSERT INTO towers (id, name, "agentId", "managerPhone") VALUES
  (11, 'مكتب1أ', 1, '07811000011'),
  (12, 'مكتب1ب', 1, NULL),
  (21, 'مكتب2أ', 2, '07821000021');

INSERT INTO tower_info (id, "towerId", sector) VALUES (301, 11, 'A'), (302, 21, 'B');

INSERT INTO subscribers (id, name, phone, "towerId") VALUES
  (111, 'مشترك1-1', '07901000111', 11),
  (112, 'مشترك1-2', '07901000112', 12),
  (211, 'مشترك2-1', '07901000211', 21);

INSERT INTO packages (id, name, "agentId") VALUES (401, 'باقة1', 1), (402, 'باقة2', 2);
INSERT INTO sms_templates (id, "agentId", type, text) VALUES (501, 1, 'renew', 'ن1'), (502, 2, 'renew', 'ن2');
INSERT INTO card_types (id, "agentId", name) VALUES (601, 1, 'صيانة'), (602, 2, 'صيانة');
INSERT INTO tickets (id, "agentId", "desc") VALUES (701, 1, 'ت1'), (702, 2, 'ت2');
INSERT INTO recharge_cards (id, "agentId", serial, price) VALUES (801, 1, 'PIN-A1', 5000), (802, 2, 'PIN-A2', 5000);
INSERT INTO reward_logs (id, "agentId", kind, amount) VALUES (851, 1, 'grant', 1000), (852, 2, 'grant', 1000);

INSERT INTO technicians (id, name, "agentId", "towerId") VALUES (1001, 'فني1', 1, 11), (2001, 'فني2', 2, 21);
INSERT INTO attendances (id, "technicianId", "agentId", "towerId", "dayKey", "checkIn") VALUES
  (1101, 1001, 1, 11, '2026-07-17', now()), (2101, 2001, 2, 21, '2026-07-17', now());
INSERT INTO leaves (id, "technicianId", "agentId", "towerId", kind, "dayKey", reason) VALUES
  (1201, 1001, 1, 11, 'day', '2026-07-16', 'س1'), (2201, 2001, 2, 21, 'day', '2026-07-16', 'س2');
INSERT INTO adjustments (id, "technicianId", "agentId", "towerId", kind, source, amount, reason, "dayKey") VALUES
  (1301, 1001, 1, 11, 'deduction', 'manual', 500, 'خ1', '2026-07-17'),
  (2301, 2001, 2, 21, 'deduction', 'manual', 500, 'خ2', '2026-07-17');
INSERT INTO salary_statements (id, "technicianId", "technicianName", "agentId", "towerId", "periodFrom", "periodTo",
  "daysPaid", "dailyAmount", "baseEarned", overtime, bonuses, "attendanceDeductions", "confirmedDeductions", net, details) VALUES
  (1401, 1001, 'فني1', 1, 11, '2026-06-01', '2026-06-30', 30, 10, 300, 0, 0, 0, 0, 300, '[]'),
  (2401, 2001, 'فني2', 2, 21, '2026-06-01', '2026-06-30', 30, 10, 300, 0, 0, 0, 0, 300, '[]');
INSERT INTO notifications (id, "agentId", "towerId", type, title, body) VALUES
  (1501, 1, 11, 'checkin', 'ع1', 'ن'), (2501, 2, 21, 'checkin', 'ع2', 'ن');
INSERT INTO push_subscriptions (id, "userId", "agentId", endpoint, p256dh, auth) VALUES
  (1601, 901, 1, 'https://p/1', 'k', 'a'), (2601, 902, 2, 'https://p/2', 'k', 'a');

INSERT INTO accounts (id, name, "towerId") VALUES (1701, 'صندوق1', 11), (2701, 'صندوق2', 21);
INSERT INTO money_tx (id, "moneyIn", "moneyOut", "towerId", date) VALUES
  (1801, 1000, 0, 11, now()), (2801, 2000, 0, 21, now());
INSERT INTO subscription_entries (id, "towerId", "subscriberId", money) VALUES
  (1901, 11, 111, 15000), (2901, 21, 211, 15000);
INSERT INTO invoices (id, "towerId", number) VALUES (2001, 11, 1), (3001, 21, 2);
INSERT INTO invoice_items (id, "invoiceId", count, price) VALUES (2051, 2001, 1, 5), (3051, 3001, 1, 5);
INSERT INTO items (id, name, "towerId", count) VALUES (2151, 'مادة1', 11, 10), (3151, 'مادة2', 21, 10);
INSERT INTO custodies (id, "technicianId", "itemId", "towerId", qty) VALUES
  (2251, 1001, 2151, 11, 2), (3251, 2001, 3151, 21, 2);

INSERT INTO task_boards (id, name, "towerId") VALUES (2301, 'لوحة1', 11), (3301, 'لوحة2', 21);
INSERT INTO task_lists (id, "boardId", name) VALUES (2351, 2301, 'وارد'), (3351, 3301, 'وارد');
INSERT INTO task_cards (id, "listId", title) VALUES (2401, 2351, 'بطاقة1'), (3401, 3351, 'بطاقة2');
INSERT INTO card_photos (id, "cardId", data) VALUES (2451, 2401, 'd1'), (3451, 3401, 'd2');
INSERT INTO maintenance_logs (id, "subscriberId", details) VALUES (2501, 111, 'ص1'), (3501, 211, 'ص2');

-- الرسائل: مشترك مربوط / تقرير لمدير مكتب / تقرير لمدير مستخدم / محادثة برقم مشترك بلا ربط — للوكيلين
INSERT INTO messages (id, channel, "subscriberId", phone, text, status) VALUES
  (2601, 'WHATSAPP'::"MessageChannel", 111, '07901000111', 'م1-مشترك', 'PENDING'::"MessageStatus"),
  (2602, 'WHATSAPP'::"MessageChannel", NULL, '07811000011', 'م1-تقرير-مكتب', 'PENDING'::"MessageStatus"),
  (2603, 'WHATSAPP'::"MessageChannel", NULL, '07711000001', 'م1-تقرير-مدير', 'PENDING'::"MessageStatus"),
  (2604, 'WHATSAPP'::"MessageChannel", NULL, '07901000112', 'م1-محادثة', 'PENDING'::"MessageStatus"),
  (3601, 'WHATSAPP'::"MessageChannel", 211, '07901000211', 'م2-مشترك', 'PENDING'::"MessageStatus"),
  (3602, 'WHATSAPP'::"MessageChannel", NULL, '07821000021', 'م2-تقرير-مكتب', 'PENDING'::"MessageStatus");

INSERT INTO wa_sessions ("towerId", state, "updatedAt") VALUES (11, 'ready', now()), (21, 'ready', now());
INSERT INTO wa_relays (id, "towerId", kind, status, "updatedAt") VALUES (2701, 11, 'chats', 'pending', now()), (3701, 21, 'chats', 'pending', now());
INSERT INTO hybrid_workers (id, "machineId", "agentId") VALUES
  (2801, 'machine-a1', 1), (3801, 'machine-a2', 2), (4801, 'machine-new', NULL);

-- أهداف المنع الكامل
INSERT INTO install_tokens (token, "agentId", "expiresAt") VALUES ('tok-secret', 1, now() + interval '1 hour');
INSERT INTO manager_tx (id, type, amount) VALUES (2901, 'expense', 9);
INSERT INTO groups (id, name) VALUES (3001, 'قديمة');
INSERT INTO system_settings (id, type, value) VALUES (3101, 'reminderTime', '13:00'), (3102, 'receipt:1', 'قالب1');
INSERT INTO map_points (name, lat, lng) VALUES ('P1/T', 33.3, 44.4);
INSERT INTO audit_logs (id, action, "userId") VALUES (3201, 'X1', 901), (3202, 'X2', NULL);

COMMIT;

-- إنشاء دورَي الوكيلين
SELECT create_agent_worker_role(1, 'w1pass');
SELECT create_agent_worker_role(2, 'w2pass');
