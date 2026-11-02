import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { genRewardCode } from "@/lib/rewards";
import { getInviteBonus } from "@/lib/appConfig";

// ═════ 🎁 دعوةُ صديق — كودٌ يمنحه المشترك الفعّال (طلبُ محمد 2026-11-02) ═════
//
// الكودُ **يُشتقّ من معرّف المشترك ولا يُخزَّن**: أربعُ خاناتٍ تحمل المعرّفَ وأربعٌ توقيعٌ
// بسرٍّ في `system_settings` ⇒ لا عمودَ جديدٌ ولا جدولٌ ولا لصقةَ SQL على الإنتاج، وكودٌ
// ثابتٌ لصاحبه لا يتبدّل (كودُ المكافأة يتبدّل مع كلّ منحةٍ ويُمحى عند صفر الرصيد فلا يصلح).
// والتوقيعُ يمنع تخمينَ كودِ غيره: من لا يملك السرَّ لا يُنتج كوداً مقبولاً.
//
// والاستعمالُ يُسجَّل في `reward_logs` بسياق `invite` ومرجعِ التذكرة ⇒ لا منحَ مرّتَين،
// والمنحُ نفسُه رصيدٌ في `rewardBalance` يُستعمَل كأيّ كود خصمٍ عند الفنيّ.

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ٣٢ رمزاً بلا الملتبس (O0I1)
const BODY = 4; // ٣٢⁴ = ١٬٠٤٨٬٥٧٦ معرّفاً
const SIG = 4;
const MAX_ID = 32 ** BODY;
const SECRET_KEY = "inviteSecret";

export const INVITE_TAG_RE = /⟦inv:([A-Z0-9]{8})⟧/;
export function inviteTag(code: string): string { return ` ⟦inv:${code}⟧`; }

let cachedSecret: string | null = null;
async function inviteSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const row = await prisma.systemSetting.findFirst({ where: { type: SECRET_KEY }, select: { value: true } });
  if (row?.value) { cachedSecret = row.value; return cachedSecret; }
  const fresh = crypto.randomBytes(24).toString("hex");
  try {
    await prisma.systemSetting.create({ data: { type: SECRET_KEY, value: fresh } });
    cachedSecret = fresh;
  } catch {
    const again = await prisma.systemSetting.findFirst({ where: { type: SECRET_KEY }, select: { value: true } });
    cachedSecret = again?.value ?? null;
  }
  return cachedSecret ?? "";
}

function encodeId(id: number): string {
  let n = id, s = "";
  for (let i = 0; i < BODY; i++) { s = CHARS[n % 32] + s; n = Math.floor(n / 32); }
  return s;
}
function decodeId(body: string): number | null {
  let n = 0;
  for (const ch of body) {
    const i = CHARS.indexOf(ch);
    if (i < 0) return null;
    n = n * 32 + i;
  }
  return n;
}
function signBody(secret: string, body: string): string {
  const h = crypto.createHmac("sha256", secret).update(body).digest();
  let s = "";
  for (let i = 0; i < SIG; i++) s += CHARS[h[i] % 32];
  return s;
}

export async function inviteCodeFor(subscriberId: number): Promise<string | null> {
  if (!Number.isInteger(subscriberId) || subscriberId <= 0 || subscriberId >= MAX_ID) return null;
  const secret = await inviteSecret();
  if (!secret) return null;
  const body = encodeId(subscriberId);
  return body + signBody(secret, body);
}

export function normalizeInvite(raw: unknown): string {
  return typeof raw === "string" ? raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, BODY + SIG) : "";
}

export async function subscriberFromInvite(raw: unknown): Promise<number | null> {
  const code = normalizeInvite(raw);
  if (code.length !== BODY + SIG) return null;
  const secret = await inviteSecret();
  if (!secret) return null;
  const body = code.slice(0, BODY);
  if (signBody(secret, body) !== code.slice(BODY)) return null;
  const id = decodeId(body);
  return id && id > 0 ? id : null;
}

// الداعي: مشتركٌ قائمٌ ومعه مكتبُه ووكيلُه — null لكلّ ما عداه
export async function inviterOf(raw: unknown): Promise<{ id: number; name: string | null; phone: string | null; towerId: number; agentId: number } | null> {
  const id = await subscriberFromInvite(raw);
  if (!id) return null;
  const sub = await prisma.subscriber.findFirst({
    where: { id, isDeleted: false, purgedAt: null },
    select: { id: true, name: true, phone: true, towerId: true },
  });
  if (!sub?.towerId) return null;
  const tower = await prisma.tower.findUnique({ where: { id: sub.towerId }, select: { agentId: true } });
  if (tower?.agentId == null) return null;
  return { id: sub.id, name: sub.name, phone: sub.phone, towerId: sub.towerId, agentId: tower.agentId };
}

// 💰 منحُ الداعي مبلغَه حين يُنجَز طلبُ صديقه فعلاً — لا عند إرساله (طلبٌ وهميٌّ لا يصنع مالاً).
// ⚖️ وشرطُ الوكيل: الداعي والتذكرةُ لوكيلٍ واحد — فالخصمُ يُموّله الوكيلُ الذي ربح المشترك.
export async function creditInviteForTicket(
  ticketId: number,
  by?: { user?: string | null; name?: string | null },
): Promise<number> {
  try {
    const ticket = await prisma.subscriberTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, note: true, agentId: true },
    });
    const code = ticket?.note?.match(INVITE_TAG_RE)?.[1];
    if (!code || ticket?.agentId == null) return 0;
    const done = await prisma.rewardLog.findFirst({ where: { refId: ticketId, context: "invite" }, select: { id: true } });
    if (done) return 0;
    const inviter = await inviterOf(code);
    if (!inviter || inviter.agentId !== ticket.agentId) return 0;
    const amount = await getInviteBonus();
    if (amount <= 0) return 0;

    return await prisma.$transaction(async (tx) => {
      const again = await tx.rewardLog.findFirst({ where: { refId: ticketId, context: "invite" }, select: { id: true } });
      if (again) return 0;
      const cur = await tx.subscriber.findUnique({ where: { id: inviter.id }, select: { rewardBalance: true, rewardCode: true } });
      const rewardCode = cur?.rewardCode ?? genRewardCode();
      const balanceAfter = (cur?.rewardBalance ?? 0) + amount;
      await tx.subscriber.update({
        where: { id: inviter.id },
        data: { rewardBalance: { increment: amount }, rewardCode },
      });
      await tx.rewardLog.create({
        data: {
          agentId: inviter.agentId, towerId: inviter.towerId, subscriberId: inviter.id,
          kind: "grant", amount, code: rewardCode, context: "invite", refId: ticketId,
          balanceAfter, subscriberName: inviter.name,
          createdByUser: by?.user ?? null, createdByName: by?.name ?? null,
        },
      });
      return amount;
    });
  } catch {
    return 0;
  }
}
