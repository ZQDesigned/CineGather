package city.zqdesigned.cinegather.screenshare

import android.app.Activity
import android.content.Intent
import android.content.Context
import android.media.projection.MediaProjectionManager
import android.media.projection.MediaProjectionConfig
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// One in-process session. No persistent credentials and no microphone samples are
// ever passed to the playback publisher.
internal object ShareBridge {
  var id: String? = null
  @Volatile var expiresAt: Long = 0
  var event: ((Map<String, Any>) -> Unit)? = null
  var result: Promise? = null
  var stats: Map<String, Any> = emptyMap()
  fun status(id: String, state: String, reason: String = "") {
    if (this.id != id) return
    event?.invoke(mapOf("id" to id, "state" to state, "reason" to reason))
    if (state == "active") { result?.resolve(null); result = null }
    if (state == "stopped" || state == "failed") {
      result?.reject("CAPTURE_STOPPED", if (reason.isEmpty()) "共享已停止" else reason, null); result = null
    }
  }
}
class ScreenShareModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private val requestCode = 28376
  private var awaitingConsent = false
  private var pending: Map<String, Any>? = null
  private fun activityResult(code: Int, result: Int, data: Intent?) {
      if (code != requestCode) return
      awaitingConsent = false
      val options = pending ?: return
      pending = null
      val id = options["id"] as String
      if (ShareBridge.id != id) return
      if (result != Activity.RESULT_OK || data == null) {
        ShareBridge.status(id, "stopped", "已取消系统共享授权"); return
      }
      val context = appContext.reactContext ?: return
      try {
        ContextCompat.startForegroundService(context, Intent(context, ScreenShareService::class.java).apply {
          putExtra("id", id); putExtra("projection", data)
          putExtra("url", options["url"] as String); putExtra("token", options["token"] as String)
          putExtra("audio", options["audio"] as Boolean)
          putExtra("width", (options["width"] as Number).toInt()); putExtra("height", (options["height"] as Number).toInt())
          putExtra("fps", (options["fps"] as Number).toInt()); putExtra("bitrate", (options["bitrate"] as Number).toInt())
        })
      } catch (e: Exception) { ShareBridge.status(id, "failed", "无法启动屏幕共享服务：${e.javaClass.simpleName}") }
  }
  override fun definition() = ModuleDefinition {
    Name("CineGatherScreenShare")
    Events("status")
    OnActivityResult { _, result -> activityResult(result.requestCode, result.resultCode, result.data) }
    OnCreate {
      ShareBridge.event = { sendEvent("status", it) }
    }
    OnDestroy {
      ShareBridge.event = null
      appContext.reactContext?.stopService(Intent(appContext.reactContext, ScreenShareService::class.java))
      ShareBridge.result?.reject("CAPTURE_STOPPED", "客户端已关闭", null); ShareBridge.result = null
      ShareBridge.id = null
    }
    AsyncFunction("start") { options: Map<String, Any>, promise: Promise ->
      handler.post {
        if (awaitingConsent || pending != null || ShareBridge.result != null || ScreenShareService.running) {
          promise.reject("CAPTURE_BUSY", "已有共享正在运行或等待系统授权", null)
        } else try {
          val activity = appContext.currentActivity ?: throw IllegalStateException("请返回应用后发起共享")
          ShareBridge.id = options["id"] as String; ShareBridge.expiresAt = (options["expiresAt"] as Number).toLong(); ShareBridge.stats = emptyMap()
          ShareBridge.result = promise; pending = options; awaitingConsent = true
          val manager = activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
          val consent = if (Build.VERSION.SDK_INT >= 34 && options["audio"] == true)
            manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
          else manager.createScreenCaptureIntent()
          activity.startActivityForResult(consent, requestCode)
        } catch (e: Exception) {
          awaitingConsent = false; pending = null; ShareBridge.result = null
          promise.reject("CAPTURE_START", e.message, e)
        }
      }
    }
    AsyncFunction("stop") { id: String ->
      handler.post {
        if (ShareBridge.id == id) {
          pending = null; ShareBridge.status(id, "stopped")
          appContext.reactContext?.stopService(Intent(appContext.reactContext, ScreenShareService::class.java))
          ShareBridge.id = null
        }
      }
    }
    AsyncFunction("renew") { id: String, expiresAt: Double -> if (ShareBridge.id == id) ShareBridge.expiresAt = expiresAt.toLong() }
    AsyncFunction("diagnostics") { ShareBridge.stats }
  }
}
