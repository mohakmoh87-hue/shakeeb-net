// يحدّد الرابط العام الحقيقي للموقع (لأوامر تنصيب حاسبة المكتب وجلب إعداداتها).
// خلف بروكسي (Cloudflare/Azure Container Apps) يكون new URL(request.url).host هو العنوان
// الداخلي للحاوية (0.0.0.0:8080) لا الدومين العام — فلا يصلح لأمر يُشغَّل على حاسبة المكتب.
// الأولوية: (1) APP_BASE_URL الصريح، (2) ترويسات البروكسي X-Forwarded-*/Host، (3) request.url.
export function publicOrigin(request: Request): string {
  const env = (process.env.APP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (env) return /^https?:\/\//i.test(env) ? env : `https://${env}`;

  const h = request.headers;
  const fwdHost = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  // نتجاهل العنوان الداخلي إن ظهر في الترويسة أيضاً
  if (fwdHost && !/^0\.0\.0\.0|^localhost|^127\.0\.0\.1/i.test(fwdHost)) {
    const proto = (h.get("x-forwarded-proto") ?? "https").split(",")[0].trim();
    return `${proto}://${fwdHost}`;
  }

  const u = new URL(request.url);
  return `${u.protocol}//${u.host}`;
}
