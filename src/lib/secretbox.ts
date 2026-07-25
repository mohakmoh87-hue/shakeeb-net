import crypto from "crypto";

// تشفير الأسرار «القابلة للعرض» عند التخزين (كلمات سرّ المدراء المعروضة للمالك، رموز
// الفنيين المعروضة للمدير). ليست للمصادقة — الدخول يعتمد على bcrypt hash منفصل — بل
// لتمكين المالك/المدير من رؤية البيانات لإبلاغها. الهدف: لو تسرّبت نسخة القاعدة وحدها
// (بلا مفتاح CREDS_ENC_KEY) لا تنكشف هذه الأسرار.
//
// AES-256-GCM. الصيغة المخزّنة: "enc:v1:<iv>:<tag>:<نصّ مشفّر>" (كلها base64).
// تدهور آمن: بلا مفتاح تُعاد القيمة كما هي (سلوك مطابق للسابق، بلا كسر). والفكّ يتوافق
// مع القيم القديمة النصّية (بلا البادئة) فيعيدها كما هي.

const PREFIX = "enc:v1:";

// مفتاح 32 بايت مشتقّ من متغيّر البيئة (أي نصّ يُقبل — نشتقّ منه SHA-256 بطول ثابت).
function key(): Buffer | null {
  const k = process.env.CREDS_ENC_KEY;
  if (!k) return null;
  return crypto.createHash("sha256").update(k, "utf8").digest();
}

// هل القيمة مشفّرة أصلاً (لتفادي إعادة تشفير أثناء الترحيل)
export function isEncrypted(v: string | null | undefined): boolean {
  return typeof v === "string" && v.startsWith(PREFIX);
}

// يشفّر سرّاً نصّياً للتخزين. بلا مفتاح → يُعيد النصّ كما هو. القيمة الفارغة/الغائبة كما هي.
export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return plain ?? null;
  if (isEncrypted(plain)) return plain; // مشفّرة مسبقاً
  const k = key();
  if (!k) return plain; // لا مفتاح → سلوك كالسابق (تخزين نصّي)
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, ct].map((b) => b.toString("base64")).join(":");
}

// يفكّ سرّاً مخزّناً للعرض. القيم القديمة النصّية (بلا بادئة) تُعاد كما هي. المشفّرة بلا
// مفتاح متاح أو بفشل الفكّ → null (يعرضها الواجهة كـ«غير متاحة» بدل كسر الطلب).
export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored == null || stored === "") return stored ?? null;
  if (!isEncrypted(stored)) return stored; // قيمة قديمة نصّية
  const k = key();
  if (!k) return null;
  try {
    const [ivB, tagB, ctB] = stored.slice(PREFIX.length).split(":");
    const iv = Buffer.from(ivB, "base64");
    const tag = Buffer.from(tagB, "base64");
    const ct = Buffer.from(ctB, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", k, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
