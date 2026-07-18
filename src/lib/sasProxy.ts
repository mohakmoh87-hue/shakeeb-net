import { fetch as undiciFetch, Agent } from "undici";

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

// حماية SSRF: يمنع البروكسي (على Vercel) من الاتصال بعناوين داخلية/محلية.
// لا يؤثّر على العامل المحلي (خادم SAS المحلي مسار منفصل)، ولا على لوحات SAS العامة.
function isBlockedHost(host: string): boolean {
  const h = host.replace(/:\d+$/, "").trim().toLowerCase(); // إزالة المنفذ
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false; // اسم مضيف (ليس IP) — يُسمح (لوحات SAS تُعرَّف عادةً بـ IP عام)
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 0 || a === 10) return true;               // loopback / هذا المضيف / خاص
  if (a === 169 && b === 254) return true;                          // link-local (بيانات السحابة الوصفية)
  if (a === 192 && b === 168) return true;                          // خاص
  if (a === 172 && b >= 16 && b <= 31) return true;                 // خاص
  if (a === 100 && b >= 64 && b <= 127) return true;                // CGNAT
  return false;
}

// معالج بروكسي مشترك للوحة SAS4
export async function proxyToSas(
  request: Request,
  host: string,
  upstreamPath: string,
  basePrefix?: string, // للـ HTML: يُعاد كتابة <base href> إلى هذه البادئة
  onJsonBody?: (text: string) => void, // التقاط جسم JSON (مثل قائمة المستخدمين)
): Promise<Response> {
  if (isBlockedHost(host)) return new Response("blocked host", { status: 403 });
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
