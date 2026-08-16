/** @jsxImportSource react */
import Hls from "hls.js";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { LIVE_STREAM_RENEWAL_MARGIN_MS, type PlaybackSessionState } from "../../../../types/media";
import type { MediaSurfaceHandle, MediaSurfaceProps } from "../../../../ui/host";
import { cleanDomProps, commonStyle } from "./style";

export const WebMediaSurface = forwardRef<HTMLVideoElement, MediaSurfaceProps>(function WebMediaSurface(rawProps, forwardedRef) {
  const {
    children,
    src,
    title,
    poster,
    autoPlay = false,
    muted = false,
    liveStream,
    renewLiveStream,
    mediaHandleRef,
    onPlaybackStateChange,
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
    liveStream?: MediaSurfaceProps["liveStream"];
    renewLiveStream?: MediaSurfaceProps["renewLiveStream"];
    mediaHandleRef?: MediaSurfaceProps["mediaHandleRef"];
    onPlaybackStateChange?: (state: PlaybackSessionState) => void;
    onMutedChange?: (muted: boolean) => void;
    onError?: (message: string) => void;
  };
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  const mediaSrc = typeof src === "string" ? src.trim() : "";
  const baseStyle = commonStyle(props);

  useImperativeHandle(forwardedRef, () => videoRef.current as HTMLVideoElement, []);
  useImperativeHandle(mediaHandleRef, (): MediaSurfaceHandle => ({
    async play() {
      if (videoRef.current) await videoRef.current.play();
    },
    pause() {
      videoRef.current?.pause();
    },
    async toggle() {
      const video = videoRef.current;
      if (!video) return;
      if (video.paused) {
        await video.play();
      } else {
        video.pause();
      }
    },
    toggleMuted() {
      const video = videoRef.current;
      if (!video) return muted;
      video.muted = !video.muted;
      return video.muted;
    },
  }), [muted]);

  useEffect(() => {
    if (!liveStream || !renewLiveStream) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (current: typeof liveStream, delayMs?: number) => {
      const waitMs = delayMs
        ?? Math.max(0, current.expiresAt - LIVE_STREAM_RENEWAL_MARGIN_MS - Date.now());
      timer = setTimeout(() => {
        void renewLiveStream(current).then((next) => {
          if (!active) return;
          if (next.manifestUrl !== current.manifestUrl) onPlaybackStateChange?.("stalled");
          schedule(next);
        }).catch(() => {
          if (active) schedule(current, 5_000);
        });
      }, waitMs);
    };

    schedule(liveStream);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [liveStream, onPlaybackStateChange, renewLiveStream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mediaSrc) {
      onPlaybackStateChange?.("idle");
      return;
    }

    setFailed(false);
    onPlaybackStateChange?.("starting");
    let hls: Hls | null = null;

    let active = true;
    const fail = (message: string) => {
      if (!active) return;
      setFailed(true);
      onPlaybackStateChange?.("failed");
      onError?.(message);
    };
    const handlePlaying = () => onPlaybackStateChange?.("playing");
    const handlePause = () => onPlaybackStateChange?.("stopped");
    const handleEnded = () => onPlaybackStateChange?.("stopped");
    const handleWaiting = () => onPlaybackStateChange?.("stalled");
    const handleVolumeChange = () => onMutedChange?.(video.muted);
    const handleError = () => fail("The live stream could not be played.");
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("volumechange", handleVolumeChange);
    video.addEventListener("error", handleError);
    video.defaultMuted = muted;
    video.muted = muted;
    onMutedChange?.(video.muted);

    const startPlayback = () => {
      if (!autoPlay) return;
      void video.play().catch(() => {
        if (active) onPlaybackStateChange?.("stopped");
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
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("volumechange", handleVolumeChange);
      video.removeEventListener("error", handleError);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [autoPlay, mediaSrc, onError, onMutedChange, onPlaybackStateChange]);

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
          key={mediaSrc}
          ref={videoRef}
          aria-label={title || "Live TV stream"}
          title={title}
          poster={poster}
          controls
          playsInline
          autoPlay={autoPlay}
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
