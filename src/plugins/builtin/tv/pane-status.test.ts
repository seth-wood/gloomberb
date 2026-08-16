import { describe, expect, test } from "bun:test";
import { deriveTvPaneStatus, isTvPaneMuteEnabled, isTvPanePlaybackActive } from "./pane-status";

describe("deriveTvPaneStatus", () => {
  const base = {
    channelName: "Bloomberg",
    resolution: "resolved" as const,
    resolutionError: null,
    playbackState: "idle" as const,
    stopReason: null,
    playbackError: null,
    playbackWarning: null,
    hasStream: true,
  };

  test("reports resolving while the Channel is being resolved", () => {
    expect(deriveTvPaneStatus({ ...base, resolution: "resolving" })).toEqual({
      text: "resolving Bloomberg",
      tone: "value",
    });
  });

  test("reports unavailable Resolution errors", () => {
    expect(deriveTvPaneStatus({
      ...base,
      resolution: "unavailable",
      resolutionError: "No live broadcast",
      hasStream: false,
    })).toEqual({
      text: "No live broadcast",
      tone: "warning",
    });
  });

  test("never reports playing live unless the Session is playing", () => {
    expect(deriveTvPaneStatus({ ...base, playbackState: "starting" }).text).toBe("starting");
    expect(deriveTvPaneStatus({ ...base, playbackState: "stalled" }).text).toBe("stalled");
    expect(deriveTvPaneStatus({ ...base, playbackState: "playing" }).text).toBe("playing live");
  });

  test("reports displaced playback in another pane", () => {
    expect(deriveTvPaneStatus({
      ...base,
      playbackState: "stopped",
      stopReason: "displaced",
    })).toEqual({
      text: "playing in another pane",
      tone: "value",
    });
  });

  test("reports silent video while playback is active", () => {
    expect(deriveTvPaneStatus({
      ...base,
      playbackState: "playing",
      playbackWarning: "Audio is unavailable; playing silent video.",
    })).toEqual({
      text: "audio unavailable",
      tone: "warning",
    });
  });

  test("reports ffmpeg install failures from the Session", () => {
    expect(deriveTvPaneStatus({
      ...base,
      playbackState: "failed",
      playbackError: "ffmpeg is required for terminal TV playback. Install ffmpeg and try again.",
    })).toEqual({
      text: "ffmpeg is required for terminal TV playback. Install ffmpeg and try again.",
      tone: "warning",
    });
  });
});

describe("tv pane playback helpers", () => {
  test("tracks active playback states", () => {
    expect(isTvPanePlaybackActive("idle")).toBe(false);
    expect(isTvPanePlaybackActive("playing")).toBe(true);
    expect(isTvPanePlaybackActive("stalled")).toBe(true);
  });

  test("enables mute only while a Session is running", () => {
    expect(isTvPaneMuteEnabled("idle")).toBe(false);
    expect(isTvPaneMuteEnabled("playing")).toBe(true);
  });
});
