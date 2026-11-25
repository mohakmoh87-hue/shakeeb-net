import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { packageSpeedMbps } from "../src/lib/packageSpeed";

describe("استخراجُ سرعة الباقة من اسمها (طلبُ محمد 2026-11-25)", () => {
  test("ميغابت عربيّة + أرقام عربيّة", () => {
    assert.equal(packageSpeedMbps("برو ماكس 50 — سرعة 50 ميغابت"), 50);
    assert.equal(packageSpeedMbps("٣٠ ميغابت"), 30);
    assert.equal(packageSpeedMbps("باقة الطالب — 15 ميغا"), 15);
  });
  test("وحداتٌ إنجليزيّة", () => {
    assert.equal(packageSpeedMbps("Pro 100Mbps"), 100);
    assert.equal(packageSpeedMbps("50M"), 50);
    assert.equal(packageSpeedMbps("Speed: 75 Mega"), 75);
  });
  test("رقمٌ وحيدٌ بلا وحدة", () => {
    assert.equal(packageSpeedMbps("برو 50"), 50);
  });
  test("رقمان بلا وحدةٍ ⇒ غموضٌ فلا قيمة", () => {
    assert.equal(packageSpeedMbps("باقة 2 جهاز 80"), null);
  });
  test("بلا رقمٍ أو اسمٍ فارغ", () => {
    assert.equal(packageSpeedMbps(""), null);
    assert.equal(packageSpeedMbps(null), null);
    assert.equal(packageSpeedMbps("باقة بريميوم"), null);
  });
  test("قيمٌ خارج المدى تُرفَض", () => {
    assert.equal(packageSpeedMbps("رمز 99999 ميغا"), null);
  });
});
