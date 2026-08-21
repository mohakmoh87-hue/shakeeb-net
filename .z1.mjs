import fs from "node:fs";
const L = (...x) => x.join("\n");
// ═══ (٢) لا يُرسَل «مبلغ الاشتراك» لمن لا باقةَ له — قاعدةُ محمد 2026-08-21 ═══
{
  const p = "src/lib/messaging.ts";
  let s = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  const must = (o, n) => { if (!s.includes(o)) throw new Error("messaging: " + o.slice(0, 50)); s = s.replace(o, n); };
  must(
    L(
      "  return template.replace(/\{([\w؀-ۿ]+)\}/g, (_, key) => {",
      "    const v = all[key];",
      "    return v === null || v === undefined ? \"\" : String(v);",
      "  });",
      "}",
    ),
    L(
      "  // ═════ 💰 «لا مبلغَ لمن لا باقةَ له» — قاعدةُ محمد 2026-08-21 (تُطبَّق على كلّ رسالة) ═════",
      "  // نصُّه: «عند إرسال رسالة انتهاء اشتراكٍ أو أيّ رسالةٍ أخرى لمشتركٍ ليس لديه باقة فلا",
      "  // يُرسَل له مبلغُ الاشتراك أبداً حتى وإن كان محدَّداً في القالب — كي لا يصله مبلغٌ صفر».",
      "  // فالسطرُ الحاملُ للمتغيّر **يُنزَع كاملاً** (لا يُترَك «مبلغ الاشتراك : » فارغاً)، وذلك",
      "  // حين تكون القيمةُ غائبةً أو صفراً — ومصدرُها سعرُ الباقة، فمن بلا باقةٍ بلا سعر.",
      "  // 🔒 وهذا الموضعُ هو **المعبرُ الوحيدُ** لكلّ القوالب (تفعيل · انتهاء · ملخّص · سجلّ",
      "  //    المزامنة · المكافآت…) فالقاعدةُ تسري على الجميع بلا استثناءٍ ولا تكرارِ منطق.",
      "  const priceKeys = [\"price\", \"مبلغ_الاشتراك\"];",
      "  const priceMissing = priceKeys.every((k) => {",
      "    const v = all[k];",
      "    if (v === null || v === undefined || String(v).trim() === \"\") return true;",
      "    const n = Number(String(v).replace(/[^\d.-]/g, \"\"));",
      "    return Number.isFinite(n) && n <= 0;",
      "  });",
      "  let body = template;",
      "  if (priceMissing) {",
      "    body = body",
      "      .split(\"\n\")",
      "      .filter((line) => !priceKeys.some((k) => line.includes(`{${k}}`)))",
      "      .join(\"\n\");",
      "  }",
      "  return body.replace(/\{([\w؀-ۿ]+)\}/g, (_, key) => {",
      "    const v = all[key];",
      "    return v === null || v === undefined ? \"\" : String(v);",
      "  });",
      "}",
    ),
  );
  fs.writeFileSync(p, s);
}
// ═══ (١) باقةُ عرضٍ لمن لا باقةَ له عندنا ⇒ لا تُذكَر في «تحديث معلومات» ═══
{
  const p = "src/lib/subscriptionSync.ts";
  let s = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  const must = (o, n) => { if (!s.includes(o)) throw new Error("sync: " + o.slice(0, 50)); s = s.replace(o, n); };
  must(
    "        if (sv(u.packageName) && sasPkgIdForDiff != null && sasPkgIdForDiff !== p.packageId) {",
    L(
      "        // 🎁 **بلا باقةٍ عندنا وباقتُه في الساس «عرض» ⇒ لا يُذكَر** (قاعدةُ محمد الجديدة",
      "        //    2026-08-21): «بعد انقضاء فترة العرض سيُفعَّل بإحدى الباقات، وبقاؤه بلا باقةٍ",
      "        //    لا يؤثّر على شيء». وكانت هذه وحدَها ١٥١ صفّاً في المواصلات.",
      "        const offerOnEmpty = p.packageId == null && isOfferPackage(u.packageName);",
      "        if (sv(u.packageName) && !offerOnEmpty && sasPkgIdForDiff != null && sasPkgIdForDiff !== p.packageId) {",
    ),
  );
  must(
    "import { recordInfoDiff, recordInstall, recordActivationEvent, recordCompanyActivation, resolveEventIfReceipted, reconcileInstalls, reconcileInfo, reconcileEvents, closeDeadSasRows, isOwnCabinet, type InfoChange } from \"@/lib/syncLog\";",
    "import { recordInfoDiff, recordInstall, recordActivationEvent, recordCompanyActivation, resolveEventIfReceipted, reconcileInstalls, reconcileInfo, reconcileEvents, closeDeadSasRows, isOwnCabinet, isOfferPackage, type InfoChange } from \"@/lib/syncLog\";",
  );
  fs.writeFileSync(p, s);
}
console.log("z1 ok");
