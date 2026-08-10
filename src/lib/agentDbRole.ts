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

// يبني رابط اتصال دور الوكيل (يبدّل بيانات الاعتماد فقط).
// ===== الأساس ليس DATABASE_URL بالضرورة (إصلاح 2026-08-10 — نقل Railway) =====
// حاسبات المكاتب تتّصل عبر **الإنترنت العامّ**، أمّا DATABASE_URL على المضيف السحابيّ فقد
// يكون رابطاً **داخليّاً** (على Railway: postgres.railway.internal) لا تصله أيّ حاسبة، وبلا
// sslmode فيتّصل بلا تشفير. فلو أُعيد توليد مفتاح وكيلٍ من الواجهة لتسلّم المكتب رابطاً
// ميّتاً وسقط، ولا رسالة خطأٍ تدلّ على السبب. لذا:
//   • WORKER_DB_BASE_URL (إن ضُبط) هو الأساس — الرابط **العامّ** بما فيه sslmode.
//   • وإن كان الأساس مضيفاً داخليّاً ولم يُضبط المتغيّر ⇒ **نرفض ونصرّح** بدل الكسر الصامت.
function buildRoleUrl(roleName: string, password: string): string {
  const main = process.env.WORKER_DB_BASE_URL || process.env.DATABASE_URL;
  if (!main) throw new Error("DATABASE_URL غير مضبوط");
  const u = new URL(main);
  if (/(\.internal|^localhost$|^127\.0\.0\.1$)/i.test(u.hostname) && !process.env.WORKER_DB_BASE_URL) {
    throw new Error(
      `رابط القاعدة الداخليّ (${u.hostname}) لا تصله حاسبات المكاتب — اضبط WORKER_DB_BASE_URL بالرابط العامّ (مع sslmode) قبل توليد مفاتيح الوكلاء`,
    );
  }
  // ===== فرضُ التشفير عند التوليد (تدقيق 2026-08-10) =====
  // حاسبات المكاتب تعبر الإنترنت العامّ. ومكتبة pg لا تُشفّر إلّا إن حمل الرابط sslmode
  // (تحقُّقٌ من pg-connection-string) ⇒ رابطٌ بلا sslmode يتّصل **نصّاً صريحاً** ومع ذلك
  // **ينجح**، فيعتمده الفحص وتُعيد الحاسبات التشغيل وتسري كلمة سرّ الدور وبيانات المشتركين
  // والمبالغ مكشوفةً بلا سطرٍ واحدٍ في أيّ سجلّ. ورابط Railway العامّ لا يحمل sslmode بطبعه،
  // فسهوُ حرفٍ واحدٍ كان يكفي. والفرض هنا — لا وقت التسليم — كي يُخزَّن الرابط مطبَّعاً
  // فتبقى بصمته (hashUrl) مطابقةً لبرهان الحاسبة، وإلّا صار كلّ برهانٍ تالٍ مرفوضاً.
  if (u.searchParams.get("sslmode") === "disable") {
    throw new Error("رابط حاسبات المكاتب بلا تشفير — sslmode=disable مرفوض");
  }
  if (!process.env.DB_SSL_CA_B64 && !u.searchParams.get("sslmode")) {
    u.searchParams.set("sslmode", "no-verify");
  }
  u.username = roleName;
  u.password = password;
  return u.toString();
}

// حارسُ تسليم: لا يُسلَّم للمكتب رابطٌ غير مشفَّر أبداً — ولا يُعدَّل في الطريق (التعديل
// يُغيّر بصمته فيصير برهان الحاسبة التالي مرفوضاً 403 أبداً ⇒ زيارة مكتب).
// الرفض آمن: الحاسبة تُبقي رابطها القديم وتُعيد السؤال كلّ ٥ دقائق، فيكفي تصحيح العمود.
export function workerUrlIsEncrypted(url: string): boolean {
  if (process.env.DB_SSL_CA_B64) return true; // شهادةٌ صريحة تتولّى التشفير
  try {
    const m = new URL(url).searchParams.get("sslmode");
    return !!m && m !== "disable";
  } catch {
    return false;
  }
}

// يقرأ رابط دور الوكيل المخزَّن (أو null) — عمود خام
async function readStoredUrl(agentId: number): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<{ url: string | null }[]>(
    `SELECT "workerDbUrl" AS url FROM agents WHERE id = $1`, agentId,
  );
  return rows[0]?.url ?? null;
}

// بصمة رابط — بها تُثبت الحاسبة أنها تحمل رابطاً صالحاً (حالياً أو سابقاً) بلا كشفه
export function hashUrl(url: string): string {
  return crypto.createHash("sha256").update(url.trim()).digest("hex");
}

// بصمات الروابط المقبولة للوكيل: الحالي + آخر خمسة سابقة (الربط الذاتي 2026-08-02)
export async function acceptedUrlHashes(agentId: number): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ url: string | null; prev: string | null }[]>(
    `SELECT "workerDbUrl" AS url, "prevUrlHashes" AS prev FROM agents WHERE id = $1`, agentId,
  );
  const out: string[] = [];
  if (rows[0]?.url) out.push(hashUrl(rows[0].url));
  try {
    const prev = rows[0]?.prev ? (JSON.parse(rows[0].prev) as unknown) : [];
    if (Array.isArray(prev)) for (const h of prev) if (typeof h === "string") out.push(h);
  } catch { /* نص فاسد — نتجاهله */ }
  return out;
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

  // بصمة الرابط القديم تُحفظ قبل استبداله (آخر خمسة) — بها تُثبت الحاسبة التي لم تُحدَّث
  // بعدُ هويتها فتستلم الرابط الجديد وحدها بلا زيارة مكتب (الربط الذاتي 2026-08-02)
  const old = await readStoredUrl(agentId);
  const url = buildRoleUrl(roleName, password);
  if (old && old !== url) {
    const rows = await prisma.$queryRawUnsafe<{ prev: string | null }[]>(
      `SELECT "prevUrlHashes" AS prev FROM agents WHERE id = $1`, agentId,
    );
    let list: string[] = [];
    try { const p = rows[0]?.prev ? JSON.parse(rows[0].prev) : []; if (Array.isArray(p)) list = p.filter((x) => typeof x === "string"); }
    catch { list = []; }
    list = [hashUrl(old), ...list.filter((h) => h !== hashUrl(old))].slice(0, 5);
    await prisma.$executeRawUnsafe(`UPDATE agents SET "prevUrlHashes" = $1 WHERE id = $2`, JSON.stringify(list), agentId);
  }
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
