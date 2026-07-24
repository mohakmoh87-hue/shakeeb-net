package com.shakeebnet.field;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.Executor;

/**
 * جسر البصمة الأصلية للويب (Android BiometricPrompt) — بصمة إصبع/وجه حقيقية داخل التطبيق،
 * بديلاً عن WebAuthn الذي لا يعمل في WebView. يستدعيه كود الويب عبر Capacitor حين
 * يكون داخل التطبيق الأصلي، ويبقى WebAuthn للمتصفح.
 * - isAvailable: هل يوجد مستشعر بصمة مُفعّل ومُسجَّل عليه بصمة؟
 * - authenticate: يُظهر نافذة بصمة النظام؛ يعيد { verified: true } عند النجاح.
 * ملاحظة أمنية: فحص محلي على الجهاز (لا تشفيري كـ WebAuthn) — كافٍ لمنع تبصيم زميل عن زميل.
 */
@CapacitorPlugin(name = "BiometricNative")
public class BiometricNativePlugin extends Plugin {

    // بصمة قوية أو ضعيفة (إصبع/وجه) — بلا رمز الجهاز، كي نُبقي زرّ الإلغاء ظاهراً
    private static final int ALLOWED = BiometricManager.Authenticators.BIOMETRIC_STRONG
            | BiometricManager.Authenticators.BIOMETRIC_WEAK;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        int result = BiometricManager.from(getContext()).canAuthenticate(ALLOWED);
        JSObject ret = new JSObject();
        ret.put("available", result == BiometricManager.BIOMETRIC_SUCCESS);
        ret.put("code", result); // للتشخيص: 0 نجاح، 11 لا بصمة مُسجَّلة، 12 لا عتاد…
        call.resolve(ret);
    }

    @PluginMethod
    public void authenticate(final PluginCall call) {
        final String title = call.getString("title", "تأكيد البصمة");
        final String subtitle = call.getString("subtitle", "المس مستشعر البصمة للتأكيد");
        final String cancel = call.getString("cancel", "إلغاء");

        final FragmentActivity activity = (getActivity() instanceof FragmentActivity)
                ? (FragmentActivity) getActivity() : null;
        if (activity == null) { call.reject("no_activity"); return; }

        activity.runOnUiThread(() -> {
            try {
                Executor executor = ContextCompat.getMainExecutor(getContext());
                BiometricPrompt prompt = new BiometricPrompt(activity, executor,
                        new BiometricPrompt.AuthenticationCallback() {
                            @Override
                            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r) {
                                JSObject ret = new JSObject();
                                ret.put("verified", true);
                                call.resolve(ret);
                            }

                            @Override
                            public void onAuthenticationError(int errorCode, CharSequence errString) {
                                // إلغاء/خطأ نهائي — نعيد نتيجة (لا نرفض) ليتعامل معها الويب بلطف
                                JSObject ret = new JSObject();
                                ret.put("verified", false);
                                ret.put("errorCode", errorCode);
                                ret.put("error", errString != null ? errString.toString() : "");
                                call.resolve(ret);
                            }

                            @Override
                            public void onAuthenticationFailed() {
                                // بصمة غير مطابقة لمحاولة واحدة — النظام يسمح بإعادة المحاولة، لا نُنهي هنا
                            }
                        });

                BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                        .setTitle(title)
                        .setSubtitle(subtitle)
                        .setNegativeButtonText(cancel)
                        .setConfirmationRequired(false)
                        .setAllowedAuthenticators(ALLOWED)
                        .build();
                prompt.authenticate(info);
            } catch (Exception e) {
                call.reject("prompt_error", e);
            }
        });
    }
}
