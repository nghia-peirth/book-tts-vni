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
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class TtsBackgroundService extends Service implements TextToSpeech.OnInitListener {

    private static final String TAG = "TtsService";
    public static final String CHANNEL_ID = "tts_playback_channel";
    public static final int NOTIFICATION_ID = 1001;

    // Actions from JS / notification
    public static final String ACTION_START = "com.virus.appreader.TTS_START";
    public static final String ACTION_STOP = "com.virus.appreader.TTS_STOP";
    public static final String ACTION_UPDATE_META = "com.virus.appreader.TTS_UPDATE_META";
    public static final String ACTION_SET_PARAGRAPHS = "com.virus.appreader.TTS_SET_PARAGRAPHS";
    public static final String ACTION_PAUSE = "com.virus.appreader.TTS_PAUSE";
    public static final String ACTION_RESUME = "com.virus.appreader.TTS_RESUME";
    public static final String ACTION_SET_RATE = "com.virus.appreader.TTS_SET_RATE";
    public static final String ACTION_SET_VOICE = "com.virus.appreader.TTS_SET_VOICE";
    public static final String ACTION_MEDIA_PLAY = "com.virus.appreader.TTS_MEDIA_PLAY";
    public static final String ACTION_MEDIA_PAUSE = "com.virus.appreader.TTS_MEDIA_PAUSE";
    public static final String ACTION_MEDIA_STOP = "com.virus.appreader.TTS_MEDIA_STOP";
    public static final String ACTION_MEDIA_NEXT = "com.virus.appreader.TTS_MEDIA_NEXT";
    public static final String ACTION_MEDIA_PREV = "com.virus.appreader.TTS_MEDIA_PREV";

    // Broadcasts to JS
    public static final String BROADCAST_COMMAND = "com.virus.appreader.TTS_COMMAND";
    public static final String BROADCAST_PROGRESS = "com.virus.appreader.TTS_PROGRESS";

    private TextToSpeech tts;
    private boolean ttsReady = false;
    private MediaSessionCompat mediaSession;
    private PowerManager.WakeLock wakeLock;

    // Playback state
    private List<String> paragraphs = new ArrayList<>();
    private int currentIndex = -1;
    private boolean isPlaying = false;
    private boolean isPaused = false;
    private float speechRate = 1.0f;
    private String voiceName = null;

    // Metadata
    private String bookTitle = "AppReader";
    private String chapterTitle = "";

    // Queue pending speak if TTS not ready yet
    private boolean pendingSpeak = false;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        setupMediaSession();
        acquireWakeLock();

        // Initialize native TTS engine
        tts = new TextToSpeech(this, this);
    }

    @Override
    public void onInit(int status) {
        if (status == TextToSpeech.SUCCESS) {
            int result = tts.setLanguage(new Locale("vi", "VN"));
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                // Fallback to default
                tts.setLanguage(Locale.getDefault());
                Log.w(TAG, "Vietnamese not available, using default locale");
            }

            tts.setSpeechRate(speechRate);
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String utteranceId) {
                    // Paragraph started
                }

                @Override
                public void onDone(String utteranceId) {
                    // Paragraph finished → speak next
                    onParagraphDone();
                }

                @Override
                public void onError(String utteranceId) {
                    Log.e(TAG, "TTS error for utterance: " + utteranceId);
                    onParagraphDone();
                }
            });

            ttsReady = true;
            Log.i(TAG, "TTS engine initialized successfully");

            // If there was a pending speak request
            if (pendingSpeak && paragraphs.size() > 0) {
                pendingSpeak = false;
                speakCurrentParagraph();
            }
        } else {
            Log.e(TAG, "TTS initialization failed with status: " + status);
        }
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
                resumeSpeaking();
            }

            @Override
            public void onPause() {
                pauseSpeaking();
            }

            @Override
            public void onStop() {
                fullStop();
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
            wakeLock.acquire(8 * 60 * 60 * 1000L); // max 8 hours
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
                startForeground(NOTIFICATION_ID, buildNotification());
                break;

            case ACTION_SET_PARAGRAPHS: {
                ArrayList<String> newParagraphs = intent.getStringArrayListExtra("paragraphs");
                int startIndex = intent.getIntExtra("startIndex", 0);
                if (newParagraphs != null && newParagraphs.size() > 0) {
                    paragraphs = newParagraphs;
                    currentIndex = startIndex;
                    isPlaying = true;
                    isPaused = false;

                    if (ttsReady) {
                        speakCurrentParagraph();
                    } else {
                        pendingSpeak = true;
                    }
                    updatePlaybackState(true);
                    updateNotification();
                }
                break;
            }

            case ACTION_PAUSE:
            case ACTION_MEDIA_PAUSE:
                pauseSpeaking();
                break;

            case ACTION_RESUME:
            case ACTION_MEDIA_PLAY:
                resumeSpeaking();
                break;

            case ACTION_STOP:
            case ACTION_MEDIA_STOP:
                fullStop();
                break;

            case ACTION_SET_RATE: {
                float rate = intent.getFloatExtra("rate", 1.0f);
                speechRate = rate;
                if (ttsReady) {
                    tts.setSpeechRate(speechRate);
                }
                // If currently speaking, restart current paragraph with new rate
                if (isPlaying && !isPaused && ttsReady) {
                    tts.stop();
                    speakCurrentParagraph();
                }
                break;
            }

            case ACTION_SET_VOICE: {
                voiceName = intent.getStringExtra("voiceName");
                if (ttsReady && voiceName != null) {
                    for (android.speech.tts.Voice v : tts.getVoices()) {
                        if (v.getName().equals(voiceName)) {
                            tts.setVoice(v);
                            break;
                        }
                    }
                }
                break;
            }

            case ACTION_UPDATE_META: {
                String newBook = intent.getStringExtra("bookTitle");
                String newChapter = intent.getStringExtra("chapterTitle");
                if (newBook != null) bookTitle = newBook;
                if (newChapter != null) chapterTitle = newChapter;
                updateMetadata();
                updateNotification();
                break;
            }

            case ACTION_MEDIA_NEXT:
                broadcastCommand("next");
                break;

            case ACTION_MEDIA_PREV:
                broadcastCommand("prev");
                break;
        }

        return START_STICKY;
    }

    private void speakCurrentParagraph() {
        if (!ttsReady || currentIndex < 0 || currentIndex >= paragraphs.size()) {
            return;
        }

        String text = paragraphs.get(currentIndex).trim();

        // Skip empty paragraphs
        while (text.isEmpty() && currentIndex < paragraphs.size() - 1) {
            currentIndex++;
            text = paragraphs.get(currentIndex).trim();
        }

        if (text.isEmpty()) {
            // All remaining paragraphs empty → chapter done
            onChapterFinished();
            return;
        }

        // Broadcast current index to JS for highlighting
        broadcastProgress(currentIndex);

        tts.setSpeechRate(speechRate);
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "para_" + currentIndex);
    }

    private void onParagraphDone() {
        if (!isPlaying || isPaused) return;

        currentIndex++;
        if (currentIndex >= paragraphs.size()) {
            // Chapter finished
            onChapterFinished();
        } else {
            speakCurrentParagraph();
        }
    }

    private void onChapterFinished() {
        isPlaying = false;
        currentIndex = -1;
        paragraphs.clear();
        broadcastCommand("chapter_finished");
        updatePlaybackState(false);
        updateNotification();
    }

    private void pauseSpeaking() {
        if (!isPlaying) return;
        isPaused = true;
        if (ttsReady) {
            tts.stop();
        }
        updatePlaybackState(false);
        updateNotification();
        broadcastCommand("paused");
    }

    private void resumeSpeaking() {
        if (!isPlaying || !isPaused) {
            // If not playing at all, tell JS to start
            broadcastCommand("play");
            return;
        }
        isPaused = false;
        if (ttsReady && currentIndex >= 0 && currentIndex < paragraphs.size()) {
            speakCurrentParagraph();
        }
        updatePlaybackState(true);
        updateNotification();
        broadcastCommand("resumed");
    }

    private void fullStop() {
        isPlaying = false;
        isPaused = false;
        currentIndex = -1;
        paragraphs.clear();
        if (ttsReady) {
            tts.stop();
        }
        broadcastCommand("stop");
        stopSelf();
    }

    private void broadcastCommand(String command) {
        Intent broadcast = new Intent(BROADCAST_COMMAND);
        broadcast.putExtra("command", command);
        broadcast.setPackage(getPackageName());
        sendBroadcast(broadcast);
    }

    private void broadcastProgress(int index) {
        Intent broadcast = new Intent(BROADCAST_PROGRESS);
        broadcast.putExtra("index", index);
        broadcast.setPackage(getPackageName());
        sendBroadcast(broadcast);
    }

    private void updatePlaybackState(boolean playing) {
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
        boolean showPause = isPlaying && !isPaused;
        Intent playPauseIntent = new Intent(this, TtsBackgroundService.class);
        playPauseIntent.setAction(showPause ? ACTION_MEDIA_PAUSE : ACTION_MEDIA_PLAY);
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

        int playPauseIcon = showPause
            ? android.R.drawable.ic_media_pause
            : android.R.drawable.ic_media_play;
        String playPauseTitle = showPause ? "Tạm dừng" : "Tiếp tục";

        updateMetadata();

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(chapterTitle.isEmpty() ? bookTitle : chapterTitle)
            .setContentText(chapterTitle.isEmpty() ? "Đang đọc..." : bookTitle)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(contentPendingIntent)
            .setOngoing(isPlaying && !isPaused)
            .setShowWhen(false)
            .addAction(android.R.drawable.ic_media_previous, "Trước", prevPending)
            .addAction(playPauseIcon, playPauseTitle, playPausePending)
            .addAction(android.R.drawable.ic_media_next, "Sau", nextPending)
            .addAction(android.R.drawable.ic_delete, "Dừng", stopPending)
            .setStyle(new MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2)
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
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
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
