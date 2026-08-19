// ═════════ علَمُ تجربة طراز التطبيق (طلبُ محمد 2026-08-19) ═════════
//
// بنصّ الطلب: «اريد انشاء تطبيق احمله في هاتفي لاجربه وحدي ونجري التعديلات عليه
// واذا تمت جميع التعديلات فيهمل هذا التطبيق وتتم نفس التعديلات على التطبيق الحالي».
//
// 🔑 فالتجربةُ ليست تطبيقاً موازياً (درسُ الـ١١٤ فارقاً) بل **علَمٌ على الجهاز**:
//   كعكةُ `trialSkin=1` يضعها المديرُ من صفحة /trial على هاتفه وحدَه، وسكربتُ الرأس
//   يحوّلها وسمَ `data-app-trial` على <html> فيُشعل جلدَ الطراز كلَّه.
//   ولا جهازَ في الإنتاج يحملها ⇒ صفرُ فرقٍ للمدراء والفنيّين وتطبيقِهم.
//
// وعند اكتمال التعديلات: يُستبدل مفتاحُ الجلد في globals.css من [data-app-trial]
// إلى [data-app-mode] (والسلوكان في StandaloneLock/login يفقدان شرطَ العلَم)
// فتنتقل التعديلاتُ نفسُها للتطبيق الحقيقيّ — بلا نقلِ كودٍ ولا إعادةِ بناء.

export function hasTrialSkin(): boolean {
  if (typeof document === "undefined") return false;
  try {
    return document.cookie.split("; ").includes("trialSkin=1");
  } catch {
    return false;
  }
}

export function setTrialSkin(on: boolean): void {
  if (typeof document === "undefined") return;
  // سنةٌ كاملة — التجربةُ تمتدّ أيّاماً ولا تسقط بإغلاق التطبيق
  document.cookie = on
    ? "trialSkin=1; Max-Age=31536000; Path=/; SameSite=Lax"
    : "trialSkin=; Max-Age=0; Path=/; SameSite=Lax";
}
