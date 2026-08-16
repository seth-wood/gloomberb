import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Tabs, usePaneFooter } from "../../../components";
import { updatePaneInstance } from "../../../pane-settings";
import { useShortcut } from "../../../react/input";
import {
  syncConfigActiveLayoutState,
  useAppDispatch,
  useAppStateRef,
  usePaneInstance,
} from "../../../state/app/context";
import { scheduleConfigSave } from "../../../state/config-save-scheduler";
import { colors } from "../../../theme/colors";
import type { PaneProps } from "../../../types/plugin";
import { Box, MediaSurface, Text, useRendererHost, type MediaSurfaceHandle } from "../../../ui";
import { getTvChannel, TV_CHANNELS, type TvChannelId } from "./channels";
import type { PlaybackSessionState, PlaybackStopReason, ResolutionState, ResolvedLiveStream } from "../../../types/media";
import { deriveTvPaneStatus, isTvPaneMuteEnabled, isTvPanePlaybackActive } from "./pane-status";
import { resolveTvStream } from "./youtube-stream";

export function TvPane({ paneId, focused, width, height }: PaneProps) {
  const renderer = useRendererHost();
  const dispatch = useAppDispatch();
  const stateRef = useAppStateRef();
  const pane = usePaneInstance();
  const initialChannelIdRef = useRef<TvChannelId>(
    TV_CHANNELS.find((item) => item.id === pane?.settings?.channelId)?.id ?? "bloomberg",
  );
  const [channelId, setChannelId] = useState<TvChannelId>(initialChannelIdRef.current);
  const [stream, setStream] = useState<ResolvedLiveStream | null>(null);
  const [resolution, setResolution] = useState<ResolutionState>("resolving");
  const [error, setError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackWarning, setPlaybackWarning] = useState<string | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackSessionState>("idle");
  const [stopReason, setStopReason] = useState<PlaybackStopReason | null>(null);
  const [playbackGeneration, setPlaybackGeneration] = useState(0);
  const [muted, setMuted] = useState(false);
  const mediaRef = useRef<MediaSurfaceHandle | null>(null);
  const generationRef = useRef(0);
  const playbackStateRef = useRef<PlaybackSessionState>("idle");
  const channel = getTvChannel(channelId);
  const resolving = resolution === "resolving";
  const playbackActive = isTvPanePlaybackActive(playbackState);
  playbackStateRef.current = playbackState;

  const persistChannelSelection = useCallback((nextId: TvChannelId) => {
    const nextChannel = getTvChannel(nextId);
    const nextTitle = `TV: ${nextChannel.name}`;
    const currentState = stateRef.current;
    const currentPane = currentState.config.layout.instances.find((instance) => instance.instanceId === paneId);
    if (currentPane?.title === nextTitle && currentPane.settings?.channelId === nextId) return;

    const layout = updatePaneInstance(currentState.config.layout, paneId, (instance) => ({
      ...instance,
      title: nextTitle,
      settings: { ...instance.settings, channelId: nextId },
    }));
    const syncedConfig = syncConfigActiveLayoutState(
      { ...currentState.config, layout },
      currentState.paneState,
      currentState.focusedPaneId,
      currentState.activePanel,
    );
    dispatch({ type: "SET_CONFIG", config: syncedConfig });
    scheduleConfigSave(syncedConfig);
  }, [dispatch, paneId, stateRef]);

  const stopPlayback = useCallback(() => {
    mediaRef.current?.pause();
  }, []);

  const load = useCallback(async (force = false) => {
    const generation = ++generationRef.current;
    if (isTvPanePlaybackActive(playbackStateRef.current)) {
      stopPlayback();
      setPlaybackGeneration((current) => current + 1);
    }
    setError(null);
    setPlaybackError(null);
    setPlaybackWarning(null);
    setStopReason(null);
    setPlaybackState("idle");
    setMuted(false);
    setResolution("resolving");
    setStream((current) => current?.sourceId === channel.id ? current : null);
    try {
      const nextStream = renderer.resolveLiveStream
        ? await renderer.resolveLiveStream({ provider: "youtube", sourceId: channel.id, force })
        : await resolveTvStream(channel, { force });
      if (generation !== generationRef.current) return;
      setStream(nextStream);
      setResolution("resolved");
    } catch (cause) {
      if (generation !== generationRef.current) return;
      setStream(null);
      setError(cause instanceof Error ? cause.message : String(cause));
      setResolution("unavailable");
    }
  }, [channel, renderer, stopPlayback]);

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  const renewLiveStream = useCallback(async (current: ResolvedLiveStream) => {
    const generation = generationRef.current;
    const nextStream = renderer.resolveLiveStream
      ? await renderer.resolveLiveStream({ provider: "youtube", sourceId: channel.id, force: true })
      : await resolveTvStream(channel, { force: true });
    if (generation !== generationRef.current) return current;
    setStream(nextStream);
    return nextStream;
  }, [channel, renderer]);

  useEffect(() => {
    void load();
    return () => {
      generationRef.current += 1;
    };
  }, [load]);

  useEffect(() => {
    persistChannelSelection(channelId);
  }, [channelId, persistChannelSelection]);

  const selectChannel = useCallback((nextId: string) => {
    if (TV_CHANNELS.some((item) => item.id === nextId)) {
      stopPlayback();
      setChannelId(nextId as TvChannelId);
    }
  }, [stopPlayback]);

  const togglePlayback = useCallback(async () => {
    setPlaybackError(null);
    try {
      await mediaRef.current?.toggle();
    } catch (cause) {
      setPlaybackState("failed");
      setPlaybackError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const toggleMute = useCallback(() => {
    const nextMuted = mediaRef.current?.toggleMuted();
    if (typeof nextMuted === "boolean") setMuted(nextMuted);
  }, []);

  useShortcut((event) => {
    if (!focused) return;
    const channelIndex = Number(event.name) - 1;
    if (Number.isInteger(channelIndex) && TV_CHANNELS[channelIndex]) {
      event.preventDefault?.();
      selectChannel(TV_CHANNELS[channelIndex]!.id);
      return;
    }
    if (event.name === "r") {
      event.preventDefault?.();
      refresh();
      return;
    }
    if (event.name === "p" && stream) {
      event.preventDefault?.();
      void togglePlayback();
      return;
    }
    if (event.name === "m" && stream && isTvPaneMuteEnabled(playbackState)) {
      event.preventDefault?.();
      toggleMute();
    }
  });

  const { text: status, tone: statusTone } = deriveTvPaneStatus({
    channelName: channel.name,
    resolution,
    resolutionError: error,
    playbackState,
    stopReason,
    playbackError,
    playbackWarning,
    hasStream: stream !== null,
  });

  usePaneFooter(paneId, () => ({
    info: [{
      id: "tv-status",
      parts: [{ text: status, tone: statusTone }],
    }],
    hints: [
      {
        id: "playback",
        key: "p",
        label: playbackActive ? "top" : "lay",
        onPress: () => { void togglePlayback(); },
        disabled: resolving || !stream,
      },
      {
        id: "mute",
        key: "m",
        label: muted ? "unmute" : "ute",
        onPress: toggleMute,
        disabled: resolving || !stream || !isTvPaneMuteEnabled(playbackState),
      },
      { id: "refresh", key: "r", label: "efresh", onPress: refresh, disabled: resolving },
    ],
  }), [error, muted, paneId, playbackActive, playbackError, playbackGeneration, playbackState, playbackWarning, refresh, resolving, status, statusTone, stream, toggleMute, togglePlayback]);

  const channelTabs = useMemo(() => TV_CHANNELS.map((item, index) => ({
    label: `${index + 1} ${item.name}`,
    value: item.id,
  })), []);
  const mediaHeight = Math.max(6, height - 1);
  const overlayMessage = playbackError ?? (playbackState === "failed" ? status : null);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box height={1} paddingX={1}>
        <Tabs
          tabs={channelTabs}
          activeValue={channelId}
          onSelect={selectChannel}
          compact
          variant="bare"
          focused={focused}
        />
      </Box>

      {resolving && !stream ? (
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Text fg={colors.textMuted}>{`Resolving ${channel.name} live stream...`}</Text>
        </Box>
      ) : error || !stream ? (
        <Box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center" gap={1}>
          <Text fg={colors.warning}>{error ?? `${channel.name} is offline.`}</Text>
          <Button label="Try again" variant="primary" onPress={refresh} />
        </Box>
      ) : (
        <MediaSurface
          src={stream.manifestUrl}
          liveStream={stream}
          renewLiveStream={renewLiveStream}
          title={stream.title}
          poster={stream.posterUrl}
          muted={muted}
          playbackGeneration={playbackGeneration}
          mediaHandleRef={mediaRef}
          height={mediaHeight}
          flexGrow={1}
          onPlaybackStateChange={setPlaybackState}
          onStopReason={setStopReason}
          onMutedChange={setMuted}
          onWarning={setPlaybackWarning}
          onError={setPlaybackError}
        >
          {overlayMessage ? (
            <Box flexGrow={1} justifyContent="center" alignItems="center">
              <Text fg={colors.warning}>{overlayMessage}</Text>
            </Box>
          ) : null}
        </MediaSurface>
      )}
    </Box>
  );
}
