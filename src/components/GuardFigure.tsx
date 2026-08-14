// ═════════ 🕵️ «حارسُ المال» — الشخصيّةُ المرسومة (طلبُ محمد 2026-08-14) ═════════
//
// أرسل محمد صورةَ شخصيّةٍ إيموجيّةٍ ثلاثيّةِ الأبعاد: ضابطٌ برأسٍ أصفرَ كرويٍّ وقبّعةٍ
// بنجمةٍ ذهبيّةٍ ونظّارةٍ سوداءَ وبدلةٍ كحليّةٍ، وسأل: «هل يمكنك صنعُ مثل هذا بالضبط؟»
//
// ⚠️ **والجوابُ الصريحُ: لا** — تلك صورةٌ مُصيَّرةٌ (render) بمُولِّدِ صور، والكودُ لا
//   يُنتجها. وهذه **متجهاتٌ بتدرّجاتٍ ولمعانٍ وظلٍّ أرضيٍّ** تُحاكي هيئتَها. ومكسبُها
//   على الصورة الجاهزة ثلاثةٌ قِيست لا تُقدَّر:
//     • **تتحرّك وتتغيّر بالحالة** — والصورةُ ساكنةٌ أبداً، ومحمدٌ طلب «متحرّكاً وليس
//       ثابتاً كصورة».
//     • **٤ كيلوبايت بلا طلبِ شبكة** — ومحمدٌ أوقف صورَ القوالب لأنّها «تُغلي الفاتورة».
//     • حادّةٌ في كلّ مقاسٍ وكلّ كثافةِ شاشة.
//
// والحالاتُ الثلاثُ بُنيت على مراجعاته المتتابعة:
//   🟢 **مرتاح**  — يدانِ على الخصر، حاجبانِ مستويان، فمٌ مبتسمٌ قليلاً، تنفّسٌ بطيء.
//   🟠 **منتبِه** — «اجعلها أكثرَ انتباهاً»: يدٌ على **سمّاعةِ الأذن** وسلكُها ظاهر،
//      **حاجبٌ مرفوعٌ وآخرُ منخفض** (أصدقُ إشارةِ تيقّظٍ حين تُخفي النظّارةُ العينَين)،
//      فمٌ مضغوط، ورأسٌ يمسح الجهتَين أوسعَ وأسرع.
//   🔴 **غاضبٌ مستعدّ** — «أكثرَ غضباً» ثمّ «يغلق فمه ويمسك مسدّساً بكلتا يديه مصوَّباً
//      للأمام»: فمٌ **مغلقٌ مشدودٌ** بطيّةٍ تحت الشفة (والغضبُ المكتومُ أوقعُ من الصراخ)،
//      وذراعانِ ممدودتانِ **نحو الناظر** مختصرتان، وكفّانِ متشابكتانِ على المقبض،
//      والسلاحُ من مؤخّرته بفوهةٍ تنظر إليك، واحمرارٌ في الوجه، وقبّعةٌ مائلةٌ ١١°.
//
// ⚠️ وترتيبُ الطبقات مقصودٌ: الذراعانِ **بعد** الرأس. فحين كانتا قبله كان المسدّسُ عند
//   الصدر يقع خلفَ قُبّةِ الرأس (نصفُ قطرها ٣٠ وتنتهي عند ٧٥) فيُحجَب تماماً — علّةٌ
//   اصطدتُها بقياسِ موضعِ العنصرَين في الناتج، لا بالنظر إلى الصورة.

export type GuardMood = "calm" | "warn" | "critical";

const NAVYD = "#161B29", NAVYL = "#33405E", GOLDD = "#C88A1E";

export const GUARD_MOODS: Record<GuardMood, {
  brow: { l: string; r: string }; mouth: string; mouthFill: string; capTilt: number;
  pose: "hips" | "listen" | "aim"; ear: boolean; flush: boolean;
  body: string; head: string; gun: string;
}> = {
  calm: {
    brow: { l: "M26 37.5q7-2.6 13.6-.6l-.5 3.6q-6.2-1.8-12.6 .5z", r: "M74 37.5q-7-2.6-13.6-.6l.5 3.6q6.2-1.8 12.6 .5z" },
    mouth: "M40 62q10 7 20 0", mouthFill: "none", capTilt: 0,
    pose: "hips", ear: false, flush: false,
    body: "guard-body-calm", head: "guard-head-calm", gun: "guard-gun-calm",
  },
  warn: {
    brow: { l: "M25.6 34.6q7-3.4 13.8-.8l-.6 3.8q-6.4-2.2-12.8 .6z", r: "M74.4 38.4q-7-2-13.4 .4l.6 3.6q6-2 12.4-.4z" },
    mouth: "M41 63.5h18", mouthFill: "none", capTilt: -5,
    pose: "listen", ear: true, flush: false,
    body: "guard-body-warn", head: "guard-head-warn", gun: "guard-gun-warn",
  },
  critical: {
    brow: { l: "M24.4 32.6q8.4 .4 15.6 6.4l-2.6 4.4q-6.8-5.4-14-4.8z", r: "M75.6 32.6q-8.4 .4-15.6 6.4l2.6 4.4q6.8-5.4 14-4.8z" },
    mouth: "M39.5 65.4q10.5 3.4 21 0", mouthFill: "none", capTilt: -11,
    pose: "aim", ear: true, flush: true,
    body: "guard-body-rage", head: "guard-head-rage", gun: "guard-gun-rage",
  },
};

export default function GuardFigure({ mood, size, label }: { mood: GuardMood; size: number; label?: string }) {
  const m = GUARD_MOODS[mood];
  const id = `gf-${mood}`; // مُعرِّفاتُ التدرّجات فريدةٌ لكلّ حالة كي لا تتشابك في الصفحة
  return (
    <svg width={size} height={size * 1.3} viewBox="0 0 100 130" style={{ display: "block", overflow: "visible" }}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <defs>
        <radialGradient id={`${id}head`} cx="36%" cy="28%" r="78%">
          <stop offset="0%" stopColor="#FFE07A" /><stop offset="46%" stopColor="#FFC42E" />
          <stop offset="100%" stopColor="#E09400" />
        </radialGradient>
        <linearGradient id={`${id}cap`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3A4665" /><stop offset="100%" stopColor="#1B2131" />
        </linearGradient>
        <linearGradient id={`${id}body`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2E3854" /><stop offset="100%" stopColor="#1A2030" />
        </linearGradient>
        <linearGradient id={`${id}lens`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#39445C" /><stop offset="55%" stopColor="#1A2030" />
          <stop offset="100%" stopColor="#0E1220" />
        </linearGradient>
        <linearGradient id={`${id}gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFD778" /><stop offset="100%" stopColor="#C88A1E" />
        </linearGradient>
      </defs>
      <g className={`guard-glyph ${m.body}`}>
        {/* الظلُّ الأرضيّ — يُعطي الجسمَ ثِقلاً فيُقرَأ مُجسَّماً */}
        <ellipse cx="50" cy="127" rx="27" ry="3.6" fill="#0B1020" opacity=".2" />
        <rect x="37" y="99" width="10.5" height="23" rx="4.6" fill={NAVYD} />
        <rect x="52.5" y="99" width="10.5" height="23" rx="4.6" fill={NAVYD} />
        <ellipse cx="42" cy="123" rx="7.4" ry="3.4" fill="#0D111A" />
        <ellipse cx="58" cy="123" rx="7.4" ry="3.4" fill="#0D111A" />
        {/* البدلة */}
        <path d="M28 104V82c0-9 9.8-14 22-14s22 5 22 14v22z" fill={`url(#${id}body)`} />
        <path d="M28 104V82c0-9 9.8-14 22-14v3.4C39.2 71.4 31.6 75.6 31.6 83V104z" fill={NAVYD} opacity=".55" />
        <path d="M29.4 79.5q4.6-3.6 9.4-1.2l-.6 4.2q-4.4-2-8.8 1z" fill={NAVYL} />
        <path d="M70.6 79.5q-4.6-3.6-9.4-1.2l.6 4.2q4.4-2 8.8 1z" fill={NAVYL} />
        <path d="M49 68h2v36h-2z" fill={NAVYD} opacity=".8" />
        <circle cx="54" cy="79" r="1.9" fill={`url(#${id}gold)`} />
        <circle cx="54" cy="87" r="1.9" fill={`url(#${id}gold)`} />
        {/* الشارةُ على الصدر */}
        <path d="M38 79.6l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill={`url(#${id}gold)`} />
        {/* الحزامُ والإبزيم */}
        <rect x="28" y="93.5" width="44" height="7.2" fill={NAVYD} />
        <rect x="28" y="93.5" width="44" height="2" fill={NAVYL} opacity=".45" />
        <rect x="44.5" y="93.2" width="11" height="7.8" rx="1.6" fill={`url(#${id}gold)`} />
        <rect x="47" y="95.4" width="6" height="3.4" rx=".8" fill={GOLDD} opacity=".7" />
        {/* الرأس */}
        <g className={`guard-glyph ${m.head}`} style={{ transformOrigin: "50px 70px" }}>
          <circle cx="50" cy="45" r="30" fill={`url(#${id}head)`} />
          <ellipse cx="38" cy="32" rx="11" ry="8" fill="#fff" opacity=".16" />
          <path d="M50 75c-14 0-25.4-9.6-28.4-22 5 9.4 15.6 15.6 28.4 15.6S73 62.4 78 53c-3 12.4-14 22-28 22z" fill="#C88400" opacity=".28" />
          {m.flush && (<>
            <circle cx="50" cy="45" r="30" fill="#E2483A" opacity=".14" />
            <ellipse cx="28" cy="57" rx="8" ry="5" fill="#E2483A" opacity=".32" />
            <ellipse cx="72" cy="57" rx="8" ry="5" fill="#E2483A" opacity=".32" />
          </>)}
          {/* النظّارةُ السوداءُ اللامعة */}
          <path d="M23 43h54v5.4H23z" fill="#1A2030" opacity=".9" />
          <ellipse cx="36" cy="47.5" rx="13.4" ry="11" fill={`url(#${id}lens)`} />
          <ellipse cx="64" cy="47.5" rx="13.4" ry="11" fill={`url(#${id}lens)`} />
          <path d="M27 41.5q7 3 13 1.4l-2 4.4q-6 1.2-11.6-1.6z" fill="#fff" opacity=".22" />
          <path d="M55 41.5q7 3 13 1.4l-2 4.4q-6 1.2-11.6-1.6z" fill="#fff" opacity=".22" />
          <path d="M49 45.4h2.4v2.4H49z" fill="#1A2030" />
          {/* الحاجبانِ فوق النظّارة: حاملُ المزاج حين تُخفى العينان */}
          <path d={m.brow.l} fill="#8A5A00" opacity=".92" />
          <path d={m.brow.r} fill="#8A5A00" opacity=".92" />
          {m.ear && (<>
            <ellipse cx="78.4" cy="47" rx="3" ry="4" fill="#D9D5CF" />
            <path d="M79.4 51q3.4 6 .6 12" stroke="#D9D5CF" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          </>)}
          <path d={m.mouth} fill={m.mouthFill} stroke="#6E1F18" strokeWidth="2.6" strokeLinecap="round" />
          {m.flush && (<>
            <path d="M41.4 68.8q8.6 1.4 17.2 0" stroke="#B07A4E" strokeWidth=".9" fill="none" opacity=".6" />
            <path d="M35.6 60.4q3 1.6 6 1.4M64.4 60.4q-3 1.6-6 1.4" stroke="#A85A3C" strokeWidth=".9" fill="none" opacity=".45" />
          </>)}
          {/* القبّعةُ: قبّةٌ وشريطٌ وحاجبٌ ونجمةٌ ذهبيّة */}
          <g transform={`rotate(${m.capTilt} 50 26)`}>
            <path d="M22.5 26.5C22.5 12.8 34.6 4.5 50 4.5s27.5 8.3 27.5 22z" fill={`url(#${id}cap)`} />
            <path d="M31 12.5q8-6 19-5.6-11 1.4-16.4 9.6z" fill="#fff" opacity=".14" />
            <rect x="21.4" y="26" width="57.2" height="6.4" rx="2.2" fill={NAVYD} />
            <path d="M15.6 32.4h68.8a3 3 0 0 1 0 6H15.6a3 3 0 0 1 0-6z" fill="#10141F" />
            <path d="M17 33.6h66a1.6 1.6 0 0 1 0 1.6H17z" fill={NAVYL} opacity=".4" />
            <path d="M50 12.4l2.9 6 6.6.9-4.8 4.6 1.1 6.6-5.8-3.1-5.8 3.1 1.1-6.6-4.8-4.6 6.6-.9z" fill={`url(#${id}gold)`} />
          </g>
        </g>
        {/* ⚠️ الذراعانِ **بعد** الرأس — وإلّا حُجب المسدّسُ خلف قُبّة الرأس */}
        {m.pose === "hips" ? (<>
          <path d="M31 80Q19 88 33.5 95.5" stroke={`url(#${id}body)`} strokeWidth="8.6" fill="none" strokeLinecap="round" />
          <path d="M69 80Q81 88 66.5 95.5" stroke={`url(#${id}body)`} strokeWidth="8.6" fill="none" strokeLinecap="round" />
          <circle cx="34.5" cy="95.8" r="4.2" fill={NAVYD} />
          <circle cx="65.5" cy="95.8" r="4.2" fill={NAVYD} />
        </>) : m.pose === "listen" ? (<>
          <path d="M31 80Q19 88 33.5 95.5" stroke={`url(#${id}body)`} strokeWidth="8.6" fill="none" strokeLinecap="round" />
          {/* يدٌ مرفوعةٌ إلى السمّاعة — أوضحُ وقفةِ تيقّظٍ عند رجال الحماية */}
          <path d="M69 80Q86 72 79.5 57" stroke={`url(#${id}body)`} strokeWidth="8.6" fill="none" strokeLinecap="round" />
          <circle cx="34.5" cy="95.8" r="4.2" fill={NAVYD} />
          <circle cx="79" cy="55.6" r="4.4" fill={NAVYD} />
        </>) : (<>
          {/* 🎯 مسدّسٌ بكلتا يدَيه مصوَّبٌ إلى الأمام — والذراعانِ نحوَ الناظر مختصرتان */}
          <path d="M31 80Q34 70 44 68.5" stroke={`url(#${id}body)`} strokeWidth="9.4" fill="none" strokeLinecap="round" />
          <path d="M69 80Q66 70 56 68.5" stroke={`url(#${id}body)`} strokeWidth="9.4" fill="none" strokeLinecap="round" />
          <path d="M31 80Q34 70 44 68.5" stroke={NAVYL} strokeWidth="2" fill="none" strokeLinecap="round" opacity=".3" />
          <g className={`guard-glyph ${m.gun}`} style={{ transformOrigin: "50px 70px" }}>
            <ellipse cx="45.4" cy="69.4" rx="5.4" ry="4.6" fill={NAVYD} />
            <ellipse cx="54.6" cy="69.4" rx="5.4" ry="4.6" fill={NAVYD} />
            <ellipse cx="50" cy="69" rx="6.2" ry="4.8" fill="#1E2534" />
            <path d="M44.6 66.8q5.4-1.6 10.8 0" stroke={NAVYL} strokeWidth=".9" fill="none" opacity=".45" />
            <rect x="46.4" y="60.6" width="7.2" height="7" rx="1.4" fill="#161B27" />
            <rect x="47.6" y="61.4" width="4.8" height="1.1" rx=".5" fill="#39414D" opacity=".6" />
            <circle cx="50" cy="63.6" r="2.5" fill="#0A0D14" />
            <circle cx="50" cy="63.6" r="1.4" fill="#000" />
            <circle cx="49.2" cy="62.7" r=".6" fill="#5A6478" opacity=".7" />
          </g>
        </>)}
      </g>
    </svg>
  );
}
