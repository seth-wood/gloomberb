export type ResolutionState = "resolving" | "resolved" | "unavailable";

export type PlaybackSessionState =
  | "idle"
  | "starting"
  | "playing"
  | "stalled"
  | "stopped"
  | "failed";

export type PlaybackStopReason = "displaced" | "pane-close" | "teardown" | "hidden-muted";

export interface LiveStreamResolveRequest {
  provider: "youtube";
  sourceId: string;
  force?: boolean;
}

export interface ResolvedLiveStream {
  provider: "youtube" | "generated";
  sourceId: string;
  videoId: string;
  title: string;
  manifestUrl: string;
  watchUrl: string;
  posterUrl?: string;
  resolvedAt: number;
  expiresAt: number;
}
