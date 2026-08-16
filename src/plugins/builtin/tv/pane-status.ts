import type { PlaybackSessionState, PlaybackStopReason, ResolutionState } from "../../../types/media";

export interface TvPaneStatusInput {
  channelName: string;
  resolution: ResolutionState;
  resolutionError: string | null;
  playbackState: PlaybackSessionState;
  stopReason: PlaybackStopReason | null;
  playbackError: string | null;
  playbackWarning: string | null;
  hasStream: boolean;
}

export type TvPaneStatusTone = "warning" | "positive" | "value";

export interface TvPaneStatus {
  text: string;
  tone: TvPaneStatusTone;
}

export function deriveTvPaneStatus(input: TvPaneStatusInput): TvPaneStatus {
  if (input.resolution === "resolving") {
    return { text: `resolving ${input.channelName}`, tone: "value" };
  }
  if (input.resolution === "unavailable" || input.resolutionError) {
    return { text: input.resolutionError ?? "offline", tone: "warning" };
  }
  if (
    input.playbackWarning
    && (input.playbackState === "playing" || input.playbackState === "stalled" || input.playbackState === "starting")
  ) {
    return { text: "audio unavailable", tone: "warning" };
  }
  if (input.stopReason === "displaced") {
    return { text: "playing in another pane", tone: "value" };
  }
  switch (input.playbackState) {
    case "idle":
    case "stopped":
      return input.hasStream ? { text: "live", tone: "value" } : { text: "offline", tone: "value" };
    case "starting":
      return { text: "starting", tone: "value" };
    case "playing":
      return { text: "playing live", tone: "positive" };
    case "stalled":
      return { text: "stalled", tone: "value" };
    case "failed":
      return { text: input.playbackError ?? "stream error", tone: "warning" };
    default: {
      const _exhaustive: never = input.playbackState;
      return _exhaustive;
    }
  }
}

export function isTvPanePlaybackActive(state: PlaybackSessionState): boolean {
  return state === "starting" || state === "playing" || state === "stalled";
}

export function isTvPaneMuteEnabled(state: PlaybackSessionState): boolean {
  return isTvPanePlaybackActive(state);
}
