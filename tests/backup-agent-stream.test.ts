import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { parseBackupFile } from "../src/lib/backup";

// ═════ نسخةُ الوكيل البثّيّة (إصلاح 2026-08-29) ═════
// كانت تبني سلسلةً عملاقةً (JSON.stringify للوكيل كلِّه) فتتجاوز حدَّ V8 ⇒ RangeError ⇒ 500.
// الآن تُبثّ صفحةً صفحة. هذا الحارسُ يثبّت **عقدَ البنية**: ما يُصدَّر يُطابق ما يقرؤه الاسترجاع
// (parseBackupFile)، ويثبّت أنّ نمطَ التجميع (فواصل/أقواس) يُنتج JSON صالحاً في كلّ الحالات.

// يُحاكي تجميعَ exportAgentBackupTo حرفيّاً (نفسُ منطق الفواصل والأقواس)
function assembleAgentBackupJson(
  meta: { agentId: number; agentName: string | null; backupEmail: string | null; exportedAt: string },
  tables: Record<string, Record<string, unknown>[]>,
  settings: Record<string, unknown>[],
): string {
  let out = '{"version":1,"agentId":' + meta.agentId +
    ',"agentName":' + JSON.stringify(meta.agentName) +
    ',"backupEmail":' + JSON.stringify(meta.backupEmail) +
    ',"exportedAt":' + JSON.stringify(meta.exportedAt) + ',"tables":{';
  let firstTable = true;
  for (const [label, rows] of Object.entries(tables)) {
    out += (firstTable ? "" : ",") + JSON.stringify(label) + ":[";
    firstTable = false;
    let firstRow = true;
    for (const r of rows) { out += (firstRow ? "" : ",") + JSON.stringify(r); firstRow = false; }
    out += "]";
  }
  out += '},"settings":[';
  let firstS = true;
  for (const s of settings) { out += (firstS ? "" : ",") + JSON.stringify(s); firstS = false; }
  out += "]}";
  return out;
}

describe("نسخةُ الوكيل البثّيّة — عقدُ البنية والاسترجاع", () => {
  test("البنيةُ المبثوثةُ JSON صالحةٌ وتُطابق ما يقرؤه parseBackupFile (round-trip)", () => {
    const meta = { agentId: 5, agentName: "وكالة النور \"للإنترنت\"", backupEmail: "a@b.com", exportedAt: "2026-08-29T00:00:00.000Z" };
    const tables = {
      subscribers: [{ id: 1, name: "خالد", phone: "0770" }, { id: 2, name: "زهراء", phone: null }],
      cards: [],
      card_photos: [{ id: 9, cardId: 3, photo: "data:image/png;base64,AAAA" }],
    };
    const settings = [{ id: 7, type: "receipt:5", text: "قالب", value: null }];
    const json = assembleAgentBackupJson(meta, tables, settings);

    const obj = JSON.parse(json); // لا يرمي ⇒ JSON صالح
    assert.equal(obj.version, 1);
    assert.equal(obj.agentId, 5);
    assert.equal(obj.agentName, 'وكالة النور "للإنترنت"'); // الاقتباساتُ داخل الاسم لا تكسر البنية
    assert.deepEqual(Object.keys(obj.tables), ["subscribers", "cards", "card_photos"]);
    assert.equal(obj.tables.subscribers.length, 2);
    assert.deepEqual(obj.tables.cards, []);
    assert.deepEqual(obj.settings, settings);

    // نفسُ مسار الاسترجاع: gzip ← parseBackupFile
    const parsed = parseBackupFile(gzipSync(Buffer.from(json)));
    assert.equal(parsed.agentId, 5);
    assert.equal(parsed.version, 1);
    assert.deepEqual(parsed.tables.subscribers[0], { id: 1, name: "خالد", phone: "0770" });
    assert.equal(parsed.settings.length, 1);
  });

  test("حالاتُ الحافّة: بلا جداولَ وبلا إعداداتٍ ⇒ JSON صالح", () => {
    const json = assembleAgentBackupJson({ agentId: 1, agentName: null, backupEmail: null, exportedAt: "x" }, {}, []);
    const obj = JSON.parse(json);
    assert.deepEqual(obj.tables, {});
    assert.deepEqual(obj.settings, []);
    assert.equal(obj.agentName, null);
  });

  test("parseBackupFile يرفضُ ملفّاً فاسداً (بلا tables)", () => {
    assert.throws(() => parseBackupFile(gzipSync(Buffer.from('{"version":1,"nope":true}'))));
  });
});
