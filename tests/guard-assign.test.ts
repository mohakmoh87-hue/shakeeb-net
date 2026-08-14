import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { applyPrivateLists, GUARD_LIST_NAME } from "../src/lib/guardAssign";

// ═══════ 🎯 تكليفُ حالاتِ حارس المال + العمودُ الخاصّ (طلبُ محمد 2026-08-14) ═══════
//
// «إرسالُ أيّ حالةٍ أو مجموعةِ حالاتٍ إلى أيّ فنيٍّ أو مديرٍ أو مستخدمٍ فتظهر له
//  بالإشعارات لديه» · «التكتُ عنوانُه حالاتٌ حرجةٌ من المدير يجب اتّخاذُ إجراءٍ بها،
//  وعند فتحه لكلّ حالةٍ تظهر كاملُ تفاصيلها» · «ولا يراها سوى المدير والفنيِّ المعنيّ»
//  · «عمودٌ خاصٌّ بها… يظهر فقط إذا فيه بطاقاتٌ وإذا خلا اختفى» · «اسمُه حارس المال».

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const L = (id: number, priv = false) => ({ id, privateToAssignee: priv });
const C = (listId: number, technicianId: number | null) => ({ listId, technicianId });

describe("🔒 العمودُ الخاصُّ بتكليفات الحارس", () => {
  const data = {
    lists: [L(1), L(9, true)],
    cards: [C(1, 5), C(9, 5), C(9, 7)],
  };

  test("المديرُ يرى بطاقاتِ العمود الخاصِّ كلَّها", () => {
    const out = applyPrivateLists(data, { kind: "manager" });
    assert.equal(out.cards.length, 3);
    assert.equal(out.lists.length, 2);
  });

  test("🔴 الفنيُّ يرى بطاقتَه وحدَها — **ولو لم يكن عليه ownCardsOnly**", () => {
    const out = applyPrivateLists(data, { kind: "technician", technicianId: 5 });
    assert.deepEqual(out.cards, [C(1, 5), C(9, 5)], "رأى بطاقةَ زميله في العمود الخاصّ");
  });

  test("🔴 مستخدمُ المكتب غيرُ المدير لا يرى العمودَ الخاصَّ أصلاً", () => {
    const out = applyPrivateLists(data, { kind: "user" });
    assert.deepEqual(out.cards, [C(1, 5)]);
    assert.deepEqual(out.lists.map((l) => l.id), [1], "بقي العمودُ الخاصُّ ظاهراً لمن لا يراه");
  });

  test("👀 والعمودُ يظهر فقط إذا فيه بطاقاتٌ يراها هذا الناظر — وإذا خلا اختفى", () => {
    // فنّيٌّ لا تكليفَ له: العمودُ يختفي من لوحته
    const out = applyPrivateLists(data, { kind: "technician", technicianId: 99 });
    assert.deepEqual(out.lists.map((l) => l.id), [1], "العمودُ الخاصُّ ظاهرٌ وهو فارغٌ عنده");
    // ولا عمودَ خاصّاً في اللوحة أصلاً ⇒ لا تغيير
    const plain = { lists: [L(1), L(2)], cards: [C(1, 3)] };
    assert.deepEqual(applyPrivateLists(plain, { kind: "user" }), plain);
  });

  test("والأعمدةُ العامّةُ لا تُمَسّ في كلّ الحالات", () => {
    for (const v of [{ kind: "manager" } as const, { kind: "user" } as const,
                     { kind: "technician", technicianId: 5 } as const]) {
      const out = applyPrivateLists(data, v);
      assert.ok(out.cards.some((c) => c.listId === 1), `فُقدت بطاقةُ عمودٍ عامٍّ عند ${v.kind}`);
      assert.ok(out.lists.some((l) => l.id === 1), `فُقد عمودٌ عامٌّ عند ${v.kind}`);
    }
  });

  test("اسمُ العمود «حارس المال» بإيموجيه (طلبُ محمد)", () => {
    assert.ok(GUARD_LIST_NAME.includes("حارس المال"), "اسمُ العمود ليس «حارس المال»");
    assert.ok(/[\u{1F300}-\u{1FAFF}]/u.test(GUARD_LIST_NAME), "لا إيموجي على العمود");
  });

  test("🔑 والحجبُ في **نقطةٍ واحدةٍ** تمرّ بها كلُّ فروع مسار اللوحة", () => {
    const board = read("src/app/api/field/board/route.ts");
    assert.ok(board.includes("applyPrivateLists("), "مسارُ اللوحة لا يُطبّق قاعدةَ العمود الخاصّ");
    // ولا يُطبَّق في فرعٍ واحدٍ ويُنسى في آخر: النداءُ في مخرجِ buildBoard المشترك
    const build = board.slice(board.indexOf("async function buildBoard"), board.indexOf("export async function GET"));
    assert.ok(build.includes("applyPrivateLists("), "الحجبُ خارجَ الدالّة المشتركة — ففرعٌ سيفلت");
    assert.ok(/viewer: BoardViewer/.test(build), "الدالّةُ لا تعرف الناظر");
  });
});

describe("🎯 التكليفُ نفسُه", () => {
  const A = "src/app/api/money-health/assign/route.ts";

  test("عنوانُ التكت كما طلبه محمد حرفيّاً", () => {
    assert.ok(read(A).includes("حالاتٌ حرجةٌ من المدير يجب اتّخاذُ إجراءٍ بها"), "العنوانُ مختلف");
  });

  test("وكلُّ حالةٍ في التكت بتفاصيلها **وطريقةِ حلّها**", () => {
    const src = read(A);
    assert.ok(/x\.detail/.test(src) && /x\.how/.test(src), "التكتُ بلا تفاصيلَ أو بلا طريقةِ حلّ");
  });

  test("🔒 المُخاطَبُ مُصادَقٌ عليه ضدّ وكيلِ الجلسة — فلا تكليفَ عابرٌ للوكلاء", () => {
    const src = read(A);
    assert.ok(/prisma\.user\.findFirst\(\{[\s\S]{0,120}agentId/.test(src), "المستخدمُ بلا مصادقةِ وكيل");
    assert.ok(/prisma\.technician\.findFirst\(\{[\s\S]{0,120}agentId/.test(src), "الفنيُّ بلا مصادقةِ وكيل");
  });

  test("لا تُكلَّف حالةٌ مرّتَين — قيدٌ فريدٌ في القاعدة وskipDuplicates", () => {
    assert.ok(read(A).includes("skipDuplicates: true"), "قد تُنشَأ تكليفاتٌ مكرَّرة");
    assert.ok(read("prisma/schema.prisma").includes(`@@unique([agentId, checkKey, rowKey])`),
      "لا قيدَ فريداً على التكليف");
  });

  test("🔔 والإشعارُ موجَّهٌ لا عامّ — ولا يراه غيرُ المُخاطَب", () => {
    assert.ok(read("src/lib/notify.ts").includes("userId: opts.userId ?? null"), "notify لا يحمل مُخاطَباً");
    const n = read("src/app/api/field/notifications/route.ts");
    assert.ok(/OR: \[\{ userId: null \}, \{ userId: me \}\]/.test(n), "قائمةُ الإشعارات لا تحترم المُخاطَب");
    assert.equal((n.match(/OR: \[\{ userId: null \}/g) ?? []).length, 2,
      "شرطُ «مقروء» يخالف شرطَ القراءة — فيُعلَّم إشعارُ غيري مقروءاً");
  });

  test("والحالاتُ **وحدَها** في القائمة — لا صفوفٌ خضراءُ تزحم الصفحة", () => {
    const btn = read("src/components/MoneyHealthButton.tsx");
    assert.ok(/h\.checks\.filter\(\(c\) => !c\.ok && c\.cases\.length > 0\)/.test(btn),
      "ما زالت الحقائقُ السليمةُ تُعرَض صفّاً صفّاً");
    assert.ok(/حقيقةً سليمةً/.test(btn), "لا سطرَ خلاصةٍ للسليم — فالرقمُ يضيع");
  });
});
