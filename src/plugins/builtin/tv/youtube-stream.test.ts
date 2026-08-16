import { describe, expect, test } from "bun:test";
import { createTvStreamResolver, type TvStreamResolutionSource } from "./youtube-stream";
import { getTvChannel } from "./channels";

function source(overrides: Partial<TvStreamResolutionSource> = {}): TvStreamResolutionSource {
  return {
    async listLiveCandidates() {
      return [{ videoId: "broadcast-1", title: "Markets Live" }];
    },
    async getStreamInfo(videoId) {
      return {
        videoId,
        isLive: true,
        title: "Bloomberg Markets Live",
        manifestUrl: `https://example.test/${videoId}.m3u8`,
        posterUrl: "https://example.test/poster.jpg",
        expiresAt: 2_000_000,
      };
    },
    ...overrides,
  };
}

describe("TV Live Stream resolution", () => {
  test("resolves a Channel's current playable Live Stream", async () => {
    const resolve = createTvStreamResolver({ source: source(), now: () => 1_000_000 });

    await expect(resolve(getTvChannel("bloomberg"))).resolves.toEqual({
      provider: "youtube",
      sourceId: "bloomberg",
      videoId: "broadcast-1",
      title: "Bloomberg Markets Live",
      manifestUrl: "https://example.test/broadcast-1.m3u8",
      watchUrl: "https://www.youtube.com/watch?v=broadcast-1",
      posterUrl: "https://example.test/poster.jpg",
      resolvedAt: 1_000_000,
      expiresAt: 2_000_000,
    });
  });

  test("a forced Resolution discovers broadcast rotation on the same Channel", async () => {
    let broadcast = 1;
    const resolutionSource = source({
      async listLiveCandidates() {
        return [{ videoId: `broadcast-${broadcast}`, title: `Broadcast ${broadcast}` }];
      },
    });
    const resolve = createTvStreamResolver({ source: resolutionSource, now: () => 1_000_000 });
    const channel = getTvChannel("bloomberg");

    const first = await resolve(channel);
    broadcast = 2;
    const cached = await resolve(channel);
    const rotated = await resolve(channel, { force: true });

    expect(cached.videoId).toBe(first.videoId);
    expect(rotated.videoId).toBe("broadcast-2");
    expect(rotated.sourceId).toBe(channel.id);
  });

  test("skips an unavailable broadcast candidate and resolves the next playable one", async () => {
    const resolve = createTvStreamResolver({
      source: source({
        async listLiveCandidates() {
          return [
            { videoId: "private", title: "Private" },
            { videoId: "broadcast-2", title: "Current broadcast" },
          ];
        },
        async getStreamInfo(videoId) {
          if (videoId === "private") throw new Error("Video unavailable");
          return {
            videoId,
            isLive: true,
            title: "Current broadcast",
            manifestUrl: "https://example.test/current.m3u8",
            expiresAt: 2_000_000,
          };
        },
      }),
      now: () => 1_000_000,
    });

    const stream = await resolve(getTvChannel("yahoo-finance"));

    expect(stream.videoId).toBe("broadcast-2");
  });

  test("reports Resolution as unavailable when a Channel has no playable Live Stream", async () => {
    const resolve = createTvStreamResolver({
      source: source({
        async listLiveCandidates() {
          return [{ videoId: "ended", title: "Ended" }];
        },
        async getStreamInfo(videoId) {
          return { videoId, isLive: false, title: "Ended", expiresAt: 2_000_000 };
        },
      }),
      now: () => 1_000_000,
    });

    await expect(resolve(getTvChannel("cnbc"))).rejects.toThrow(/playable public live stream/i);
  });
});
