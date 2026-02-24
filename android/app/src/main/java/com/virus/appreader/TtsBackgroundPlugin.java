package com.virus.appreader;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "TtsBackground")
public class TtsBackgroundPlugin extends Plugin {

    private BroadcastReceiver commandReceiver;

    @Override
    public void load() {
        // Listen for commands from the notification service
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

        IntentFilter filter = new IntentFilter(TtsBackgroundService.BROADCAST_COMMAND);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(commandReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(commandReceiver, filter);
        }
    }

    @PluginMethod
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

    @PluginMethod
    public void stopService(PluginCall call) {
        Intent intent = new Intent(getContext(), TtsBackgroundService.class);
        intent.setAction(TtsBackgroundService.ACTION_STOP);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void updateNotification(PluginCall call) {
        String bookTitle = call.getString("bookTitle");
        String chapterTitle = call.getString("chapterTitle");
        boolean isPlaying = call.getBoolean("isPlaying", true);

        Intent intent = new Intent(getContext(), TtsBackgroundService.class);
        intent.setAction(TtsBackgroundService.ACTION_UPDATE);
        if (bookTitle != null) intent.putExtra("bookTitle", bookTitle);
        if (chapterTitle != null) intent.putExtra("chapterTitle", chapterTitle);
        intent.putExtra("isPlaying", isPlaying);
        getContext().startService(intent);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (commandReceiver != null) {
            try {
                getContext().unregisterReceiver(commandReceiver);
            } catch (Exception e) {
                // ignore
            }
        }
    }
}
