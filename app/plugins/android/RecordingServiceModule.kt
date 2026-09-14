package com.mirra.app

import android.content.Intent
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class RecordingServiceModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "RecordingService"

  @ReactMethod
  fun startForegroundService() {
    val intent = Intent(reactApplicationContext, RecordingForegroundService::class.java)
    ContextCompat.startForegroundService(reactApplicationContext, intent)
  }

  @ReactMethod
  fun stopForegroundService() {
    reactApplicationContext.stopService(Intent(reactApplicationContext, RecordingForegroundService::class.java))
  }
}
