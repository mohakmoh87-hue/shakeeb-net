// التحقق الخادمي من بصمة الفني (WebAuthn / @simplewebauthn).
// الخادم يُصدر التحدّي ويتحقق من التوقيع بالمفتاح العام المخزَّن — فلا يُصدَّق العميل وحده.
// يشتقّ rpID/origin من مضيف الطلب العام (خلف Cloudflare/Azure) عبر publicOrigin.
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { publicOrigin } from "@/lib/publicOrigin";

const RP_NAME = "SHAKEEB";
// صلاحية التحدّي: نافذة قصيرة بين طلب الخيارات وإرسال الرد (يشمل لمس المستشعر)
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// rpID = اسم المضيف العام (مثل shakeebnet.com)، origin = https://shakeebnet.com
export function rpFromRequest(request: Request): { origin: string; rpID: string } {
  const origin = publicOrigin(request);
  return { origin, rpID: new URL(origin).hostname };
}

// خيارات التسجيل (إنشاء بصمة جديدة على هذا الجهاز). challenge يُخزَّن ليُتحقق منه لاحقاً.
export async function regOptions(request: Request, techName: string) {
  const { rpID } = rpFromRequest(request);
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: techName || "technician",
    attestationType: "none", // لا نحتاج شهادة المُصنِّع — يكفي التحقق من الحيازة والمستخدم
    authenticatorSelection: {
      authenticatorAttachment: "platform", // بصمة/وجه الهاتف نفسه
      userVerification: "required",
      residentKey: "preferred",
    },
  });
}

// تحقق من رد التسجيل → يعيد المعرّف والمفتاح العام (base64url) والعدّاد لتخزينها، أو null إن فشل.
export async function regVerify(
  request: Request,
  response: RegistrationResponseJSON,
  expectedChallenge: string,
): Promise<{ credId: string; publicKey: string; counter: number } | null> {
  const { origin, rpID } = rpFromRequest(request);
  let v;
  try {
    v = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
  } catch {
    return null;
  }
  if (!v.verified || !v.registrationInfo) return null;
  const c = v.registrationInfo.credential;
  return { credId: c.id, publicKey: isoBase64URL.fromBuffer(c.publicKey), counter: c.counter };
}

// خيارات المصادقة (تأكيد ببصمة مُسجَّلة مسبقاً). challenge يُخزَّن.
export async function authOptions(request: Request, credId: string) {
  const { rpID } = rpFromRequest(request);
  return generateAuthenticationOptions({
    rpID,
    allowCredentials: [{ id: credId }],
    userVerification: "required",
  });
}

// تحقق من رد المصادقة بالمفتاح العام المخزَّن → يعيد العدّاد الجديد، أو null إن فشل.
export async function authVerify(
  request: Request,
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  cred: { credId: string; publicKey: string; counter: number },
): Promise<{ newCounter: number } | null> {
  const { origin, rpID } = rpFromRequest(request);
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: cred.credId, publicKey: isoBase64URL.toBuffer(cred.publicKey), counter: cred.counter },
    });
  } catch {
    return null;
  }
  if (!v.verified) return null;
  return { newCounter: v.authenticationInfo.newCounter };
}
