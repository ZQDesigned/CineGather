import { createPortal } from "react-dom";
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
} from "react";
import { Flex, Slider, Typography } from "antd";
import { PictureInPicture2, Pin, ArrowUpRight, X, Volume2 } from "lucide-react";
import { Button } from "./Controls";
import { useApp, update } from "../store";
import { media, report } from "../controller";
const drag = { WebkitAppRegion: "drag" } as CSSProperties;
const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;
const styleSnapshots = new WeakMap<Document, string>();
function mirrorStyles(target: Document) {
  const nodes = [
    ...document.head.querySelectorAll('style,link[rel="stylesheet"]'),
  ];
  const styles = nodes.map((node) => {
    let text = node.textContent;
    if (node instanceof HTMLStyleElement)
      try {
        text = [...(node.sheet?.cssRules ?? [])]
          .map((rule) => rule.cssText)
          .join("\n");
      } catch {
        /* Keep the original stylesheet text. */
      }
    return { node, text };
  });
  const signature = styles
    .map(({ node, text }) => node.outerHTML + text)
    .join("\n");
  if (styleSnapshots.get(target) === signature) return;
  styleSnapshots.set(target, signature);
  const bucket =
    target.getElementById("shared-styles") ??
    target.head.appendChild(target.createElement("div"));
  bucket.id = "shared-styles";
  bucket.replaceChildren(
    ...styles.map(({ node, text }) => {
      const copy = node.cloneNode(true) as HTMLElement;
      if (node instanceof HTMLStyleElement) copy.textContent = text;
      return copy;
    }),
  );
  target.documentElement.className = document.documentElement.className;
  target.body.className = document.body.className;
  target.body.style.cssText =
    "margin:0;min-width:0;width:100vw;height:100vh;overflow:hidden;background:#0d0f14;color:#e9e9ef";
}
export function useViewingWindow(enabled: boolean) {
  const [child, setChild] = useState<Window>(),
    [root, setRoot] = useState<HTMLElement>(),
    [active, setActive] = useState(false),
    [pinned, setPinned] = useState(true);
  const windowRef = useRef<Window | undefined>(undefined);
  const browserVideo = useRef<HTMLVideoElement | undefined>(undefined);
  const roomId = useApp((s) => s.room?.id),
    sharer = useApp((s) => s.media.sharer),
    volume = useApp((s) => s.screenVolume);
  const desktop = Boolean(window.desktop?.viewingWindow);
  const generation = useRef(0);
  const bindVideo = useCallback(
    (element: HTMLVideoElement | null) =>
      media.setViewingVideoElement(element ?? undefined),
    [],
  );
  const close = () => {
    ++generation.current;
    windowRef.current?.close();
    windowRef.current = undefined;
    media.setViewingVideoElement();
    setRoot(undefined);
    setChild(undefined);
    setActive(false);
    if (
      browserVideo.current &&
      document.pictureInPictureElement === browserVideo.current
    )
      void document.exitPictureInPicture().catch(() => {});
  };
  useEffect(() => {
    if (!enabled) close();
    return () => close();
  }, [enabled, roomId, sharer?.id]);
  useEffect(() => {
    if (!child) return;
    const stop = () => {
      media.setViewingVideoElement();
      setActive(false);
      setRoot(undefined);
      setChild(undefined);
      windowRef.current = undefined;
    };
    child.addEventListener("beforeunload", stop);
    mirrorStyles(child.document);
    const observer = new MutationObserver(() => {
      if (!child.closed) mirrorStyles(child.document);
    });
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    // Emotion may insert CSS rules without changing the style element's text.
    const timer = setInterval(() => {
      if (!child.closed) mirrorStyles(child.document);
    }, 1000);
    return () => {
      child.removeEventListener("beforeunload", stop);
      observer.disconnect();
      clearInterval(timer);
    };
  }, [child]);
  const open = async () => {
    if (!enabled) return;
    try {
      if (!desktop) {
        const video = document.querySelector<HTMLVideoElement>(
          'video[aria-label="共享画面"]',
        );
        if (
          !video ||
          !document.pictureInPictureEnabled ||
          !video.requestPictureInPicture
        )
          throw new Error("当前浏览器不支持画中画，请使用 Chrome 或桌面客户端");
        browserVideo.current = video;
        video.addEventListener(
          "leavepictureinpicture",
          () => setActive(false),
          { once: true },
        );
        const revision = generation.current;
        await video.requestPictureInPicture();
        if (revision !== generation.current) {
          if (document.pictureInPictureElement === video)
            await document.exitPictureInPicture();
          return;
        }
        setActive(true);
        return;
      }
      if (windowRef.current && !windowRef.current.closed) {
        windowRef.current.focus();
        return;
      }
      const opened = window.open(
        new URL("watch.html", location.href).href,
        "cinegather-watch",
        "width=640,height=410",
      );
      if (!opened) throw new Error("无法打开观看小窗");
      windowRef.current = opened;
      opened.addEventListener(
        "load",
        () => {
          if (opened.closed || windowRef.current !== opened) return;
          const host = opened.document.getElementById("watch-root");
          if (!host) {
            opened.close();
            return;
          }
          mirrorStyles(opened.document);
          setChild(opened);
          setRoot(host);
          setPinned(true);
          setActive(true);
        },
        { once: true },
      );
    } catch (e) {
      report(e);
    }
  };
  const presentation =
    root &&
    createPortal(
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          background: "#0d0f14",
        }}
      >
        <Flex
          align="center"
          gap={6}
          style={{
            ...drag,
            height: 44,
            padding: "0 8px 0 12px",
            flexShrink: 0,
            borderBottom: "1px solid #ffffff18",
          }}
        >
          <Typography.Text ellipsis style={{ flex: 1, minWidth: 0 }}>
            {sharer?.name}的共享
          </Typography.Text>
          <div style={noDrag}>
            <Button
              type="text"
              aria-label={pinned ? "取消置顶" : "置顶"}
              aria-pressed={pinned}
              icon={<Pin size={15} />}
              onClick={() =>
                void window
                  .desktop!.viewingWindow!.action("toggle-top")
                  .then(setPinned)
                  .catch(report)
              }
            />
            <Button
              type="text"
              aria-label="返回主窗口"
              icon={<ArrowUpRight size={16} />}
              onClick={() =>
                void window
                  .desktop!.viewingWindow!.action("return")
                  .catch(report)
              }
            />
            <Button
              type="text"
              aria-label="关闭观看小窗"
              icon={<X size={16} />}
              onClick={close}
            />
          </div>
        </Flex>
        <video
          autoPlay
          playsInline
          aria-label="小窗共享画面"
          ref={bindVideo}
          style={{
            flex: 1,
            minHeight: 0,
            width: "100%",
            objectFit: "contain",
            background: "#050608",
          }}
        />
        <Flex
          align="center"
          gap={12}
          style={{ height: 38, padding: "0 16px", flexShrink: 0 }}
        >
          <Volume2 size={15} />
          <Slider
            ariaLabelForHandle="小窗共享音量"
            value={Math.round(volume * 100)}
            min={0}
            max={100}
            style={{ flex: 1 }}
            onChange={(v) => {
              update({ screenVolume: v / 100 });
              media.screenVolume(v / 100);
            }}
          />
          <Typography.Text style={{ fontSize: 12, width: 36 }}>
            {Math.round(volume * 100)}%
          </Typography.Text>
        </Flex>
      </div>,
      root,
    );
  return {
    active,
    close,
    control: enabled ? (
      <Button
        type="text"
        aria-label={active ? "返回主窗口" : "观看小窗"}
        onClick={() => (active ? close() : void open())}
        icon={<PictureInPicture2 size={17} />}
        className="stage-action"
      />
    ) : null,
    presentation,
  };
}
