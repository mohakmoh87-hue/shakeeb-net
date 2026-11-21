import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 👁️ مستخدمُ المشاهدة فقط — طلبُ محمد 2026-11-21 ═════
// «لا يظهر له أيُّ شيءٍ ولا الصفحةُ الرئيسيّة — صفحةٌ واحدةٌ فيها المشتركون بلا هاتف،
//  يبحث بالاسم أو اليوزر، ويرى متصلاً أو غيرَ متصل، وزرُّ عمليّاتٍ يرفع له بطاقة».
// وهذه الحرّاسُ تحمي ما يسقط صامتاً: تسريبُ الهاتف، واتّساعُ النطاق، وجلسةٌ قديمةٌ باقية.
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const WATCH_ROUTES = [
  "src/app/api/watch/subscribers/route.ts",
  "src/app/api/watch/ops/route.ts",
  "src/app/api/watch/card/route.ts",
  "src/app/api/watch/sas-status/[id]/route.ts",
];

describe("🔴 الهاتفُ لا يصل المشاهدَ أصلاً — لا يُخفى بالعرض", () => {
  test("لا مسارَ مشاهدةٍ واحدٌ يذكر الهاتف", () => {
    for (const r of WATCH_ROUTES) {
      assert.ok(!/\bphone\b/.test(code(r)), `🔴 ${r} يذكر الهاتف — والطلبُ أن لا يظهر هاتفُ أيّ مشترك`);
    }
  });

  test("القائمةُ تنتقي الاسمَ واليوزرَ والمكتبَ فقط", () => {
    const sub = code("src/app/api/watch/subscribers/route.ts");
    assert.ok(/select: \{ id: true, name: true, netUser: true, towerId: true \}/.test(sub),
      "🔴 أعمدةُ القائمة تغيّرت — أيُّ عمودٍ زائدٍ قد يحمل بياناتٍ شخصيّة");
  });

  test("البحثُ لا يشمل الهاتف ولا العنوان (وإلّا استُنتج الرقمُ بالبحث عنه)", () => {
    const sub = code("src/app/api/watch/subscribers/route.ts");
    const or = sub.slice(sub.indexOf("OR: ["), sub.indexOf("OR: [") + 400);
    assert.ok(or.includes("name:") && or.includes("netUser:"), "🔴 البحثُ لا يغطّي الاسمَ واليوزر");
    assert.ok(!or.includes("phone") && !or.includes("address"),
      "🔴 البحثُ يشمل الهاتفَ أو العنوان — فيُستنتَج الرقمُ بتجربة أرقامٍ عليه");
  });

  test("واجهةُ المشاهد لا تعرض هاتفاً ولا تلمس لوحةَ المشتركين الأصليّة", () => {
    const ui = code("src/components/WatchBoard.tsx");
    assert.ok(!/\bphone\b/i.test(ui.replace(/extraPhone/g, "")), "🔴 واجهةُ المشاهد تذكر هاتفَ مشترك");
    assert.ok(!ui.includes("SubscribersBoard"), "🔴 واجهةُ المشاهد تعتمد اللوحةَ الأصليّة — والطلبُ عزلُها");
  });
});

describe("نوعُ الجلسة هو الحارس — لا قائمةُ صلاحيّاتٍ فارغة", () => {
  const auth = code("src/lib/auth.ts");

  test("getSession ترفض كلَّ توكنٍ يحمل نوعاً (فتُغلق ٤٠ مساراً بلا حارسِ صلاحيّة)", () => {
    assert.ok(/\}\)\.kind != null\) return null/.test(auth),
      "🔴 سقطت القائمةُ البيضاء في getSession — فجلسةُ المشاهد تُجيبها مساراتُ المال والتقارير");
  });

  test("جلسةُ المشاهد تُقرأ من القاعدة وتُبطَل عند سحب الصفة", () => {
    const fn = auth.slice(auth.indexOf("export async function getViewerSession"));
    assert.ok(/kind !== "viewer"\) return null/.test(fn), "🔴 لا تحقّقَ من نوع التوكن");
    assert.ok(/!u\.viewOnly\) return null/.test(fn),
      "🔴 سحبُ صفة المشاهدة لا يُبطل جلسته — أو أسوأ: تتحوّل جلستُه إلى شيءٍ آخر");
    assert.ok(/u\.isOwner \|\|/.test(fn), "🔴 مالكُ النظام قد يُقرأ كمشاهد");
    assert.ok(/isAgentBlocked\(u\.agentId\)\) return null/.test(fn),
      "🔴 مشاهدُ وكيلٍ منتهي الاشتراك يبقى يعمل");
    const dbRead = fn.indexOf("prisma.user.findUnique");
    const ret = fn.indexOf("kind: \"viewer\", userId: u.id");
    assert.ok(dbRead > -1 && dbRead < ret, "🔴 النطاقُ يُعاد من التوكن لا من القاعدة");
    assert.ok(/viewAllOffices: u\.viewAllOffices/.test(fn),
      "🔴 النطاقُ يُؤخذ من التوكن — فتعديلُ المدير لا يسري، وتوكنٌ قديمٌ يُوسّع النطاق");
  });

  test("الدخولُ يفرّع المشاهدَ قبل أن تُكتَب له جلسةُ مستخدمٍ أبداً", () => {
    const login = code("src/app/api/auth/login/route.ts");
    const v = login.indexOf("setViewerSession");
    const u = login.indexOf("await setSession({");
    assert.ok(v > -1 && u > -1 && v < u, "🔴 جلسةُ المستخدم تُكتَب قبل فرع المشاهد");
    assert.ok(/redirect: "\/watch"/.test(login), "🔴 المشاهدُ لا يُوجَّه لصفحته");
  });

  test("البروكسي يحصره بصفحته، والغلافُ يعطيه هيكلاً مجرَّداً", () => {
    const proxy = code("src/proxy.ts");
    assert.ok(/isViewer && !pathname\.startsWith\("\/watch"\)/.test(proxy), "🔴 المشاهدُ غيرُ محصورٍ بصفحته");
    const layout = code("src/app/(app)/layout.tsx");
    const branch = layout.slice(layout.indexOf("const viewer = await getViewerSession"), layout.indexOf("redirect(\"/login\")"));
    assert.ok(branch.length > 0, "🔴 لا فرعَ للمشاهد في الغلاف");
    assert.ok(!branch.includes("AppShell"), "🔴 المشاهدُ يرى قائمةَ التنقّل — والطلبُ أن لا يظهر له أيُّ خيار");
    assert.ok(!branch.includes("PlanBanner") && !branch.includes("InternalMsgHost"),
      "🔴 عناصرُ شريطٍ أو رسائلَ تظهر للمشاهد");
  });
});

describe("العزلُ بالمعرّفات والنطاقُ لا يتّسع", () => {
  const scope = code("src/lib/viewerScope.ts");

  test("مكتبُه وحدَه أو مكاتبُ وكيله — بالمعرّفات لا بالنصّ", () => {
    assert.ok(/!viewer\.viewAllOffices/.test(scope) && /towerIds: \[viewer\.towerId\]/.test(scope),
      "🔴 نطاقُ «مكتبه» لا يُحصر بمكتبه");
    assert.ok(/towerIdsOfAgent\(viewer\.agentId\)/.test(scope), "🔴 نطاقُ «كلُّ المكاتب» لا يُحصر بوكيله");
    assert.ok(!/name|contains|createdBy/.test(scope), "🔴 عزلٌ بنصٍّ يملكه المستخدم");
  });

  test("بلا وكيلٍ أو بلا مكتبٍ ⇒ لا نطاقَ (فشلٌ مُغلَق)", () => {
    assert.ok(/agentId == null\) return null/.test(scope), "🔴 مشاهدٌ بلا وكيلٍ يمرّ");
    assert.ok(/towerId == null \? null/.test(scope), "🔴 مشاهدٌ بلا مكتبٍ ونطاقُه مكتبُه يمرّ بلا حصر");
  });

  test("كلُّ مسارِ مشاهدةٍ يبدأ بالنطاق ويرفض بـ٤٠٣ قبل أيّ عمل", () => {
    for (const r of WATCH_ROUTES) {
      const c = code(r);
      const sc = c.indexOf("await viewerScope()");
      assert.ok(sc > -1, `🔴 ${r} بلا حارسِ نطاق`);
      assert.ok(/if \(!sc\) return NextResponse\.json\(\{ error: "غير مصرّح" \}, \{ status: 403 \}\)/.test(c),
        `🔴 ${r} لا يرفض من هو خارج النطاق`);
      const pr = c.indexOf("prisma.");
      if (pr > -1) assert.ok(sc < pr, `🔴 ${r} يستعلم القاعدةَ قبل فحص النطاق`);
    }
  });

  test("حالةُ الاتصال والأنواعُ تُحصران بمكاتب نطاقه هو", () => {
    assert.ok(/sc\.towerIds\.includes\(officeId\)/.test(code("src/app/api/watch/ops/route.ts")),
      "🔴 المشاهدُ يقرأ أنواعَ مكتبٍ خارجَ نطاقه");
    assert.ok(/sc\.towerIds\.includes\(sub\.towerId\)/.test(code("src/app/api/watch/sas-status/[id]/route.ts")),
      "🔴 المشاهدُ يفحص اتّصالَ مشتركٍ خارجَ نطاقه");
  });
});

describe("رفعُ البطاقة: منطقٌ واحدٌ مشترَكٌ وبلا اختيارِ فنيّ", () => {
  const lib = code("src/lib/cardFromSubscriber.ts");

  test("المنطقُ مستخرَجٌ لا منسوخ — والمسارُ القديم يستعمله", () => {
    const old = code("src/app/api/field/from-subscriber/route.ts");
    assert.ok(/createCardFromSubscriber/.test(old), "🔴 المسارُ القديم لا يستعمل الدالّةَ المشتركة");
    assert.ok(!/prisma\.taskCard\.create/.test(old), "🔴 منطقُ إنشاء البطاقة منسوخٌ في مكانَين — سيتباعدان");
    assert.ok(/prisma\.taskCard\.create/.test(lib), "🔴 الدالّةُ المشتركة لا تُنشئ البطاقة");
  });

  test("ملكيّةُ المشترك تُقاس بمكاتب الفاعل (نظيرُ sameAgentTower حرفيّاً)", () => {
    assert.ok(/sub\.towerId == null \|\| !actor\.ownerTowerIds\.includes\(sub\.towerId\)/.test(lib),
      "🔴 المِلكيّةُ لا تُفحَص بمكاتب الفاعل — أو مشتركٌ بلا مكتبٍ يمرّ");
    const old = code("src/app/api/field/from-subscriber/route.ts");
    assert.ok(/ownerTowerIds: await agentTowerIds\(g\.session\)/.test(old),
      "🔴 المسارُ القديم غيّر معنى الملكيّة — وكان agentTowerIds عينَ ما تفعله sameAgentTower");
    assert.ok(/allowManualTech: true/.test(old), "🔴 مستخدمُ المكتب فقد اختيارَ الفنيّ");
  });

  test("المشاهدُ لا يختار فنيّاً — خادميّاً لا في الواجهة", () => {
    const w = code("src/app/api/watch/card/route.ts");
    assert.ok(/allowManualTech: false/.test(w), "🔴 المشاهدُ يستطيع إسنادَ البطاقة لفنيّ");
    assert.ok(!/technicianId: /.test(w), "🔴 معرّفُ الفنيّ يُمرَّر من طلب المشاهد");
    assert.ok(/actor\.allowManualTech && input\.technicianId/.test(lib),
      "🔴 الدالّةُ تقبل الفنيَّ بلا نظرٍ للعلَم ⇒ العلَمُ زينة");
  });

  test("حارسُ البطاقة المرفوعة ومبلغُ باقة التوصيل باقيان", () => {
    assert.ok(/settled: false, isDeleted: false[\s\S]{0,900}status: 409/.test(lib),
      "🔴 ضاع حارسُ «بطاقةٌ مرفوعةٌ بالفعل» ⇒ بطاقتان لمشترك");
    assert.ok(/operation === "توصيل"[\s\S]{0,300}priceDinar/.test(lib), "🔴 ضاع مبلغُ باقة التوصيل");
    assert.ok(/agentId: actor\.agentId \?\? -1/.test(lib), "🔴 سعرُ الباقة يُقرأ بلا عزلِ وكيل");
  });
});

describe("إنشاءُ المشاهد وتعديلُه: بلا صلاحيّةٍ وبلا جلسةٍ باقية", () => {
  const create = code("src/app/api/users/route.ts");
  const edit = code("src/app/api/users/[id]/route.ts");

  for (const [label, c] of [["الإنشاء", create], ["التعديل", edit]] as const) {
    test(`${label}: المشاهدُ بلا إدارةٍ وبلا صلاحيّاتٍ مهما أُرسل`, () => {
      assert.ok(/if \(rest\.viewOnly\) \{[\s\S]{0,200}rest\.isAdmin = false;/.test(c),
        `🔴 ${label}: مشاهدٌ قد يُنشأ مديراً`);
      assert.ok(/permissions\.length = 0/.test(c) && /deniedPermissions\.length = 0/.test(c),
        `🔴 ${label}: صلاحيّاتٌ تُكتَب لمشاهد — والطلبُ أن لا يظهر له أيُّ خيار`);
      assert.ok(/!rest\.viewAllOffices && rest\.towerId == null[\s\S]{0,200}status: 400/.test(c),
        `🔴 ${label}: مشاهدٌ بنطاق «مكتبه» بلا مكتبٍ ⇒ بلا نطاقٍ صامت`);
      assert.ok(/\} else \{\s*rest\.viewAllOffices = false;/.test(c),
        `🔴 ${label}: علَمُ «كلُّ المكاتب» يبقى على مستخدمٍ عاديّ`);
    });
  }

  test("تغييرُ النوع يُبطل الجلسةَ القائمة برمزٍ جديدٍ لا بتصفير", () => {
    assert.ok(/const typeChanged = rest\.viewOnly !== target\.viewOnly/.test(edit),
      "🔴 لا كشفَ لتغيير النوع");
    assert.ok(/typeChanged \? \{ sessionToken: crypto\.randomUUID\(\) \}/.test(edit),
      "🔴 الجلسةُ القديمة تبقى صالحةً — مستخدمٌ حُوِّل إلى مشاهدٍ يبقى بصلاحيّاته سنةً");
    assert.ok(!/sessionToken: null/.test(edit),
      "🔴 تصفيرُ الرمز يُلغي الفحصَ في getSession فيُبقي الجلسةَ القديمة صالحة");
  });

  test("حدُّ الوكيل: المشاهدُ يُحسب مستخدماً عاديّاً (قرارُ محمد)", () => {
    assert.ok(/isAdmin: isManager \}[\s\S]{0,200}cap = isManager \? agent\.maxManagers : agent\.maxUsers/.test(create),
      "🔴 تغيّر حسابُ الحدود — والمشاهدُ يجب أن يُحسب من maxUsers");
  });
});

describe("حقلُ role القديم لم يُلمَس", () => {
  test("لا شيءَ في الميزة يعتمد enum Role (افتراضُه VIEWER لكلّ مستخدمٍ قائم)", () => {
    const files = [
      "src/lib/auth.ts", "src/lib/viewerScope.ts", "src/app/api/users/route.ts",
      "src/app/api/users/[id]/route.ts", "src/app/api/auth/login/route.ts",
      ...WATCH_ROUTES,
    ];
    for (const f of files) {
      assert.ok(!/\brole:\s*(Role\.)?"?VIEWER"?/.test(code(f)),
        `🔴 ${f} يعتمد role=VIEWER — وهو افتراضُ **كلّ** مستخدمٍ في القاعدة ⇒ الجميعُ مشاهدون`);
    }
    const schema = read("prisma/schema.prisma");
    assert.ok(/role\s+Role\s+@default\(VIEWER\)/.test(schema),
      "🔴 تغيّر الحقلُ القديم — وهذا الحارسُ قائمٌ لتذكيرِ أنّ افتراضَه VIEWER للجميع");
  });
});
