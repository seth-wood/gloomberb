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
import type { PlaybackSessionState, PlaybackStopReason, ResolvedLiveStream } from "../../types/media";
import { useNativeRenderer, type MediaSurfaceHandle, type MediaSurfaceProps } from "../../ui";
import { loadOpenTuiImageBitmap } from "./image/loader";
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
const KITTY_REQUIRED_MESSAGE = "Kitty graphics are required for video.";
const displacedUntilPlay = new Set<string>();
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

function showsPosterState(state: PlaybackSessionState): boolean {
  return state === "idle" || state === "starting" || state === "failed";
}

export function resetOpenTuiMediaSurfaceTestState(): void {
  displacedUntilPlay.clear();
}

export const OpenTuiMediaSurface = forwardRef<unknown, OpenTuiMediaSurfaceProps>(function OpenTuiMediaSurface(
  rawProps,
  forwardedRef,
) {
  const {
    children,
    src,
    title,
    poster,
    autoPlay = false,
    muted = false,
    liveStream,
    renewLiveStream,
    playbackGeneration = 0,
    mediaHandleRef,
    onPlaybackStateChange,
    onStopReason,
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
    poster?: string;
    autoPlay?: boolean;
    muted?: boolean;
    liveStream?: ResolvedLiveStream;
    renewLiveStream?: (current: ResolvedLiveStream) => Promise<ResolvedLiveStream>;
    playbackGeneration?: number;
    mediaHandleRef?: Ref<MediaSurfaceHandle>;
    onPlaybackStateChange?: MediaSurfaceProps["onPlaybackStateChange"];
    onStopReason?: MediaSurfaceProps["onStopReason"];
    onMutedChange?: MediaSurfaceProps["onMutedChange"];
    onWarning?: MediaSurfaceProps["onWarning"];
    onError?: MediaSurfaceProps["onError"];
    sessionRegistry?: PlaybackSessionRegistry;
    frameIntervalMs?: number;
  };
  const renderer = useNativeRenderer();
  const paneId = useOptionalPaneInstanceId();
  const registry = sessionRegistry ?? getPlaybackSessionRegistry();
  const surfaceId = paneId ? `opentui-media:${paneId}` : useRef(`opentui-media:${nextMediaSurfaceId++}`).current;
  const mediaSrc = typeof src === "string" ? src.trim() : "";
  const posterSrc = typeof poster === "string" ? poster.trim() : "";
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
  const displacedRef = useRef(false);
  const autoPlayAppliedRef = useRef(false);
  const mountedRef = useRef(true);
  const enabledRef = useRef(autoPlay);
  const mediaSrcRef = useRef(mediaSrc);
  const playbackGenerationRef = useRef(playbackGeneration);
  const mutedRef = useRef(muted);
  const frameSequenceRef = useRef(0);
  const [enabled, setEnabled] = useState(autoPlay);
  const [playbackState, setPlaybackState] = useState<PlaybackSessionState>(autoPlay ? "starting" : "idle");
  const [bitmapState, setBitmapState] = useState<{ bitmap: NativeChartBitmap; key: string } | null>(null);
  const [posterBitmap, setPosterBitmap] = useState<{ bitmap: NativeChartBitmap; key: string } | null>(null);
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

  const detachSession = useCallback((clearVideo = true) => {
    sessionUnsubscribeRef.current?.();
    sessionUnsubscribeRef.current = null;
    sessionRef.current = null;
    sessionSourceRef.current = null;
    boundPlaybackGenerationRef.current = null;
    if (clearVideo) setBitmapState(null);
  }, []);

  const stopSession = useCallback(async (reason: PlaybackStopReason = "pane-close") => {
    reportedFailureRef.current = null;
    reportedWarningRef.current = null;
    const session = sessionRef.current;
    detachSession();
    if (session) await session.stop(reason);
    setPlaybackState("stopped");
    onPlaybackStateChange?.("stopped");
    onStopReason?.(reason === "pane-close" ? null : reason);
    onWarning?.(null);
  }, [detachSession, onPlaybackStateChange, onStopReason, onWarning]);

  const syncSessionFeedback = useCallback((session: PlaybackSession) => {
    setPlaybackState(session.state);
    onPlaybackStateChange?.(session.state);
    if (session.state === "stopped") {
      onStopReason?.(session.stopReason);
      if (session.stopReason === "displaced") {
        displacedRef.current = true;
        displacedUntilPlay.add(surfaceId);
        enabledRef.current = false;
        setEnabled(false);
      }
    }
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
  }, [onError, onPlaybackStateChange, onStopReason, onWarning]);

  const bindSession = useCallback((session: PlaybackSession) => {
    sessionUnsubscribeRef.current?.();
    sessionUnsubscribeRef.current = session.subscribe(() => {
      if (sessionRef.current === session && !sessionAcceptsSurfaceControl(session)) {
        syncSessionFeedback(session);
        detachSession(session.state !== "stalled");
        return;
      }
      syncSessionFeedback(session);
    });
    syncSessionFeedback(session);
  }, [detachSession, syncSessionFeedback]);

  const startSessionRef = useRef<(() => Promise<void>) | null>(null);

  const pullLatestFrame = useCallback((session = sessionRef.current) => {
    if (!session) return;
    const frame = session.takeLatestFrame();
    syncSessionFeedback(session);
    if (!frame || session.state === "failed") return;
    frameSequenceRef.current += 1;
    setBitmapState({
      bitmap: frame,
      key: `${session.id}:${frameSequenceRef.current}:${frame.width}x${frame.height}`,
    });
  }, [syncSessionFeedback]);

  const resolveOwnedSession = useCallback((): PlaybackSession | null => {
    const bound = sessionRef.current;
    if (bound) return bound;
    const registrySession = registry.current;
    return registrySession?.surfaceId === surfaceId ? registrySession : null;
  }, [registry, surfaceId]);

  const startSession = useCallback(async () => {
    if (!geometry || !mediaSrc || !enabledRef.current) return;
    if (kittySupport === false) {
      setBitmapState(null);
      setPlaybackState("failed");
      onPlaybackStateChange?.("failed");
      onError?.(KITTY_REQUIRED_MESSAGE);
      enabledRef.current = false;
      setEnabled(false);
      return;
    }
    if (kittySupport !== true) return;

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
      existing.setMuted(mutedRef.current);
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
      setPlaybackState("starting");
      onPlaybackStateChange?.("starting");
      try {
        const sessionLiveStream = liveStream ?? surfaceLiveStream(requestedSrc, title);
        const session = await registry.start({
          surfaceId,
          liveStream: sessionLiveStream,
          width: geometry.pixelWidth,
          height: geometry.pixelHeight,
          muted: mutedRef.current,
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
          setPlaybackState("stopped");
          onPlaybackStateChange?.("stopped");
          onStopReason?.(null);
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
        setPlaybackState("failed");
        onPlaybackStateChange?.("failed");
        onError?.(message);
        enabledRef.current = false;
        setEnabled(false);
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
  }, [bindSession, detachSession, geometry, kittySupport, liveStream, mediaSrc, onError, onPlaybackStateChange, onStopReason, onWarning, playbackGeneration, pullLatestFrame, registry, renewLiveStream, resolveOwnedSession, surfaceId, title]);
  startSessionRef.current = startSession;

  useEffect(() => {
    mediaSrcRef.current = mediaSrc;
    playbackGenerationRef.current = playbackGeneration;
    mutedRef.current = muted;
  }, [mediaSrc, muted, playbackGeneration]);

  useEffect(() => {
    if (!autoPlay || autoPlayAppliedRef.current || displacedRef.current || displacedUntilPlay.has(surfaceId)) return;
    autoPlayAppliedRef.current = true;
    enabledRef.current = true;
    setEnabled(true);
  }, [autoPlay, surfaceId]);

  useEffect(() => {
    if (displacedUntilPlay.has(surfaceId)) {
      displacedRef.current = true;
      enabledRef.current = false;
      setEnabled(false);
    }
  }, [surfaceId]);

  useEffect(() => {
    const owned = resolveOwnedSession();
    if (
      boundPlaybackGenerationRef.current !== null
      && boundPlaybackGenerationRef.current !== playbackGenerationRef.current
      && owned
      && enabledRef.current
    ) {
      detachSession();
      void owned.stop("pane-close");
    }
  }, [detachSession, playbackGeneration, resolveOwnedSession]);

  useEffect(() => {
    if (!enabled || displacedRef.current || displacedUntilPlay.has(surfaceId)) return;
    if (kittySupport !== true || !mediaSrc) {
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
    if (!posterSrc || !geometry || !showsPosterState(playbackState) || bitmapState) {
      setPosterBitmap(null);
      return;
    }
    let cancelled = false;
    const posterKey = `${posterSrc}\ncontain\n${geometry.pixelWidth}x${geometry.pixelHeight}`;
    void loadOpenTuiImageBitmap(posterSrc, {
      width: geometry.pixelWidth,
      height: geometry.pixelHeight,
      objectFit: "contain",
    }).then((bitmap) => {
      if (!cancelled) setPosterBitmap({ bitmap, key: posterKey });
    }).catch(() => {
      if (!cancelled) setPosterBitmap(null);
    });
    return () => {
      cancelled = true;
    };
  }, [bitmapState, geometry, playbackState, posterSrc]);

  useEffect(() => {
    const timer = setInterval(pullLatestFrame, frameIntervalMs);
    return () => clearInterval(timer);
  }, [frameIntervalMs, pullLatestFrame]);

  useEffect(() => {
    if (!autoPlay && playbackState === "idle") {
      onPlaybackStateChange?.("idle");
    }
  }, [autoPlay, onPlaybackStateChange, playbackState]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      if (session) void session.stop("pane-close");
      detachSession();
    };
  }, [detachSession]);

  useImperativeHandle(mediaHandleRef, (): MediaSurfaceHandle => ({
    async play() {
      displacedRef.current = false;
      displacedUntilPlay.delete(surfaceId);
      enabledRef.current = true;
      setEnabled(true);
    },
    pause() {
      enabledRef.current = false;
      setEnabled(false);
      void stopSession();
    },
    async toggle() {
      if (enabledRef.current) {
        enabledRef.current = false;
        setEnabled(false);
        await stopSession();
        return;
      }
      displacedRef.current = false;
      displacedUntilPlay.delete(surfaceId);
      enabledRef.current = true;
      setEnabled(true);
    },
    toggleMuted() {
      const nextMuted = !mutedRef.current;
      mutedRef.current = nextMuted;
      sessionRef.current?.setMuted(nextMuted);
      onMutedChange?.(nextMuted);
      return nextMuted;
    },
  }), [onMutedChange, stopSession, surfaceId]);

  const publishedBitmap = bitmapState ?? (showsPosterState(playbackState) ? posterBitmap : null);

  useNativeSurfacePublication({
    renderer,
    surfaceId,
    paneId,
    surface: geometry?.visibleRect && publishedBitmap
      ? {
        rect: geometry.rect,
        visibleRect: geometry.visibleRect,
        bitmap: publishedBitmap.bitmap,
        bitmapKey: publishedBitmap.key,
      }
      : null,
  });

  const awaitingFirstFrame = enabled
    && kittySupport === true
    && geometry
    && !bitmapState
    && playbackState === "starting"
    && reportedFailureRef.current === null;
  const showFallback = !awaitingFirstFrame
    && !publishedBitmap
    && (kittySupport === false || !geometry || (enabled && playbackState === "failed"));
  return createElement("box" as any, { ...props, ref: setRenderableRef }, showFallback ? children : null);
});
