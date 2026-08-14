"use client";

import { useEffect, useState } from "react";

// ═════════════ جسُّ العامل المحلّيّ على حاسبة المكتب (المنفذ ٤٧٦١٥) ═════════════
//
// إن وُجد العاملُ وُجّهت إليه عمليّاتُ الساس والطباعة مباشرةً — فهو **بجانب** مُخدِّم الساس
// وبجانب الطابعة، بينما الموقعُ في أمريكا. و`http://127.0.0.1` سياقٌ آمنٌ في المتصفّح
// فلا يُحجب رغم أنّ الصفحة `https`، والعاملُ يردّ `Allow-Private-Network` فيمرّ فحصُ كروم.
//
// ═════ 🔴 لماذا كُتبت هذه الوحدةُ من جديد (بلاغُ محمد 2026-08-15) ═════
// «أخبرتك أنّ عملَ الساس ليس محلّيّاً لأنّه يتأخّر، والطابعاتُ تطبع على السحابة لأنّها
//  تتأخّر ٥ ثوانٍ لكلّ وصل» — والشكويان **علّةٌ واحدة** في النسخة السابقة:
//
//   ١. **خانقٌ يردّ «لا عامل» بلا أن يجسّ.** كان:
//        if (Date.now() - lastProbe < 15000) return "";
//        lastProbe = Date.now();          // ← يُختم **قبل** انتظار الجسّة
//      و`lastProbe` على مستوى الوحدة أي **مشتركٌ بين كلّ مكوّنات التبويب**. فأوّلُ مكوّنٍ
//      يبدأ الجسَّ يختم الطابع، وكلُّ مَن يسأل بعده — زرُّ الطباعة، صفحةُ الساس — يتلقّى
//      «لا عامل محلّيّ» **فوراً وطيلة ١٥ ثانية** وهو موجودٌ ويعمل. ⇒ الوصلُ يذهب للطابور
//      السحابيّ (خمسُ ثوانٍ)، ولوحةُ الساس تُحمَّل عبر الموقع (بطءٌ ونقلٌ مدفوع).
//   ٢. **استسلامٌ بعد خمس دقائق** (`if (++tries < 15)`) — تبويبٌ بقي مفتوحاً أثناء إعادة
//      تشغيل العامل يظلّ سحابيّاً للأبد حتى يُحدَّث بيدٍ.
//
// ⇒ والعلاجُ مبدأٌ واحد: **مَن يسأل ينتظر الجوابَ الحقيقيّ، ولا يُصرَف بجوابٍ قديم.**
//    فالجسّةُ الجاريةُ تُشارَك (`inflight`) بدل أن يُصرَف السائلُ بـ""؛ والنجاحُ يُخزَّن
//    لعمر الصفحة؛ والفشلُ يُهدَّأ ثوانيَ قليلةً لا خمسَ عشرة، ويُعاد المحاولةُ **بلا سقف**.
//
// 📍 وموضعُ الملفّ مقصود: `src/components/` لا `src/lib/` — فقائمةُ `UI_ONLY` في
//    `src/worker.ts` تجعل كلَّ تغييرٍ تحت `src/lib` **يُعيد تشغيل حاسبات المكاتب السبع
//    ويهدم جلساتِ الواتساب**، وهذا ملفُّ متصفّحٍ خالصٌ لا يستورده العاملُ إطلاقاً.
//    ⚠️ و`src/lib/localSas.ts` القديمُ يبقى على القرص **ميْتاً بلا مستهلك** (حذفُه وحدَه
//    يُشعل إعادةَ التشغيل) — يُحذَف في أوّل دفعةٍ تمسّ `src/lib` لسببٍ آخر.

const BASE = "http://127.0.0.1:47615";
const PROBE_TIMEOUT_MS = 1500;
/** تهدئةٌ بعد فشل: تمنع إغراقَ العامل بجسّاتٍ متلاحقة، وقصيرةٌ كي لا تُصبح خانقاً. */
const FAIL_COOLDOWN_MS = 5000;
/** أوّلُ فاصلِ إعادةِ محاولةٍ للخطّاف، ثمّ يتضاعف حتى السقف — تباطؤٌ لا استسلام. */
const RETRY_MIN_MS = 20_000;
const RETRY_MAX_MS = 60_000;

let cached = ""; // نجاحٌ مؤكَّد — العاملُ لا يتنقّل، فيُخزَّن لعمر الصفحة
let inflight: Promise<string> | null = null; // جسّةٌ جاريةٌ يشترك فيها كلُّ سائل
let lastFail = 0;

async function probe(): Promise<string> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    const r = await fetch(`${BASE}/health`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (r.ok) {
      const d = await r.json().catch(() => null);
      // بصمةُ العامل المعتمَد: `/health` يردّ `agentId` رقميّاً. وعاملٌ قديمٌ أو غيرُ
      // معتمَدٍ يُتجاهَل — فهو لا يملك مسارات `/sas` و`/print` فيُختطَف العرضُ إلى لا شيء.
      if (d && typeof d.agentId === "number") { cached = BASE; return cached; }
    }
  } catch { /* لا عاملَ على هذه الحاسبة (هاتفٌ أو جهازٌ بعيد) — المسارُ السحابيُّ يعمل */ }
  lastFail = Date.now();
  return "";
}

/**
 * عنوانُ العامل المحلّيّ أو `""`.
 *
 * `wait: true` ⇒ «لا تصرفني بجوابٍ قديم»: تُنتظَر الجسّةُ الجاريةُ أو تُطلَق واحدةٌ جديدة
 * ولو كان الفشلُ الأخيرُ قريباً. يستعمله زرُّ الطباعة — فانتظارُ ١٫٥ث في أسوأ الحالات
 * أرخصُ من خمسِ ثوانٍ في الطابور السحابيّ، والفشلُ على الهاتف فوريٌّ أصلاً (رفضُ اتّصال).
 */
export async function localSasBase(opts?: { wait?: boolean }): Promise<string> {
  if (cached) return cached;
  // 🔑 جوهرُ الإصلاح: السائلُ الثاني **ينضمّ** إلى الجسّة الجارية ولا يُصرَف بـ""
  if (inflight) return inflight;
  if (!opts?.wait && Date.now() - lastFail < FAIL_COOLDOWN_MS) return "";
  inflight = probe().finally(() => { inflight = null; });
  return inflight;
}

/**
 * الجسُّ مع **حالةِ استقراره** — و`settled` هو ما يمنع سباقَ صفحة الساس:
 * قبل أن تنتهيَ أوّلُ جسّةٍ لا يُعرَف أمحلّيٌّ هو أم سحابيّ، ومن اختار حينها اختار على
 * جهل. فتنتظر الصفحةُ `settled` ثمّ تُقرّر مرّةً واحدةً على حقيقة.
 */
export function useLocalSasProbe(): { base: string; settled: boolean } {
  // ⚠️ تبدأ فارغةً دائماً (لا `cached`): قراءةُ متغيّرِ وحدةٍ في التصيير الأوّل تختلف بين
  //    الخادم والعميل فتُنتج عدمَ تطابقِ ترطيب. والقيمةُ تصل في أوّل ردِّ وعدٍ بلا وميض.
  const [base, setBase] = useState("");
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = RETRY_MIN_MS;

    const tick = () => {
      void localSasBase({ wait: true })
        .then((b) => {
          if (!alive) return;
          setSettled(true); // انتهت جسّةٌ حقيقيّة ⇒ القرارُ صار مبنيّاً على واقع
          if (b) { setBase(b); return; } // وُجد ⇒ يتوقّف الجسّ (النتيجةُ مخزونةٌ للوحدة)
          // ⛔ بلا سقفِ محاولات: العاملُ قد يعود بعد ساعةٍ (نشرةٌ · إقلاعُ حاسبة)،
          //    والاستسلامُ كان يُبقي التبويبَ سحابيّاً حتى تحديثٍ يدويّ.
          timer = setTimeout(tick, delay);
          delay = Math.min(delay * 2, RETRY_MAX_MS);
        })
        .catch(() => { if (alive) setSettled(true); });
    };
    tick();

    // عودةُ التبويب أو استيقاظُ الحاسبة ⇒ جسّةٌ فوريّة: العاملُ يعود غالباً في هذه اللحظة
    // بالذات (فتح المكتب صباحاً)، وانتظارُ دقيقةٍ بعدها ضياعٌ بلا سبب.
    const onWake = () => {
      if (!alive || cached) return;
      if (timer) clearTimeout(timer);
      delay = RETRY_MIN_MS;
      tick();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, []);

  return { base, settled };
}

/** الشكلُ المختصر لمن لا يهمّه الاستقرار (بطاقاتُ الأرقام · نافذةُ التفعيل · زرُّ الطباعة). */
export function useLocalSasBase(): string {
  return useLocalSasProbe().base;
}
