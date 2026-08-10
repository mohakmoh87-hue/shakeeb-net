import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaNeon } from "@prisma/adapter-neon";
import { getMachineId } from "@/lib/hybridAgent";
import { prisma } from "@/lib/prisma";

// ===== الربط الذاتي: الحاسبة تجلب رابط قاعدتها من الموقع (2026-08-02) =====
// الغاية: تبديل القاعدة (نقل لمزوّد آخر، أو تدوير مفتاح) بلا زيارة أي مكتب.
// المبدأ الحاكم: **لا يُعتمد رابط جديد قبل إثبات أنه يعمل** — فإن فشل الفحص يبقى
// الرابط القديم كما هو وتُعاد المحاولة لاحقاً؛ فلا تنقطع الحاسبة بسبب هذه الميزة أبداً.

const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://shakeebnet.com";
// نبضة الصحّة كل 5 دقائق **على القاعدة نفسها** — والموقع لا يُسأل إطلاقاً ما دامت
// القاعدة تستجيب. (استطلاع الموقع دورياً كان سيُبقي خادم أزور مستيقظاً ويضرب حمية الأجور.)
const HEALTH_EVERY = 5 * 60 * 1000;

function clientFor(url: string, caB64: string | null): PrismaClient {
  if (/\.neon\.tech/i.test(url)) return new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) });
  if (caB64) {
    // sslmode في الرابط يطغى على إعداد ssl الصريح — يُحذف عند تمرير الشهادة (نفس منطق lib/prisma)
    const cs = new URL(url);
    cs.searchParams.delete("sslmode");
    return new PrismaClient({
      adapter: new PrismaPg({
        connectionString: cs.toString(),
        ssl: { ca: Buffer.from(caB64, "base64").toString("utf8"), rejectUnauthorized: true },
        max: 1,
      }),
    });
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) });
}

// فحص رابط: هل يتصل ويستجيب فعلاً؟
export async function testDbUrl(url: string, caB64: string | null): Promise<boolean> {
  let c: PrismaClient | null = null;
  try {
    c = clientFor(url, caB64);
    await c.$queryRawUnsafe("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    if (c) await c.$disconnect().catch(() => {});
  }
}

// كتابة الإعدادات الجديدة مع الإبقاء على بقية الأسطر (AUTH_SECRET/MACHINE_ID/…)
// ونسخة احتياطية .env.bak قبل أي تعديل
function writeEnv(url: string, caB64: string | null): void {
  const p = path.resolve(".env");
  const keep = fs.existsSync(p)
    ? fs.readFileSync(p, "utf8").split(/\r?\n/).filter((l) => l.trim() && !/^\s*(DATABASE_URL|DB_SSL_CA_B64)\s*=/.test(l))
    : [];
  const lines = [`DATABASE_URL=${url}`, ...(caB64 ? [`DB_SSL_CA_B64=${caB64}`] : []), ...keep];
  if (fs.existsSync(p)) fs.copyFileSync(p, `${p}.bak`);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, `${lines.join("\r\n")}\r\n`, "utf8");
  try { fs.renameSync(tmp, p); } catch { fs.rmSync(p, { force: true }); fs.renameSync(tmp, p); }
}

// يسأل الموقع عن إعداداته الحالية ببرهان أنه يحمل رابطاً صالحاً (بصمة لا الرابط نفسه)
async function fetchConfig(): Promise<{ databaseUrl: string; caB64: string | null } | null> {
  const machineId = getMachineId();
  const current = (process.env.DATABASE_URL ?? "").trim();
  if (!machineId || !current) return null;
  const proof = crypto.createHash("sha256").update(current).digest("hex");
  try {
    const r = await fetch(`${SITE_ORIGIN}/api/hybrid/worker-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machineId, proof }),
    });
    if (!r.ok) {
      console.log(`[self-config] الموقع رفض الطلب (${r.status}) — يبقى الرابط الحالي`);
      return null;
    }
    const d = (await r.json()) as { databaseUrl?: unknown; caB64?: unknown };
    const url = typeof d.databaseUrl === "string" ? d.databaseUrl.trim() : "";
    if (!url) return null;
    return { databaseUrl: url, caB64: typeof d.caB64 === "string" ? d.caB64 : null };
  } catch (e) {
    console.log(`[self-config] تعذّر سؤال الموقع: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

// المزامنة: يجلب، يقارن، يفحص الجديد، ثم يكتب. "updated" تعني: أعِد تشغيل العملية.
export async function syncWorkerConfig(): Promise<"unchanged" | "updated" | "failed"> {
  const current = (process.env.DATABASE_URL ?? "").trim();
  const cfg = await fetchConfig();
  if (!cfg) return "failed";
  if (cfg.databaseUrl === current) return "unchanged";

  // ===== جواب الموقع هو الحُكم في الشهادة — بلا رجوعٍ إلى المزروع (إصلاح 2026-08-10) =====
  // كان: (cfg.caB64 ?? process.env.DB_SSL_CA_B64) — فلو نُقلت القاعدة إلى مزوّدٍ **لا يحتاج
  // شهادةً** (وهو ما حدث في النقل إلى Railway: شهادةٌ موقَّعةٌ ذاتيّاً والرابط يحمل
  // sslmode=no-verify) أجاب الموقع null فرجعت الحاسبة إلى شهادة المزوّد **القديم** وفحصت
  // الرابط الجديد بها مع rejectUnauthorized: true ⇒ يفشل الفحص دائماً ⇒ «أُبقي القديم» ⇒
  // الحاسبة لا تنتقل أبداً ويلزم زيارة كلّ مكتبٍ بيدك — وهو عين ما بُنيت الميزة لتمنعه.
  // الموقع يعرف قاعدته التي يُسلّم رابطها، فشهادته (أو خلوّها) هي الصحيحة دائماً.
  const ca = cfg.caB64;
  // بلا شهادةٍ **وبلا** sslmode ⇒ الاتصال نصٌّ صريح على الإنترنت العامّ، ومع ذلك **ينجح**
  // فيمرّ الفحص. نرفضه هنا ولا نُعدّله (تعديل الرابط يُغيّر بصمته فيُرفض برهاننا التالي أبداً).
  if (!ca) {
    let mode: string | null = null;
    try { mode = new URL(cfg.databaseUrl).searchParams.get("sslmode"); } catch { /* رابط فاسد */ }
    if (!mode || mode === "disable") {
      console.error("[self-config] ✗ الرابط الوارد بلا تشفير — لم يُعتمد، أُبقي القديم");
      return "failed";
    }
  }
  console.log(`[self-config] وصل رابط قاعدة جديد (${ca ? "بشهادة" : "بلا شهادة"}) — فحصه قبل اعتماده...`);
  if (!(await testDbUrl(cfg.databaseUrl, ca))) {
    console.error("[self-config] ✗ الرابط الجديد لم يعمل — أُبقي القديم وأُعيد المحاولة لاحقاً");
    return "failed";
  }
  writeEnv(cfg.databaseUrl, ca);
  console.log("[self-config] ✓ اعتُمد الرابط الجديد (نسخة احتياطية .env.bak) — إعادة تشغيل");
  return "updated";
}

// هل اتصال العامل الفعلي بالقاعدة يعمل؟ (نفس العميل الذي تستعمله كل الخدمات)
async function dbAlive(): Promise<boolean> {
  try { await prisma.$queryRawUnsafe("SELECT 1"); return true; } catch { return false; }
}

// فحص الإقلاع: إن كانت القاعدة تستجيب نكمل؛ وإلا نطلب الرابط الجديد ونعيد التشغيل عند نجاحه
export async function bootConfigCheck(): Promise<"ok" | "restart"> {
  if (await dbAlive()) return "ok";
  console.log("[self-config] القاعدة لا تستجيب عند الإقلاع — سؤال الموقع عن الرابط الجديد...");
  return (await syncWorkerConfig()) === "updated" ? "restart" : "ok";
}

// مراقب الصحّة: يجسّ القاعدة كل 5 دقائق. سليمة ⇒ لا شيء (صفر طلبات على الموقع).
// متعثّرة ⇒ يسأل الموقع مرة؛ فإن تبدّل الرابط اعتمده وأعاد التشغيل، وإلا أبقى القديم.
// وهذا يغطي النقل أيضاً: يكفي إغلاق دخول الدور القديم لحظة التبديل فتلتقط الحاسبات خلال 5 دقائق.
export function startConfigWatcher(onUpdated: () => void): void {
  setInterval(() => {
    void (async () => {
      if (await dbAlive()) return;
      console.log("[self-config] القاعدة لا تستجيب — سؤال الموقع...");
      if ((await syncWorkerConfig()) === "updated") onUpdated();
    })();
  }, HEALTH_EVERY);
}
