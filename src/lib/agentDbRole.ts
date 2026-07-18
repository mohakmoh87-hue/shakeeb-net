import { prisma } from "@/lib/prisma";
import crypto from "node:crypto";

// ============================================================================
// أدوار قاعدة بيانات الوكلاء (RLS): لكل وكيل دور Postgres «agent_<id>_worker»
// بكلمة سر عشوائية، تُسلَّم لحواسيب مكاتبه عند التنصيب. اتصال الموقع (المالك) يبقى
// كما هو ويتجاوز RLS. هذا الملف إضافي — لا يعدّل أي منطق قائم.
//   - رابط الدور يُخزَّن في العمود الخام agents."workerDbUrl" (خارج schema.prisma).
//   - إنشاء/تبديل كلمة السر يتمّان عبر دالة create_agent_worker_role على القاعدة.
// كل الاستعلامات باتصال المالك (Vercel) الذي يملك صلاحية إنشاء الأدوار.
// ============================================================================

function randomPassword(): string {
  // 40 حرفاً آمناً بلا رموز تُربك روابط الاتصال
  return crypto.randomBytes(30).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 40).padEnd(24, "0");
}

// يبني رابط اتصال دور الوكيل من DATABASE_URL الرئيسي (يبدّل بيانات الاعتماد فقط)
function buildRoleUrl(roleName: string, password: string): string {
  const main = process.env.DATABASE_URL;
  if (!main) throw new Error("DATABASE_URL غير مضبوط");
  const u = new URL(main);
  u.username = roleName;
  u.password = password;
  return u.toString();
}

// يقرأ رابط دور الوكيل المخزَّن (أو null) — عمود خام
async function readStoredUrl(agentId: number): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<{ url: string | null }[]>(
    `SELECT "workerDbUrl" AS url FROM agents WHERE id = $1`, agentId,
  );
  return rows[0]?.url ?? null;
}

// ينشئ/يبدّل كلمة سر دور الوكيل على القاعدة ثم يخزّن الرابط ويُعيده.
// اتصال الموقع (neondb_owner) يملك CREATEROLE، فتُنفَّذ عبارات DDL مباشرةً بلا حاجة
// لدالة SECURITY DEFINER — مع تحقّق صارم يمنع أي حقن (المعرّف عدد، وكلمة السر alnum فقط).
async function upsertRole(agentId: number): Promise<string> {
  if (!Number.isInteger(agentId) || agentId <= 0) throw new Error("agentId غير صالح");
  const roleName = `agent_${agentId}_worker`;
  const password = randomPassword();
  if (!/^[A-Za-z0-9]+$/.test(password)) throw new Error("كلمة سر غير آمنة"); // حارس إضافي

  const exists = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM pg_roles WHERE rolname = $1`, roleName,
  );
  // أسماء الأدوار وكلمات السر لا تقبل معاملات في DDL؛ آمنة هنا (عدد + alnum)
  if ((exists[0]?.n ?? 0) > 0) {
    await prisma.$executeRawUnsafe(`ALTER ROLE "${roleName}" WITH LOGIN PASSWORD '${password}'`);
  } else {
    await prisma.$executeRawUnsafe(`CREATE ROLE "${roleName}" WITH LOGIN PASSWORD '${password}'`);
  }
  await prisma.$executeRawUnsafe(`GRANT agent_worker TO "${roleName}"`);
  await prisma.$executeRawUnsafe(
    `INSERT INTO db_agent_roles (role_name, agent_id) VALUES ($1, $2)
     ON CONFLICT (role_name) DO UPDATE SET agent_id = EXCLUDED.agent_id`, roleName, agentId,
  );

  const url = buildRoleUrl(roleName, password);
  await prisma.$executeRawUnsafe(`UPDATE agents SET "workerDbUrl" = $1 WHERE id = $2`, url, agentId);
  return url;
}

// يضمن وجود رابط دور للوكيل: يُنشئه أول مرة، أو يعيد المخزَّن.
// يُستخدم من install-config (تسليم الرابط للحاسبة) ومن إنشاء الوكيل.
export async function ensureAgentRoleUrl(agentId: number): Promise<string> {
  const stored = await readStoredUrl(agentId);
  if (stored) return stored;
  return upsertRole(agentId);
}

// يعيد توليد المفتاح: يبدّل كلمة سر الدور دائماً (عند الشك بتسريب) ويحدّث الرابط.
// الحواسيب القديمة تفقد الاتصال حتى تُجدَّد تنصيباتها برمز جديد.
export async function regenerateAgentRoleUrl(agentId: number): Promise<string> {
  return upsertRole(agentId);
}
