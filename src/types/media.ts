/** Resolution, as defined in `CONTEXT.md`. Distinct from playback state. */
export type ResolutionState = "resolving" | "resolved" | "unavailable";

/** Playback Session, as defined in `CONTEXT.md`. A live broadcast has no paused state. */
export type PlaybackSessionState =
  | "idle"
  | "starting"
  | "playing"
  | "stalled"
  | "stopped"
  | "failed";

/** Why a Playback Session stopped. Distinct from `failed`, which is a state. */
export type PlaybackStopReason = "displaced" | "pane-close" | "teardown" | "hidden-muted";

export interface LiveStreamResolveRequest {
  provider: "youtube";
  sourceId: string;
  force?: boolean;
}

export interface ResolvedLiveStream {
  provider: "youtube";
  sourceId: string;
  videoId: string;
  title: string;
  manifestUrl: string;
  watchUrl: string;
  posterUrl?: string;
  resolvedAt: number;
  expiresAt: number;
}
