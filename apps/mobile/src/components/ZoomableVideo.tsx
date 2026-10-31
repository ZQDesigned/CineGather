import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native";
import { VideoTrack, type VideoTrackProps } from "@livekit/react-native";
import { MobileVideoViewport } from "@cinegather/client-core";

/** Keep the input surface stationary while sizing the native video beneath it. */
export function ZoomableVideo({ trackRef }: Pick<VideoTrackProps, "trackRef">) {
  const [viewport] = useState(() => new MobileVideoViewport());
  const [geometry] = useState(() => ({
    width: new Animated.Value(1),
    height: new Animated.Value(1),
    left: new Animated.Value(0),
    top: new Animated.Value(0),
  }));
  const frame = useRef({ width: 0, height: 0 });
  const [percent, setPercent] = useState(100);
  const dimensions = trackRef?.publication.dimensions;
  const aspect =
    dimensions?.width && dimensions.height
      ? dimensions.width / dimensions.height
      : undefined;
  const apply = useCallback(() => {
    const { scale, x, y } = viewport.value;
    const { width, height } = frame.current;
    // Size the renderer rather than transforming an Android SurfaceView.
    geometry.width.setValue(width * scale);
    geometry.height.setValue(height * scale);
    geometry.left.setValue((width * (1 - scale)) / 2 + x);
    geometry.top.setValue((height * (1 - scale)) / 2 + y);
    setPercent(Math.round(scale * 100));
  }, [geometry, viewport]);
  useEffect(() => {
    const { width, height } = frame.current;
    viewport.resize(width, height, aspect ?? width / height);
    apply();
  }, [aspect, apply, viewport]);
  const update = (event: GestureResponderEvent) => {
    viewport.update(
      event.nativeEvent.touches.map((touch) => ({
        id: touch.identifier,
        x: touch.locationX,
        y: touch.locationY,
      })),
    );
    apply();
  };
  const reset = () => {
    viewport.reset();
    apply();
  };
  return (
    <View
      testID="zoomable-video"
      style={styles.viewport}
      onLayout={({ nativeEvent: { layout } }) => {
        frame.current = { width: layout.width, height: layout.height };
        viewport.resize(
          layout.width,
          layout.height,
          aspect ?? layout.width / layout.height,
        );
        apply();
      }}
    >
      <Animated.View pointerEvents="none" style={[styles.renderer, geometry]}>
        <VideoTrack
          trackRef={trackRef}
          objectFit="contain"
          style={styles.video}
        />
      </Animated.View>
      <View
        testID="video-gestures"
        style={StyleSheet.absoluteFill}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="共享画面"
        accessibilityHint="双指缩放，放大后拖动，双击复原"
        accessibilityValue={{
          min: 100,
          max: 400,
          now: percent,
          text: `${percent}%`,
        }}
        accessibilityActions={[
          { name: "increment", label: "放大" },
          { name: "decrement", label: "缩小" },
          { name: "activate", label: "复原画面" },
        ]}
        onAccessibilityAction={({ nativeEvent: { actionName } }) => {
          if (actionName === "activate") reset();
          else {
            viewport.zoom(
              viewport.value.scale + (actionName === "increment" ? 0.5 : -0.5),
            );
            apply();
          }
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={update}
        onResponderStart={update}
        onResponderMove={update}
        onResponderEnd={(event) => {
          if (event.nativeEvent.touches.length) update(event);
        }}
        onResponderRelease={() => {
          viewport.finish();
          apply();
        }}
        onResponderTerminationRequest={() => false}
        onResponderTerminate={() => viewport.cancel()}
      />
      {percent > 100 && (
        <Pressable
          testID="video-zoom-reset"
          accessibilityRole="button"
          accessibilityLabel="复原画面"
          onPress={reset}
          style={({ pressed }) => [styles.reset, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.label}>{percent}% 复原</Text>
        </Pressable>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  viewport: { width: "100%", height: "100%", overflow: "hidden" },
  renderer: { position: "absolute" },
  video: { width: "100%", height: "100%" },
  reset: {
    position: "absolute",
    bottom: 8,
    right: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: "#191d28e6",
  },
  label: { color: "#f5f3ff", fontSize: 13, fontWeight: "600" },
});
