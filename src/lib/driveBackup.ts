import { createSign } from "node:crypto";

// ═════ ☁️ نسخة المالك الكاملة إلى Google Drive (قرار محمد 2026-08-20) ═════
// Railway يحجب SMTP نهائيّاً فالبريدُ من الموقع مستحيل — أمّا HTTPS فمفتوح، وواجهةُ
// درايف كلُّها HTTPS ⇒ الموقعُ يرفع النسخةَ بنفسه بلا كرونٍ ولا بريد.
// ═════ 🔴 المصادقة برمز تحديث حساب محمد لا بحساب الخدمة (قِيس حيّاً 2026-08-21) ═════
// أوّلُ رفعةٍ فشلت بنصّ غوغل الحرفيّ: «Service Accounts do not have storage quota» —
// غوغل ألغت مساحةَ حسابات الخدمة نهائيّاً، وحلّاها (Shared Drives / Delegation) كلاهما
// يتطلّب Workspace مدفوعاً. ⇒ الرفعُ بهويّة **حساب محمد نفسِه** (مالكِ المجلّد ومساحتِه
// 15GB) عبر OAuth refresh token يُصنع مرّةً واحدةً ولا يبلى (التطبيق «In production»).
// البيئة (الأحدثُ يغلب):
//   GDRIVE_OAUTH_CLIENT_ID / GDRIVE_OAUTH_CLIENT_SECRET / GDRIVE_REFRESH_TOKEN  ← المعتمد
//   GDRIVE_SA_B64  ← مسار حساب الخدمة القديم (يبقى سقوطاً لو أعادت غوغل المساحةَ يوماً)
//   GDRIVE_FOLDER_ID = معرّف مجلّد ShakeebNet-Backups
// غيابُ التهيئة = خمولٌ هادئ (configured() ترجع false ولا يُحجَز يومٌ فتبدأ فورَ التهيئة).

const KEEP_COPIES = 30; // تدويرٌ تلقائيّ: تبقى أحدثُ ٣٠ نسخةً وتُحذف الأقدم (~200MB سقفاً)

type SA = { client_email: string; private_key: string };

function readSA(): SA | null {
  const b64 = process.env.GDRIVE_SA_B64;
  if (!b64) return null;
  try {
    const j = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as SA;
    return j.client_email && j.private_key ? j : null;
  } catch { return null; }
}

type OAuthCreds = { clientId: string; clientSecret: string; refreshToken: string };
function readOAuth(): OAuthCreds | null {
  const clientId = (process.env.GDRIVE_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.GDRIVE_OAUTH_CLIENT_SECRET ?? "").trim();
  const refreshToken = (process.env.GDRIVE_REFRESH_TOKEN ?? "").trim();
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null;
}

export function driveConfigured(): boolean {
  return !!((readOAuth() ?? readSA()) && process.env.GDRIVE_FOLDER_ID);
}

const b64url = (s: Buffer | string) =>
  (typeof s === "string" ? Buffer.from(s) : s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// رمزُ وصولٍ من رمز التحديث (هويّةُ حساب محمد) — طازجٌ لكلّ رفعةٍ يوميّة (أبسط من كاش)
async function accessTokenFromRefresh(o: OAuthCreds): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token", refresh_token: o.refreshToken,
      client_id: o.clientId, client_secret: o.clientSecret,
    }).toString(),
  });
  const d = (await r.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
  if (!r.ok || !d.access_token) throw new Error(`رمز تحديث درايف رُفض: ${d.error_description ?? d.error ?? r.status}`);
  return d.access_token;
}

// رمزُ وصولٍ من JWT حساب الخدمة — يكفي لساعة، ونطلبه طازجاً لكلّ رفعةٍ يوميّة (أبسط من كاش)
async function accessToken(sa: SA): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(sa.private_key))}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  const d = (await r.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
  if (!r.ok || !d.access_token) throw new Error(`رمز درايف رُفض: ${d.error_description ?? d.error ?? r.status}`);
  return d.access_token;
}

// رفع الملف إلى المجلّد + تدوير القديم. يرمي خطأً عربيّاً واضحاً عند أيّ فشل.
export async function uploadBackupToDrive(gz: Buffer, filename: string): Promise<{ fileId: string; rotatedOut: number }> {
  const oauth = readOAuth();
  const sa = readSA();
  const folderId = process.env.GDRIVE_FOLDER_ID;
  if ((!oauth && !sa) || !folderId) throw new Error("درايف غير مهيّأ (GDRIVE_REFRESH_TOKEN أو GDRIVE_SA_B64 / GDRIVE_FOLDER_ID)");
  // هويّةُ حساب محمد أوّلاً — حسابُ الخدمة بلا مساحةٍ منذ قرار غوغل (انظر رأس الملفّ)
  const token = oauth ? await accessTokenFromRefresh(oauth) : await accessToken(sa!);
  const auth = { Authorization: `Bearer ${token}` };

  // رفعٌ متعدّد الأجزاء: البياناتُ الوصفيّة (الاسم والمجلّد) + المحتوى في طلبٍ واحد
  const boundary = "shakeeb-backup-boundary";
  const meta = JSON.stringify({ name: filename, parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`),
    gz,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const up = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST", headers: { ...auth, "Content-Type": `multipart/related; boundary=${boundary}` },
    body: new Uint8Array(body),
  });
  const ud = (await up.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!up.ok || !ud.id) throw new Error(`رفعُ درايف فشل: ${ud.error?.message ?? up.status}`);

  // التدوير: أحدثُ KEEP_COPIES تبقى — والحذفُ لنسخنا نحن فقط (بادئة الاسم)، أفضلُ جهدٍ
  let rotatedOut = 0;
  try {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false and name contains 'shakeeb-full-'`);
    const ls = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&pageSize=100&fields=files(id,name)`, { headers: auth });
    const ld = (await ls.json().catch(() => ({}))) as { files?: { id: string; name: string }[] };
    for (const f of (ld.files ?? []).slice(KEEP_COPIES)) {
      const del = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, { method: "DELETE", headers: auth });
      if (del.ok) rotatedOut++;
    }
  } catch (e) {
    console.warn("[drive-backup] تعذّر التدوير (الرفعُ نفسُه نجح):", e instanceof Error ? e.message : e);
  }
  return { fileId: ud.id, rotatedOut };
}
