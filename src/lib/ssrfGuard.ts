import { lookup } from "node:dns/promises";

// هل العنوان (IP) داخليّ/خاص يجب حجبه؟ (IPv4 نطاقات خاصة + بيانات السحابة الوصفية + CGNAT؛ IPv6 محلي)
export function isBlockedIp(ip: string): boolean {
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

// حماية SSRF: يمنع الاتصالَ بعناوين داخلية/محلية — للـIP الحرفي وللأسماء بعد ترجمتها (DNS) كي لا
// يُخدَع باسمٍ يُترجم لعنوان داخلي (lvh.me/localtest.me أو نطاقٌ سجلُّه خاصّ). فشلُ الترجمة ⇒ حجبٌ احتياطاً.
export async function isBlockedHost(host: string): Promise<boolean> {
  const h = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").replace(/\.$/, "").trim().toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (/\.(nip|sslip|xip)\.io$/.test(h)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":")) return isBlockedIp(h);
  try {
    const addrs = await lookup(h, { all: true });
    return addrs.length === 0 || addrs.some((x) => isBlockedIp(x.address));
  } catch {
    return true;
  }
}
