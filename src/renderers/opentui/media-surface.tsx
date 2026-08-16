import {
  createElement,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ForwardedRef,
  type ReactNode,
  type Ref,
} from "react";
import type { NativeChartBitmap } from "../../components/chart/native/chart-rasterizer";
import {
  getPlaybackSessionRegistry,
  type PlaybackSession,
  type PlaybackSessionRegistry,
  type StartPlaybackSessionOptions,
} from "../../media/playback-session";
import { TERMINAL_VIDEO_FPS_CEILING } from "../../media/frame-reader";
import { useOptionalPaneInstanceId } from "../../state/app/context";
import type { ResolvedLiveStream } from "../../types/media";
import { useNativeRenderer, type MediaSurfaceHandle, type MediaSurfaceProps } from "../../ui";
import {
  resolveCellInsets,
  useKittySupport,
  useNativeSurfaceGeometry,
  useNativeSurfacePublication,
  type NativeSurfaceRenderableNode,
} from "./native-surface";

const TEST_PATTERN_SOURCE = "generated:test-pattern";
const TEST_PATTERN_FILTER = `testsrc2=rate=${TERMINAL_VIDEO_FPS_CEILING}`;
const FRAME_INTERVAL_MS = Math.ceil(1000 / TERMINAL_VIDEO_FPS_CEILING);
let nextMediaSurfaceId = 1;

export interface OpenTuiMediaSurfaceProps extends MediaSurfaceProps {
  /** Dependency seams for host-level tests; production uses the shared registry and frame cadence. */
  sessionRegistry?: PlaybackSessionRegistry;
  frameIntervalMs?: number;
}

function assignRef(ref: ForwardedRef<unknown>, value: unknown): void {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    (ref as { current: unknown }).current = value;
  }
}

function surfaceLiveStream(src: string, title: string | undefined): ResolvedLiveStream {
  const now = Date.now();
  return {
    provider: src === TEST_PATTERN_SOURCE ? "generated" : "youtube",
    sourceId: src === TEST_PATTERN_SOURCE ? "test-pattern" : "terminal-media",
    videoId: src,
    title: title || "Live video",
    manifestUrl: src,
    watchUrl: src,
    resolvedAt: now,
    expiresAt: now + 24 * 60 * 60 * 1000,
  };
}

function frameSource(src: string): StartPlaybackSessionOptions["frameSource"] {
  if (src !== TEST_PATTERN_SOURCE) return undefined;
  return {
    url: TEST_PATTERN_FILTER,
    inputFormat: "lavfi",
    realtime: true,
    audio: "none",
    fps: TERMINAL_VIDEO_FPS_CEILING,
  };
}

export const OpenTuiMediaSurface = forwardRef<unknown, OpenTuiMediaSurfaceProps>(function OpenTuiMediaSurface(
  rawProps,
  forwardedRef,
) {
  const {
    children,
    src,
    title,
    autoPlay = false,
    muted = false,
    mediaHandleRef,
    onPlaybackStateChange,
    onMutedChange,
    onError,
    sessionRegistry,
    frameIntervalMs = FRAME_INTERVAL_MS,
    ...props
  } = rawProps as OpenTuiMediaSurfaceProps & {
    children?: ReactNode;
    src?: string;
    title?: string;
    autoPlay?: boolean;
    muted?: boolean;
    mediaHandleRef?: Ref<MediaSurfaceHandle>;
    onPlaybackStateChange?: MediaSurfaceProps["onPlaybackStateChange"];
    onMutedChange?: MediaSurfaceProps["onMutedChange"];
    onError?: MediaSurfaceProps["onError"];
    sessionRegistry?: PlaybackSessionRegistry;
    frameIntervalMs?: number;
  };
  const renderer = useNativeRenderer();
  const paneId = useOptionalPaneInstanceId();
  const registry = sessionRegistry ?? getPlaybackSessionRegistry();
  const surfaceId = useRef(`opentui-media:${nextMediaSurfaceId++}`).current;
  const renderableRef = useRef<NativeSurfaceRenderableNode | null>(null);
  const sessionRef = useRef<PlaybackSession | null>(null);
  const sessionSourceRef = useRef<string | null>(null);
  const startInFlightRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);
  const frameSequenceRef = useRef(0);
  const [enabled, setEnabled] = useState(autoPlay);
  const [bitmapState, setBitmapState] = useState<{ bitmap: NativeChartBitmap; key: string } | null>(null);
  const mediaSrc = typeof src === "string" ? src.trim() : "";
  const kittySupport = useKittySupport(renderer);

  const setRenderableRef = useCallback((node: unknown) => {
    renderableRef.current = node as NativeSurfaceRenderableNode | null;
    assignRef(forwardedRef, node);
  }, [forwardedRef]);

  const geometry = useNativeSurfaceGeometry({
    renderer,
    renderableRef,
    enabled: kittySupport === true && mediaSrc !== "",
    insets: resolveCellInsets(props),
  });

  const stopSession = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    sessionSourceRef.current = null;
    setBitmapState(null);
    if (session) await session.stop("pane-close");
    onPlaybackStateChange?.("stopped");
  }, [onPlaybackStateChange]);

  const pullLatestFrame = useCallback((session = sessionRef.current) => {
    if (!session) return;
    const frame = session.takeLatestFrame();
    onPlaybackStateChange?.(session.state);
    if (!frame) return;
    frameSequenceRef.current += 1;
    setBitmapState({
      bitmap: frame,
      key: `${session.id}:${frameSequenceRef.current}:${frame.width}x${frame.height}`,
    });
  }, [onPlaybackStateChange]);

  const startSession = useCallback(async () => {
    if (!geometry || !mediaSrc || kittySupport !== true || !enabled) return;
    const existing = sessionRef.current;
    if (existing && sessionSourceRef.current === mediaSrc) {
      existing.setSize(geometry.pixelWidth, geometry.pixelHeight);
      existing.setVisible(geometry.visibleRect !== null);
      existing.setMuted(muted);
      return;
    }
    if (startInFlightRef.current) return startInFlightRef.current;

    const start = (async () => {
      if (existing) await existing.stop("pane-close");
      onPlaybackStateChange?.("starting");
      try {
        const session = await registry.start({
          surfaceId,
          liveStream: surfaceLiveStream(mediaSrc, title),
          width: geometry.pixelWidth,
          height: geometry.pixelHeight,
          muted,
          visible: geometry.visibleRect !== null,
          frameSource: frameSource(mediaSrc),
        });
        if (!mountedRef.current || !enabled) {
          await session.stop("pane-close");
          return;
        }
        sessionRef.current = session;
        sessionSourceRef.current = mediaSrc;
        onPlaybackStateChange?.(session.state);
        pullLatestFrame(session);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        onPlaybackStateChange?.("failed");
        onError?.(message);
      }
    })();
    startInFlightRef.current = start;
    try {
      await start;
    } finally {
      if (startInFlightRef.current === start) startInFlightRef.current = null;
    }
  }, [enabled, geometry, kittySupport, mediaSrc, muted, onError, onPlaybackStateChange, pullLatestFrame, registry, surfaceId, title]);

  useEffect(() => {
    setEnabled(autoPlay);
  }, [autoPlay]);

  useEffect(() => {
    if (kittySupport !== true || !enabled || !mediaSrc) {
      if (sessionRef.current) void stopSession();
      return;
    }
    void startSession();
  }, [enabled, kittySupport, mediaSrc, startSession, stopSession]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (geometry) session.setSize(geometry.pixelWidth, geometry.pixelHeight);
    session.setVisible(geometry?.visibleRect != null);
    session.setMuted(muted);
  }, [geometry, muted]);

  useEffect(() => {
    const timer = setInterval(pullLatestFrame, frameIntervalMs);
    return () => clearInterval(timer);
  }, [frameIntervalMs, pullLatestFrame]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) void session.stop("pane-close");
    };
  }, []);

  useImperativeHandle(mediaHandleRef, (): MediaSurfaceHandle => ({
    async play() {
      setEnabled(true);
    },
    pause() {
      setEnabled(false);
      void stopSession();
    },
    async toggle() {
      setEnabled((current) => !current);
    },
    toggleMuted() {
      const nextMuted = !muted;
      sessionRef.current?.setMuted(nextMuted);
      onMutedChange?.(nextMuted);
      return nextMuted;
    },
  }), [muted, onMutedChange, stopSession]);

  useNativeSurfacePublication({
    renderer,
    surfaceId,
    paneId,
    surface: geometry?.visibleRect && bitmapState
      ? {
        rect: geometry.rect,
        visibleRect: geometry.visibleRect,
        bitmap: bitmapState.bitmap,
        bitmapKey: bitmapState.key,
      }
      : null,
  });

  const showFallback = kittySupport !== true || !geometry || !bitmapState;
  return createElement("box" as any, { ...props, ref: setRenderableRef }, showFallback ? children : null);
});
