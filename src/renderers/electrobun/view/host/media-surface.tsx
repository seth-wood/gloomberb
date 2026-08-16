/** @jsxImportSource react */
import Hls from "hls.js";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { scheduleLiveStreamRenewal } from "../../../../media/live-stream-renewal";
import { type PlaybackSessionState } from "../../../../types/media";
import type { MediaSurfaceHandle, MediaSurfaceProps } from "../../../../ui/host";
import { cleanDomProps, commonStyle } from "./style";

function showsPosterState(state: PlaybackSessionState): boolean {
  return state === "idle" || state === "starting" || state === "failed";
}

export const WebMediaSurface = forwardRef<HTMLVideoElement, MediaSurfaceProps>(function WebMediaSurface(rawProps, forwardedRef) {
  const {
    children,
    src,
    title,
    poster,
    autoPlay = false,
    muted = false,
    playbackGeneration = 0,
    liveStream,
    renewLiveStream,
    mediaHandleRef,
    onPlaybackStateChange,
    onStopReason,
    onMutedChange,
    onWarning: _onWarning,
    onError,
    ...props
  } = rawProps as MediaSurfaceProps & {
    children?: ReactNode;
    src?: string;
    title?: string;
    poster?: string;
    autoPlay?: boolean;
    muted?: boolean;
    playbackGeneration?: number;
    liveStream?: MediaSurfaceProps["liveStream"];
    renewLiveStream?: MediaSurfaceProps["renewLiveStream"];
    mediaHandleRef?: MediaSurfaceProps["mediaHandleRef"];
    onPlaybackStateChange?: (state: PlaybackSessionState) => void;
    onStopReason?: MediaSurfaceProps["onStopReason"];
    onMutedChange?: (muted: boolean) => void;
    onError?: (message: string) => void;
  };
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const wantsPlaybackRef = useRef(autoPlay);
  const [wantsPlayback, setWantsPlayback] = useState(autoPlay);
  const [failed, setFailed] = useState(false);
  const [sessionState, setSessionState] = useState<PlaybackSessionState>(autoPlay ? "starting" : "idle");
  const mediaSrc = typeof src === "string" ? src.trim() : "";
  const baseStyle = commonStyle(props);
  const showPoster = showsPosterState(sessionState);

  const tearDownPlayback = useCallback(() => {
    const video = videoRef.current;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }, []);

  useImperativeHandle(forwardedRef, () => videoRef.current as HTMLVideoElement, []);
  useImperativeHandle(mediaHandleRef, (): MediaSurfaceHandle => ({
    async play() {
      wantsPlaybackRef.current = true;
      setWantsPlayback(true);
    },
    pause() {
      wantsPlaybackRef.current = false;
      setWantsPlayback(false);
      tearDownPlayback();
      setSessionState("stopped");
      onPlaybackStateChange?.("stopped");
      onStopReason?.(null);
    },
    async toggle() {
      if (wantsPlaybackRef.current) {
        wantsPlaybackRef.current = false;
        setWantsPlayback(false);
        tearDownPlayback();
        setSessionState("stopped");
        onPlaybackStateChange?.("stopped");
        onStopReason?.(null);
        return;
      }
      wantsPlaybackRef.current = true;
      setWantsPlayback(true);
    },
    toggleMuted() {
      const video = videoRef.current;
      if (!video) return muted;
      video.muted = !video.muted;
      onMutedChange?.(video.muted);
      return video.muted;
    },
  }), [muted, onMutedChange, onPlaybackStateChange, onStopReason, tearDownPlayback]);

  useEffect(() => {
    wantsPlaybackRef.current = wantsPlayback;
  }, [wantsPlayback]);

  useEffect(() => {
    if (!wantsPlayback) {
      setSessionState("idle");
      onPlaybackStateChange?.("idle");
      onStopReason?.(null);
    }
  }, [onPlaybackStateChange, onStopReason, wantsPlayback]);

  useEffect(() => {
    if (!liveStream || !renewLiveStream || !wantsPlayback) return;
    const renewal = scheduleLiveStreamRenewal({
      liveStream,
      renewLiveStream,
      isActive: () => true,
      onRenewed: (next, previous) => {
        if (next.manifestUrl !== previous.manifestUrl) {
          setSessionState("stalled");
          onPlaybackStateChange?.("stalled");
        }
      },
    });
    return () => renewal.cancel();
  }, [liveStream, onPlaybackStateChange, renewLiveStream, wantsPlayback]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mediaSrc || !wantsPlayback) {
      return;
    }

    setFailed(false);
    setSessionState("starting");
    onPlaybackStateChange?.("starting");
    let hls: Hls | null = null;
    let active = true;

    const fail = (message: string) => {
      if (!active) return;
      setFailed(true);
      setSessionState("failed");
      onPlaybackStateChange?.("failed");
      onError?.(message);
    };
    const handlePlaying = () => {
      setSessionState("playing");
      onPlaybackStateChange?.("playing");
    };
    const handleEnded = () => {
      setSessionState("stopped");
      onPlaybackStateChange?.("stopped");
      onStopReason?.(null);
    };
    const handleWaiting = () => {
      setSessionState("stalled");
      onPlaybackStateChange?.("stalled");
    };
    const handleVolumeChange = () => onMutedChange?.(video.muted);
    const handleError = () => fail("The live stream could not be played.");

    video.addEventListener("playing", handlePlaying);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("volumechange", handleVolumeChange);
    video.addEventListener("error", handleError);
    video.defaultMuted = muted;
    video.muted = muted;
    onMutedChange?.(video.muted);

    const startPlayback = () => {
      void video.play().catch(() => {
        if (active) {
          setSessionState("stopped");
          onPlaybackStateChange?.("stopped");
          onStopReason?.(null);
        }
      });
    };

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = mediaSrc;
      video.load();
      startPlayback();
    } else if (Hls.isSupported()) {
      hls = new Hls({
        backBufferLength: 30,
        enableWorker: true,
        lowLatencyMode: true,
      });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        fail(data.details ? `Stream playback failed: ${data.details}` : "Stream playback failed.");
      });
      hls.on(Hls.Events.MANIFEST_PARSED, startPlayback);
      hls.loadSource(mediaSrc);
      hls.attachMedia(video);
    } else {
      fail("HLS playback is unavailable in this desktop runtime.");
    }

    return () => {
      active = false;
      hls?.destroy();
      hlsRef.current = null;
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("volumechange", handleVolumeChange);
      video.removeEventListener("error", handleError);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [mediaSrc, muted, onError, onMutedChange, onPlaybackStateChange, onStopReason, playbackGeneration, wantsPlayback]);

  useEffect(() => {
    if (!wantsPlayback || !mediaSrc) return;
    const video = videoRef.current;
    const hls = hlsRef.current;
    if (!video) return;
    if (hls) {
      hls.loadSource(mediaSrc);
      return;
    }
    if (video.canPlayType("application/vnd.apple.mpegurl") && video.getAttribute("src") !== mediaSrc) {
      video.src = mediaSrc;
      video.load();
      void video.play().catch(() => {});
    }
  }, [mediaSrc, wantsPlayback]);

  return (
    <div
      {...cleanDomProps(props)}
      style={{
        ...baseStyle,
        position: "relative",
        overflow: "hidden",
        background: "#050505",
        ...(props.style as CSSProperties | undefined),
      }}
    >
      {mediaSrc && !failed ? (
        <video
          key={`playback:${playbackGeneration}`}
          ref={videoRef}
          aria-label={title || "Live TV stream"}
          title={title}
          poster={showPoster ? poster : undefined}
          controls
          playsInline
          muted={muted}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            objectFit: "contain",
            background: "#050505",
          }}
        />
      ) : children as ReactNode}
    </div>
  );
});
