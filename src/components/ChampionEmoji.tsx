"use client";

import { useId } from "react";

// ===== وجه البطل المتحرّك (طلب محمد 2026-08-05) =====
// إيموجي حقيقيّ لا يتحرّك — فبنيتُه رسماً متجهاً (SVG) بحركةٍ من CSS: تاجٌ يتمايل،
// ونظارةٌ تنزلق عن العينين ثم تعود، وغمزةٌ بالعين، وابتسامةُ زهوٍ، وبريقٌ يلمع.
// بلا صور ولا مكتبات — يعمل في المتصفّح وفي WebView التطبيق سواءً بسواء.
// ويحترم «تقليل الحركة» في النظام: من أطفأ الحركات يراه ساكناً بلا وميض.
export default function ChampionEmoji({ size = 22, className = "" }: { size?: number; className?: string }) {
  // 🔴 بلاغ محمد 2026-08-19: في التطبيق ظهر الوجهُ «خطوطاً زرقاءَ مفرَّغاً» — لأنّ
  //   نسختَين منه تعيشان معاً (بطاقاتُ الإحصاء المخفيّةُ في التجربة + شارةُ المتصدّر)
  //   ومعرّفاتُ التدرّجات ثابتة (chFace/chGold) فيحلّها المتصفّح على النسخة الأولى —
  //   وهي داخل display:none فتسقط التعبئةُ كلُّها. المعرّفاتُ صارت فريدةً لكلّ نسخة.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const faceId = `chFace${uid}`;
  const goldId = `chGold${uid}`;
  return (
    <span className={`champ ${className}`} style={{ width: size, height: size, display: "inline-block", lineHeight: 0 }} aria-hidden>
      <style>{`
        .champ svg { overflow: visible; }
        /* التاج: تمايلٌ خفيف كأنه يفاخر */
        .champ .cr { transform-origin: 32px 20px; animation: chCrown 3.2s ease-in-out infinite; }
        @keyframes chCrown { 0%,100% { transform: rotate(-7deg) translateY(0) } 50% { transform: rotate(7deg) translateY(-1.2px) } }
        /* النظارة: تنزلق عن العينين ثم تعود */
        .champ .gl { transform-origin: 32px 34px; animation: chGlass 4.6s cubic-bezier(.4,0,.2,1) infinite; }
        @keyframes chGlass {
          0%, 38% { transform: translateY(0) rotate(0deg) }
          48%, 62% { transform: translateY(7px) rotate(-4deg) }
          72%, 100% { transform: translateY(0) rotate(0deg) }
        }
        /* العين اليمنى تغمز حين تنزل النظارة */
        .champ .eyeR { transform-origin: 39px 33px; animation: chWink 4.6s ease-in-out infinite; }
        @keyframes chWink { 0%, 50% { transform: scaleY(1) } 55%, 60% { transform: scaleY(.12) } 66%, 100% { transform: scaleY(1) } }
        /* بريقٌ يلمع على التاج */
        .champ .sp { transform-origin: center; animation: chSpark 2.4s ease-in-out infinite; }
        .champ .sp2 { animation-delay: 1.1s; }
        @keyframes chSpark { 0%, 70%, 100% { opacity: 0; transform: scale(.4) } 82% { opacity: 1; transform: scale(1) } }
        @media (prefers-reduced-motion: reduce) {
          .champ .cr, .champ .gl, .champ .eyeR, .champ .sp { animation: none }
        }
      `}</style>
      <svg viewBox="0 0 64 64" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id={faceId} cx="38%" cy="32%" r="72%">
            <stop offset="0%" stopColor="#ffe27a" />
            <stop offset="60%" stopColor="#fdc63f" />
            <stop offset="100%" stopColor="#e89b12" />
          </radialGradient>
          <linearGradient id={goldId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffe89a" />
            <stop offset="55%" stopColor="#f5c53d" />
            <stop offset="100%" stopColor="#d99a10" />
          </linearGradient>
        </defs>

        {/* الوجه */}
        <circle cx="32" cy="38" r="20.5" fill={`url(#${faceId})`} stroke="#a86a06" strokeWidth="1.7" />

        {/* التاج */}
        <g className="cr">
          <path d="M15.5 20.5 L21.5 12 L27 17.5 L32 9 L37 17.5 L42.5 12 L48.5 20.5 Z" fill={`url(#${goldId})`} stroke="#c8830a" strokeWidth="1.3" strokeLinejoin="round" />
          <rect x="15.5" y="19.8" width="33" height="5.2" rx="2.2" fill={`url(#${goldId})`} stroke="#c8830a" strokeWidth="1.1" />
          <circle cx="32" cy="10.2" r="2.1" fill="#fff3c4" stroke="#c8830a" strokeWidth=".9" />
          <circle cx="21.5" cy="13.2" r="1.6" fill="#ff5c7a" />
          <circle cx="42.5" cy="13.2" r="1.6" fill="#5ec3ff" />
        </g>

        {/* العينان (تظهران حين تنزل النظارة) */}
        <ellipse cx="25" cy="33" rx="2.3" ry="3" fill="#3a2a06" />
        <ellipse className="eyeR" cx="39" cy="33" rx="2.3" ry="3" fill="#3a2a06" />

        {/* ابتسامة الزهو */}
        <path d="M23 45 q8 7 16.5 1.5" fill="none" stroke="#8a5a06" strokeWidth="2.9" strokeLinecap="round" />

        {/* النظارة الشمسية */}
        <g className="gl">
          <rect x="17.5" y="28.8" width="13.2" height="9" rx="3.6" fill="#2b2b33" stroke="#15151a" strokeWidth="1.1" />
          <rect x="33.3" y="28.8" width="13.2" height="9" rx="3.6" fill="#2b2b33" stroke="#15151a" strokeWidth="1.1" />
          <path d="M31 31.5 q1 -1.4 2 0" fill="none" stroke="#15151a" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M16.5 30.5 L11.5 28.5" stroke="#15151a" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M47.5 30.5 L52.5 28.5" stroke="#15151a" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M20 30.6 l3.2 4.6" stroke="#7c7c8a" strokeWidth="2.1" strokeLinecap="round" opacity=".9" />
          <path d="M36 30.6 l3.2 4.6" stroke="#7c7c8a" strokeWidth="2.1" strokeLinecap="round" opacity=".9" />
        </g>

        {/* بريق */}
        <path className="sp" d="M52 14 l1.4 3.2 3.2 1.4 -3.2 1.4 -1.4 3.2 -1.4 -3.2 -3.2 -1.4 3.2 -1.4 Z" fill="#fff6cf" />
        <path className="sp sp2" d="M11 22 l1 2.3 2.3 1 -2.3 1 -1 2.3 -1 -2.3 -2.3 -1 2.3 -1 Z" fill="#fff6cf" />
      </svg>
    </span>
  );
}
