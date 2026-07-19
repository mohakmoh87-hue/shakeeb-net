// تأكيد البصمة ببصمة الهاتف الحقيقية (WebAuthn platform authenticator).
// تسجيل مرّة على الجهاز ثم تحقّق كل مرّة؛ إن كان الجهاز لا يدعم البصمة يُسمح بلا تأكيد (fallback).

export type BioResult = "ok" | "unsupported" | "failed";

const b64uToBuf = (s: string): ArrayBuffer => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
};
const bufToB64u = (b: ArrayBuffer): string => {
  const bytes = new Uint8Array(b);
  let s = "";
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function register(name: string): Promise<string | null> {
  const challenge = crypto.getRandomValues(new Uint8Array(16));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "SHAKEEB", id: location.hostname },
      user: { id: userId, name: name || "technician", displayName: name || "الفني" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  return cred ? bufToB64u(cred.rawId) : null;
}

async function assertBio(credId: string): Promise<boolean> {
  const challenge = crypto.getRandomValues(new Uint8Array(16));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: location.hostname,
      allowCredentials: [{ id: b64uToBuf(credId), type: "public-key" }],
      userVerification: "required",
      timeout: 60000,
    },
  });
  return !!assertion;
}

async function saveCredId(credId: string) {
  await fetch("/api/field/biometric", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credId }) });
}

// يُطلق مستشعر بصمة الهاتف الحقيقي. يعيد "ok" عند النجاح، "unsupported" إن لم يدعمه الجهاز، "failed" إن رفض/فشل.
export async function bioConfirm(techName: string): Promise<BioResult> {
  try {
    if (typeof window === "undefined" || !window.PublicKeyCredential || !navigator.credentials) return "unsupported";
    const avail = await (window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.() ?? Promise.resolve(false)).catch(() => false);
    if (!avail) return "unsupported";
    const { credId } = await fetch("/api/field/biometric").then((r) => (r.ok ? r.json() : { credId: null })).catch(() => ({ credId: null }));
    if (credId) {
      try { return (await assertBio(credId)) ? "ok" : "failed"; } catch { return "failed"; }
    }
    const newId = await register(techName);
    if (!newId) return "failed";
    await saveCredId(newId);
    return "ok";
  } catch { return "failed"; }
}

// إعادة تسجيل البصمة على جهازٍ جديد (يستبدل المعرّف المخزَّن).
export async function bioReRegister(techName: string): Promise<BioResult> {
  try {
    if (typeof window === "undefined" || !window.PublicKeyCredential || !navigator.credentials) return "unsupported";
    const newId = await register(techName);
    if (!newId) return "failed";
    await saveCredId(newId);
    return "ok";
  } catch { return "failed"; }
}
