import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ ⚡ إذنُ كروم للاتصال بحاسبة المكتب — حرّاسُ الجراحة النصّيّة ═════
//
// 🔴 السياق: كروم يمنع الموقعَ من نداء `127.0.0.1` بإذن «Apps on device»، فتُحمَّل لوحةُ
//   الساس من أمريكا (٧٫٩ ميغا لكلّ فتحة · ٦١٣ ميغا يوميّاً). والسياسةُ تحتاج مديراً،
//   والعاملُ يعمل بحساب موظّف ⇒ الطريقُ الوحيدُ المُثبَت: تعديلُ ملفّ إعدادات كروم وهو مغلق.
//
// ⚠️ **ولماذا هذه الاختباراتُ حرِجة**: الملفُّ يحمل جلساتِ المستخدم وإعداداتِه كلَّها، وأيُّ
//   ناتجٍ غيرِ صالحٍ كـJSON يجعل كروم **يُصفّر الملفَّ الشخصيّ**. فكلُّ فرعٍ هنا يُتحقَّق منه
//   بـ`JSON.parse` على الناتج — لا بالنظر إلى النصّ.

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src/lib/chromeLoopbackPermission.ts");
const KEY = "https://shakeebnet.com:443,*";

/** ملفُّ إعداداتٍ مصغَّرٌ بنفس بنية كروم الحقيقيّة (من ملفّ محمد 2026-08-24) */
function prefs(exceptions: Record<string, unknown>): string {
  return JSON.stringify({
    profile: { content_settings: { exceptions } },
    session: { restore_on_startup: 1 },
  });
}
const SITE_ENTRY = (v: number) => ({ last_modified: "13428806973221476", last_visit: "13432003200000000", setting: v });
const OTHER_SITE = { "https://shakeeb-net-production.up.railway.app:443,*": SITE_ENTRY(1) };

type Applied = { text: string; how: string };
type Mod = { applyGrant: (t: string) => Applied };
const load = async (): Promise<Mod> => (await import("../src/lib/chromeLoopbackPermission")) as unknown as Mod;

function parsedSetting(text: string): unknown {
  const j = JSON.parse(text) as { profile: { content_settings: { exceptions: Record<string, Record<string, { setting: unknown }>> } } };
  return j.profile.content_settings.exceptions?.loopback_network?.[KEY]?.setting;
}

describe("⚡ إذنُ كروم للاتصال بحاسبة المكتب", () => {
  test("① ممنوعٌ (2) ⇒ يصير مسموحاً (1) والناتجُ JSON صالح", async () => {
    const { applyGrant } = await load();
    const src = prefs({ loopback_network: { ...OTHER_SITE, [KEY]: SITE_ENTRY(2) } });
    const r = applyGrant(src);
    assert.equal(r.how, "updated");
    assert.equal(parsedSetting(r.text), 1, "الإذنُ لم يصر مسموحاً");
    // 🔒 ولا يُمَسّ موقعٌ آخرُ في نفس القسم
    const j = JSON.parse(r.text) as { profile: { content_settings: { exceptions: Record<string, Record<string, { setting: number }>> } } };
    assert.equal(j.profile.content_settings.exceptions.loopback_network["https://shakeeb-net-production.up.railway.app:443,*"].setting, 1);
  });

  test("② القسمُ موجودٌ بلا موقعنا ⇒ يُضاف الموقع", async () => {
    const { applyGrant } = await load();
    const r = applyGrant(prefs({ loopback_network: { ...OTHER_SITE } }));
    assert.equal(r.how, "added-site");
    assert.equal(parsedSetting(r.text), 1);
  });

  test("③ لا قسمَ إطلاقاً (حالةُ كلّ حاسبةٍ لم تُفتح عليها الصفحة) ⇒ يُنشأ القسم", async () => {
    const { applyGrant } = await load();
    const r = applyGrant(prefs({ media_engagement: { "https://x.com:443,*": { setting: {} } } }));
    assert.equal(r.how, "added-section");
    assert.equal(parsedSetting(r.text), 1);
  });

  test("④ مسموحٌ سلفاً ⇒ لا يُمَسّ الملفُّ بحرف", async () => {
    const { applyGrant } = await load();
    const src = prefs({ loopback_network: { [KEY]: SITE_ENTRY(1) } });
    const r = applyGrant(src);
    assert.equal(r.how, "already");
    assert.equal(r.text, src, "الملفُّ تغيّر مع أنّ الإذنَ ممنوحٌ سلفاً");
  });

  test("⑤ بنيةٌ غيرُ معروفة ⇒ صمتٌ ولا كتابة", async () => {
    const { applyGrant } = await load();
    const src = '{"something":"else"}';
    const r = applyGrant(src);
    assert.equal(r.how, "unknown-shape");
    assert.equal(r.text, src);
  });

  test("🛡️ الحرّاسُ في الكود: لا كتابةَ وكرومُ يعمل · ونسخةٌ قبل التعديل · وويندوز وحدَه", () => {
    const s = fs.readFileSync(SRC, "utf8");
    assert.match(s, /if \(await userChromeRunning\(\)\)/, "يكتب حتى وكرومُ يعمل ⇒ يُمحى التعديلُ عند خروجه");
    assert.match(s, /if \(!fs\.existsSync\(bak\)\) fs\.copyFileSync\(file, bak\)/, "يكتب بلا نسخةٍ احتياطيّة");
    assert.match(s, /process\.platform !== "win32"/, "يعمل على غير ويندوز");
    // ومتصفّحُ الواتساب لا يُخلَط بكروم المستخدم (اسمُ عمليّته chrome.exe كذلك)
    assert.match(s, /puppeteer/, "لا يُستثنى متصفّحُ الواتساب فلا يكتب أبداً");
    // ولا يُصفّر ملفَّ كروم: جراحةُ نصٍّ لا إعادةَ كتابةٍ بمُحوِّل
    assert.equal(/JSON\.stringify\(/.test(s), false, "إعادةُ كتابة الملفّ بـJSON.stringify تُخاطر بتصفير ملفّ كروم");
  });
});
