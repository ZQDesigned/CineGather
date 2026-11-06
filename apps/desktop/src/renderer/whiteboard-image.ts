export async function normalizeBoardImage(
  source: File | string,
): Promise<string> {
  if (
    source instanceof File &&
    (source.size > 20_000_000 ||
      !["image/png", "image/jpeg", "image/webp"].includes(source.type))
  )
    throw Error("请选择不超过 20 MB 的 PNG、JPEG 或 WebP 图片");
  const owned = source instanceof File,
    url = owned ? URL.createObjectURL(source) : source;
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 40_000_000
    )
      throw Error("图片尺寸过大");
    const canvas = document.createElement("canvas");
    let ratio = Math.min(
      1,
      2400 / image.naturalWidth,
      1600 / image.naturalHeight,
    );
    for (let attempt = 0; attempt < 7; attempt++) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      canvas
        .getContext("2d")!
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/png");
      if (data.length < 2_600_000) return data;
      ratio *= 0.78;
    }
    throw Error("图片内容过大，请缩小图片后重试");
  } finally {
    if (owned) URL.revokeObjectURL(url);
  }
}
export async function screenshotBoardImage(): Promise<string | undefined> {
  if (window.desktop?.captureWhiteboardImage) {
    const image = await window.desktop.captureWhiteboardImage();
    return image ? normalizeBoardImage(image) : undefined;
  }
  if (!navigator.mediaDevices?.getDisplayMedia)
    throw Error("当前浏览器不支持截屏，请上传截图图片");
  let stream: MediaStream | undefined;
  const video = document.createElement("video");
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    await new Promise<void>((resolve, reject) => {
      const track = stream!.getVideoTracks()[0]!;
      const finish = (error?: Error) => {
        clearTimeout(timer);
        video.cancelVideoFrameCallback(frame);
        track.removeEventListener("ended", ended);
        if (error) reject(error);
        else resolve();
      };
      const ended = () => finish(Error("截屏已取消"));
      const timer = setTimeout(
        () => finish(Error("暂时无法读取屏幕画面")),
        8000,
      );
      const frame = video.requestVideoFrameCallback(() => finish());
      track.addEventListener("ended", ended, { once: true });
    });
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    const data = canvas.toDataURL("image/png");
    video.pause();
    video.srcObject = null;
    return await normalizeBoardImage(data);
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotAllowedError") return;
    throw e;
  } finally {
    video.pause();
    video.srcObject = null;
    stream?.getTracks().forEach((t) => t.stop());
  }
}
