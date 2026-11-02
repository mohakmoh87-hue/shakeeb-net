import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 🎁 دعوةُ صديق + بنودُ تطبيق المشترك 2026-11-02 — الحرّاسُ البنيويّون ═════
//
// المالُ يتحرّك هنا: مبلغٌ يُضاف إلى رصيد كود خصمِ مشترك. فالحرّاسُ على ما لا يجوز أن
// ينكسر: لا منحَ قبل الإنجاز · لا منحَ مرّتَين · لا منحَ عبر وكيلَين · لا دعوةَ للنفس ·
// ولا عمودَ قاعدةٍ جديدٍ أصلاً (الكودُ مشتقٌّ من المعرّف بتوقيع).

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const INVITE = read("src/lib/invite.ts");
const ME = read("src/app/api/app/me/route.ts");
const REQ = read("src/app/api/app/coverage-request/route.ts");
const FIELD_TICKETS = read("src/app/api/field/subscriber-tickets/route.ts");
const COMPANY_TICKETS = read("src/app/api/company/tickets/route.ts");
const STORE = read("src/app/api/app/store/route.ts");
const FIELD_PAGE = read("src/app/(app)/field-management/page.tsx");
const SCHEMA = read("prisma/schema.prisma");

describe("🎁 دعوةُ صديق", () => {
  test("الكودُ مشتقٌّ موقَّعٌ — لا عمودَ جديدٌ في القاعدة ولا لصقةَ SQL", () => {
    assert.match(INVITE, /createHmac\("sha256", secret\)/, "كودٌ بلا توقيع ⇒ يُخمَّن كودُ غيره");
    assert.doesNotMatch(INVITE, /ALTER TABLE|ADD COLUMN|CREATE TABLE/, "لصقةُ SQL في مسارِ ميزة");
    assert.doesNotMatch(SCHEMA, /inviteCode/, "عمودٌ جديدٌ على القاعدة — والقاعدةُ لا تُمَسّ لهذه الميزة");
    assert.match(INVITE, /context: "invite"/, "المنحُ بلا سياقٍ مميَّز ⇒ لا يُميَّز عن منح التفعيل");
  });

  test("💰 لا منحَ إلّا عند الإنجاز الفعليّ — لا عند إرسال الطلب", () => {
    assert.doesNotMatch(REQ, /creditInvite/, "المنحُ عند الإرسال ⇒ طلبٌ وهميٌّ يصنع مالاً");
    for (const [name, src] of [["الوكيل", FIELD_TICKETS], ["الشركة", COMPANY_TICKETS]] as const) {
      assert.match(src, /status === "done" && t\.status !== "done"/, `${name}: المنحُ يتكرّر مع كلّ ضغطةِ «منجزة»`);
      assert.match(src, /creditInviteForTicket\(/, `${name}: الإنجازُ لا يمنح شيئاً`);
    }
  });

  test("🔒 لا منحَ مرّتَين، ولا عبر وكيلَين، ولا بمبلغٍ صفر", () => {
    assert.match(INVITE, /refId: ticketId, context: "invite"/, "بلا فحصِ سابقةٍ ⇒ منحٌ مكرّر");
    assert.match(INVITE, /inviter\.agentId !== ticket\.agentId/, "وكيلٌ يموّل خصمَ مشترك وكيلٍ آخر");
    assert.match(INVITE, /if \(amount <= 0\) return 0/, "منحٌ بلا مبلغٍ مضبوط");
    const tx = INVITE.slice(INVITE.indexOf("prisma.$transaction"));
    assert.match(tx, /const again = await tx\.rewardLog\.findFirst/, "الفحصُ خارج المعاملة وحدَه ⇒ سباقٌ يمنح مرّتَين");
  });

  test("🙅 لا يدعو أحدٌ نفسَه", () => {
    assert.match(REQ, /phoneCore\(found\.phone \?\? ""\) !== core/, "كودُه على رقمه هو يُقبَل");
  });

  test("الكودُ لا يُعرَض إلّا لمشتركٍ فعّالٍ ومبلغٌ مضبوط", () => {
    assert.match(ME, /st\.state === "active" && \(await getInviteBonus\(\)\) > 0/, "كودٌ لمن ليس فعّالاً أو وعدٌ بلا مقابل");
  });
});

describe("🏬 متجرُ الوكيل واسمُ المكتب", () => {
  test("موادُّ وكيلِ المشترك أوّلاً ثمّ الباقون", () => {
    assert.match(STORE, /agentId: viewerAgentId/, "لا تمييزَ لمواد وكيله");
    assert.match(STORE, /NOT: \{ agentId: viewerAgentId \}/, "بقيّةُ الوكلاء بلا استثناءِ وكيله ⇒ تكرار");
    assert.match(STORE, /skip: Math\.max\(0, skip - mineCount\)/, "الترقيمُ لا يمرّ على القائمتَين ⇒ مادّةٌ تسقط بين صفحتَين");
  });

  test("اسمُ المتجر: مكتبُه حين يكون واحداً لا اسمَ الوكيل دائماً", () => {
    assert.match(STORE, /storeName:/, "المادّةُ بلا اسمِ متجر");
    assert.match(STORE, /officeName\.has\(t\.agentId\) \? null : t\.name/, "وكيلٌ بعدّة مكاتبَ يُنسَب لمكتبٍ واحدٍ منها");
  });
});

describe("🧰 ما يراه الفنيّ بعد خصم الكود", () => {
  test("الملخّصُ يطرح الخصمَ كما يفعل الخادم", () => {
    assert.match(FIELD_PAGE, /const rewardDiscount = rewardPulled && reward \? Math\.min\(reward\.balance, nSale\) : 0/, "لا خصمَ محسوبٌ في الملخّص");
    assert.match(FIELD_PAGE, /\(nSale - rewardDiscount \+ nSub\)/, "«الكلي المستلم منك» يعرض ما قبل الخصم ⇒ يحسبه الفنيُّ بالحاسبة");
  });
});
