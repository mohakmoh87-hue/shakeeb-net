package com.shakeebnet.field;

import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * يستقبل إشعارات FCM (data-only عالية الأولوية) — تصل حتى والتطبيق مُغلَق.
 * cmd=track-start ⇒ تشغيل خدمة الموقع الأمامية. cmd=track-stop ⇒ إيقافها.
 * onNewToken ⇒ إرسال رمز الجهاز للخادم (إن كان الفني مسجّلاً) ليتمكّن من إيقاظنا لاحقاً.
 */
public class TrackMessagingService extends FirebaseMessagingService {
    private static final String TAG = "ShakeebNet";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        String cmd = message.getData().get("cmd");
        Log.i(TAG, "FCM received cmd=" + cmd);
        if ("track-start".equals(cmd)) {
            Intent i = new Intent(this, LocationForegroundService.class);
            i.setAction(LocationForegroundService.ACTION_START);
            // FCM عالي الأولوية يمنح استثناءً لبدء خدمة أمامية من الخلفية
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(i);
            else startService(i);
        } else if ("track-stop".equals(cmd)) {
            Intent i = new Intent(this, LocationForegroundService.class);
            i.setAction(LocationForegroundService.ACTION_STOP);
            startService(i);
        }
    }

    @Override
    public void onNewToken(@NonNull String token) {
        Log.i(TAG, "FCM new token");
        // إرسال بخيط منفصل؛ يُتجاهَل بهدوء إن لم يكن الفني مسجّل دخول (لا كوكي)
        new Thread(() -> {
            String body = "{\"token\":" + jsonString(token) + "}";
            ServerApi.postJson("/api/field/push-token", body);
        }).start();
    }

    private static String jsonString(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') sb.append('\\').append(c);
            else sb.append(c);
        }
        return sb.append('"').toString();
    }
}
