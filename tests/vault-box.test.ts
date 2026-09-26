import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 🧰 «الصندوق» في حسابات المدير (طلبُ محمد 2026-09-27) ═════
// وظيفتُه النقلُ من/إلى «المبلغ الكلّي» وحدَه: مجموعُهما لا يتغيّر، ولا يُنقَل أكبرُ من
// رصيد المصدر، ولا يمسّ التقاريرَ اليوميّةَ ولا المكاتب.
const code = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("صندوقُ حسابات المدير", () => {
  const tx = code("src/app/api/manager-accounts/tx/route.ts");
  test("النقلُ زوجُ حركتَين — فلا يُخلَق مالٌ ولا يضيع", () => {
    assert.ok(/type: toVault \? "expense" : "vault-expense"/.test(tx), "شقُّ الخروج ليس زوجاً صحيحاً");
    assert.ok(/type: toVault \? "vault-receipt" : "receipt"/.test(tx), "شقُّ الدخول ليس زوجاً صحيحاً");
    assert.ok(/زوج #\$\{a\.id\}/.test(tx), "بلا علامةِ «زوج» — فلا يُحذفان معاً");
  });
  test("🔒 لا يُنقَل أكبرُ من رصيد المصدر (الطرفان)", () => {
    assert.ok(/const source = toVault \? totalAvailable : vaultBalance;/.test(tx), "🔴 الحدُّ لا يُقرأ من الطرف المصدر");
    assert.ok(/if \(amount > source\)/.test(tx), "🔴 يمرّ نقلٌ أكبرُ من الرصيد");
  });
  test("الحدُّ والعرضُ من معادلةٍ واحدة (لا نسخَ منطقٍ ماليّ)", () => {
    assert.ok(/managerBalances\(agentId, await agentTowerIds\(g\.session\)\)/.test(tx), "المسارُ لا يستعمل المعادلةَ المشتركة");
    const lib = code("src/lib/managerBalances.ts");
    assert.ok(/sumBy\("vault-receipt"\) - sumBy\("vault-expense"\)/.test(lib), "رصيدُ الصندوق غيرُ محسوبٍ في المعادلة المشتركة");
    assert.ok(/cumulativeDaily - sumBy\("card-payment"\) - sumBy\("expense"\) - sumBy\("salary"\) \+ sumBy\("receipt"\)/.test(lib),
      "معادلةُ «الكلّي» في الحارس تخالف معادلةَ الصفحة");
  });
  test("الصفحةُ تعرضه مربّعاً ولا تُرسل سبباً", () => {
    const page = code("src/app/(app)/manager-accounts/page.tsx");
    assert.ok(/label="🧰 الصندوق"/.test(page), "مربّعُ الصندوق سقط من الصفحة");
    assert.ok(/type: vaultMove === "to" \? "convert-to-vault" : "convert-from-vault", amount: n/.test(page),
      "نافذةُ النقل تُرسل حقولاً غيرَ المبلغ (قرارُ محمد: بلا سبب)");
  });
  test("رصيدُ الصندوق يصل الصفحةَ من الخادم", () => {
    assert.ok(/vaultBalance/.test(code("src/app/api/manager-accounts/route.ts")), "الرصيدُ لا يُرجَع من مسار الحسابات");
  });
});
