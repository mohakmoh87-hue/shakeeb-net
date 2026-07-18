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

// ينشئ/يبدّل كلمة سر دور الوكيل على القاعدة ثم يخزّن الرابط ويُعيده
async function upsertRole(agentId: number): Promise<string> {
  const password = randomPassword();
  // الدالة SECURITY DEFINER: تنشئ الدور أو تبدّل كلمة سره وتُدرجه بجدول الربط
  const res = await prisma.$queryRawUnsafe<{ create_agent_worker_role: string }[]>(
    `SELECT create_agent_worker_role($1, $2)`, agentId, password,
  );
  const roleName = res[0]?.create_agent_worker_role ?? `agent_${agentId}_worker`;
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
