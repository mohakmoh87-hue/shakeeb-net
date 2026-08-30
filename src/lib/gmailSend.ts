type OAuthCreds = { clientId: string; clientSecret: string; refreshToken: string };

function readGmailOAuth(): OAuthCreds | null {
  const clientId = (process.env.GMAIL_OAUTH_CLIENT_ID ?? process.env.GDRIVE_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.GMAIL_OAUTH_CLIENT_SECRET ?? process.env.GDRIVE_OAUTH_CLIENT_SECRET ?? "").trim();
  const refreshToken = (process.env.GMAIL_REFRESH_TOKEN ?? "").trim();
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null;
}

export function gmailConfigured(): boolean {
  return !!readGmailOAuth();
}

export async function gmailReady(): Promise<boolean> {
  const o = readGmailOAuth();
  if (!o) return false;
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: o.refreshToken,
        client_id: o.clientId,
        client_secret: o.clientSecret,
      }).toString(),
    });
    const d = (await r.json().catch(() => ({}))) as { access_token?: string; scope?: string };
    if (!r.ok || !d.access_token) return false;
    const scope = typeof d.scope === "string" ? d.scope : "";
    return scope.includes("gmail.send") || scope.includes("mail.google.com") || scope.includes("gmail.modify");
  } catch {
    return false;
  }
}

async function accessTokenFromRefresh(o: OAuthCreds): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: o.refreshToken,
      client_id: o.clientId,
      client_secret: o.clientSecret,
    }).toString(),
  });
  const d = (await r.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
  if (!r.ok || !d.access_token) throw new Error(`رمز تحديث Gmail رُفض: ${d.error_description ?? d.error ?? r.status}`);
  return d.access_token;
}

const b64 = (b: Buffer | string) => (typeof b === "string" ? Buffer.from(b, "utf8") : b).toString("base64");
const b64url = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const wrap76 = (s: string) => (s.match(/.{1,76}/g) ?? [s]).join("\r\n");

export type MailAttachment = { filename: string; content: Buffer; contentType: string };
export type MailInput = { to: string; subject: string; text: string; attachments?: MailAttachment[] };

function buildMime(m: MailInput): string {
  const boundary = "shakeeb_gm_boundary_9f2c7a1e";
  const p: string[] = [];
  p.push(`To: ${m.to}`);
  p.push(`Subject: =?UTF-8?B?${b64(m.subject)}?=`);
  p.push("MIME-Version: 1.0");
  p.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  p.push("");
  p.push(`--${boundary}`);
  p.push('Content-Type: text/plain; charset="UTF-8"');
  p.push("Content-Transfer-Encoding: base64");
  p.push("");
  p.push(wrap76(b64(m.text)));
  for (const a of m.attachments ?? []) {
    p.push(`--${boundary}`);
    p.push(`Content-Type: ${a.contentType}; name="${a.filename}"`);
    p.push("Content-Transfer-Encoding: base64");
    p.push(`Content-Disposition: attachment; filename="${a.filename}"`);
    p.push("");
    p.push(wrap76(a.content.toString("base64")));
  }
  p.push(`--${boundary}--`);
  return p.join("\r\n");
}

const GMAIL_MAX_ATTACH = 24 * 1024 * 1024;

export async function sendGmail(m: MailInput): Promise<{ ok: boolean; error?: string }> {
  const o = readGmailOAuth();
  if (!o) return { ok: false, error: "Gmail غير مهيّأ" };
  const attBytes = (m.attachments ?? []).reduce((n, a) => n + a.content.length, 0);
  if (attBytes > GMAIL_MAX_ATTACH) return { ok: false, error: `المرفق ${(attBytes / 1048576).toFixed(1)}م.ب أكبر من حدّ Gmail` };
  try {
    const token = await accessTokenFromRefresh(o);
    const raw = b64url(b64(buildMime(m)));
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      return { ok: false, error: d.error?.message ?? `Gmail HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
