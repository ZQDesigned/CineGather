package city.zqdesigned.cinegather.roomaudio

import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RoomAudioModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CineGatherRoomAudio")
    Events("leave", "interruption", "routeLost")
    OnCreate { RoomAudioService.events = { event, data -> sendEvent(event, data) } }
    OnDestroy {
      RoomAudioService.events = null
      appContext.reactContext?.let { it.stopService(Intent(it, RoomAudioService::class.java)) }
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
