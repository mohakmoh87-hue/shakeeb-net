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
        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 60_000L)
                .setMinUpdateIntervalMillis(30_000L)
                .setMinUpdateDistanceMeters(10f)
                .build();
        callback = new LocationCallback() {
            @Override
            public void onLocationResult(@NonNull LocationResult result) {
                Location loc = result.getLastLocation();
                if (loc != null) postLocation(loc.getLatitude(), loc.getLongitude());
            }
        };
        try {
            client.requestLocationUpdates(request, callback, Looper.getMainLooper());
        } catch (SecurityException e) {
            Log.w(TAG, "requestLocationUpdates SecurityException");
            stopTracking();
        }
    }

    /** يرسل الموقع للخادم؛ إن ردّ الخادم أن التتبع لم يعُد مطلوباً → إيقاف الخدمة. */
    private void postLocation(final double lat, final double lng) {
        new Thread(() -> {
            String body = "{\"lat\":" + lat + ",\"lng\":" + lng + "}";
            String resp = ServerApi.postJson("/api/field/track", body);
            // الخادم يعيد {"tracking":false} حين يوقف المدير التتبع أو تنتهي الجلسة
            boolean stop = resp == null || resp.contains("\"tracking\":false");
            if (stop) main.post(this::stopTracking);
        }).start();
    }

    private void startAsForeground() {
        createChannel();
        Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("شكيب نت — تتبع الموقع")
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
        try {
            if (client != null && callback != null) client.removeLocationUpdates(callback);
        } catch (Exception ignored) {}
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
    }
}
