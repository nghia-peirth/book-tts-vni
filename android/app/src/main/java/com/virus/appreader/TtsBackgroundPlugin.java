package com.virus.appreader;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONException;
import java.util.ArrayList;

@CapacitorPlugin(name = "TtsBackground")
public class TtsBackgroundPlugin extends Plugin {

    private static final String TAG = "TtsBackgroundPlugin";

    private BroadcastReceiver commandReceiver;
    private BroadcastReceiver progressReceiver;

    @Override
    public void load() {
        // Listen for commands from native service (play, pause, stop, next, prev, chapter_finished)
        commandReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String command = intent.getStringExtra("command");
                if (command != null) {
                    JSObject data = new JSObject();
                    data.put("command", command);
                    notifyListeners("ttsCommand", data);
                }
            }
        };

        // Listen for paragraph progress from native service
        progressReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                int index = intent.getIntExtra("index", -1);
                if (index >= 0) {
                    JSObject data = new JSObject();
                    data.put("index", index);
                    notifyListeners("ttsProgress", data);
                }
            }
        };

        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ctx.registerReceiver(commandReceiver,
                new IntentFilter(TtsBackgroundService.BROADCAST_COMMAND),
                Context.RECEIVER_NOT_EXPORTED);
            ctx.registerReceiver(progressReceiver,
                new IntentFilter(TtsBackgroundService.BROADCAST_PROGRESS),
                Context.RECEIVER_NOT_EXPORTED);
        } else {
            ctx.registerReceiver(commandReceiver,
                new IntentFilter(TtsBackgroundService.BROADCAST_COMMAND));
            ctx.registerReceiver(progressReceiver,
                new IntentFilter(TtsBackgroundService.BROADCAST_PROGRESS));
        }
    }

    @PluginMethod()
    public void startService(PluginCall call) {
        String bookTitle = call.getString("bookTitle", "AppReader");
        String chapterTitle = call.getString("chapterTitle", "");

        Intent intent = new Intent(getContext(), TtsBackgroundService.class);
        intent.setAction(TtsBackgroundService.ACTION_START);
        intent.putExtra("bookTitle", bookTitle);
        intent.putExtra("chapterTitle", chapterTitle);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        call.resolve();
    }

    @PluginMethod()
    public void stopService(PluginCall call) {
        Intent intent = new Intent(getContext(), TtsBackgroundService.class);
        intent.setAction(TtsBackgroundService.ACTION_STOP);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod()
    public void setParagraphs(PluginCall call) {
        JSONArray jsonParagraphs = call.getArray("paragraphs");
        int startIndex = call.getInt("startIndex", 0);

        if (jsonParagraphs == null || jsonParagraphs.length() == 0) {
            call.reject("paragraphs array is required");
            return;
        }

        ArrayList<String> paragraphList = new ArrayList<>();
        try {
            for (int i = 0; i < jsonParagraphs.length(); i++) {
                paragraphList.add(jsonParagraphs.getString(i));
            }
        } catch (JSONException e) {
            call.reject("Invalid paragraphs array");
            return;
        }

        Intent intent = new Intent(getContext(), TtsBackgroundService.class);
        intent.setAction(TtsBackgroundService.ACTION_SET_PARAGRAPHS);
        intent.putStringArrayListExtra("paragraphs", paragraphList);
        intent.putExtra("startIndex", startIndex);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod()
    public void pause(PluginCall call) {
        Intent intent = new Intent(getContext(), TtsBackgroundService.class);
        intent.setAction(TtsBackgroundService.ACTION_PAUSE);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod()
    public void resume(PluginCall call) {
        Intent intent = new Intent(getContext(), TtsBackgroundService.class);
        intent.setAction(TtsBackgroundService.ACTION_RESUME);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod()
    public void setRate(PluginCall call) {
        float rate = call.getFloat("rate", 1.0f);
        Intent intent = new Intent(getContext(), TtsBackgroundService.class);
        intent.setAction(TtsBackgroundService.ACTION_SET_RATE);
        intent.putExtra("rate", rate);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod()
    public void setVoice(PluginCall call) {
        String voiceName = call.getString("voiceName");
        if (voiceName == null) {
            call.reject("voiceName is required");
            return;
        }
        Intent intent = new Intent(getContext(), TtsBackgroundService.class);
        intent.setAction(TtsBackgroundService.ACTION_SET_VOICE);
        intent.putExtra("voiceName", voiceName);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod()
    public void updateNotification(PluginCall call) {
        String bookTitle = call.getString("bookTitle");
        String chapterTitle = call.getString("chapterTitle");

        Intent intent = new Intent(getContext(), TtsBackgroundService.class);
        intent.setAction(TtsBackgroundService.ACTION_UPDATE_META);
        if (bookTitle != null) intent.putExtra("bookTitle", bookTitle);
        if (chapterTitle != null) intent.putExtra("chapterTitle", chapterTitle);
        getContext().startService(intent);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        try {
            Context ctx = getContext();
            if (commandReceiver != null) ctx.unregisterReceiver(commandReceiver);
            if (progressReceiver != null) ctx.unregisterReceiver(progressReceiver);
        } catch (Exception e) {
            // ignore
        }
        super.handleOnDestroy();
    }
}
