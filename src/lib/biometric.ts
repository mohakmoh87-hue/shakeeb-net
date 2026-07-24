// تأكيد البصمة ببصمة الهاتف الحقيقية (WebAuthn) مع **تحقق خادمي**.
// الخادم يُصدر التحدّي ويتحقق من التوقيع بالمفتاح العام المخزَّن — لا يُصدَّق العميل وحده.
// أول استخدام لكل فني (أو بعد مسح المدير) = تسجيل يلتقط المفتاح العام؛ ثم كل مرة = مصادقة مُتحقَّقة.
// جهاز بلا مستشعر بصمة → "unsupported" (لا يُعطَّل الحضور في هذه المرحلة).
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

export type BioResult = "ok" | "unsupported" | "failed";

async function post(action: string, extra?: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const r = await fetch("/api/field/biometric", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }),
    });
    return { ok: r.ok, data: await r.json().catch(() => ({})) };
  } catch { return { ok: false, data: {} }; }
}

// تسجيل بصمة جديدة على هذا الجهاز: خيارات من الخادم ← لمس المستشعر ← تحقق خادمي يخزّن المفتاح العام
async function doRegister(): Promise<BioResult> {
  const opt = await post("reg-options");
  const options = opt.data?.options as PublicKeyCredentialCreationOptionsJSON | undefined;
  if (!opt.ok || !options) return "failed";
  let att;
  try { att = await startRegistration({ optionsJSON: options }); } catch { return "failed"; }
  const ver = await post("reg-verify", { response: att });
  return ver.ok && ver.data?.ok === true ? "ok" : "failed";
}

// تأكيد ببصمة مُسجَّلة: خيارات من الخادم ← لمس المستشعر ← تحقق خادمي بالتوقيع
async function doAuth(): Promise<BioResult> {
  const opt = await post("auth-options");
  const options = opt.data?.options as PublicKeyCredentialRequestOptionsJSON | undefined;
  if (!opt.ok || !options) return "failed";
  let asr;
  try { asr = await startAuthentication({ optionsJSON: options }); } catch { return "failed"; }
  const ver = await post("auth-verify", { response: asr });
  return ver.ok && ver.data?.verified === true ? "ok" : "failed";
}

function unsupported(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential || !navigator.credentials) return Promise.resolve(true);
  return (window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.() ?? Promise.resolve(false))
    .then((a) => !a).catch(() => true);
}

// يُطلق مستشعر بصمة الهاتف مع تحقق خادمي. "ok" نجاح، "unsupported" جهاز بلا مستشعر، "failed" رفض/فشل.
export async function bioConfirm(_techName?: string): Promise<BioResult> {
  try {
    if (await unsupported()) return "unsupported";
    // مُسجَّل خادمياً؟ (يملك مفتاحاً عاماً) → مصادقة؛ وإلا (جديد أو تسجيل قديم بلا مفتاح) → تسجيل
    const status = await fetch("/api/field/biometric").then((r) => (r.ok ? r.json() : { registered: false })).catch(() => ({ registered: false }));
    return status?.registered ? doAuth() : doRegister();
  } catch { return "failed"; }
}

// إعادة تسجيل البصمة على هذا الجهاز (تبديل هاتف/إعادة ضبط) — يستبدل المُسجَّل بمفتاح جديد.
export async function bioReRegister(_techName?: string): Promise<BioResult> {
  try {
    if (await unsupported()) return "unsupported";
    return doRegister();
  } catch { return "failed"; }
}
