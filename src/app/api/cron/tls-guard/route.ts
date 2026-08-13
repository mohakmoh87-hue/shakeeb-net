import { NextResponse } from "next/server";
import tls from "node:tls";
import { prisma } from "@/lib/prisma";
import { sendMail, mailerConfigured } from "@/lib/mailer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ═════ حارسُ شهادة TLS — إنذارٌ قبل السقوط لا بعده ═════
// شهاداتُ Let's Encrypt على `shakeebnet.com` تُجدَّد **تلقائيّاً** من Railway، ولذلك
// بالضبط لا ينظر إليها أحد. فإن فشل التجديدُ مرّةً (تغيُّرُ DNS · تحدٍّ لم يُجَب ·
// خللٌ عند المزوّد) لا يعلم أحدٌ **حتى تنتهي الشهادة**، وحينها يسقط الموقعُ على
// **كلّ الوكلاء دفعةً واحدة** بشاشةِ «الاتصالُ غيرُ آمن» — لا صفحةَ خطأٍ تُشخَّص.
//
// وهذا الحارسُ يقيس **الشهادةَ الحقيقيّةَ بمصافحةٍ فعليّة** (لا سجلَّ DNS ولا واجهةَ
// Railway): يفتح اتصال TLS ويقرأ `valid_to`. فما يراه الزائرُ هو ما يُقاس.
//
// · تحتَ `ALERT_DAYS` (٢١ يوماً) ⇒ بريدٌ للمالك. والتجديدُ التلقائيّ يحدث عادةً قبل
//   ٣٠ يوماً، فـ٢١ تعني «التجديدُ **لم** يحدث في موعده» لا «الشهادةُ قاربت الانتهاء».
// · وبريدٌ **مرّةً واحدةً في اليوم** لكلّ مضيف (ختمٌ في `system_settings`) — فحارسٌ
//   يُرسل كلَّ ساعةٍ يُهمَل بعد يومَين، والإهمالُ هو ما نُحاربه.
// · وسطرُ الحالةِ يُكتَب **في كلّ تشغيلٍ** ليقرأه المالكُ من صفحته: صحيحٌ أو معطوب.
//
// ✅ **سحابيٌّ بحتٌ**: الملفُّ داخل `src/app` ⇒ داخلَ بوّابة `UI_ONLY` في `src/worker.ts`
//    فلا يُعيد تشغيل أيّ حاسبةِ مكتبٍ ولا يُهدّد جلسةَ واتساب. وصفرُ كلفة.

const ALERT_DAYS = 21;
const HARD_DAYS = 7; // تحتَ هذا: خطرٌ حقيقيّ — العنوانُ يتغيّر نصّاً في البريد
const STATE_KEY = "tlsGuard";

type HostState = {
  host: string;
  ok: boolean;
  daysLeft: number | null;
  validTo: string | null;
  issuer: string | null;
  error: string | null;
};

/** أوّلُ قيمةٍ نصّيّةٍ من حقلٍ قد يكون نصّاً أو مصفوفةً أو غائباً. */
const one = (v: string | string[] | undefined): string | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

/** يقرأ شهادةَ المضيف بمصافحةِ TLS حقيقيّة. لا يرمي أبداً — يُعيد الخطأَ نصّاً. */
function readCert(host: string, timeoutMs = 12_000): Promise<HostState> {
  return new Promise((resolve) => {
    const base: HostState = { host, ok: false, daysLeft: null, validTo: null, issuer: null, error: null };
    let settled = false;
    const done = (s: HostState) => { if (!settled) { settled = true; resolve(s); } };

    let socket: tls.TLSSocket;
    try {
      socket = tls.connect({
        host, port: 443, servername: host,
        // نريد **قراءةَ** الشهادة حتى لو كانت غيرَ صالحة — فرفضُ الاتصال يُعمينا عن
        // السبب. والصلاحيّةُ تُحكَم بأنفسنا أدناه (`authorized` + المدّة الباقية).
        rejectUnauthorized: false,
      });
    } catch (e) {
      done({ ...base, error: e instanceof Error ? e.message : String(e) });
      return;
    }

    const timer = setTimeout(() => {
      done({ ...base, error: `لم تكتمل المصافحةُ خلال ${Math.round(timeoutMs / 1000)}ث` });
      socket.destroy();
    }, timeoutMs);

    socket.once("secureConnect", () => {
      clearTimeout(timer);
      const cert = socket.getPeerCertificate();
      const authorized = socket.authorized;
      const authError = socket.authorizationError ? String(socket.authorizationError) : null;
      socket.end();
      if (!cert || !cert.valid_to) {
        done({ ...base, error: "لم تُقرأ الشهادةُ من المضيف" });
        return;
      }
      const to = new Date(cert.valid_to);
      const days = Math.floor((to.getTime() - Date.now()) / 86_400_000);
      done({
        host,
        // `ok` = موثوقةٌ **وباقيةٌ** فوق حدّ الإنذار. فشهادةٌ موثوقةٌ تنتهي غداً ليست ok.
        ok: authorized && days >= ALERT_DAYS,
        daysLeft: days,
        validTo: to.toISOString(),
        // `O`/`CN` قد يكونا مصفوفةً (شهادةٌ بأكثر من قيمةٍ للحقل) — فنُسوّيهما نصّاً
        issuer: one(cert.issuer?.O) ?? one(cert.issuer?.CN),
        error: authorized ? null : (authError ?? "الشهادةُ غيرُ موثوقة"),
      });
    });

    socket.once("error", (e: Error) => {
      clearTimeout(timer);
      done({ ...base, error: e.message });
    });
  });
}

/** المضيفون المحروسون: مضيفُ عنوان التطبيق، ومعه `www.` إن كان العنوانُ جذراً.
 *  (يُقرأ من البيئة فلا يُكتَب عنوانٌ في الكود — تبديلُ النطاق لا يُبطل الحارس.) */
function hostsToCheck(): string[] {
  const raw = process.env.APP_BASE_URL || process.env.APP_URL || "";
  const out: string[] = [];
  try {
    const h = new URL(raw).hostname;
    if (h) {
      out.push(h);
      // نطاقٌ جذريٌّ (نقطةٌ واحدة) ⇒ `www` عليه شهادةٌ منفصلةٌ عادةً، وسقوطُها
      // يُسقط مَن يكتب العنوانَ بـwww — وهم كثيرٌ من الوكلاء.
      if (h.split(".").length === 2) out.push(`www.${h}`);
    }
  } catch { /* عنوانٌ غيرُ صالح — نُبلّغ أدناه */ }
  return out;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  }

  const hosts = hostsToCheck();
  if (!hosts.length) {
    return NextResponse.json({ error: "لم يُضبط APP_BASE_URL — لا مضيفَ ليُحرَس" }, { status: 500 });
  }

  const states = await Promise.all(hosts.map((h) => readCert(h)));
  const bad = states.filter((s) => !s.ok);

  // سطرُ الحالة يُكتَب دائماً — فصفحةُ المالك تُظهر آخرَ قياسٍ لا آخرَ إنذار
  const text = JSON.stringify({ at: new Date().toISOString(), states });
  const row = await prisma.systemSetting.findFirst({
    where: { type: STATE_KEY }, select: { id: true }, orderBy: { id: "asc" },
  });
  if (row) await prisma.systemSetting.update({ where: { id: row.id }, data: { text } }).catch(() => {});
  else await prisma.systemSetting.create({ data: { type: STATE_KEY, text } }).catch(() => {});

  let mailed = 0, muted = 0;
  if (bad.length && mailerConfigured()) {
    const toRow = await prisma.systemSetting.findFirst({
      where: { type: "ownerBackupEmail" }, select: { value: true }, orderBy: { id: "asc" },
    });
    const to = toRow?.value?.trim();
    if (to) {
      // ختمُ «أُنذرتُ اليومَ» لكلّ مضيفٍ — إنذارٌ يتكرّر كلَّ دورةٍ يُهمَل
      const dayKey = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10); // يومُ بغداد
      for (const s of bad) {
        const key = `tlsAlert:${s.host}`;
        const seen = await prisma.systemSetting.findFirst({
          where: { type: key }, select: { id: true, value: true }, orderBy: { id: "asc" },
        });
        if (seen?.value === dayKey) { muted++; continue; }

        const critical = s.daysLeft != null && s.daysLeft <= HARD_DAYS;
        const head = s.daysLeft == null
          ? `⛔ تعذّر قياسُ شهادة ${s.host}`
          : critical
            ? `⛔ شهادةُ ${s.host} تنتهي بعد ${s.daysLeft} يوماً`
            : `⚠️ شهادةُ ${s.host} لم تُجدَّد في موعدها — باقٍ ${s.daysLeft} يوماً`;
        const body = [
          head,
          "",
          `المضيف: ${s.host}`,
          `الباقي: ${s.daysLeft ?? "—"} يوماً`,
          `تنتهي: ${s.validTo ?? "—"}`,
          `المُصدِر: ${s.issuer ?? "—"}`,
          s.error ? `الخطأ: ${s.error}` : "",
          "",
          "التجديدُ التلقائيُّ من Railway يحدث عادةً قبل ٣٠ يوماً من الانتهاء.",
          `فبلوغُ ${ALERT_DAYS} يوماً يعني أنّ التجديدَ **لم يحدث في موعده** — لا أنّ الشهادةَ قاربت الانتهاء.`,
          "",
          "ما يُفعَل: افتح Railway ← الخدمة ← Settings ← Domains، وتحقّق من حالة الشهادة.",
          "وإن كانت الحالةُ خطأً فأعِد إصدارَها من هناك، وتأكّد أنّ سجلَّ DNS للنطاق يشير إلى Railway.",
          "",
          "⛔ وإن انتهت: يسقط الموقعُ على **كلّ الوكلاء دفعةً واحدةً** بشاشةِ «الاتصالُ غيرُ آمن».",
        ].filter(Boolean).join("\n");

        const r = await sendMail({ to, subject: `SHAKEEB — ${head}`, text: body });
        if (r.ok) {
          mailed++;
          if (seen) await prisma.systemSetting.update({ where: { id: seen.id }, data: { value: dayKey } }).catch(() => {});
          else await prisma.systemSetting.create({ data: { type: key, value: dayKey } }).catch(() => {});
        }
      }
    }
  }

  return NextResponse.json({
    ok: bad.length === 0,
    checked: states.length,
    alertDays: ALERT_DAYS,
    mailed, muted,
    states,
  });
}
