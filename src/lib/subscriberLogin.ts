import crypto from "crypto";
import { prisma } from "./prisma";
import { sendOtpWhatsApp } from "./otpWa";

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const GRACE_DAYS = 30;

export function phoneCore(raw: string): string | null {
  let p = (raw || "").replace(/\D/g, "").replace(/^00/, "");
  if (p.startsWith("964")) p = p.slice(3);
  if (p.startsWith("0")) p = p.slice(1);
  if (p.length !== 10 || !p.startsWith("7")) return null;
  return p;
}

export type SubMatch = {
  id: number; name: string | null; netUser: string | null; packageId: number | null;
  dateFrom: Date | null; dateTo: Date | null; towerId: number | null; carry: number | null; phone: string | null;
};

export async function findSubscriberByPhone(core: string): Promise<SubMatch | null> {
  const rows = await prisma.$queryRaw<SubMatch[]>`
    SELECT id, name, "netUser", "packageId", "dateFrom", "dateTo", "towerId", carry, phone
    FROM subscribers
    WHERE "isDeleted" = false AND "purgedAt" IS NULL
      AND right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${core}
    ORDER BY ("dateTo" IS NULL OR "dateTo" >= now() - interval '30 days') DESC, "dateFrom" DESC NULLS LAST, id DESC
    LIMIT 1`;
  return rows[0] ?? null;
}

export type SubState = { state: "active" | "grace" | "expired"; daysExpired: number };
export function subscriberState(dateTo: Date | null): SubState {
  const to = dateTo ? new Date(dateTo).getTime() : 0;
  const now = Date.now();
  if (!to || to >= now) return { state: "active", daysExpired: 0 };
  const daysExpired = Math.floor((now - to) / 86_400_000);
  return daysExpired <= GRACE_DAYS ? { state: "grace", daysExpired } : { state: "expired", daysExpired };
}

const OTP_KEY = (core: string) => `otp:${core}`;

export async function issueOtp(core: string, subscriberId: number, phone: string): Promise<{ ok: boolean; error?: string }> {
  const code = String(crypto.randomInt(100000, 1000000));
  await prisma.systemSetting.deleteMany({ where: { type: OTP_KEY(core) } });
  await prisma.systemSetting.create({ data: { type: OTP_KEY(core), value: JSON.stringify({ code, subscriberId, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 }) } });
  const r = await sendOtpWhatsApp(phone, `رمزُ دخولك إلى تطبيق سوبر سيل: ${code}\nصالحٌ ٥ دقائق. لا تُشاركه مع أحد.`);
  if (!r.ok) await prisma.systemSetting.deleteMany({ where: { type: OTP_KEY(core) } }).catch(() => {});
  return r;
}

export async function verifyOtp(core: string, code: string): Promise<{ ok: boolean; subscriberId?: number; error?: string }> {
  const row = await prisma.systemSetting.findFirst({ where: { type: OTP_KEY(core) }, orderBy: { id: "desc" }, select: { id: true, value: true } });
  if (!row?.value) return { ok: false, error: "اطلب رمزاً جديداً" };
  let d: { code?: string; subscriberId?: number; expiresAt?: number; attempts?: number };
  try { d = JSON.parse(row.value); } catch { return { ok: false, error: "اطلب رمزاً جديداً" }; }
  if (!d.expiresAt || Date.now() > d.expiresAt) {
    await prisma.systemSetting.delete({ where: { id: row.id } }).catch(() => {});
    return { ok: false, error: "انتهت صلاحيّةُ الرمز — اطلب رمزاً جديداً" };
  }
  if ((d.attempts ?? 0) >= OTP_MAX_ATTEMPTS) {
    await prisma.systemSetting.delete({ where: { id: row.id } }).catch(() => {});
    return { ok: false, error: "محاولاتٌ كثيرة — اطلب رمزاً جديداً" };
  }
  if (d.code !== code.trim()) {
    await prisma.systemSetting.update({ where: { id: row.id }, data: { value: JSON.stringify({ ...d, attempts: (d.attempts ?? 0) + 1 }) } }).catch(() => {});
    return { ok: false, error: "رمزٌ غير صحيح" };
  }
  await prisma.systemSetting.delete({ where: { id: row.id } }).catch(() => {});
  return { ok: true, subscriberId: d.subscriberId };
}
