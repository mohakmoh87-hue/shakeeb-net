package com.shakeebnet.field;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

/**
 * خدمة أمامية ترسل موقع الفني للخادم ما دام التتبع مطلوباً.
 * تبدأ عبر إشعار FCM (حتى والتطبيق مُغلَق) وتتوقّف حين يوقف المدير التتبع
 * (رسالة FCM «track-stop» أو ردّ الخادم tracking:false). لا تعمل إطلاقاً بلا طلب.
 */
public class LocationForegroundService extends Service {
    private static final String TAG = "ShakeebNet";
    private static final String CHANNEL_ID = "shakeebnet_tracking";
    private static final int NOTIF_ID = 4711;
    public static final String ACTION_START = "com.shakeebnet.field.START_TRACKING";
    public static final String ACTION_STOP = "com.shakeebnet.field.STOP_TRACKING";

    private static volatile boolean running = false;

    private FusedLocationProviderClient client;
    private LocationCallback callback;
    private final Handler main = new Handler(Looper.getMainLooper());

    // v2: التقاط كل ٥ث وإرسال دفعة كل دقيقة (توفير البطارية والبيانات)
    private final java.util.List<String> buffer = new java.util.ArrayList<>();
    private Runnable flusher;
    private static final long CAPTURE_MS = 5_000L;
    private static final long FLUSH_MS = 60_000L;
    private static final int MAX_BUFFER = 4000;

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            stopTracking();
            return START_NOT_STICKY;
        }

        // يجب رفع الإشعار خلال ثوانٍ من بدء الخدمة الأمامية
        startAsForeground();

        if (running) return START_NOT_STICKY; // يعمل أصلاً
        if (!hasLocationPermission()) {
            Log.w(TAG, "إذن الموقع غير ممنوح — إيقاف الخدمة");
            stopTracking();
            return START_NOT_STICKY;
        }
        running = true;
        startLocationUpdates();
        return START_NOT_STICKY;
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED
                || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void startLocationUpdates() {
        client = LocationServices.getFusedLocationProviderClient(this);
        // فاصل ٥ث ومسافة صفر: نلتقط النقاط ولو كان ثابتاً — ضروريّ لكشف التوقّفات
        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, CAPTURE_MS)
                .setMinUpdateIntervalMillis(CAPTURE_MS)
                .setMinUpdateDistanceMeters(0f)
                .build();
        callback = new LocationCallback() {
            @Override
            public void onLocationResult(@NonNull LocationResult result) {
                Location loc = result.getLastLocation();
                if (loc != null) bufferLocation(loc);
            }
        };
        try {
            client.requestLocationUpdates(request, callback, Looper.getMainLooper());
        } catch (SecurityException e) {
            Log.w(TAG, "requestLocationUpdates SecurityException");
            stopTracking();
            return;
        }
        scheduleFlush();
    }

    private void bufferLocation(Location loc) {
        long at = loc.getTime() > 0 ? loc.getTime() : System.currentTimeMillis();
        String pt = "{\"lat\":" + loc.getLatitude() + ",\"lng\":" + loc.getLongitude()
                + ",\"at\":" + at + ",\"acc\":" + loc.getAccuracy() + "}";
        synchronized (buffer) {
            buffer.add(pt);
            while (buffer.size() > MAX_BUFFER) buffer.remove(0);
        }
    }

    private void scheduleFlush() {
        if (flusher != null) return;
        flusher = new Runnable() {
            @Override
            public void run() {
                flush(false);
                if (running) main.postDelayed(this, FLUSH_MS);
            }
        };
        main.postDelayed(flusher, FLUSH_MS);
    }

    /** يرسل ما جُمع دفعةً واحدة إلى track/batch. فشلُ الشبكة يُعيد النقاط للمخزن؛ tracking:false يُوقف. */
    private void flush(final boolean isFinal) {
        final java.util.List<String> batch;
        synchronized (buffer) {
            if (buffer.isEmpty()) return;
            batch = new java.util.ArrayList<>(buffer);
            buffer.clear();
        }
        new Thread(() -> {
            StringBuilder sb = new StringBuilder("{\"points\":[");
            for (int i = 0; i < batch.size(); i++) {
                if (i > 0) sb.append(',');
                sb.append(batch.get(i));
            }
            sb.append("]}");
            String resp = ServerApi.postJson("/api/field/track/batch", sb.toString());
            if (resp == null) {
                if (!isFinal) {
                    synchronized (buffer) {
                        buffer.addAll(0, batch);
                        while (buffer.size() > MAX_BUFFER) buffer.remove(0);
                    }
                }
            } else if (resp.contains("\"tracking\":false")) {
                main.post(this::stopTracking);
            }
        }).start();
    }

    private void startAsForeground() {
        createChannel();
        Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("SHAKEEB — تتبع الموقع")
                .setContentText("مكتبك يتابع موقعك أثناء الدوام")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0;
        try {
            ServiceCompat.startForeground(this, NOTIF_ID, n, type);
        } catch (Exception e) {
            Log.w(TAG, "startForeground failed: " + e.getMessage());
            stopSelf();
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, "تتبع الموقع", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("يظهر أثناء متابعة المكتب لموقعك فقط");
                nm.createNotificationChannel(ch);
            }
        }
    }

    private void stopTracking() {
        running = false;
        if (flusher != null) { main.removeCallbacks(flusher); flusher = null; }
        try {
            if (client != null && callback != null) client.removeLocationUpdates(callback);
        } catch (Exception ignored) {}
        flush(true); // إرسال أخير لما تبقّى (أفضل جهد)
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
    }
}
