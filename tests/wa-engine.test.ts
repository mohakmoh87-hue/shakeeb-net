import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isBaileysOffice } from "../src/lib/waBaileys";

const wa = fs.readFileSync(path.join(process.cwd(), "src/lib/whatsapp.ts"), "utf8");

describe("اختيارُ محرّك واتساب — تحوّلُ Baileys (طلبُ محمد 2026-11-24)", () => {
  test("الافتراضيُّ Baileys لكلّ مكتب — لأنّ whatsapp-web.js مكسورٌ عالميّاً", () => {
    delete process.env.WA_WWEBJS_OFFICES;
    assert.equal(isBaileysOffice(5), true);
    assert.equal(isBaileysOffice(999), true);
  });

  test("منفذُ الهروب `WA_WWEBJS_OFFICES` يُبقي مكتباً بعينه على القديم", () => {
    process.env.WA_WWEBJS_OFFICES = "5, 6";
    assert.equal(isBaileysOffice(5), false);
    assert.equal(isBaileysOffice(6), false);
    assert.equal(isBaileysOffice(7), true);
    delete process.env.WA_WWEBJS_OFFICES;
  });

  test("الدوالُّ الأربعُ موصولةٌ بالمحرّك — فلا مكتبٌ يبقى على المسار المكسور صامتاً", () => {
    for (const fn of ["startWhatsApp", "whatsappStatus", "logoutWhatsApp", "waReadyLocal"]) {
      const re = new RegExp(`${fn}[\\s\\S]{0,140}isBaileysOffice`);
      assert.match(wa, re, `${fn} غيرُ موصولةٍ بـisBaileysOffice`);
    }
  });

  test("مسارُ الإرسال والمُرحِّل يوجّهان إلى Baileys", () => {
    assert.match(wa, /sendBaileysLocal/);
    assert.match(wa, /baileysReadyLocal\(officeId\)/);
    assert.match(wa, /baiRelay \? await sendBaileysLocal/);
  });
});
