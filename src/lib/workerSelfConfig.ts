import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaNeon } from "@prisma/adapter-neon";
import { getMachineId } from "@/lib/hybridAgent";

// ===== الربط الذاتي: الحاسبة تجلب رابط قاعدتها من الموقع (2026-08-02) =====
// الغاية: تبديل القاعدة (نقل لمزوّد آخر، أو تدوير مفتاح) بلا زيارة أي مكتب.
// المبدأ الحاكم: **لا يُعتمد رابط جديد قبل إثبات أنه يعمل** — فإن فشل الفحص يبقى
// الرابط القديم كما هو وتُعاد المحاولة لاحقاً؛ فلا تنقطع الحاسبة بسبب هذه الميزة أبداً.

const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://shakeebnet.com";
const CHECK_EVERY = 30 * 60 * 1000; // فحص دوري كل نصف ساعة — يلتقط التبديل المخطَّط ولو بقي القديم يعمل

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

  console.log("[self-config] وصل رابط قاعدة جديد — فحصه قبل اعتماده...");
  if (!(await testDbUrl(cfg.databaseUrl, cfg.caB64 ?? process.env.DB_SSL_CA_B64 ?? null))) {
    console.error("[self-config] ✗ الرابط الجديد لم يعمل — أُبقي القديم وأُعيد المحاولة لاحقاً");
    return "failed";
  }
  writeEnv(cfg.databaseUrl, cfg.caB64 ?? process.env.DB_SSL_CA_B64 ?? null);
  console.log("[self-config] ✓ اعتُمد الرابط الجديد (نسخة احتياطية .env.bak) — إعادة تشغيل");
  return "updated";
}

// فحص الإقلاع: إن كان الرابط الحالي يعمل نكمل؛ وإلا نطلب الجديد ونعيد التشغيل عند نجاحه
export async function bootConfigCheck(): Promise<"ok" | "restart"> {
  const current = (process.env.DATABASE_URL ?? "").trim();
  const ca = process.env.DB_SSL_CA_B64 ?? null;
  if (current && (await testDbUrl(current, ca))) return "ok";
  console.log("[self-config] رابط القاعدة الحالي لا يعمل — سؤال الموقع عن الجديد...");
  return (await syncWorkerConfig()) === "updated" ? "restart" : "ok";
}

// مراقب دوري: يلتقط التبديل المخطَّط حتى لو بقي الرابط القديم صالحاً (حالة النقل مع
// إبقاء القاعدة القديمة حيّة أسبوعاً) — طلب واحد خفيف كل نصف ساعة
export function startConfigWatcher(onUpdated: () => void): void {
  setInterval(() => {
    void syncWorkerConfig().then((r) => { if (r === "updated") onUpdated(); });
  }, CHECK_EVERY);
}
