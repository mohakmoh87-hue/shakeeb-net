import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { agentTowerIds } from "@/lib/guard";
import type { SessionPayload } from "@/lib/auth";
import type { DelKind } from "./deletedReceipts";

// ═════ ♻️ إرجاعُ وصلٍ محذوف — المرحلةُ الثانية (طلبُ محمد 2026-08-22) ═════
//
// بنصّه: «وعند ارجاع وصل يرجع كانه لم يحذف اصلا بكل تاثيراته».
//
// 📐 **لماذا بلا جدولِ لقطةٍ ولا لمسِ مسارات الحذف** (وكان مقترَحاً في الخطّة):
//   كلُّ ما يحتاجه العكسُ **محفوظٌ أصلاً ومُشتقٌّ بيقين**:
//     • المالُ: حركاتُ الوصل موجودةٌ **مخفيّةً لا ممحوّة**، وتُميَّز حركاتُ *هذا* الحذف
//       بأنّها كُتبت في **معاملته نفسِها** ⇒ `updatedAt` بينها وبين الوصل أقلُّ من ثانيةٍ
//       (نافذةُ ١٥ ثانيةً احتياطاً). فلا يُحيا صفٌّ أطفأه إبطالٌ آخرُ مستقلّ.
//     • الأيّامُ والدَّينُ: `dateTo` و(money + addPrice − moneyIn) من الوصل نفسِه.
//     • الكارتُ: `card2`. • المكافأةُ: صفُّ `rewardLog` نوعه `reverse` يحمل المبلغَ والكودَ.
//   فالنتيجةُ: **صفرُ تعديلٍ في مسارات الحذف الأربعة**، وهو شرطُ محمد «لا تؤثّر على الأكواد».
//
// 🛡️ ولا يُرجَع شيءٌ إلّا بعد **تسعةِ فحوصٍ** تردّ بجملةٍ عربيّةٍ تشرح المنع — لأنّ المسحَ
//   العدائيَّ أحصى ٢١ حالةً يُفسد فيها الإرجاعُ الساذجُ بياناتٍ قائمة.

export type BlockCode =
  | "not_found" | "not_deleted" | "purged" | "duplicate" | "card_taken"
  | "salary_locked" | "linked_doc_deleted" | "invoice_reverse" | "sale_reverse" | "pair_missing";

export type Block = { code: BlockCode; message: string; override: boolean };
export type Note = { message: string };

export type RestorePlan = {
  kind: DelKind;
  id: number;
  title: string;
  mode: "reverse" | "plain" | null;
  /** ما سيقع فعلاً عند التنفيذ — يُعرَض للمستخدم قبل الضغط */
  actions: string[];
  blocks: Block[];
  notes: Note[];
};

export type RestoreOutcome = RestorePlan & { ok: boolean; done?: string[] };

/** نافذةُ «نفس المعاملة»: الوصلُ وحركاتُه تُكتب في معاملةٍ واحدة، فالفارقُ أجزاءُ ثانية */
const SAME_TX_MS = 15_000;
/** نافذةُ «وصلٌ بديل» — نفسُ نافذة محمد للكارت والتفعيل (±٣ أيّام) */
const DUP_WINDOW_MS = 3 * 86_400_000;
const MONEY_KINDS = ["activation", "manual", "master"];

const ar = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("en-US");

function modeOf(details: string | null | undefined): "reverse" | "plain" | null {
  if (!details) return null;
  if (details.includes("بلا تأثير")) return "plain";
  if (details.includes("عكس")) return "reverse";
  return null;
}

/** آخرُ قيدِ تدقيقٍ لحذف هذه الوثيقة — منه تُعرَف طريقةُ الحذف */
async function lastVoidAudit(entity: string, id: number, actions: string[]) {
  return prisma.auditLog.findFirst({
    where: { action: { in: actions }, entity, entityId: String(id) },
    orderBy: { id: "desc" },
    select: { details: true, createdAt: true },
  });
}

/**
 * يبني خطّةَ الإرجاع (وينفّذها إن لم يكن `dryRun`).
 * 🔒 العزلُ يُعاد التحقّقُ منه في **جملة الجلب وفي كلّ كتابة** — لا بالمعرّف وحدَه.
 */
export async function restoreReceipt(
  session: SessionPayload | null,
  input: { kind: DelKind; id: number; dryRun: boolean; overrides: string[] },
): Promise<RestoreOutcome> {
  const { kind, id, dryRun, overrides } = input;
  const agentId = session?.agentId ?? -1;
  const towers = await agentTowerIds(session);
  const scope = { towerId: { in: towers.length ? towers : [-1] } };

  const blocks: Block[] = [];
  const notes: Note[] = [];
  const actions: string[] = [];
  const allowed = (c: BlockCode) => overrides.includes(c);

  const fail = (code: BlockCode, message: string, override = false): RestoreOutcome => ({
    kind, id, title: "", mode: null, actions: [], blocks: [{ code, message, override }], notes: [], ok: false,
  });

  // ═════ ① وصلُ تفعيل ═════
  if (kind === "activation") {
    const entry = await prisma.subscriptionEntry.findFirst({ where: { id, ...scope } });
    if (!entry) return fail("not_found", "الوصلُ غير موجودٍ ضمن مكاتبك");
    if (!entry.isDeleted) return fail("not_deleted", "الوصلُ غيرُ محذوفٍ أصلاً");

    const audit = await lastVoidAudit("subscriptionEntry", id, ["VOID_RECEIPT"]);
    const mode = modeOf(audit?.details) ?? "reverse"; // بلا قيدٍ نفترض الأحوط: عكسيّاً
    const title = `وصل تفعيل #${id} — ${ar(entry.money)}`;

    const sub = entry.subscriberId
      ? await prisma.subscriber.findUnique({ where: { id: entry.subscriberId } })
      : null;
    if (sub?.purgedAt) blocks.push({ code: "purged", message: "المشتركُ مُسِح نهائيّاً — لا يُعاد له أثرٌ ماليّ", override: false });

    // 🚧 وصلٌ بديلٌ أُدخل بعد الحذف ⇒ إرجاعُ القديم ازدواجٌ كامل (حالةُ حيدر 2026-08-22)
    if (entry.subscriberId && entry.date) {
      const dup = await prisma.subscriptionEntry.findFirst({
        where: {
          subscriberId: entry.subscriberId, isDeleted: false, id: { not: id }, ...scope,
          date: { gte: new Date(entry.date.getTime() - DUP_WINDOW_MS), lte: new Date(entry.date.getTime() + DUP_WINDOW_MS) },
          money: { gt: 0 },
        },
        select: { id: true, money: true, date: true },
      });
      if (dup) {
        blocks.push({
          code: "duplicate",
          message: `للمشترك وصلٌ حيٌّ آخر (#${dup.id} بمبلغ ${ar(dup.money)}) ضمن ±٣ أيّام — الإرجاعُ يُنتج وصلَين لدفعةٍ واحدة`,
          override: true,
        });
      }
    }

    // حركاتُ المال التي أطفأها **هذا الحذفُ بعينه** (نفسُ المعاملة)
    const voidAt = entry.updatedAt.getTime();
    const txs = (
      await prisma.moneyTx.findMany({
        where: { sourceId: id, sourceType: { in: MONEY_KINDS }, isDeleted: true, ...scope },
        select: { id: true, moneyIn: true, moneyOut: true, updatedAt: true, salaryStatementId: true, settledAt: true, sourceType: true },
      })
    ).filter((t) => Math.abs(t.updatedAt.getTime() - voidAt) <= SAME_TX_MS);

    const locked = txs.find((t) => t.salaryStatementId != null || t.settledAt != null);
    if (locked) {
      blocks.push({
        code: "salary_locked",
        message: `حركةُ المال #${locked.id} موسومةٌ بكشفِ راتبٍ أو تسديدِ مكتب — إرجاعُها يخلّ بحسابٍ مُقفَل`,
        override: false,
      });
    }

    // الكارت: لا يُسترَدّ إن صار لمشتركٍ آخر
    let cardId: number | null = null;
    if (entry.card2 && entry.subscriberId) {
      const card = await prisma.rechargeCard.findFirst({
        where: { agentId, serial: entry.card2 },
        select: { id: true, useDate: true, subscriberId: true },
      });
      if (!card) {
        notes.push({ message: `الكارتُ ${entry.card2} لم يعد في مخزنك — يُرجَع الوصلُ بلا كارت` });
      } else if (card.useDate != null && card.subscriberId !== entry.subscriberId) {
        blocks.push({
          code: "card_taken",
          message: `الكارتُ ${entry.card2} صار مستهلَكاً لمشتركٍ آخر — إرجاعُ ربطِه يسرقه منه`,
          override: true,
        });
      } else if (card.useDate == null) {
        cardId = card.id;
      }
    }

    // المكافأة: عكسُ العكس مضبوطٌ بصفّ `reverse` نفسِه (المبلغُ والكودُ محفوظان فيه)
    const rev = entry.subscriberId
      ? await prisma.rewardLog.findFirst({
          where: { subscriberId: entry.subscriberId, refId: id, kind: "reverse" },
          orderBy: { id: "desc" },
        })
      : null;

    // الأيّام: لا تُعاد إلى الوراء أبداً
    const restoreDate = mode === "reverse" && entry.dateTo && (!sub?.dateTo || sub.dateTo < entry.dateTo);
    if (mode === "reverse" && entry.dateTo && !restoreDate) {
      notes.push({ message: "تاريخُ انتهاء المشترك أحدثُ من هذا الوصل — يُترَك كما هو ولا يُرجَع إلى الوراء" });
    }

    const debtAdded = (entry.money ?? 0) + (entry.addPrice ?? 0) - (entry.moneyIn ?? 0);
    actions.push("رفعُ الإخفاء عن الوصل");
    if (mode === "reverse") {
      if (txs.length) actions.push(`إعادةُ ${txs.length} حركةَ مالٍ إلى الصندوق (${ar(txs.reduce((s, t) => s + (t.moneyIn ?? 0), 0))})`);
      if (restoreDate) actions.push("إعادةُ تاريخ الانتهاء إلى ما كان عليه الوصل");
      if (debtAdded !== 0) actions.push(`إعادةُ الدَّين المرحَّل (${ar(debtAdded)})`);
      if (cardId) actions.push(`إعادةُ ربط الكارت ${entry.card2}`);
      if (rev) actions.push(`إعادةُ المكافأة (${ar(rev.amount)})`);
    } else {
      notes.push({ message: "حُذف «بلا أثرٍ ماليّ» — فلا شيءَ يُعكَس: رفعُ الإخفاء يُعيده كما كان تماماً" });
    }

    const hard = blocks.filter((b) => !b.override || !allowed(b.code));
    if (dryRun || hard.length) return { kind, id, title, mode, actions, blocks, notes, ok: hard.length === 0 };

    const done: string[] = [];
    await prisma.$transaction(async (t) => {
      // 🔒 كلُّ كتابةٍ تُعيد شرطَ النطاق — فمعرّفٌ غريبٌ لا يُنفَّذ ولو تسلّل
      const up = await t.subscriptionEntry.updateMany({ where: { id, isDeleted: true, ...scope }, data: { isDeleted: false } });
      if (up.count === 0) throw new Error("الوصلُ لم يعد محذوفاً");
      done.push("رُفع الإخفاء");

      if (mode === "reverse") {
        if (txs.length) {
          const r = await t.moneyTx.updateMany({ where: { id: { in: txs.map((x) => x.id) }, isDeleted: true, ...scope }, data: { isDeleted: false } });
          if (r.count) done.push(`أُعيدت ${r.count} حركةَ مال`);
        }
        if (entry.subscriberId) {
          const data: Prisma.SubscriberUpdateInput = {};
          if (restoreDate) data.dateTo = entry.dateTo;
          // الدَّينُ بزيادةٍ ذرّيّةٍ لا بكتابةٍ مطلقة — فتفعيلٌ متزامنٌ لا يُمحى
          if (debtAdded !== 0) data.carry = { increment: debtAdded };
          if (Object.keys(data).length) {
            await t.subscriber.updateMany({ where: { id: entry.subscriberId, ...scope }, data: data as Prisma.SubscriberUpdateManyMutationInput });
            done.push(restoreDate ? "أُعيد التاريخ والدَّين" : "أُعيد الدَّين");
          }
        }
        if (cardId) {
          const c = await t.rechargeCard.updateMany({
            where: { id: cardId, agentId, useDate: null },
            data: { useDate: entry.date ?? new Date(), subscriberId: entry.subscriberId, userName: entry.createdByUser ?? null },
          });
          if (c.count) done.push("أُعيد ربطُ الكارت");
        }
        if (rev && entry.subscriberId) {
          const s = await t.subscriber.findUnique({ where: { id: entry.subscriberId }, select: { rewardBalance: true, rewardGrantCount: true } });
          await t.subscriber.update({
            where: { id: entry.subscriberId },
            data: {
              rewardBalance: (s?.rewardBalance ?? 0) + rev.amount,
              rewardCode: rev.code,
              rewardGrantCount: (s?.rewardGrantCount ?? 0) + 1,
            },
          });
          // ⚠️ صفُّ العكس **يُحذف** لا يُترَك: بقاؤه يجعل حذفاً قادماً يظنّ المكافأةَ
          //    معكوسةً سلفاً فلا يعكسها ⇒ رصيدٌ ممنوحٌ بلا وصل (علّةٌ أحصاها المسح).
          await t.rewardLog.delete({ where: { id: rev.id } });
          done.push("أُعيدت المكافأة");
        }
      }

      await t.auditLog.create({
        data: {
          userId: session?.userId, action: "RESTORE_RECEIPT", entity: "subscriptionEntry", entityId: String(id),
          details: `إرجاع وصل تفعيل ${mode === "reverse" ? "بأثره الماليّ" : "بلا أثرٍ ماليّ"} - مشترك ${entry.subscriberId} - مبلغ ${entry.money} - ${done.join(" · ")}`
            + (overrides.length ? ` - إقرارٌ صريح: ${overrides.join(",")}` : ""),
        },
      });
    });
    return { kind, id, title, mode, actions, blocks, notes, ok: true, done };
  }

  // ═════ ② فاتورةُ مبيع ═════
  if (kind === "invoice") {
    const inv = await prisma.invoice.findFirst({ where: { id, ...scope } });
    if (!inv) return fail("not_found", "الفاتورةُ غير موجودةٍ ضمن مكاتبك");
    if (!inv.isDeleted) return fail("not_deleted", "الفاتورةُ غيرُ محذوفةٍ أصلاً");

    const audit = await lastVoidAudit("invoice", id, ["VOID_RECEIPT"]);
    const mode = modeOf(audit?.details) ?? "reverse";
    const title = `فاتورة مبيع #${inv.number ?? id} — ${ar(inv.totalMy)}`;

    // ⛔ الحذفُ العكسيُّ للفاتورة **لا يُرَدّ بيقين**: بنودُها وُسمت محذوفةً وبضاعتُها رجعت
    //   للمخزن (وربّما بيعت لغيره)، وخصمُ المكافأة عُكس. فالإرجاعُ إمّا فاتورةٌ فارغةٌ
    //   بإجماليٍّ لا يطابق، أو خصمُ مخزونٍ يهبط تحت الصفر.
    if (mode === "reverse") {
      return {
        kind, id, title, mode, actions: [], notes: [],
        blocks: [{
          code: "invoice_reverse",
          message: "هذه الفاتورةُ حُذفت **بأثرٍ ماليّ**: رجعت بضاعتُها للمخزن وأُلغي مالُها وعُكس خصمُ مكافأتها. وإرجاعُها لا يصحّ آليّاً (بنودُها موسومةٌ محذوفةً وقد بيعت بضاعتُها لغيره) — أنشئ فاتورةً جديدةً بدلاً منها",
          override: false,
        }],
        ok: false,
      };
    }

    actions.push("رفعُ الإخفاء عن الفاتورة");
    notes.push({ message: "حُذفت «بلا أثرٍ ماليّ» — بنودُها ومالُها ومخزنُها لم تُمَسّ، فالإرجاعُ يُعيدها كما كانت" });
    if (dryRun) return { kind, id, title, mode, actions, blocks, notes, ok: true };

    await prisma.$transaction(async (t) => {
      const up = await t.invoice.updateMany({ where: { id, isDeleted: true, ...scope }, data: { isDeleted: false } });
      if (up.count === 0) throw new Error("الفاتورةُ لم تعد محذوفة");
      await t.auditLog.create({
        data: {
          userId: session?.userId, action: "RESTORE_RECEIPT", entity: "invoice", entityId: String(id),
          details: `إرجاع فاتورة مبيع #${inv.number ?? id} بلا أثرٍ ماليّ - إجمالي ${inv.totalMy} - واصل ${inv.waselHim}`,
        },
      });
    });
    return { kind, id, title, mode, actions, blocks, notes, ok: true, done: ["رُفع الإخفاء"] };
  }

  // ═════ ③ قيدُ صندوق ═════
  if (kind === "money") {
    const tx = await prisma.moneyTx.findFirst({ where: { id, ...scope } });
    if (!tx) return fail("not_found", "الحركةُ غير موجودةٍ ضمن مكاتبك");
    if (!tx.isDeleted) return fail("not_deleted", "الحركةُ غيرُ محذوفةٍ أصلاً");

    const audit = await lastVoidAudit("moneyTx", id, ["VOID_MONEY"]);
    const mode = modeOf(audit?.details) ?? null;
    const isPair = /زوج تحويل/.test(audit?.details ?? "");
    const title = `قيد صندوق #${id} — ${ar(tx.moneyIn || tx.moneyOut)}`;

    if (tx.salaryStatementId != null || tx.settledAt != null) {
      return fail("salary_locked", "هذه الحركةُ موسومةٌ بكشفِ راتبٍ أو تسديدِ مكتب — إرجاعُها يخلّ بحسابٍ مُقفَل");
    }

    // 🔴 **العبرةُ بحال الوثيقة الآن لا بطريقة الحذف** (اصطادته تجربةُ dryRun على الإنتاج
    //   2026-08-22): حين يُحذف الوصلُ تُطفأ حركاتُه **بلا قيدِ تدقيقٍ خاصٍّ بها** ⇒ `mode`
    //   يخرج `null`، فلو عُلِّق الفحصُ على «عكسيّ» لمرّت أخطرُ الحالات: يعود المبلغُ إلى
    //   الصندوق ووصلُه ما يزال مخفيّاً ⇒ رقمان لا يتّسقان وحالةٌ حرجةٌ في حارس المال.
    //   وإن كانت الوثيقةُ **حيّةً** (حُذف قيدُها وحدَه من الصندوق) فالإرجاعُ صحيحٌ ويمرّ.
    if (tx.sourceId) {
      const linksEntry = tx.sourceType === "activation" || tx.sourceType === "master" || tx.sourceType === "manual";
      const linksInvoice = tx.sourceType === "invoice" || tx.sourceType === "master-invoice";
      if (linksEntry || linksInvoice) {
        const gone = linksEntry
          ? await prisma.subscriptionEntry.findFirst({ where: { id: tx.sourceId, isDeleted: true, ...scope }, select: { id: true } })
          : await prisma.invoice.findFirst({ where: { id: tx.sourceId, isDeleted: true, ...scope }, select: { id: true } });
        if (gone) {
          return fail("linked_doc_deleted",
            linksEntry
              ? `هذا مالُ وصل تفعيلٍ محذوف (#${tx.sourceId}) — أرجِع الوصلَ نفسَه من هذه الصفحة فيعود مالُه معه`
              : `هذا مالُ فاتورةٍ محذوفة (#${tx.sourceId}) — أرجِع الفاتورةَ نفسَها`);
        }
      }
    }
    if (mode === "reverse" && tx.sourceType === "sale") {
      return fail("sale_reverse", "حذفُ هذا البيع أرجع كميّتَه إلى المخزن — وإرجاعُ المال وحدَه يجعل المخزنَ والمالَ متناقضَين");
    }

    // زوجُ التحويل نقديّ↔ماستر: الشقّان يُحذفان معاً فيُرجَعان معاً
    let pairId: number | null = null;
    if (isPair && tx.sourceId) {
      const other = await prisma.moneyTx.findFirst({ where: { id: tx.sourceId, isDeleted: true, ...scope }, select: { id: true, sourceId: true } });
      if (!other || other.sourceId !== tx.id) {
        return fail("pair_missing", "هذه حركةُ تحويلٍ نقديّ↔ماستر وشقُّها الآخرُ غيرُ قابلٍ للإرجاع — إرجاعُ شقٍّ واحدٍ يخلق مالاً من العدم");
      }
      pairId = other.id;
      actions.push(`إعادةُ شقّ التحويل الآخر (#${other.id}) معه`);
    }

    actions.unshift("إعادةُ الحركة إلى الصندوق والتقرير");
    if (dryRun) return { kind, id, title, mode, actions, blocks, notes, ok: true };

    await prisma.$transaction(async (t) => {
      const ids = pairId ? [id, pairId] : [id];
      const up = await t.moneyTx.updateMany({ where: { id: { in: ids }, isDeleted: true, ...scope }, data: { isDeleted: false } });
      if (up.count === 0) throw new Error("الحركةُ لم تعد محذوفة");
      await t.auditLog.create({
        data: {
          userId: session?.userId, action: "RESTORE_RECEIPT", entity: "moneyTx", entityId: String(id),
          details: `إرجاع قيد صندوق (${tx.sourceType ?? "يدوية"}) - قبض ${tx.moneyIn ?? 0} - صرف ${tx.moneyOut ?? 0}`
            + (pairId ? ` - مع شقّ التحويل #${pairId}` : ""),
        },
      });
    });
    return { kind, id, title, mode, actions, blocks, notes, ok: true, done: ["أُعيدت الحركة"] };
  }

  // ═════ ④ حركةُ مدير ═════
  const mtx = await prisma.managerTx.findFirst({ where: { id, agentId } });
  if (!mtx) return fail("not_found", "الحركةُ غير موجودةٍ ضمن وكالتك");
  if (!mtx.isDeleted) return fail("not_deleted", "الحركةُ غيرُ محذوفةٍ أصلاً");
  const title = `حركة مدير #${id} — ${ar(mtx.amount)}`;

  // زوجُ «الكلّي↔الماستر» علامتُه نصٌّ في الملاحظة، فيُرجَع الشقّان معاً
  const pairNo = Number(mtx.notes?.match(/زوج #(\d+)/)?.[1] ?? NaN);
  let mPairId: number | null = null;
  if (Number.isFinite(pairNo)) {
    const other = await prisma.managerTx.findFirst({ where: { id: pairNo, agentId, isDeleted: true }, select: { id: true } });
    if (other) { mPairId = other.id; actions.push(`إعادةُ شقّ الزوج (#${other.id}) معه`); }
    else notes.push({ message: `شقُّ الزوج (#${pairNo}) غيرُ محذوفٍ — يُرجَع هذا وحدَه` });
  }
  actions.unshift("إعادةُ الحركة إلى حسابات المدير");
  if (dryRun) return { kind, id, title, mode: null, actions, blocks, notes, ok: true };

  await prisma.$transaction(async (t) => {
    const ids = mPairId ? [id, mPairId] : [id];
    const up = await t.managerTx.updateMany({ where: { id: { in: ids }, isDeleted: true, agentId }, data: { isDeleted: false } });
    if (up.count === 0) throw new Error("الحركةُ لم تعد محذوفة");
    await t.auditLog.create({
      data: {
        userId: session?.userId, action: "RESTORE_RECEIPT", entity: "managerTx", entityId: String(id),
        details: `إرجاع حركة مدير (${mtx.type}) بمبلغ ${mtx.amount}` + (mPairId ? ` - مع شقّ الزوج #${mPairId}` : ""),
      },
    });
  });
  return { kind, id, title, mode: null, actions, blocks, notes, ok: true, done: ["أُعيدت الحركة"] };
}
