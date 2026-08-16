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
  PLAYBACK_UNEXPECTED_FAILURE_MESSAGE,
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

function sessionAcceptsSurfaceControl(session: PlaybackSession): boolean {
  switch (session.state) {
    case "starting":
    case "playing":
    case "stalled":
      return true;
    case "stopped":
      return session.stopReason === "hidden-muted";
    case "idle":
    case "failed":
      return false;
    default: {
      const _exhaustive: never = session.state;
      return _exhaustive;
    }
  }
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
    liveStream,
    renewLiveStream,
    playbackGeneration = 0,
    mediaHandleRef,
    onPlaybackStateChange,
    onMutedChange,
    onWarning,
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
    liveStream?: ResolvedLiveStream;
    renewLiveStream?: (current: ResolvedLiveStream) => Promise<ResolvedLiveStream>;
    playbackGeneration?: number;
    mediaHandleRef?: Ref<MediaSurfaceHandle>;
    onPlaybackStateChange?: MediaSurfaceProps["onPlaybackStateChange"];
    onMutedChange?: MediaSurfaceProps["onMutedChange"];
    onWarning?: MediaSurfaceProps["onWarning"];
    onError?: MediaSurfaceProps["onError"];
    sessionRegistry?: PlaybackSessionRegistry;
    frameIntervalMs?: number;
  };
  const renderer = useNativeRenderer();
  const paneId = useOptionalPaneInstanceId();
  const registry = sessionRegistry ?? getPlaybackSessionRegistry();
  const surfaceId = useRef(`opentui-media:${nextMediaSurfaceId++}`).current;
  const mediaSrc = typeof src === "string" ? src.trim() : "";
  const renderableRef = useRef<NativeSurfaceRenderableNode | null>(null);
  const sessionRef = useRef<PlaybackSession | null>(null);
  const sessionSourceRef = useRef<string | null>(null);
  const boundPlaybackGenerationRef = useRef<number | null>(null);
  const startInFlightRef = useRef<Promise<void> | null>(null);
  const startInFlightSourceRef = useRef<string | null>(null);
  const startInFlightGenerationRef = useRef<number | null>(null);
  const sessionUnsubscribeRef = useRef<(() => void) | null>(null);
  const reportedFailureRef = useRef<string | null>(null);
  const reportedWarningRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const enabledRef = useRef(autoPlay);
  const mediaSrcRef = useRef(mediaSrc);
  const playbackGenerationRef = useRef(playbackGeneration);
  const mutedRef = useRef(muted);
  const frameSequenceRef = useRef(0);
  const [enabled, setEnabled] = useState(autoPlay);
  const [bitmapState, setBitmapState] = useState<{ bitmap: NativeChartBitmap; key: string } | null>(null);
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

  const detachSession = useCallback(() => {
    sessionUnsubscribeRef.current?.();
    sessionUnsubscribeRef.current = null;
    sessionRef.current = null;
    sessionSourceRef.current = null;
    boundPlaybackGenerationRef.current = null;
    setBitmapState(null);
  }, []);

  const stopSession = useCallback(async () => {
    reportedFailureRef.current = null;
    reportedWarningRef.current = null;
    const session = sessionRef.current;
    detachSession();
    if (session) await session.stop("pane-close");
    onPlaybackStateChange?.("stopped");
    onWarning?.(null);
  }, [detachSession, onPlaybackStateChange, onWarning]);

  const syncSessionFeedback = useCallback((session: PlaybackSession) => {
    onPlaybackStateChange?.(session.state);
    const warning = session.warning;
    if (warning !== reportedWarningRef.current) {
      reportedWarningRef.current = warning;
      onWarning?.(warning);
    }
    if (session.state !== "failed") {
      reportedFailureRef.current = null;
      return;
    }
    const message = session.failureMessage ?? PLAYBACK_UNEXPECTED_FAILURE_MESSAGE;
    if (reportedFailureRef.current === message) return;
    reportedFailureRef.current = message;
    setBitmapState(null);
    onError?.(message);
  }, [onError, onPlaybackStateChange, onWarning]);

  const bindSession = useCallback((session: PlaybackSession) => {
    sessionUnsubscribeRef.current?.();
    sessionUnsubscribeRef.current = session.subscribe(() => {
      if (sessionRef.current === session && !sessionAcceptsSurfaceControl(session)) {
        syncSessionFeedback(session);
        detachSession();
        return;
      }
      syncSessionFeedback(session);
    });
    syncSessionFeedback(session);
  }, [detachSession, syncSessionFeedback]);

  const startSessionRef = useRef<(() => Promise<void>) | null>(null);

  const maybeResumePlayback = useCallback(() => {
    if (!geometry || !mediaSrc || kittySupport !== true || !enabledRef.current || !mountedRef.current) return;
    if (sessionRef.current || startInFlightRef.current || registry.current) return;
    const start = startSessionRef.current;
    if (start) void start();
  }, [geometry, kittySupport, mediaSrc, registry]);

  const pullLatestFrame = useCallback((session = sessionRef.current) => {
    if (!session) {
      maybeResumePlayback();
      return;
    }
    const frame = session.takeLatestFrame();
    syncSessionFeedback(session);
    if (!frame || session.state === "failed") return;
    frameSequenceRef.current += 1;
    setBitmapState({
      bitmap: frame,
      key: `${session.id}:${frameSequenceRef.current}:${frame.width}x${frame.height}`,
    });
  }, [maybeResumePlayback, syncSessionFeedback]);

  const resolveOwnedSession = useCallback((): PlaybackSession | null => {
    const bound = sessionRef.current;
    if (bound) return bound;
    const registrySession = registry.current;
    return registrySession?.surfaceId === surfaceId ? registrySession : null;
  }, [registry, surfaceId]);

  const startSession = useCallback(async () => {
    if (!geometry || !mediaSrc || kittySupport !== true || !enabledRef.current) return;
    const ownedSession = resolveOwnedSession();
    if (ownedSession && boundPlaybackGenerationRef.current !== playbackGenerationRef.current) {
      detachSession();
      await ownedSession.stop("pane-close");
    }
    const existing = sessionRef.current;
    if (
      existing
      && sessionSourceRef.current === mediaSrcRef.current
      && boundPlaybackGenerationRef.current === playbackGenerationRef.current
      && sessionAcceptsSurfaceControl(existing)
    ) {
      existing.setSize(geometry.pixelWidth, geometry.pixelHeight);
      existing.setVisible(geometry.visibleRect !== null);
      existing.setMuted(muted);
      return;
    }
    if (startInFlightRef.current) {
      if (
        startInFlightSourceRef.current === mediaSrc
        && startInFlightGenerationRef.current === playbackGeneration
      ) {
        return startInFlightRef.current;
      }
      await startInFlightRef.current.catch(() => {});
    }

    const requestedSrc = mediaSrc;
    const requestedGeneration = playbackGeneration;
    const start = (async () => {
      const activeSession = resolveOwnedSession();
      if (activeSession) await activeSession.stop("pane-close");
      onPlaybackStateChange?.("starting");
      try {
        const sessionLiveStream = liveStream ?? surfaceLiveStream(requestedSrc, title);
        const session = await registry.start({
          surfaceId,
          liveStream: sessionLiveStream,
          width: geometry.pixelWidth,
          height: geometry.pixelHeight,
          muted,
          visible: geometry.visibleRect !== null,
          frameSource: frameSource(requestedSrc),
          renewLiveStream: requestedSrc !== TEST_PATTERN_SOURCE && renewLiveStream
            ? renewLiveStream
            : undefined,
        });
        if (
          !mountedRef.current
          || !enabledRef.current
          || requestedSrc !== mediaSrcRef.current
          || requestedGeneration !== playbackGenerationRef.current
        ) {
          await session.stop("pane-close");
          onPlaybackStateChange?.("stopped");
          onWarning?.(null);
          return;
        }
        sessionRef.current = session;
        sessionSourceRef.current = requestedSrc;
        boundPlaybackGenerationRef.current = requestedGeneration;
        bindSession(session);
        pullLatestFrame(session);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setBitmapState(null);
        onPlaybackStateChange?.("failed");
        onError?.(message);
      }
    })();
    startInFlightRef.current = start;
    startInFlightSourceRef.current = requestedSrc;
    startInFlightGenerationRef.current = requestedGeneration;
    try {
      await start;
    } finally {
      if (startInFlightRef.current === start) {
        startInFlightRef.current = null;
        startInFlightSourceRef.current = null;
        startInFlightGenerationRef.current = null;
      }
    }
  }, [bindSession, detachSession, geometry, kittySupport, liveStream, mediaSrc, muted, onError, onPlaybackStateChange, onWarning, playbackGeneration, pullLatestFrame, registry, renewLiveStream, resolveOwnedSession, surfaceId, title]);
  startSessionRef.current = startSession;

  useEffect(() => {
    mediaSrcRef.current = mediaSrc;
    playbackGenerationRef.current = playbackGeneration;
    mutedRef.current = muted;
  }, [mediaSrc, muted, playbackGeneration]);

  useEffect(() => {
    if (autoPlay) {
      enabledRef.current = true;
      setEnabled(true);
    }
    const owned = resolveOwnedSession();
    if (
      boundPlaybackGenerationRef.current !== null
      && boundPlaybackGenerationRef.current !== playbackGenerationRef.current
      && owned
    ) {
      detachSession();
      void owned.stop("pane-close");
    }
  }, [autoPlay, detachSession, playbackGeneration, resolveOwnedSession]);

  useEffect(() => {
    enabledRef.current = autoPlay;
    setEnabled(autoPlay);
  }, [autoPlay]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    if (kittySupport !== true || !enabled || !mediaSrc) {
      if (sessionRef.current) void stopSession();
      return;
    }
    void startSession();
  }, [enabled, kittySupport, mediaSrc, playbackGeneration, startSession, stopSession]);

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
      detachSession();
      if (session) void session.stop("pane-close");
    };
  }, [detachSession]);

  useImperativeHandle(mediaHandleRef, (): MediaSurfaceHandle => ({
    async play() {
      enabledRef.current = true;
      setEnabled(true);
    },
    pause() {
      enabledRef.current = false;
      setEnabled(false);
      void stopSession();
    },
    async toggle() {
      setEnabled((current) => {
        const next = !current;
        enabledRef.current = next;
        return next;
      });
    },
    toggleMuted() {
      const nextMuted = !mutedRef.current;
      mutedRef.current = nextMuted;
      sessionRef.current?.setMuted(nextMuted);
      onMutedChange?.(nextMuted);
      return nextMuted;
    },
  }), [onMutedChange, stopSession]);

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

  const awaitingFirstFrame = enabled
    && kittySupport === true
    && geometry
    && !bitmapState
    && reportedFailureRef.current === null;
  const showFallback = !awaitingFirstFrame && (kittySupport !== true || !geometry || !bitmapState);
  return createElement("box" as any, { ...props, ref: setRenderableRef }, showFallback ? children : null);
});
