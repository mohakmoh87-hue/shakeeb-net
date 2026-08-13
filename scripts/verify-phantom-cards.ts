// ═════ فحصٌ مستقلٌّ لكلّ كارتٍ وُسِم «وهميّاً» يوماً (طلبُ محمد 2026-08-13) ═════
//
// «فحصٌ لكلّ الكروت ١٢٤٠ كارت، وكلُّ مكتبٍ بمكتبه ووكيلٍ بوكيله — فربّما هنالك كارتٌ
//  وهميٌّ بحقّ وأنت لم تنتبه.»
//
// 🔒 **قراءةٌ فقط**: لا يكتب في القاعدة ولا في الساس شيئاً. ولا يطبع اسمَ مشتركٍ ولا رقمَه.
// 🔒 **والعزلُ في صميمه**: كلُّ كارتٍ يُحاكَم بتفعيلات **مكتبِه** المجلوبةِ بحسابِ ذلك
//    المكتب و**كلِّ لوحاته**. ولا يُقارَن كارتُ مكتبٍ بأدلّةِ مكتبٍ آخرَ أبداً.
// 🔑 ويُشغَّل بـ`tsx` لا `node` عمداً: ليستعمل **دوالَّ البرنامج نفسَها** (تشفيرُ الطلب
//    وترقيمُ الصفحات وتطبيعُ الصفوف) — فما يراه هذا الفحصُ هو ما تراه المزامنةُ حرفيّاً.
//    (وأعدتُ بناءَ التشفير يدويّاً أوّلاً فأخطأتُ: المفتاحُ مُشتَقٌّ بـEVP بملحٍ لا ثابتاً.)
//
// 🎯 وسببُ الإيجابات الكاذبة حُسم — و**أوّلُ تفسيرٍ لي كان خطأً فأُثبِت خطؤه بالقياس**:
//    ظننتُ أنّ مكاتبَ بعينها «تُفعّل بالرصيد لا بالكارت» لأنّ صفوفَ قائمتها تأتي بطريقةِ
//    `credit` وبلا PIN. وصحّح محمد: **لا يوجد تفعيلٌ إلّا بالكروت**. ثمّ أثبت القياسُ صدقَه:
//    ١٦ كارتاً من ١٦ (٨ لصميم و٨ للمواصلات) **وُجدت كلُّها بالبحث الموجَّه بسيريالها**،
//    وكلُّها `voucher` بـPIN — أي أنّ التفعيلاتِ موجودةٌ في الساس، و**القائمةُ الجماعيّةُ
//    وحدَها لا تُرجعها** (سياسةُ سوبر سيل: «موجودٌ لكن لا يُمكن استخدامه»).
//
// ⇒ فالمقياسُ الصحيحُ ليس نسبةَ PIN ولا اسمَ الطريقة، بل **البحثُ الموجَّه بالسيريال**
//   (`sasSearchActivation`) — وهو ما ينجح به زرُّ «ربط» حيث تفشل القائمة.
//   والدرسُ: **أداةٌ ناقصةٌ تُنتج نظريّةً كاملةً خاطئة.** فالنسبةُ التي بنيتُ عليها
//   استنتاجي كانت أثراً من نقص الأداة لا خبراً عن عمل المكتب.
//
// فالحكمُ ثلاثيٌّ لا ثنائيّ:
//   ✅ مُثبَتٌ حقيقيّ   : سيريالُه في القائمة **أو** وجده البحثُ الموجَّه.
//   🔴 وهميٌّ بحقّ      : غائبٌ عن القائمة **وفشل البحثُ الموجَّه** في كلّ لوحات مكتبه.
//   ⚪ لا يُمكن التحقّق : الجلبُ ناقصٌ · أو استُخدم خارج النافذة.
//
//   npx tsx scripts/verify-phantom-cards.ts
//   npx tsx scripts/verify-phantom-cards.ts --days 60
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { sasBaseUrl, sasLogin, sasFetchActivationsSince, sasSearchActivation } from "@/lib/sas4";

const argDays = process.argv.indexOf("--days");
const DAYS = argDays > -1 ? Number(process.argv[argDays + 1]) || 120 : 120;
/** سقفُ عمليّات البحث الموجَّه لكلّ مكتب — حمايةٌ من إثقال الساس. */
const MAX_SEARCH = 500;

async function main() {
  const since = new Date(Date.now() - DAYS * 86400 * 1000);
  console.log(`═══ فحصُ كلّ كارتٍ وُسِم «وهميّاً» — نافذةُ ${DAYS} يوماً ═══\n`);

  // ١) كلُّ الكروت التي وُسِمت يوماً: الوسومُ الحاليّة + نسخةُ التراجع للمحذوفة
  const ids = new Set<number>();
  for (const a of await prisma.auditLog.findMany({ where: { action: "SYNC_PHANTOM_VERIFIED" }, select: { entityId: true } })) {
    const n = Number(a.entityId); if (Number.isFinite(n)) ids.add(n);
  }
  const fromLog = ids.size;
  for (const f of fs.readdirSync(process.cwd()).filter((x) => /^phantom-flags-backup-\d+\.json$/.test(x))) {
    for (const row of JSON.parse(fs.readFileSync(path.join(process.cwd(), f), "utf8")) as { entityId: string }[]) {
      const n = Number(row.entityId); if (Number.isFinite(n)) ids.add(n);
    }
    console.log(`• قُرئت نسخةُ التراجع: ${f}`);
  }
  console.log(`• وسومٌ قائمةٌ: ${fromLog} · والمجموعُ بضمّ المحذوفة: ${ids.size} كارتاً فريداً\n`);

  // ٢) كلُّ كارتٍ ومكتبُه ووكيلُه — 🔒 المكتبُ من **مشتركِ الكارت** لا تخميناً
  const cards = await prisma.rechargeCard.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, serial: true, useDate: true, subscriberId: true, agentId: true },
    orderBy: { id: "asc" },
  });
  const subIds = [...new Set(cards.map((c) => c.subscriberId).filter((x): x is number => x != null))];
  const subs = new Map((await prisma.subscriber.findMany({
    where: { id: { in: subIds } }, select: { id: true, towerId: true },
  })).map((s) => [s.id, s.towerId]));
  const towers = new Map((await prisma.tower.findMany({
    select: { id: true, name: true, agentId: true, loginUrl: true, username: true, password: true },
  })).map((t) => [t.id, t]));
  const agents = new Map((await prisma.agent.findMany({ select: { id: true, name: true } })).map((a) => [a.id, a.name]));
  console.log(`• صفوفُ الكروت الموجودة: ${cards.length}`);

  const byOffice = new Map<number, typeof cards>();
  for (const cd of cards) {
    const tid = (cd.subscriberId != null ? subs.get(cd.subscriberId) : null) ?? 0;
    if (!byOffice.has(tid)) byOffice.set(tid, []);
    byOffice.get(tid)!.push(cd);
  }

  const report: Record<string, unknown>[] = [];
  for (const [towerId, list] of [...byOffice].sort((a, b) => a[0] - b[0])) {
    const t = towers.get(towerId);
    const agentName = agents.get(list[0].agentId ?? -1) ?? "?";
    if (!towerId || !t) {
      console.log(`\n⚪ ${list.length} كارتاً بلا مشتركٍ/مكتب — لا مرجعَ يُحاكَم به`);
      report.push({ agent: agentName, office: null, cards: list.length, verified: 0, phantom: 0, unverifiable: list.length, reason: "بلا مشترك/مكتب" });
      continue;
    }
    console.log(`\n═════ ${agentName} / ${t.name} (مكتب ${towerId}) — ${list.length} كارتاً ═════`);

    // 🔒 لوحاتُ **هذا** المكتب حصراً وكلُّها (كارتٌ فُعِّل على الثانية لا تفعيلَ له في الأولى)
    const panels = (await prisma.sasPanel.findMany({
      where: { towerId, isDeleted: false },
      select: { id: true, label: true, loginUrl: true, username: true, password: true },
      orderBy: { id: "asc" },
    })).filter((p) => p.loginUrl && p.username && p.password);
    const sources = panels.length
      ? panels.map((p) => ({ label: p.label ?? `لوحة ${p.id}`, loginUrl: p.loginUrl!, username: p.username!, password: p.password! }))
      : (t.loginUrl && t.username && t.password
        ? [{ label: t.name ?? "المكتب", loginUrl: t.loginUrl, username: t.username, password: t.password }] : []);
    if (!sources.length) {
      console.log("  ⚪ لا بيانات ساسٍ لهذا المكتب — لا يُحاكَم كارتٌ منه");
      report.push({ agent: agentName, office: t.name, towerId, cards: list.length, verified: 0, phantom: 0, unverifiable: list.length, reason: "لا بيانات ساس" });
      continue;
    }

    const pins = new Set<string>();
    const sessions: { label: string; base: string; token: string }[] = []; // للبحث الموجَّه
    let rowsTotal = 0, withPin = 0, complete = true;
    const methods = new Map<string, number>();
    for (const s of sources) {
      try {
        const base = sasBaseUrl(s.loginUrl);
        const token = await sasLogin(base, s.username, s.password);
        sessions.push({ label: s.label, base, token });
        const r = await sasFetchActivationsSince(base, token, since);
        if (!r.complete) complete = false;
        rowsTotal += r.rows.length;
        let pinHere = 0;
        for (const a of r.rows) {
          const p = (a.pin ?? "").trim();
          if (p) { pins.add(p); withPin++; pinHere++; }
          const m = a.method ?? "—";
          methods.set(m, (methods.get(m) ?? 0) + 1);
        }
        console.log(`  • «${s.label}» (${s.username}): ${r.rows.length} تفعيلاً · بـPIN ${pinHere}`);
      } catch (e) {
        console.log(`  ⚠️ تعذّر «${s.label}»: ${e instanceof Error ? e.message : e}`);
        complete = false; // أدلّةٌ غائبةٌ ⇒ لا حكم
      }
    }
    const pinRate = rowsTotal ? withPin / rowsTotal : 0;
    console.log(`  الإجمالي: ${rowsTotal} تفعيلاً · بـPIN ${withPin} (${Math.round(pinRate * 100)}٪) · مكتمل ${complete}`);
    console.log(`  طرقُ التفعيل: ${[...methods].map(([k, v]) => `${k}=${v}`).join(" · ") || "—"}`);

    // 🎯 كلُّ كارتٍ غائبٍ عن القائمة يُبحَث عنه **بسيريالِه** في كلّ لوحات مكتبه قبل أيّ
    //   حكم — فالقائمةُ ناقصةٌ بسياسةِ سوبر سيل، والبحثُ الموجَّه يجد ما تُخفيه (أُثبت:
    //   ١٦ من ١٦ وُجدت كلُّها `voucher` بـPIN بعد أن غابت عن القائمة تماماً).
    let verified = 0, phantom = 0, unverifiable = 0, rescued = 0, searched = 0;
    const realPhantoms: { id: number; serial: string; useDate: string }[] = [];
    for (const cd of list) {
      const serial = (cd.serial ?? "").trim();
      if (serial && pins.has(serial)) { verified++; continue; }
      if (!serial) { unverifiable++; continue; }
      if (searched >= MAX_SEARCH) { unverifiable++; continue; } // فوق السقف: لا يُبرَّأ ولا يُدان
      searched++;
      let found = false;
      for (const s of sessions) {
        if (await sasSearchActivation(s.base, s.token, serial)) { found = true; break; }
      }
      if (found) { verified++; rescued++; continue; }
      // لم يوجد لا في القائمة ولا بالبحث ⇒ يُدان **فقط** إن كانت الأدلّةُ كاملةً وداخلَ النافذة
      if (!complete) { unverifiable++; continue; }
      if (!cd.useDate || cd.useDate < since) { unverifiable++; continue; }
      phantom++;
      realPhantoms.push({ id: cd.id, serial, useDate: cd.useDate.toISOString().slice(0, 16) });
    }
    if (rescued) console.log(`  🎯 أنقذ البحثُ الموجَّه ${rescued} كارتاً غائباً عن القائمة (من ${searched} بحثاً)`);
    console.log(`  ✅ مُثبَتٌ حقيقيّ ${verified} · 🔴 وهميٌّ بحقّ ${phantom} · ⚪ لا يُمكن التحقّق ${unverifiable}`);
    for (const r of realPhantoms) console.log(`     🔴 كارت#${r.id} · ${r.serial} · ${r.useDate}`);

    report.push({
      agent: agentName, office: t.name, towerId, cards: list.length, verified, phantom, unverifiable,
      pinRate: Math.round(pinRate * 100), rowsTotal, complete,
      methods: [...methods].map(([k, v]) => `${k}=${v}`).join(" · "), realPhantoms,
    });
  }

  const out = path.join(process.cwd(), "phantom-verification-report.json");
  fs.writeFileSync(out, JSON.stringify({ days: DAYS, at: new Date().toISOString(), report }, null, 1), "utf8");
  const sum = (k: string) => report.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  console.log(`\n═══ الحصيلة ═══`);
  console.log(`كروتٌ فُحصت ${sum("cards")} · ✅ مُثبَتة ${sum("verified")} · 🔴 وهميّةٌ بحقّ ${sum("phantom")} · ⚪ لا يُمكن التحقّق ${sum("unverifiable")}`);
  console.log(`📄 التقرير: ${out}`);
  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error("🔴", e instanceof Error ? e.message : e);
  process.exitCode = 1;
  await prisma.$disconnect().catch(() => {});
});
