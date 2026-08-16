import { describe, expect, test } from "bun:test";
import { deriveTvPaneStatus } from "./pane-status";

describe("TvPane footer integration", () => {
  test("reports live when resolved and idle", () => {
    const status = deriveTvPaneStatus({
      channelName: "Bloomberg",
      resolution: "resolved",
      resolutionError: null,
      playbackState: "idle",
      stopReason: null,
      playbackError: null,
      playbackWarning: null,
      hasStream: true,
    });
    expect(status.text).toBe("live");
    expect(status.tone).toBe("value");
  });
});
