# عزل الوكلاء على مستوى قاعدة البيانات (Row-Level Security)

حماية إضافية بحتة: تجعل كل حاسبة مكتب غير قادرة على رؤية/تعديل غير بيانات وكيلها **حتى بـSQL خام**، دون تغيير أي منطق قائم. اتصال الموقع (Vercel) يبقى كما هو تماماً.

## الفكرة

| الطرف | الاتصال | RLS |
|---|---|---|
| الموقع (Vercel) | اليوزر الرئيسي = **مالك الجداول** | **يتجاوز RLS بالكامل** (لا FORCE) — لا يتأثر إطلاقاً |
| حاسبة كل مكتب | دور `agent_<id>_worker` بكلمة سر عشوائية | محصور بصفوف وكيله فقط عبر السياسات |

- هوية الدور تُشتق من `session_user` عبر جدول `db_agent_roles` (قراءة فقط للأدوار) والدالة `current_agent_id()` — **لا متغيّرات جلسة يضبطها العميل**.
- رابط دور كل وكيل يُخزَّن في العمود الخام `agents."workerDbUrl"` (خارج schema.prisma عمداً كي لا يقرأه Prisma، ومحجوب عن الأدوار بصلاحيات الأعمدة).

## الملفات (تُطبَّق بالترتيب، باتصال اليوزر الرئيسي، وكلّها idempotent)

1. **`01-infra.sql`** — دور المجموعة `agent_worker`، جدول `db_agent_roles`، الدالتان `current_agent_id()` و`agent_notify_phones()`، عمود `agents."workerDbUrl"`، ودالة `create_agent_worker_role(agent_id, password)` (تنشئ الدور أو تبدّل كلمة سره).
2. **`02-grants.sql`** — أدنى صلاحيات تُبقي كل وظائف العامل تعمل (مشتقّة من جرد فعلي لقراءات/كتابات العامل). بلا أي DDL.
3. **`03-policies.sql`** — تفعيل RLS + سياسة صريحة لكل جدول حسب فئته (agentId مباشر / towerId / تابع عبر وسيط / مرجع عام / محظور).

### تصنيف الجداول
- **agentId مباشر:** towers, users*, technicians, packages, card_types, sms_templates, recharge_cards, tickets, attendances, leaves, adjustments, salary_statements, notifications, push_subscriptions, reward_logs, hybrid_workers, agents (قراءة صف الوكيل فقط، وأعمدة السرّ محجوبة).
- **towerId ← مكاتب الوكيل:** subscribers, money_tx, subscription_entries, invoices, accounts, items, custodies, task_boards, tower_info, wa_sessions, wa_relays.
- **تابع عبر وسيط (سلاسل IN):** task_lists→task_boards، task_cards→task_lists، card_photos→task_cards، invoice_items→invoices، maintenance_logs→subscribers، messages→(مشترك الوكيل | هاتف تنبيهات الوكيل | هاتف مشتركيه)، attendances/leaves/adjustments مربوطة أصلاً بـagentId.
- **مرجع عام (قراءة فقط):** map_points, push_types, ticket_types/priorities/states, system_settings.
- **محظور كلياً للأدوار:** users, install_tokens, manager_tx, groups, boxes, box_deps, months, notes, events. وaudit_logs: **إدراج بلا userId فقط** (لا قراءة).

\* users محظور تماماً على الأدوار (لا GRANT ولا سياسة) — العامل لا يقرأ حسابات الدخول أبداً.

## كيفية التطبيق على القاعدة الحيّة (Neon)

```bash
# باتصال اليوزر الرئيسي (نفس DATABASE_URL على Vercel)
psql "$DATABASE_URL" -f prisma/rls/01-infra.sql
psql "$DATABASE_URL" -f prisma/rls/02-grants.sql
psql "$DATABASE_URL" -f prisma/rls/03-policies.sql
# ثم إنشاء دور لكل وكيل موجود (idempotent):
#   SELECT create_agent_worker_role(id, '<كلمة سر عشوائية>') FROM agents WHERE NOT isDeleted;
# (يفعله التطبيق تلقائياً عبر ensureAgentRoleUrl عند أول توليد رمز تنصيب أو إنشاء وكيل)
```

## الكود المرتبط (إضافات فقط)
- `src/lib/agentDbRole.ts` — `ensureAgentRoleUrl` / `regenerateAgentRoleUrl` (باتصال المالك).
- `src/app/api/hybrid/install-config` — يسلّم رابط دور الوكيل حصراً (لا الرئيسي).
- `src/app/api/owner/agents` (POST) — ينشئ دور الوكيل عند إنشائه.
- `src/app/api/owner/agents/[id]/db-key` (POST) — زر «إعادة توليد المفتاح» بلوحة المالك.

## الاختبار المحلي
`prisma/rls/tests/` — بذور وكيلين + مصفوفة عزل كاملة (SELECT/UPDATE/DELETE/INSERT عبر الأدوار، منع الجداول الحسّاسة، حجب عمود السرّ، منع DDL، منع انتحال الهوية، تدوير المفتاح تحت scram). شغّلها على قاعدة PostgreSQL محلية بعد `prisma db push`.

## الخطوة المتبقّية (يدوية — بعد تحويل كل الحواسيب)
تبديل كلمة سر اليوزر الرئيسي على Neon وتحديث `DATABASE_URL` في Vercel — **لا تُنفَّذ إلا بعد** التأكد أن كل حواسيب المكاتب المُنصَّبة سابقاً أُعيد تنصيبها برموز جديدة (لأنها تستخدم الرابط الرئيسي القديم حتى تُجدَّد).
