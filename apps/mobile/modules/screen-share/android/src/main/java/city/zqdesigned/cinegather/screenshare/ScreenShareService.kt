package city.zqdesigned.cinegather.screenshare

import android.app.*
import androidx.core.app.NotificationCompat
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.Handler
import android.os.Looper

class ScreenShareService : Service() {
  companion object { @Volatile var running = false }
  private var activeId: String? = null
  private var publisher: ScreenPublisher? = null
  private var wake: PowerManager.WakeLock? = null
  private val handler = Handler(Looper.getMainLooper())
  private val expiry = object : Runnable {
    override fun run() {
      if (running && System.currentTimeMillis() >= ShareBridge.expiresAt) {
        ShareBridge.id?.let { ShareBridge.status(it, "stopped", "共享授权已到期，请重新共享") };stopSelf()
      } else handler.postDelayed(this, 1000)
    }
  }
  override fun onBind(intent: Intent?): IBinder? = null
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == "stop" || intent == null) { stopSelf(); return START_NOT_STICKY }
    if (publisher != null) return START_NOT_STICKY
    val id = intent.getStringExtra("id") ?: run { stopSelf(); return START_NOT_STICKY }
    if (ShareBridge.id != id) { stopSelf(); return START_NOT_STICKY }
    activeId = id
    try {
      val manager = getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel("cg-screen-share", "屏幕共享", NotificationManager.IMPORTANCE_LOW))
      val stop = PendingIntent.getService(this, 0, Intent(this, ScreenShareService::class.java).setAction("stop"), PendingIntent.FLAG_IMMUTABLE)
      val open = packageManager.getLaunchIntentForPackage(packageName)?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE) }
      val notification = NotificationCompat.Builder(this, "cg-screen-share").setContentTitle("映聚正在共享屏幕")
        .setContentText(if (intent.getBooleanExtra("audio", false)) "画面和允许采集的应用声音" else "画面共享中")
        .setSmallIcon(android.R.drawable.ic_menu_view).setOngoing(true).setContentIntent(open)
        .addAction(android.R.drawable.ic_menu_close_clear_cancel, "停止共享", stop).build()
      if (Build.VERSION.SDK_INT >= 29) {
        val type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or
          if (intent.getBooleanExtra("audio", false)) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
        startForeground(28376, notification, type)
      } else startForeground(28376, notification)
      check(System.currentTimeMillis() < ShareBridge.expiresAt) { "共享授权已过期" }
      running = true
      handler.post(expiry)
      wake = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "CineGather:screen-share").apply { acquire() }
      publisher = ScreenPublisher(this, id) { state, reason ->
        handler.post {
          ShareBridge.status(id, state, reason)
          if (state == "stopped" || state == "failed") stopSelf()
        }
      }.also { it.start(intent) }
    } catch (e: Exception) {
      ShareBridge.status(id, "failed", "屏幕共享无法启动：${e.javaClass.simpleName}"); stopSelf()
    }
    return START_NOT_STICKY
  }
  override fun onDestroy() {
    handler.removeCallbacks(expiry)
    val id = activeId
    publisher?.close(); publisher = null
    if (wake?.isHeld == true) wake?.release(); wake = null
    running = false; stopForeground(STOP_FOREGROUND_REMOVE)
    if (id != null) ShareBridge.status(id, "stopped")
    super.onDestroy()
  }
}
