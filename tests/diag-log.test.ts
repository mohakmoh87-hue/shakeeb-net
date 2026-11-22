import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validIp, isPrivateIp, cacheKey, ispLabel, SUPERCELL_ASN } from "../src/lib/isp";
import { sanitizeRef } from "../src/app/api/app/diag/route";
import { isDiagRef, DEFAULT_DIAG_REF } from "../src/lib/appConfig";

// ═════ 🩺 سجلُّ الفحص — طلبُ محمد 2026-11-22 ═════
// «آخرُ ١٠ فحوصٍ لكلّ مشترك بجانب سجلّ الوصولات، وفيها مزوّدُ الخدمة. وغيرُ المشترك
//  لا يظهر في أيّ مكان، فإن اشترك لاحقاً ظهرت فحوصُه، ويُعرَف بهاتفه وهو الأساس.»
// والحرّاسُ هنا تحمي ما يسقط صامتاً: أرقامُ المحاكاة، وانتحالُ المزوّد أو الهويّة،
// واختلاطُ مشترِكَين يتشاركان رقماً، وتسريبُ سجلّ مكتبٍ آخر.
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const POST_ROUTE = "src/app/api/app/diag/route.ts";
const GET_ROUTE = "src/app/api/subscribers/[id]/diag/route.ts";

describe("عنوانُ العميل: تحقّقٌ صارمٌ قبل أن يدخل رابطاً خارجيّاً", () => {
  test("العناوينُ الصحيحةُ تُقبَل كما هي", () => {
    for (const ip of ["5.175.147.246", "0.0.0.0", "255.255.255.255", "192.168.1.1"]) {
      assert.equal(validIp(ip), ip);
    }
    assert.equal(validIp("2001:0db8:85a3::8a2e"), "2001:0db8:85a3::8a2e");
  });

  test("🔴 كلُّ ما ليس عنواناً يُرفَض — ولا حرفَ حقنٍ يمرّ", () => {
    for (const bad of [
      "", "   ", "1.2.3", "1.2.3.4.5", "256.1.1.1", "999.999.999.999",
      "1.2.3.4 ; rm -rf /", "1.2.3.4/../admin", "http://evil/?x=1.2.3.4",
      "localhost", "1.2.3.4%0d%0a", "a.b.c.d", "1.2.3.-4",
    ]) {
      assert.equal(validIp(bad), null, `🔴 مرّ: ${JSON.stringify(bad)}`);
    }
  });

  test("العنوانُ الطويلُ جدّاً يُرفَض", () => {
    assert.equal(validIp("1".repeat(60)), null);
  });
});

describe("العناوينُ الخاصّة لا مزوّدَ لها (فلا نداءَ خارجيّ)", () => {
  test("الشبكاتُ المحلّيّةُ كلُّها خاصّة", () => {
    for (const ip of ["10.0.0.5", "192.168.1.9", "172.16.0.1", "172.31.255.254", "127.0.0.1", "169.254.1.1", "0.0.0.0"]) {
      assert.equal(isPrivateIp(ip), true, `🔴 ${ip} حُسب عامّاً`);
    }
    assert.equal(isPrivateIp("::1"), true);
    assert.equal(isPrivateIp("fd00::1"), true);
  });

  test("العنوانُ العامُّ ليس خاصّاً — ولا 172.15/172.32 اللتان تُخطئهما الفحوصُ الساذجة", () => {
    for (const ip of ["5.175.147.246", "8.8.8.8", "172.15.0.1", "172.32.0.1"]) {
      assert.equal(isPrivateIp(ip), false, `🔴 ${ip} حُسب خاصّاً`);
    }
  });
});

describe("كاشُ النظام الذاتيّ بالشريحة لا بالعنوان", () => {
  test("كلُّ عناوين الشريحة الواحدة مفتاحٌ واحد ⇒ نداءٌ خارجيٌّ واحدٌ لكلّ شبكة", () => {
    assert.equal(cacheKey("5.175.147.246"), "5.175.147.0/24");
    assert.equal(cacheKey("5.175.147.1"), "5.175.147.0/24");
    assert.notEqual(cacheKey("5.175.148.1"), cacheKey("5.175.147.1"));
  });

  test("السادسُ يُجمَع على /64", () => {
    assert.equal(cacheKey("2001:db8:85a3:1:2:3:4:5"), "2001:db8:85a3:1::/64");
  });
});

describe("اسمُ المزوّد ورقمُ سوبر سيل", () => {
  test("رقمُ سوبر سيل هو المقيسُ من سجلّ RIPE", () => {
    assert.equal(SUPERCELL_ASN, 209193);
  });

  test("الاسمُ المسجَّل أوّلاً ثمّ رقمُ النظام ثمّ لا شيء", () => {
    assert.equal(ispLabel({ asn: 209193, holder: "SUPER CELL" }), "SUPER CELL");
    assert.equal(ispLabel({ asn: 209193, holder: null }), "AS209193");
    assert.equal(ispLabel({ asn: null, holder: null }), null);
  });
});

describe("🔒 عيّنةُ الجهاز الخامّة تُنقّى قبل التخزين", () => {
  test("كلُّ ما يشبه كلمةَ مرورٍ يُشطَب", () => {
    const raw = 'UserName=telecomadmin&PassWord=admintelecom&x=1 pppoePass:"Sup3rSecret" token = abc123def';
    const out = sanitizeRef(raw) ?? "";
    assert.ok(!out.includes("admintelecom"), "🔴 كلمةُ الجهاز بقيت");
    assert.ok(!out.includes("Sup3rSecret"), "🔴 كلمةُ PPPoE بقيت");
    assert.ok(!out.includes("abc123def"), "🔴 الرمزُ بقي");
    assert.ok(out.includes("UserName=telecomadmin"), "اسمُ المستخدم يبقى — هو ما يفرّق الأجهزة");
  });

  test("الحجمُ محدودٌ فلا يُنفخ الصفُّ بصفحةِ جهازٍ كاملة", () => {
    const out = sanitizeRef("x".repeat(100000)) ?? "";
    assert.ok(out.length <= 20000, `🔴 الطول ${out.length}`);
  });

  test("الفراغُ واللا-شيء يُعادان فارغَين", () => {
    assert.equal(sanitizeRef(null), null);
    assert.equal(sanitizeRef("   "), null);
  });

  test("الكائنُ يُسلسَل ثمّ يُنقّى (التطبيقُ قد يرسل بنيةً لا نصّاً)", () => {
    const out = sanitizeRef({ server: "Huawei", password: "zzz9" }) ?? "";
    assert.ok(out.includes("Huawei"));
    assert.ok(!out.includes("zzz9"), "🔴 كلمةٌ داخلَ كائنٍ لم تُشطَب");
  });
});

describe("🔴 نسخةُ المتصفّح لا تُسجَّل — أرقامُها مخترَعةٌ في الكود", () => {
  test("المسارُ يرفض كلَّ منصّةٍ غيرِ أصليّة", () => {
    const c = code(POST_ROUTE);
    assert.ok(/platform !== "android" && platform !== "ios"/.test(c),
      "🔴 شرطُ المنصّة تغيّر — ونسخةُ الويب تعطي ٦٨ و٢١٠ و−١٩٫٤ ثابتةً لكلّ مشترك");
    assert.ok(/not-native/.test(c), "🔴 لا ردَّ يميّز غيرَ الأصليّ");
  });
});

describe("🔑 الهويّةُ والمزوّدُ من الخادم لا من الطلب", () => {
  test("لا يُقرأ من الجسم هاتفٌ ولا معرّفُ مشتركٍ ولا مكتب", () => {
    const c = code(POST_ROUTE);
    for (const f of ["body.phone", "body.subscriberId", "body.towerId", "body.agentId", "body.phoneCore"]) {
      assert.ok(!c.includes(f), `🔴 ${f} يُقرأ من الطلب — فيكتب أحدٌ فحصاً في سجلّ غيره`);
    }
  });

  test("لا يُقرأ من الجسم مزوّدٌ ولا رقمُ نظامٍ ولا حكمُ سوبر سيل", () => {
    const c = code(POST_ROUTE);
    for (const f of ["body.ispName", "body.asn", "body.onSuperCell", "body.ip"]) {
      assert.ok(!c.includes(f), `🔴 ${f} من العميل — فيدّعي المشتركُ أيَّ شبكة`);
    }
    assert.ok(/clientIp\(request\.headers\)/.test(c), "🔴 العنوانُ لم يعد يُؤخَذ من ترويسة الطلب");
  });

  test("الجلسةُ وحدَها تُحدّد صاحبَ الفحص، والزائرُ لا يُحفَظ له شيء", () => {
    const c = code(POST_ROUTE);
    assert.ok(/getSubscriberSession\(\)/.test(c) && /getAccountSession\(\)/.test(c));
    assert.ok(/reason: "guest"/.test(c), "🔴 الزائرُ بلا جلسةٍ لم يعد يُرفَض");
  });
});

describe("🔬 تفاصيلُ الجهاز للهاتف المرجعيّ وحدَه", () => {
  test("الالتقاطُ مشروطٌ بتطابق هاتف الجلسة مع الإعداد", () => {
    const c = code(POST_ROUTE);
    assert.ok(/getDiagRefPhone\(\)/.test(c), "🔴 الرقمُ المرجعيُّ لم يعد إعداداً");
    assert.ok(/refCore && refCore === core/.test(c),
      "🔴 شرطُ المرجع تغيّر — فتُخزَّن صفحةُ جهازِ كلِّ مشترك");
    assert.ok(/refRaw = sanitizeRef/.test(c), "🔴 العيّنةُ تُخزَّن بلا تنقية");
  });
});

describe("🔒 سجلُّ الفحص في البرنامج: عزلٌ ومطابقةٌ دقيقة", () => {
  test("نفسُ حارسِ سجلّ الصيانات حرفيّاً", () => {
    const c = code(GET_ROUTE);
    assert.ok(/guard\("subscribers\.manage"\)/.test(c), "🔴 لا صلاحيّةَ على المسار");
    assert.ok(/sameAgentTower\(g\.session, sub\.towerId\)/.test(c), "🔴 عزلُ المكاتب سقط");
  });

  test("فحوصُ ما قبل الاشتراك تُطابَق بالهاتف، ولا يختلط مشترِكان يتشاركان رقماً", () => {
    const c = code(GET_ROUTE);
    assert.ok(/subscriberId: null, phoneCore: core/.test(c),
      "🔴 المطابقةُ بالهاتف بلا شرط «بلا معرّف» ⇒ فحصُ مشتركٍ يظهر عند جارِه بنفس الرقم");
    assert.ok(/OR: \[\{ subscriberId \}/.test(c), "🔴 صفوفُ المشترك بمعرّفه سقطت");
  });

  test("آخرُ عشرةٍ عرضاً — والتخزينُ كاملٌ بلا حذف", () => {
    const c = code(GET_ROUTE);
    assert.ok(/const LIMIT = 10/.test(c), "🔴 عددُ الفحوص المعروضة تغيّر عن طلب محمد");
    assert.ok(/take: LIMIT/.test(c));
    assert.ok(!/delete|deleteMany/.test(c), "🔴 حذفٌ في مسار القراءة");
  });
});

describe("🏢 واجهةُ البرنامج: الزرُّ بجانب سجلّ الوصولات", () => {
  const board = read("src/components/SubscribersBoard.tsx");

  test("زرُّ «سجل الفحص» موجودٌ في قائمة المزيد", () => {
    assert.ok(/openLog\("diag"\)/.test(board), "🔴 لا زرَّ لسجلّ الفحص");
    assert.ok(/openLog\("receipts"\)/.test(board), "🔴 سجلُّ الوصولات اختفى — الزرّان متجاوران");
  });

  test("الواجهةُ تجلب من المسار المحروس لا من مسارٍ عامّ", () => {
    assert.ok(/\/api\/subscribers\/\$\{selected\.id\}\/diag/.test(board), "🔴 مصدرُ السجلّ تغيّر");
  });

  test("المزوّدُ وحكمُ «ليس على سوبر سيل» يظهران في القائمة", () => {
    assert.ok(/ispName/.test(board) && /ليس على سوبر سيل/.test(board));
  });
});

describe("🗄️ القاعدة: إضافةٌ محضةٌ وRLS", () => {
  test("لا DROP ولا RENAME في سكربت الإنشاء", () => {
    const sql = read("scripts/add-diag-checks.mjs");
    assert.ok(!/DROP\s+TABLE|ALTER\s+TABLE\s+\w+\s+DROP|RENAME/i.test(sql), "🔴 أمرٌ هدّامٌ في سكربت القاعدة");
    assert.ok(/CREATE TABLE IF NOT EXISTS "diag_checks"/.test(sql));
    assert.ok(/CREATE TABLE IF NOT EXISTS "asn_cache"/.test(sql));
  });

  test("RLS مُشعَلةٌ على الجدولَين — قاعدةُ «جدولٌ جديد = سياسة»", () => {
    const pol = read("prisma/rls/03-policies.sql");
    assert.ok(/ALTER TABLE diag_checks ENABLE ROW LEVEL SECURITY/.test(pol));
    assert.ok(/ALTER TABLE asn_cache ENABLE ROW LEVEL SECURITY/.test(pol));
    assert.ok(/CREATE POLICY rls_diag_checks/.test(pol), "🔴 لا سياسةَ عزلٍ على سجلّ الفحص");
  });

  test("العاملُ لا يُمنَح شيئاً على الجدولَين (لا يقرؤهما ولا يكتبهما)", () => {
    const grants = read("prisma/rls/02-grants.sql");
    assert.ok(!/diag_checks/.test(grants), "🔴 مُنح العاملُ إذناً على سجلّ الفحص بلا حاجة");
    assert.ok(!/asn_cache/.test(grants), "🔴 مُنح العاملُ إذناً على كاش المزوّد بلا حاجة");
  });
});

describe("مطابقةُ هاتف المرجع", () => {
  test("المطابقةُ بآخر عشرةٍ — فصيغةُ الكتابة لا تعني شيئاً", () => {
    assert.equal(isDiagRef("07726999826", "07726999826"), true);
    assert.equal(isDiagRef("07726999826", "+964 772 699 9826"), true);
    assert.equal(isDiagRef("07726999826", "7726999826"), true);
    assert.equal(isDiagRef("07726999826", "07726999827"), false);
  });

  test("🔴 الفراغُ لا يطابق أحداً — وإلّا صار كلُّ مشتركٍ مرجعاً", () => {
    assert.equal(isDiagRef("", "07726999826"), false);
    assert.equal(isDiagRef("07726999826", ""), false);
    assert.equal(isDiagRef("", ""), false);
    assert.equal(isDiagRef("07726999826", null), false);
    assert.equal(isDiagRef("123", "123"), false);
  });

  test("الافتراضيُّ هو رقمُ محمد", () => {
    assert.equal(DEFAULT_DIAG_REF, "07726999826");
  });

  test("العلامةُ تصل التطبيقَ من مسارَي الملفّ", () => {
    for (const r of ["src/app/api/app/me/route.ts", "src/app/api/app/account/route.ts"]) {
      assert.ok(/diagRef: isDiagRef\(/.test(code(r)), `🔴 ${r} لا يرسل علامةَ المرجع`);
    }
  });
});
