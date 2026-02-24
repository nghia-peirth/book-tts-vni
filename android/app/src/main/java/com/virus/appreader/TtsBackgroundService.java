package com.virus.appreader;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

public class TtsBackgroundService extends Service {

    public static final String CHANNEL_ID = "tts_playback_channel";
    public static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_START = "com.virus.appreader.TTS_START";
    public static final String ACTION_STOP = "com.virus.appreader.TTS_STOP";
    public static final String ACTION_UPDATE = "com.virus.appreader.TTS_UPDATE";
    public static final String ACTION_MEDIA_PLAY = "com.virus.appreader.TTS_MEDIA_PLAY";
    public static final String ACTION_MEDIA_PAUSE = "com.virus.appreader.TTS_MEDIA_PAUSE";
    public static final String ACTION_MEDIA_STOP = "com.virus.appreader.TTS_MEDIA_STOP";
    public static final String ACTION_MEDIA_NEXT = "com.virus.appreader.TTS_MEDIA_NEXT";
    public static final String ACTION_MEDIA_PREV = "com.virus.appreader.TTS_MEDIA_PREV";

    // Broadcast to JS
    public static final String BROADCAST_COMMAND = "com.virus.appreader.TTS_COMMAND";

    private MediaSessionCompat mediaSession;
    private PowerManager.WakeLock wakeLock;
    private String bookTitle = "AppReader";
    private String chapterTitle = "";
    private boolean isPlaying = false;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        setupMediaSession();
        acquireWakeLock();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Nghe truyện",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Điều khiển nghe truyện");
            channel.setShowBadge(false);
            channel.setSound(null, null);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void setupMediaSession() {
        mediaSession = new MediaSessionCompat(this, "AppReaderTTS");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                broadcastCommand("play");
                updatePlaybackState(true);
            }

            @Override
            public void onPause() {
                broadcastCommand("pause");
                updatePlaybackState(false);
            }

            @Override
            public void onStop() {
                broadcastCommand("stop");
                stopSelf();
            }

            @Override
            public void onSkipToNext() {
                broadcastCommand("next");
            }

            @Override
            public void onSkipToPrevious() {
                broadcastCommand("prev");
            }
        });
        mediaSession.setActive(true);
    }

    private void acquireWakeLock() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "AppReader::TtsWakeLock"
            );
            wakeLock.acquire(6 * 60 * 60 * 1000L); // max 6 hours
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        String action = intent.getAction();
        if (action == null) action = ACTION_START;

        switch (action) {
            case ACTION_START:
                bookTitle = intent.getStringExtra("bookTitle");
                chapterTitle = intent.getStringExtra("chapterTitle");
                if (bookTitle == null) bookTitle = "AppReader";
                if (chapterTitle == null) chapterTitle = "";
                isPlaying = true;
                updatePlaybackState(true);
                updateMetadata();
                startForeground(NOTIFICATION_ID, buildNotification());
                break;

            case ACTION_UPDATE:
                String newBook = intent.getStringExtra("bookTitle");
                String newChapter = intent.getStringExtra("chapterTitle");
                boolean newPlaying = intent.getBooleanExtra("isPlaying", isPlaying);
                if (newBook != null) bookTitle = newBook;
                if (newChapter != null) chapterTitle = newChapter;
                isPlaying = newPlaying;
                updatePlaybackState(isPlaying);
                updateMetadata();
                updateNotification();
                break;

            case ACTION_STOP:
                stopSelf();
                break;

            case ACTION_MEDIA_PLAY:
                broadcastCommand("play");
                updatePlaybackState(true);
                break;

            case ACTION_MEDIA_PAUSE:
                broadcastCommand("pause");
                updatePlaybackState(false);
                break;

            case ACTION_MEDIA_STOP:
                broadcastCommand("stop");
                stopSelf();
                break;

            case ACTION_MEDIA_NEXT:
                broadcastCommand("next");
                break;

            case ACTION_MEDIA_PREV:
                broadcastCommand("prev");
                break;
        }

        return START_STICKY;
    }

    private void broadcastCommand(String command) {
        Intent broadcast = new Intent(BROADCAST_COMMAND);
        broadcast.putExtra("command", command);
        broadcast.setPackage(getPackageName());
        sendBroadcast(broadcast);
    }

    private void updatePlaybackState(boolean playing) {
        isPlaying = playing;
        long actions = PlaybackStateCompat.ACTION_PLAY
            | PlaybackStateCompat.ACTION_PAUSE
            | PlaybackStateCompat.ACTION_STOP
            | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
            | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS;

        int state = playing
            ? PlaybackStateCompat.STATE_PLAYING
            : PlaybackStateCompat.STATE_PAUSED;

        mediaSession.setPlaybackState(
            new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(state, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1.0f)
                .build()
        );
        updateNotification();
    }

    private void updateMetadata() {
        mediaSession.setMetadata(
            new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, chapterTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, bookTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "AppReader")
                .build()
        );
    }

    private Notification buildNotification() {
        // Open app when tapping notification
        Intent contentIntent = new Intent(this, MainActivity.class);
        contentIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentPendingIntent = PendingIntent.getActivity(
            this, 0, contentIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Prev button
        Intent prevIntent = new Intent(this, TtsBackgroundService.class);
        prevIntent.setAction(ACTION_MEDIA_PREV);
        PendingIntent prevPending = PendingIntent.getService(
            this, 1, prevIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Play/Pause button
        Intent playPauseIntent = new Intent(this, TtsBackgroundService.class);
        playPauseIntent.setAction(isPlaying ? ACTION_MEDIA_PAUSE : ACTION_MEDIA_PLAY);
        PendingIntent playPausePending = PendingIntent.getService(
            this, 2, playPauseIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Next button
        Intent nextIntent = new Intent(this, TtsBackgroundService.class);
        nextIntent.setAction(ACTION_MEDIA_NEXT);
        PendingIntent nextPending = PendingIntent.getService(
            this, 3, nextIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Stop button
        Intent stopIntent = new Intent(this, TtsBackgroundService.class);
        stopIntent.setAction(ACTION_MEDIA_STOP);
        PendingIntent stopPending = PendingIntent.getService(
            this, 4, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        int playPauseIcon = isPlaying
            ? android.R.drawable.ic_media_pause
            : android.R.drawable.ic_media_play;
        String playPauseTitle = isPlaying ? "Tạm dừng" : "Tiếp tục";

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(chapterTitle.isEmpty() ? bookTitle : chapterTitle)
            .setContentText(chapterTitle.isEmpty() ? "Đang đọc..." : bookTitle)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(contentPendingIntent)
            .setOngoing(isPlaying)
            .setShowWhen(false)
            .addAction(android.R.drawable.ic_media_previous, "Trước", prevPending)
            .addAction(playPauseIcon, playPauseTitle, playPausePending)
            .addAction(android.R.drawable.ic_media_next, "Sau", nextPending)
            .addAction(android.R.drawable.ic_delete, "Dừng", stopPending)
            .setStyle(new MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2) // prev, play/pause, next
            )
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void updateNotification() {
        try {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.notify(NOTIFICATION_ID, buildNotification());
            }
        } catch (Exception e) {
            // ignore
        }
    }

    @Override
    public void onDestroy() {
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
