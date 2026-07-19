import { fetch as undiciFetch, Agent } from "undici";
import { lookup } from "node:dns/promises";

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

// هل العنوان (IP) داخليّ/خاص يجب حجبه؟ (IPv4 نطاقات خاصة + بيانات السحابة الوصفية + CGNAT؛ IPv6 محلي)
function isBlockedIp(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) {
    const h = ip.toLowerCase();
    return h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80"); // loopback/ULA/link-local
  }
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 0 || a === 10) return true;               // loopback / هذا المضيف / خاص
  if (a === 169 && b === 254) return true;                          // link-local (بيانات السحابة الوصفية)
  if (a === 192 && b === 168) return true;                          // خاص
  if (a === 172 && b >= 16 && b <= 31) return true;                 // خاص
  if (a === 100 && b >= 64 && b <= 127) return true;                // CGNAT
  return false;
}

// حماية SSRF: يمنع البروكسي (على Vercel) من الاتصال بعناوين داخلية/محلية — للـIP الحرفي وللأسماء
// بعد ترجمتها (DNS) كي لا يُخدَع باسمٍ يُترجم لعنوان داخلي. لا يؤثّر على العامل المحلي (مسار منفصل)
// ولا على لوحات SAS العامة (IP عام حرفي أو اسم يُترجم لعنوان عام يمرّ كما هو).
async function isBlockedHost(host: string): Promise<boolean> {
  const h = host.replace(/:\d+$/, "").trim().toLowerCase(); // إزالة المنفذ
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  // IP حرفي (IPv4 أو IPv6): افحصه مباشرةً — العناوين العامة تمرّ
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":")) return isBlockedIp(h);
  // اسم مضيف: ترجمه واحجب إن ترجم لأي عنوان داخلي؛ وفشل الترجمة ⇒ حجب احتياطاً (fail-closed)
  try {
    const addrs = await lookup(h, { all: true });
    return addrs.length === 0 || addrs.some((x) => isBlockedIp(x.address));
  } catch {
    return true;
  }
}

// حماية SSRF لمسارات الجلب المباشر (/sas4/token, /sas4/fetch, التفعيل): يستخرج مضيف SAS من
// رابط دخول المكتب ويفحصه بنفس قاعدة البروكسي — يمرّر IP العام (لوحات SAS) ويحجب الداخلي/المحلي.
// سلوك مطابق للبروكسي المُطبَّق أصلاً على العامل المحلي، فلا يمسّ SAS المحلي (IP عام) ولا السحابي.
export async function sasHostBlocked(loginUrl: string | null | undefined): Promise<boolean> {
  if (!loginUrl) return false;
  const host = loginUrl.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/#.*$/, "").trim();
  if (!host) return false;
  return isBlockedHost(host);
}

// معالج بروكسي مشترك للوحة SAS4
export async function proxyToSas(
  request: Request,
  host: string,
  upstreamPath: string,
  basePrefix?: string, // للـ HTML: يُعاد كتابة <base href> إلى هذه البادئة
  onJsonBody?: (text: string) => void, // التقاط جسم JSON (مثل قائمة المستخدمين)
): Promise<Response> {
  if (await isBlockedHost(host)) return new Response("blocked host", { status: 403 });
  const url = new URL(request.url);
  const target = `https://${host}/${upstreamPath}${url.search}`;

  const headers: Record<string, string> = {};
  const auth = request.headers.get("authorization");
  if (auth) headers["authorization"] = auth;
  const ct = request.headers.get("content-type");
  if (ct) headers["content-type"] = ct;
  const accept = request.headers.get("accept");
  if (accept) headers["accept"] = accept;

  const method = request.method;
  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : Buffer.from(await request.arrayBuffer());

  let upstream: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    upstream = await undiciFetch(target, {
      method,
      headers,
      body,
      redirect: "manual",
      dispatcher: insecureAgent,
    });
  } catch {
    return new Response("SAS4 upstream error", { status: 502 });
  }

  const upCT = upstream.headers.get("content-type") ?? "";

  if (basePrefix && upCT.includes("text/html")) {
    let html = await upstream.text();
    html = html.replace(/<base href="\/">/i, `<base href="${basePrefix}">`);
    return new Response(html, {
      status: upstream.status,
      headers: { "content-type": upCT },
    });
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  if (onJsonBody && upCT.includes("application/json")) {
    try { onJsonBody(buf.toString("utf8")); } catch { /* ignore */ }
  }
  const respHeaders: Record<string, string> = { "content-type": upCT };
  const cc = upstream.headers.get("cache-control");
  if (cc) respHeaders["cache-control"] = cc;
  return new Response(buf, { status: upstream.status, headers: respHeaders });
}
