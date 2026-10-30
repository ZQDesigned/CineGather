package city.zqdesigned.cinegather.roomaudio

import android.Manifest
import android.app.*
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.*
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

class RoomAudioService : Service() {
  companion object { var events: ((String, Map<String, Any>) -> Unit)? = null; const val CHANNEL = "cinegather-room-audio" }
  private lateinit var audio: AudioManager
  private var focus: AudioFocusRequest? = null
  private val handler = Handler(Looper.getMainLooper())
  private val devices = object : AudioDeviceCallback() {
    override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) {
      if (removed.any { it.type in setOf(AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_USB_HEADSET) }) events?.invoke("routeLost", emptyMap())
    }
  }
  override fun onCreate() {
    super.onCreate()
    audio = getSystemService(AudioManager::class.java)
    getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "房间语音", NotificationManager.IMPORTANCE_LOW).apply { setSound(null, null) })
    audio.registerAudioDeviceCallback(devices, handler)
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == "leave") { events?.invoke("leave", emptyMap()); stopSelf(); return START_NOT_STICKY }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val open = launch?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
    val leave = PendingIntent.getService(this, 1, Intent(this, RoomAudioService::class.java).setAction("leave"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val notification = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle(intent?.getStringExtra("roomName") ?: "映聚房间")
      .setContentText("房间语音保持连接，点击返回映聚").setContentIntent(open).setOngoing(true).setSilent(true)
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "退出房间", leave).build()
    val microphone = intent?.getBooleanExtra("microphone", false) == true && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    ServiceCompat.startForeground(this, 417, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK or (if (microphone) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0))
    if (focus == null) {
      focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        .setOnAudioFocusChangeListener({ change -> events?.invoke("interruption", mapOf("interrupted" to (change != AudioManager.AUDIOFOCUS_GAIN))) }, handler)
        .build()
      val granted = audio.requestAudioFocus(focus!!) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
      events?.invoke("interruption", mapOf("interrupted" to !granted))
    }
    return START_NOT_STICKY
  }
  override fun onDestroy() {
    audio.unregisterAudioDeviceCallback(devices)
    focus?.let { audio.abandonAudioFocusRequest(it) }; focus = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
  override fun onBind(intent: Intent?) = null
}
