package com.shakeebnet.field;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * جسر التتبّع الأصلي للويب:
 * - getToken: يعطي رمز جهاز FCM ليرسله الويب للخادم (ليتمكّن من إيقاظنا والتطبيق مُغلَق).
 * - startTracking/stopTracking: يشغّل/يوقف خدمة الموقع مباشرة حين يكون التطبيق مفتوحاً
 *   (احتياط موثوق لا يعتمد على وصول الإشعار)؛ نفس الخدمة تُوقظها FCM حين يكون مُغلَقاً.
 */
@CapacitorPlugin(name = "NativeTrack")
public class NativeTrackPlugin extends Plugin {

    @PluginMethod
    public void getToken(PluginCall call) {
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (task.isSuccessful() && task.getResult() != null) {
                JSObject ret = new JSObject();
                ret.put("token", task.getResult());
                call.resolve(ret);
            } else {
                call.reject("token_failed");
            }
        });
    }

    @PluginMethod
    public void startTracking(PluginCall call) {
        Intent i = new Intent(getContext(), LocationForegroundService.class);
        i.setAction(LocationForegroundService.ACTION_START);
        // التطبيق مفتوح (في المقدّمة) ⇒ يُسمح ببدء الخدمة الأمامية
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(i);
        else getContext().startService(i);
        call.resolve();
    }

    @PluginMethod
    public void stopTracking(PluginCall call) {
        Intent i = new Intent(getContext(), LocationForegroundService.class);
        i.setAction(LocationForegroundService.ACTION_STOP);
        getContext().startService(i);
        call.resolve();
    }
}
