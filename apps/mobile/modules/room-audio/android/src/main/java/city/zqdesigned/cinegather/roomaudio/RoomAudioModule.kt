package city.zqdesigned.cinegather.roomaudio

import android.content.Intent
import android.os.Handler
import android.os.Looper
import java.util.concurrent.ConcurrentHashMap
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RoomAudioModule : Module() {
  private val timerHandler = Handler(Looper.getMainLooper())
  private val timers = ConcurrentHashMap<Int, Runnable>()
  override fun definition() = ModuleDefinition {
    Name("CineGatherRoomAudio")
    Events("leave", "interruption", "routeLost", "tick", "timer")
    OnCreate { RoomAudioService.events = { event, data -> sendEvent(event, data) } }
    OnDestroy {
      timers.values.forEach { timerHandler.removeCallbacks(it) }; timers.clear()
      RoomAudioService.events = null
      appContext.reactContext?.let { it.stopService(Intent(it, RoomAudioService::class.java)) }
    }
    Function("scheduleTimer") { id: Int, delay: Double, repeat: Boolean ->
      timers.remove(id)?.let { timerHandler.removeCallbacks(it) }
      val task = object : Runnable {
        override fun run() {
          if (timers[id] !== this) return
          if (!repeat) timers.remove(id)
          sendEvent("timer", mapOf("id" to id))
          if (repeat && timers[id] === this) timerHandler.postDelayed(this, delay.toLong().coerceAtLeast(1))
        }
      }
      timers[id] = task
      timerHandler.postDelayed(task, delay.toLong().coerceAtLeast(1))
    }
    Function("cancelTimer") { id: Int -> timers.remove(id)?.let { timerHandler.removeCallbacks(it) }; Unit }
    AsyncFunction("requestMicrophonePermission") {
      appContext.reactContext?.let { ContextCompat.checkSelfPermission(it, android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED } ?: false
    }
    AsyncFunction("start") { name: String, microphone: Boolean ->
      val context = appContext.reactContext ?: throw IllegalStateException("Application unavailable")
      ContextCompat.startForegroundService(context, Intent(context, RoomAudioService::class.java).apply {
        putExtra("roomName", name.take(100)); putExtra("microphone", microphone)
      })
    }
    AsyncFunction("stop") {
      appContext.reactContext?.let { it.stopService(Intent(it, RoomAudioService::class.java)) }
    }
  }
}
