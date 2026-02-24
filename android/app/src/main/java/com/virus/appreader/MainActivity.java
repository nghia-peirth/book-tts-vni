package com.virus.appreader;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(TtsBackgroundPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
