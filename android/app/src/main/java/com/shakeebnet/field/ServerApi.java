package com.shakeebnet.field;

import android.util.Log;
import android.webkit.CookieManager;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * اتصال بسيط بخادم شكيب نت من الكود الأصلي (بلا مكتبات).
 * يعيد استخدام كوكي جلسة الفني (mynet_session) المخزَّنة في متصفّح التطبيق —
 * فلا حاجة لرمز مصادقة منفصل، ونفس مسار /api/field/track يتحقّق من الجلسة.
 */
public final class ServerApi {
    private static final String TAG = "ShakeebNet";
    public static final String BASE = "https://shakeebnet.com";

    private ServerApi() {}

    /** كوكي الموقع المحفوظ (يتضمّن mynet_session). null إن لم يوجد. */
    public static String cookie() {
        try {
            String c = CookieManager.getInstance().getCookie(BASE);
            return (c != null && c.contains("mynet_session")) ? c : null;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * POST JSON إلى مسار على الخادم بكوكي الجلسة. يعيد نص الاستجابة، أو null عند الفشل.
     */
    public static String postJson(String path, String jsonBody) {
        String c = cookie();
        if (c == null) return null; // غير مسجّل دخول — لا شيء نفعله
        HttpURLConnection conn = null;
        try {
            URL url = new URL(BASE + path);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Cookie", c);
            byte[] out = jsonBody.getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(out);
            }
            int code = conn.getResponseCode();
            InputStream is = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
            StringBuilder sb = new StringBuilder();
            if (is != null) {
                try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line);
                }
            }
            return sb.toString();
        } catch (Exception e) {
            Log.w(TAG, "postJson failed: " + e.getMessage());
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
