import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ingest, chatList, messageList, setContact, clearOfficeChat } from "../src/lib/waBaileysChat";
import type { WAMessage } from "@whiskeysockets/baileys";

const mk = (jid: string, id: string, fromMe: boolean, ts: number, message: unknown, pushName?: string): WAMessage =>
  ({ key: { remoteJid: jid, id, fromMe }, messageTimestamp: ts, pushName, message } as unknown as WAMessage);

describe("مخزنُ محادثات Baileys — المرحلة ٣ (طلبُ محمد 2026-11-24)", () => {
  test("رسالةٌ نصّيّةٌ واردةٌ تظهر في القائمة بعدّاد غير مقروء", () => {
    const o = 9001; clearOfficeChat(o);
    ingest(o, mk("964770000001@s.whatsapp.net", "m1", false, 1000, { conversation: "مرحبا" }, "أحمد"));
    const chats = chatList(o);
    assert.equal(chats.length, 1);
    assert.equal(chats[0].name, "أحمد");
    assert.equal(chats[0].last, "مرحبا");
    assert.equal(chats[0].unread, 1);
    assert.equal(chats[0].isGroup, false);
  });

  test("الصورةُ: المعاينةُ تعليقٌ أو «📷 صورة»، والنوعُ image وله وسائط", () => {
    const o = 9002; clearOfficeChat(o);
    ingest(o, mk("964770000002@s.whatsapp.net", "i1", false, 2000, { imageMessage: { caption: "", mimetype: "image/jpeg" } }));
    ingest(o, mk("964770000002@s.whatsapp.net", "i2", false, 2001, { imageMessage: { caption: "وصلٌ", mimetype: "image/jpeg" } }));
    const msgs = messageList(o, "964770000002@s.whatsapp.net");
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].type, "image");
    assert.equal(msgs[0].hasMedia, true);
    assert.equal(msgs[1].body, "وصلٌ");
    assert.equal(chatList(o)[0].last, "وصلٌ"); // الأحدث نصُّه تعليق
  });

  test("فتحُ المحادثة (messageList) يصفّر غيرَ المقروء، ورسالتي لا تزيده", () => {
    const o = 9003; clearOfficeChat(o);
    ingest(o, mk("g@s.whatsapp.net", "a", false, 10, { conversation: "واحد" }));
    ingest(o, mk("g@s.whatsapp.net", "b", false, 20, { conversation: "اثنان" }));
    assert.equal(chatList(o)[0].unread, 2);
    messageList(o, "g@s.whatsapp.net");
    assert.equal(chatList(o)[0].unread, 0);
    ingest(o, mk("g@s.whatsapp.net", "c", true, 30, { conversation: "ردّي" }));
    assert.equal(chatList(o)[0].unread, 0); // fromMe لا يزيد غيرَ المقروء
    assert.equal(chatList(o)[0].last, "ردّي");
  });

  test("المجموعةُ تُعلَّم isGroup، والترتيبُ بالأحدث", () => {
    const o = 9004; clearOfficeChat(o);
    ingest(o, mk("111@s.whatsapp.net", "x", false, 100, { conversation: "قديم" }));
    ingest(o, mk("222@g.us", "y", false, 200, { conversation: "جديد" }));
    const chats = chatList(o);
    assert.equal(chats[0].id, "222@g.us");
    assert.equal(chats[0].isGroup, true);
    assert.equal(chats[1].id, "111@s.whatsapp.net");
  });

  test("status@broadcast ورسائلُ التفاعل/البروتوكول تُتجاهَل", () => {
    const o = 9005; clearOfficeChat(o);
    ingest(o, mk("status@broadcast", "s", false, 1, { conversation: "حالة" }));
    ingest(o, mk("333@s.whatsapp.net", "r", false, 2, { reactionMessage: { text: "👍" } }));
    assert.equal(chatList(o).length, 0);
  });

  test("setContact يسمّي محادثةً كانت بالرقم", () => {
    const o = 9006; clearOfficeChat(o);
    ingest(o, mk("964771111111@s.whatsapp.net", "m", false, 5, { conversation: "ا" }));
    assert.equal(chatList(o)[0].name, "964771111111");
    setContact(o, "964771111111@s.whatsapp.net", "سعد");
    assert.equal(chatList(o)[0].name, "سعد");
  });
});
