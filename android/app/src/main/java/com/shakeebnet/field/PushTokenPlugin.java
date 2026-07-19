package com.shakeebnet.field;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * جسر بسيط ليحصل الويب على رمز جهاز FCM ويرسله للخادم (/api/field/push-token).
 * الاستدعاء من الويب: registerPlugin("PushToken").getToken().
 */
@CapacitorPlugin(name = "PushToken")
public class PushTokenPlugin extends Plugin {

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
}
