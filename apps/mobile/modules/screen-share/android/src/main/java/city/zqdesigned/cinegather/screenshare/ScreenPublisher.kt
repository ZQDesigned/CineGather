package city.zqdesigned.cinegather.screenshare

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.media.*
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import com.oney.WebRTCModule.EglUtils
import livekit.org.webrtc.*
import livekit.org.webrtc.audio.AudioProcessingOptions
import livekit.org.webrtc.audio.JavaAudioDeviceModule
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.util.concurrent.*
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.min
import kotlin.math.roundToInt

internal class ScreenPublisher(private val context: Context, private val id: String, private val event: (String,String)->Unit) {
  @Volatile private var worker: Thread? = null
  private val executor = Executors.newSingleThreadExecutor { task -> Thread(task, "CGScreenPublisher").also { worker = it } }
  private val closed = AtomicBoolean(false)
  private val gathering = CountDownLatch(1)
  private val connected = CountDownLatch(1)
  private var factory: PeerConnectionFactory? = null
  private var pc: PeerConnection? = null
  private var adm: JavaAudioDeviceModule? = null
  private var capturer: ScreenCapturerAndroid? = null
  private var texture: SurfaceTextureHelper? = null
  private var videoSource: VideoSource? = null
  private var videoTrack: VideoTrack? = null
  private var audioSource: AudioSource? = null
  private var audioTrack: livekit.org.webrtc.AudioTrack? = null
  @Volatile private var record: AudioRecord? = null
  @Volatile private var request: HttpURLConnection? = null
  private var endpoint: URL? = null
  private var token = ""
  private var resource: URL? = null
  private var width = 1920; private var height = 1080; private var fps = 30
  @Volatile private var audioBuffers = 0L
  @Volatile private var audioNonzero = 0L
  @Volatile private var audioErrors = 0
  private val main = Handler(Looper.getMainLooper())
  private val displays = context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
  private val rotation = object: DisplayManager.DisplayListener {
    override fun onDisplayAdded(id:Int) {}
    override fun onDisplayRemoved(id:Int) {}
    override fun onDisplayChanged(id:Int) { if(!closed.get()) executor.execute { resize() } }
  }
  private val stats = object: Runnable {
    override fun run() {
      if (closed.get()) return
      try { executor.execute {
        if (closed.get()) return@execute
        pc?.getStats { report ->
        if (closed.get() || ShareBridge.id != id) return@getStats
        val outbound = report.statsMap.values.filter { it.type == "outbound-rtp" }.map { stat ->
          stat.members.filterKeys { it in setOf("kind","bytesSent","packetsSent","framesEncoded","framesSent","framesPerSecond","frameWidth","frameHeight","totalEncodeTime","qualityLimitationReason","nackCount","retransmittedPacketsSent") }
        }
        ShareBridge.stats = mapOf("engine" to "projection", "excludesSelf" to true, "audioBuffers" to audioBuffers,
          "audioNonzeroBuffers" to audioNonzero, "audioReadFailures" to audioErrors,
          "capturedFrames" to (capturer?.numCapturedFrames ?: 0), "outbound" to outbound)
      }
      } } catch (_: RejectedExecutionException) {}
      main.postDelayed(this, 2000)
    }
  }
  fun start(options: Intent) { executor.execute {
    try {
      endpoint = URL(options.getStringExtra("url")!!); token = options.getStringExtra("token")!!
      validate(endpoint!!)
      width = options.getIntExtra("width",1920).coerceIn(320,2560)
      height = options.getIntExtra("height",1080).coerceIn(180,1440)
      fps = options.getIntExtra("fps",30).coerceIn(10,60)
      val audio = options.getBooleanExtra("audio",false)
      if(audio && Build.VERSION.SDK_INT < 29) throw IllegalStateException("当前系统只能共享画面")
      val projection = if(Build.VERSION.SDK_INT >= 33) options.getParcelableExtra("projection", Intent::class.java) else @Suppress("DEPRECATION") options.getParcelableExtra<Intent>("projection")
      if(closed.get()) return@execute
      val egl = EglUtils.getRootEglBaseContext()
      // A dedicated ADM runs a playback-only source; physical mic capture is
      // disabled BEFORE the second factory/track exists. Never replaces voice ADM.
      adm = JavaAudioDeviceModule.builder(context).setInputSampleRate(48000).setUseStereoInput(true)
        .setUseHardwareAcousticEchoCanceler(false).setUseHardwareNoiseSuppressor(false)
        .setAudioBufferCallback { buffer, format, channels, rate, _, _ ->
          // With the physical mic disabled WebRTC reports bytesRead=0, but
          // expects a full 10ms buffer. Reading zero bytes creates an unpaced
          // silence loop; always fill the provided buffer capacity.
          fillPlayback(buffer,format,channels,rate,buffer.capacity()); System.nanoTime()
        }.createAudioDeviceModule().also { it.setAudioRecordEnabled(false) }
      factory = PeerConnectionFactory.builder().setAudioDeviceModule(adm)
        .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl,true,true))
        .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl)).createPeerConnectionFactory()
      val config = PeerConnection.RTCConfiguration(emptyList()).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN }
      pc = factory!!.createPeerConnection(config, object: PeerConnection.Observer {
        override fun onSignalingChange(state: PeerConnection.SignalingState) {}
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
          if(state == PeerConnection.IceConnectionState.CONNECTED || state == PeerConnection.IceConnectionState.COMPLETED) connected.countDown()
          if(state == PeerConnection.IceConnectionState.FAILED) fail("共享网络连接失败，请重新共享")
        }
        override fun onIceConnectionReceivingChange(receiving:Boolean) {}
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) { if(state == PeerConnection.IceGatheringState.COMPLETE) gathering.countDown() }
        override fun onIceCandidate(candidate: IceCandidate) {}
        override fun onIceCandidatesRemoved(candidates:Array<out IceCandidate>) {}
        override fun onAddStream(stream: MediaStream) {}
        override fun onRemoveStream(stream: MediaStream) {}
        override fun onDataChannel(channel: DataChannel) {}
        override fun onRenegotiationNeeded() {}
        override fun onAddTrack(receiver:RtpReceiver, streams:Array<out MediaStream>) {}
      }) ?: throw IllegalStateException("无法创建共享连接")
      capturer = ScreenCapturerAndroid(projection ?: throw IllegalStateException("系统授权已失效"),object: MediaProjection.Callback() {
        override fun onStop() { if(!closed.get()) { event("stopped","系统已停止屏幕共享"); close() } }
      })
      texture = SurfaceTextureHelper.create("CGScreenFrames",egl)
      videoSource = factory!!.createVideoSource(true)
      capturer!!.initialize(texture,context,videoSource!!.capturerObserver)
      resize()
      if(audio) initPlayback(capturer!!.mediaProjection ?: throw IllegalStateException("系统授权已失效"))
      videoTrack = factory!!.createVideoTrack("screen-video",videoSource)
      val sender=pc!!.addTrack(videoTrack,listOf("screen"))
      sender.parameters.let { p -> p.encodings.forEach { it.maxBitrateBps=options.getIntExtra("bitrate",5000000);it.maxFramerate=fps };sender.parameters=p }
      if(audio) {
        val constraints=MediaConstraints().apply {
          listOf("googEchoCancellation","googAutoGainControl","googNoiseSuppression","googHighpassFilter").forEach { optional.add(MediaConstraints.KeyValuePair(it,"false")) }
        }
        audioSource=factory!!.createAudioSource(constraints); audioTrack=factory!!.createAudioTrack("screen-audio",audioSource)
        audioTrack!!.setAudioProcessingOptions(AudioProcessingOptions.raw())
        pc!!.addTrack(audioTrack,listOf("screen"))
      }
      pc!!.transceivers.forEach { it.direction = RtpTransceiver.RtpTransceiverDirection.SEND_ONLY }
      displays.registerDisplayListener(rotation,main)
      val offer=CompletableFuture<SessionDescription>()
      pc!!.createOffer(SdpResult(created={offer.complete(it)},failed={offer.completeExceptionally(IllegalStateException(it))}),MediaConstraints())
      val local=offer.get(10,TimeUnit.SECONDS)
      val set=CompletableFuture<Unit>();pc!!.setLocalDescription(SdpResult(set={set.complete(Unit)},failed={set.completeExceptionally(IllegalStateException(it))}),local);set.get(10,TimeUnit.SECONDS)
      gathering.await(10,TimeUnit.SECONDS)
      if(closed.get()) return@execute
      val connection=endpoint!!.openConnection() as HttpURLConnection
      request=connection;connection.instanceFollowRedirects=false;connection.requestMethod="POST";connection.doOutput=true
      connection.connectTimeout=10000;connection.readTimeout=15000
      connection.setRequestProperty("Content-Type","application/sdp");connection.setRequestProperty("Authorization","Bearer $token")
      connection.outputStream.use { it.write(pc!!.localDescription.description.toByteArray()) }
      if(connection.responseCode != 201) throw IllegalStateException("推流服务拒绝连接（${connection.responseCode}）")
      val location=connection.getHeaderField("Location") ?: throw IllegalStateException("推流服务未返回会话地址")
      resource=URL(endpoint,location).also { require(sameOrigin(it,endpoint!!)) { "不安全的推流会话地址" } }
      val answer=connection.inputStream.bufferedReader().use { it.readText().also { text -> require(text.length<1024*1024) } }
      connection.disconnect();request=null
      if(closed.get()) { deleteResource(); return@execute }
      val remote=CompletableFuture<Unit>();pc!!.setRemoteDescription(SdpResult(set={remote.complete(Unit)},failed={remote.completeExceptionally(IllegalStateException(it))}),SessionDescription(SessionDescription.Type.ANSWER,answer));remote.get(10,TimeUnit.SECONDS)
      if(!connected.await(20,TimeUnit.SECONDS)) throw IllegalStateException("共享连接超时")
      if(!closed.get()) { event("active","");main.post(stats) }
    } catch(e: Exception) { if(!closed.get()) fail(e.message ?: "屏幕共享启动失败") }
  } }
  private fun resize() {
    val metrics=context.resources.displayMetrics
    val portrait=metrics.widthPixels<metrics.heightPixels
    val maxW=if(portrait) height else width;val maxH=if(portrait) width else height
    val scale=min(maxW.toDouble()/metrics.widthPixels,maxH.toDouble()/metrics.heightPixels).coerceAtMost(1.0)
    val w=(metrics.widthPixels*scale/2).roundToInt()*2;val h=(metrics.heightPixels*scale/2).roundToInt()*2
    videoSource?.adaptOutputFormat(w,h,fps)
    val c=capturer ?: return
    if(c.mediaProjection == null) c.startCapture(w,h,fps) else c.changeCaptureFormat(w,h,fps)
  }
  @SuppressLint("MissingPermission")
  private fun initPlayback(projection:MediaProjection) {
    if(Build.VERSION.SDK_INT < 29) return
    val capture=AudioPlaybackCaptureConfiguration.Builder(projection)
      .addMatchingUsage(AudioAttributes.USAGE_MEDIA).addMatchingUsage(AudioAttributes.USAGE_GAME).addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
      .excludeUid(Process.myUid()).build()
    val min=AudioRecord.getMinBufferSize(48000,AudioFormat.CHANNEL_IN_STEREO,AudioFormat.ENCODING_PCM_16BIT)
    require(min>0) { "当前设备无法初始化共享声音" }
    val r=AudioRecord.Builder().setAudioPlaybackCaptureConfig(capture)
      .setAudioFormat(AudioFormat.Builder().setSampleRate(48000).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_IN_STEREO).build())
      .setBufferSizeInBytes(maxOf(min*2,19200)).build()
    try { r.startRecording();check(r.recordingState==AudioRecord.RECORDSTATE_RECORDING);record=r }
    catch(e:Exception) { r.release();throw IllegalStateException("共享声音初始化失败，可关闭共享声音后重试",e) }
  }
  private fun fillPlayback(buffer:ByteBuffer,format:Int,channels:Int,rate:Int,bytes:Int) {
    buffer.clear(); for(i in 0 until bytes) buffer.put(i,0)
    if(closed.get()) return
    if(format!=AudioFormat.ENCODING_PCM_16BIT || channels!=2 || rate!=48000) { fail("共享声音采样格式不兼容");return }
    val r=record ?: return
    val count=try { r.read(buffer,bytes,AudioRecord.READ_BLOCKING) } catch(_:Exception) { -1 }
    if(count<0) { audioErrors++;fail("系统声音采集已中断，请重新共享"); return }
    // A short read must never replay bytes from a previous audio buffer.
    for(i in count until bytes) buffer.put(i,0)
    audioBuffers++;if((0 until count).any { buffer.get(it).toInt()!=0 }) audioNonzero++
    buffer.position(0)
  }
  private fun validate(url:URL) { require(url.userInfo==null && (url.protocol=="https" || url.protocol=="http" && url.host in listOf("127.0.0.1","localhost","::1"))) { "推流服务必须使用 HTTPS 或本机地址" } }
  private fun sameOrigin(a:URL,b:URL)=a.protocol==b.protocol && a.host==b.host && a.port==b.port
  private fun deleteResource() { val url=resource ?: return;resource=null
    try { (url.openConnection() as HttpURLConnection).apply { requestMethod="DELETE";instanceFollowRedirects=false;connectTimeout=5000;readTimeout=5000;setRequestProperty("Authorization","Bearer $token");responseCode;disconnect() } }catch(_:Exception) {} }
  private fun fail(reason:String) { if(!closed.get()) { event("failed",reason);close() } }
  fun close() {
    if(!closed.compareAndSet(false,true)) return
    gathering.countDown();connected.countDown();main.removeCallbacks(stats);displays.unregisterDisplayListener(rotation)
    request?.disconnect()
    if (Thread.currentThread() !== worker) worker?.interrupt()
    // AudioRecord.stop unblocks READ_BLOCKING before joining WebRTC's audio thread.
    record?.let { try { it.stop() }catch(_:Exception) {} }
    executor.execute {
      pc?.close();pc?.dispose();pc=null
      try { capturer?.stopCapture();capturer?.dispose() }catch(_:Exception) {};capturer=null
      texture?.dispose();texture=null;videoTrack?.dispose();videoSource?.dispose();audioTrack?.dispose();audioSource?.dispose()
      factory?.dispose();factory=null;adm?.release();adm=null;record?.release();record=null
      deleteResource();token="";executor.shutdown()
    }
  }
}
private class SdpResult(val created:(SessionDescription)->Unit={},val set:()->Unit={},val failed:(String)->Unit={}):SdpObserver {
  override fun onCreateSuccess(sdp:SessionDescription) { created(sdp) }
  override fun onSetSuccess() { set() }
  override fun onCreateFailure(message:String) { failed(message) }
  override fun onSetFailure(message:String) { failed(message) }
}
