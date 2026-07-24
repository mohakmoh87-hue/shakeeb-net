package com.shakeebnet.field;

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
 */
@CapacitorPlugin(name = "BiometricNative")
public class BiometricNativePlugin extends Plugin {

    private static final String KS = "AndroidKeyStore";
    private static final String ALIAS = "shakeeb_bio_key";
    // نشترط البصمة القوية (Class 3) لأن التوقيع المشفّر عبر CryptoObject يتطلبها
    private static final int ALLOWED = BiometricManager.Authenticators.BIOMETRIC_STRONG;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        int r = BiometricManager.from(getContext()).canAuthenticate(ALLOWED);
        JSObject ret = new JSObject();
        ret.put("available", r == BiometricManager.BIOMETRIC_SUCCESS);
        ret.put("code", r); // 0 نجاح، 11 لا بصمة مُسجَّلة، 12 لا عتاد…
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

    // توليد مفتاح جهاز مربوط بالبصمة (لا يخرج من العتاد) وإرجاع المفتاح العام (SPKI base64)
    @PluginMethod
    public void enroll(PluginCall call) {
        try {
            KeyStore ks = KeyStore.getInstance(KS);
            ks.load(null);
            if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS); // توليد نظيف

            KeyPairGenerator kpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KS);
            KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .setUserAuthenticationRequired(true)
                    .setInvalidatedByBiometricEnrollment(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
            } else {
                b.setUserAuthenticationValidityDurationSeconds(-1); // بصمة عند كل استخدام
            }
            kpg.initialize(b.build());
            KeyPair kp = kpg.generateKeyPair();
            PublicKey pub = kp.getPublic();
            JSObject ret = new JSObject();
            ret.put("publicKey", Base64.encodeToString(pub.getEncoded(), Base64.NO_WRAP));
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
                                    Signature s = result.getCryptoObject().getSignature();
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
                        .setSubtitle("المس بصمتك المُسجَّلة للتأكيد")
                        .setNegativeButtonText("إلغاء")
                        .setAllowedAuthenticators(ALLOWED)
                        .build();
                prompt.authenticate(info, new BiometricPrompt.CryptoObject(signature));
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
        } catch (Exception ignored) {}
        call.resolve();
    }
}
