package com.shakeebnet.field;

import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.util.concurrent.Executor;

/**
 * البصمة الأصلية المربوطة بالحساب تشفيرياً (منع التبصيم لغير صاحب الحساب):
 * - enroll: يولّد مفتاح EC داخل عتاد الجهاز (AndroidKeyStore) محميّاً ببصمة النظام، لا يخرج
 *   من العتاد أبداً، ويعيد مفتاحه العام (SPKI) ليخزّنه الخادم مربوطاً بحساب الفني.
 * - sign: يوقّع تحدّي الخادم بعد بصمة صاحب المفتاح (BiometricPrompt + CryptoObject) — يُثبت
 *   حضور صاحب هذا الجهاز/البصمة تحديداً. فنيّ آخر على جهازه لا يملك المفتاح فيفشل.
 * setInvalidatedByBiometricEnrollment: أي تغيير في بصمات الجهاز يُبطل المفتاح (يلزم إعادة تسجيل).
 *
 * ===== دعم بصمة الوجه (طلب محمد 2026-08-09) =====
 * أغلب هواتف أندرويد تُصنّف بصمة الوجه Class 2 (BIOMETRIC_WEAK)، ومكتبة androidx.biometric
 * ترفض CryptoObject مع WEAK، والمفتاح نفسه مربوطٌ بـAUTH_BIOMETRIC_STRONG — فلذلك كان
 * الجهاز يعرض الإصبع وحده. الحلّ: **مسارٌ ثانٍ** يُستعمل فقط حين لا تتوفّر البصمة القويّة:
 *   • enroll: مفتاحٌ غير مربوطٍ بمصادقة العتاد (setUserAuthenticationRequired(false)).
 *   • sign: BiometricPrompt بـ STRONG|WEAK **بلا CryptoObject**، والتوقيع داخل نجاح المصادقة.
 * فالجهاز الذي يملك بصمة إصبع قويّة يبقى على المسار القويّ حرفيّاً (لا إضعاف)، ومن لا يملك
 * إلا الوجه يستطيع التبصيم. الوضع يُحفَظ في SharedPreferences ليعرف sign أيّ مسارٍ يسلك،
 * ويُرفَع للواجهة (strong/weak) لتشرح للفنيّ ما هو المتاح على جهازه.
 */
@CapacitorPlugin(name = "BiometricNative")
public class BiometricNativePlugin extends Plugin {

    private static final String KS = "AndroidKeyStore";
    private static final String ALIAS = "shakeeb_bio_key";
    // البصمة القويّة (Class 3) — يتطلّبها التوقيع المشفّر عبر CryptoObject
    private static final int STRONG = BiometricManager.Authenticators.BIOMETRIC_STRONG;
    // القويّة أو الضعيفة (Class 2 — يشمل بصمة الوجه على أغلب الأجهزة)
    private static final int STRONG_OR_WEAK =
            BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.BIOMETRIC_WEAK;

    private static final String PREFS = "shakeeb_bio";
    private static final String PREF_WEAK = "weak_key"; // true = المفتاح غير مربوطٍ بالعتاد (مسار الوجه)

    private boolean strongOk() {
        return BiometricManager.from(getContext()).canAuthenticate(STRONG) == BiometricManager.BIOMETRIC_SUCCESS;
    }
    private boolean weakOk() {
        return BiometricManager.from(getContext()).canAuthenticate(STRONG_OR_WEAK) == BiometricManager.BIOMETRIC_SUCCESS;
    }
    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        int rStrong = BiometricManager.from(getContext()).canAuthenticate(STRONG);
        int rAny = BiometricManager.from(getContext()).canAuthenticate(STRONG_OR_WEAK);
        boolean strong = rStrong == BiometricManager.BIOMETRIC_SUCCESS;
        boolean any = rAny == BiometricManager.BIOMETRIC_SUCCESS;
        JSObject ret = new JSObject();
        // available: أيّ بصمةٍ صالحة (إصبع قويّة أو وجه/ضعيفة) — فلا يُحجَب من يملك الوجه وحده
        ret.put("available", any);
        ret.put("strong", strong);          // بصمة قويّة (إصبع عادةً) — المسار المشفّر
        ret.put("weak", any && !strong);    // وجه/ضعيفة فقط — المسار الثاني
        ret.put("code", strong ? rStrong : rAny); // 0 نجاح، 11 لا بصمة مُسجَّلة، 12 لا عتاد…
        call.resolve(ret);
    }

    @PluginMethod
    public void isEnrolled(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            KeyStore ks = KeyStore.getInstance(KS);
            ks.load(null);
            ret.put("enrolled", ks.containsAlias(ALIAS));
        } catch (Exception e) {
            ret.put("enrolled", false);
        }
        call.resolve(ret);
    }

    // توليد مفتاح جهاز مربوط بالبصمة (لا يخرج من العتاد) وإرجاع المفتاح العام (SPKI base64).
    // إن لم تتوفّر بصمةٌ قويّة (وجه فقط) يُولَّد مفتاحٌ غير مربوطٍ بالعتاد ليعمل المسار الثاني.
    @PluginMethod
    public void enroll(PluginCall call) {
        try {
            KeyStore ks = KeyStore.getInstance(KS);
            ks.load(null);
            if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS); // توليد نظيف

            final boolean useStrong = strongOk();
            KeyPairGenerator kpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KS);
            KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256);
            if (useStrong) {
                // المسار القويّ (كما كان حرفيّاً): المفتاح لا يُستخدم إلا ببصمةٍ قويّة عند كلّ توقيع
                b.setUserAuthenticationRequired(true).setInvalidatedByBiometricEnrollment(true);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
                } else {
                    b.setUserAuthenticationValidityDurationSeconds(-1); // بصمة عند كل استخدام
                }
            } else {
                // مسار الوجه/الضعيفة: المفتاح غير مربوطٍ بمصادقة العتاد (CryptoObject ممنوع مع WEAK)
                b.setUserAuthenticationRequired(false);
            }
            kpg.initialize(b.build());
            KeyPair kp = kpg.generateKeyPair();
            PublicKey pub = kp.getPublic();
            prefs().edit().putBoolean(PREF_WEAK, !useStrong).apply();
            JSObject ret = new JSObject();
            ret.put("publicKey", Base64.encodeToString(pub.getEncoded(), Base64.NO_WRAP));
            ret.put("weak", !useStrong);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("enroll_failed", e);
        }
    }

    // توقيع تحدّي الخادم بعد بصمة النظام
    @PluginMethod
    public void sign(final PluginCall call) {
        final String challenge = call.getString("challenge", "");
        if (challenge == null || challenge.isEmpty()) { call.reject("no_challenge"); return; }
        final FragmentActivity activity = (getActivity() instanceof FragmentActivity) ? (FragmentActivity) getActivity() : null;
        if (activity == null) { call.reject("no_activity"); return; }

        // مسار المفتاح الحاليّ: مربوطٌ بالعتاد (قويّ) أم لا (وجه/ضعيفة)
        final boolean weakKey = prefs().getBoolean(PREF_WEAK, false);

        final Signature signature;
        try {
            KeyStore ks = KeyStore.getInstance(KS);
            ks.load(null);
            PrivateKey priv = (PrivateKey) ks.getKey(ALIAS, null);
            if (priv == null) { call.reject("not_enrolled"); return; }
            signature = Signature.getInstance("SHA256withECDSA");
            signature.initSign(priv);
        } catch (KeyPermanentlyInvalidatedException e) {
            call.reject("key_invalidated"); return; // تغيّرت البصمات → إعادة تسجيل
        } catch (Exception e) {
            call.reject("sign_init_failed", e); return;
        }

        activity.runOnUiThread(() -> {
            try {
                Executor executor = ContextCompat.getMainExecutor(getContext());
                BiometricPrompt prompt = new BiometricPrompt(activity, executor,
                        new BiometricPrompt.AuthenticationCallback() {
                            @Override
                            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                                try {
                                    // المسار القويّ: التوقيع من CryptoObject المصادَق عليه عتاديّاً.
                                    // مسار الوجه: نوقّع بالمفتاح نفسه بعد نجاح المصادقة (بلا CryptoObject).
                                    Signature s = (result.getCryptoObject() != null && result.getCryptoObject().getSignature() != null)
                                            ? result.getCryptoObject().getSignature()
                                            : signature;
                                    s.update(challenge.getBytes("UTF-8"));
                                    JSObject ret = new JSObject();
                                    ret.put("signature", Base64.encodeToString(s.sign(), Base64.NO_WRAP));
                                    call.resolve(ret);
                                } catch (Exception e) {
                                    call.reject("sign_failed", e);
                                }
                            }
                            @Override
                            public void onAuthenticationError(int code, CharSequence err) {
                                JSObject ret = new JSObject(); // إلغاء/خطأ — نتيجة بلا توقيع
                                ret.put("error", err != null ? err.toString() : "");
                                ret.put("errorCode", code);
                                call.resolve(ret);
                            }
                            @Override public void onAuthenticationFailed() { /* غير مطابقة — يُعاد تلقائياً */ }
                        });
                BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                        .setTitle("تأكيد الحضور ببصمتك")
                        .setSubtitle(weakKey ? "أكّد ببصمة وجهك أو إصبعك" : "المس بصمتك المُسجَّلة للتأكيد")
                        .setNegativeButtonText("إلغاء")
                        .setAllowedAuthenticators(weakKey ? STRONG_OR_WEAK : STRONG)
                        .build();
                if (weakKey) {
                    prompt.authenticate(info); // بلا CryptoObject (يسمح ببصمة الوجه Class 2)
                } else {
                    prompt.authenticate(info, new BiometricPrompt.CryptoObject(signature));
                }
            } catch (Exception e) {
                call.reject("prompt_error", e);
            }
        });
    }

    @PluginMethod
    public void clear(PluginCall call) {
        try {
            KeyStore ks = KeyStore.getInstance(KS);
            ks.load(null);
            if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS);
            prefs().edit().remove(PREF_WEAK).apply();
        } catch (Exception ignored) {}
        call.resolve();
    }
}
