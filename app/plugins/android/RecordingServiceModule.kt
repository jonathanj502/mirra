package com.mirra.app

import android.content.Intent
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class RecordingServiceModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "RecordingService"

  @ReactMethod
  fun startForegroundService(promise: Promise) {
    try {
      val intent = Intent(reactApplicationContext, RecordingForegroundService::class.java)
      ContextCompat.startForegroundService(reactApplicationContext, intent)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("RECORDING_SERVICE", "Keep Mirra open and allow microphone access to start recording.", error)
    }
  }

  @ReactMethod
  fun stopForegroundService() {
    reactApplicationContext.stopService(Intent(reactApplicationContext, RecordingForegroundService::class.java))
  }
}
