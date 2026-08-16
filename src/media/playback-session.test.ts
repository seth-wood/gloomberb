import { afterEach, describe, expect, test } from "bun:test";
import type { FrameReader, RgbaFrame, StartFrameReaderOptions } from "./frame-reader";
import {
  createPlaybackSessionRegistry,
  LIVE_STREAM_RENEWAL_MARGIN_MS,
  PlaybackRegistryShutdownError,
  PLAYBACK_PIPELINE_RESTART_RETRY_MS,
  PLAYBACK_RESIZE_DEBOUNCE_MS,
  type PlaybackSession,
  type PlaybackSessionRegistry,
} from "./playback-session.ts";
import type { PlaybackSessionState, ResolvedLiveStream } from "../types/media";

const WIDTH = 4;
const HEIGHT = 2;

const registries: PlaybackSessionRegistry[] = [];

afterEach(async () => {
  await Promise.all(registries.splice(0).map((registry) => registry.teardown()));
});

function liveStream(overrides: Partial<ResolvedLiveStream> = {}): ResolvedLiveStream {
  return {
    provider: "youtube",
    sourceId: "bloomberg",
    videoId: "vid",
    title: "Live",
    manifestUrl: "https://example.test/live.m3u8",
    watchUrl: "https://youtube.com/watch?v=vid",
    resolvedAt: 0,
    expiresAt: 3_600_000,
    ...overrides,
  };
}

function frame(): RgbaFrame {
  return { width: WIDTH, height: HEIGHT, pixels: new Uint8Array(WIDTH * HEIGHT * 4) };
}

function createManualClock(start = 0) {
  let now = start;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();

  return {
    now: () => now,
    schedule(callback: () => void, delayMs: number) {
      const id = ++nextId;
      timers.set(id, { at: now + delayMs, callback });
      return {
        cancel() {
          timers.delete(id);
        },
      };
    },
    advance(ms: number) {
      const target = now + ms;
      while (true) {
        let due: { id: number; at: number; callback: () => void } | null = null;
        for (const [id, timer] of timers) {
          if (timer.at > target) continue;
          if (!due || timer.at < due.at || (timer.at === due.at && id < due.id)) {
            due = { id, at: timer.at, callback: timer.callback };
          }
        }
        if (!due) {
          now = target;
          return;
        }
        timers.delete(due.id);
        now = due.at;
        due.callback();
      }
    },
  };
}

class FakeFrameReader implements FrameReader {
  latest: RgbaFrame | null = null;
  stopped = false;
  readonly pid = 4242;
  readonly audio = "system" as const;
  warning: string | null = null;
  private resolveDone: () => void = () => {};
  readonly done: Promise<void>;
  private releaseStop: (() => void) | null = null;
  readonly stopGate = new Promise<void>((resolve) => {
    this.releaseStop = resolve;
  });

  constructor(private readonly slowStop = false) {
    this.done = new Promise<void>((resolve) => {
      this.resolveDone = resolve;
    });
  }

  takeLatestFrame(): RgbaFrame | null {
    const next = this.latest;
    this.latest = null;
    return next;
  }

  finish(): void {
    this.resolveDone();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.slowStop) await this.stopGate;
    this.resolveDone();
  }

  completeStop(): void {
    this.releaseStop?.();
  }
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createHarness(options: { slowStop?: boolean } = {}) {
  const clock = createManualClock();
  const readers: FakeFrameReader[] = [];
  const starts: StartFrameReaderOptions[] = [];
  const registry = createPlaybackSessionRegistry({
    now: clock.now,
    schedule: clock.schedule,
    startFrameReader: (startOptions) => {
      starts.push(startOptions);
      const reader = new FakeFrameReader(options.slowStop && readers.length === 0);
      readers.push(reader);
      return reader;
    },
  });
  registries.push(registry);
  return { clock, readers, registry, starts };
}

async function startPlaying(
  registry: PlaybackSessionRegistry,
  readers: FakeFrameReader[],
  options: Parameters<PlaybackSessionRegistry["start"]>[0],
): Promise<PlaybackSession> {
  const session = await registry.start(options);
  expect(session.state).toBe("starting");
  readers.at(-1)!.latest = frame();
  expect(session.takeLatestFrame()).not.toBeNull();
  expect(session.state).toBe("playing");
  return session;
}

describe("playback session registry", () => {
  test("reports a missing ffmpeg install instead of a generic playback failure", async () => {
    const clock = createManualClock();
    const registry = createPlaybackSessionRegistry({
      now: clock.now,
      schedule: clock.schedule,
      startFrameReader: () => {
        throw new Error("ffmpeg is required for terminal TV playback. Install ffmpeg and try again.");
      },
    });
    registries.push(registry);
    const session = await registry.start({
      surfaceId: "pane-a",
      liveStream: liveStream(),
      width: WIDTH,
      height: HEIGHT,
    });
    expect(session.state).toBe("failed");
    expect(session.failureMessage).toContain("ffmpeg is required");
  });

  test("starts a generated frame source instead of the Live Stream manifest", async () => {
    const { registry, starts } = createHarness();

    await registry.start({
      surfaceId: "tv-test-pattern",
      liveStream: liveStream(),
      width: WIDTH,
      height: HEIGHT,
      frameSource: {
        url: "testsrc2=rate=12",
        inputFormat: "lavfi",
        realtime: true,
        audio: "none",
      },
    });

    expect(starts).toEqual([{
      url: "testsrc2=rate=12",
      width: WIDTH,
      height: HEIGHT,
      muted: false,
      inputFormat: "lavfi",
      realtime: true,
      audio: "none",
    }]);
  });

  test("starting a second session displaces the first and reports why", async () => {
    const { registry, readers } = createHarness();
    const first = await startPlaying(registry, readers, {
      surfaceId: "pane-a",
      liveStream: liveStream(),
      width: WIDTH,
      height: HEIGHT,
    });
    const firstReader = readers[0]!;

    const second = await startPlaying(registry, readers, {
      surfaceId: "pane-b",
      liveStream: liveStream({ videoId: "other", manifestUrl: "https://example.test/other.m3u8" }),
      width: WIDTH,
      height: HEIGHT,
    });

    expect(first.state).toBe("stopped");
    expect(first.stopReason).toBe("displaced");
    expect(firstReader.stopped).toBe(true);
    expect(registry.current).toBe(second);
    expect(registry.current).not.toBe(first);
  });

  test("serializes concurrent starts so an in-flight displacement cannot orphan an interim session", async () => {
    const { registry, readers } = createHarness({ slowStop: true });
    await startPlaying(registry, readers, {
      surfaceId: "pane-a",
      liveStream: liveStream(),
      width: WIDTH,
      height: HEIGHT,
    });
    const firstReader = readers[0]!;

    const firstDisplacement = registry.start({
      surfaceId: "pane-b",
      liveStream: liveStream({ videoId: "b", manifestUrl: "https://example.test/b.m3u8" }),
      width: WIDTH,
      height: HEIGHT,
    });
    await flush();
    expect(firstReader.stopped).toBe(true);
    expect(readers).toHaveLength(1);

    const secondDisplacement = registry.start({
      surfaceId: "pane-c",
      liveStream: liveStream({ videoId: "c", manifestUrl: "https://example.test/c.m3u8" }),
      width: WIDTH,
      height: HEIGHT,
    });
    await flush();
    expect(readers).toHaveLength(1);

    firstReader.completeStop();
    const [secondSession, thirdSession] = await Promise.all([firstDisplacement, secondDisplacement]);

    expect(secondSession).not.toBe(thirdSession);
    expect(readers).toHaveLength(3);
    expect(readers[1]!.stopped).toBe(true);
    expect(registry.current).toBe(thirdSession);
    expect(readers[2]!.stopped).toBe(false);
  });

  test("a hidden muted session stops its process, then resumes at the live edge as stalled", async () => {
    const { registry, readers } = createHarness();
    const session = await startPlaying(registry, readers, {
      surfaceId: "pane-a",
      liveStream: liveStream(),
      width: WIDTH,
      height: HEIGHT,
      muted: true,
    });
    const running = readers[0]!;

    session.setVisible(false);
    await flush();

    expect(session.state).toBe("stopped");
    expect(session.stopReason).toBe("hidden-muted");
    expect(running.stopped).toBe(true);
    expect(registry.current).toBe(session);

    session.setVisible(true);
    await flush();

    expect(session.state).toBe("stalled");
    expect(session.stopReason).toBeNull();
    expect(readers).toHaveLength(2);
    expect(readers[1]!.stopped).toBe(false);

    readers[1]!.latest = frame();
    expect(session.takeLatestFrame()).not.toBeNull();
    expect(session.state).toBe("playing");
    expect(session.state).not.toBe("failed");
  });

  test("a hidden audible session keeps its process running", async () => {
    const { registry, readers } = createHarness();
    const session = await startPlaying(registry, readers, {
      surfaceId: "pane-a",
      liveStream: liveStream(),
      width: WIDTH,
      height: HEIGHT,
      muted: false,
    });

    session.setVisible(false);
    await flush();

    expect(session.state).toBe("playing");
    expect(readers[0]!.stopped).toBe(false);
    expect(registry.current).toBe(session);

    session.setVisible(true);
    await flush();

    expect(session.state).toBe("playing");
    expect(readers).toHaveLength(1);
    expect(readers[0]!.stopped).toBe(false);
  });

  test("muting a hidden session stops it; unmuting keeps audio running", async () => {
    const { registry, readers } = createHarness();
    const session = await startPlaying(registry, readers, {
      surfaceId: "pane-a",
      liveStream: liveStream(),
      width: WIDTH,
      height: HEIGHT,
      muted: false,
    });

    session.setVisible(false);
    session.setMuted(true);
    await flush();

    expect(session.state).toBe("stopped");
    expect(session.stopReason).toBe("hidden-muted");
    expect(readers[0]!.stopped).toBe(true);

    session.setMuted(false);
    await flush();

    expect(session.state).toBe("stalled");
    expect(readers).toHaveLength(2);
    expect(readers[1]!.stopped).toBe(false);
  });

  test("resize reports stalled then playing, and rapid resizes restart once", async () => {
    const { clock, registry, readers, starts } = createHarness();
    const session = await startPlaying(registry, readers, {
      surfaceId: "pane-a",
      liveStream: liveStream(),
      width: WIDTH,
      height: HEIGHT,
    });
    const states: PlaybackSessionState[] = [];
    session.subscribe(() => {
      states.push(session.state);
    });

    session.setSize(8, 4);
    session.setSize(12, 6);
    session.setSize(16, 8);
    expect(readers).toHaveLength(1);

    clock.advance(PLAYBACK_RESIZE_DEBOUNCE_MS - 1);
    expect(readers).toHaveLength(1);

    clock.advance(1);
    await flush();

    expect(states).toContain("stalled");
    expect(states).not.toContain("failed");
    expect(readers).toHaveLength(2);
    expect(readers[0]!.stopped).toBe(true);
    expect(starts[1]).toMatchObject({ width: 16, height: 8 });

    readers[1]!.latest = frame();
    expect(session.takeLatestFrame()).not.toBeNull();
    expect(session.state).toBe("playing");
  });

  test("renewal is requested ahead of expiry and restarts as stalled, never failed", async () => {
    const { clock, registry, readers, starts } = createHarness();
    const renewed = liveStream({
      videoId: "next",
      manifestUrl: "https://example.test/next.m3u8",
      resolvedAt: LIVE_STREAM_RENEWAL_MARGIN_MS,
      expiresAt: LIVE_STREAM_RENEWAL_MARGIN_MS + 3_600_000,
    });
    let renewals = 0;
    const session = await startPlaying(registry, readers, {
      surfaceId: "pane-a",
      liveStream: liveStream({ expiresAt: LIVE_STREAM_RENEWAL_MARGIN_MS + 5_000 }),
      width: WIDTH,
      height: HEIGHT,
      renewLiveStream: async () => {
        renewals += 1;
        return renewed;
      },
    });
    const states: PlaybackSessionState[] = [];
    session.subscribe(() => {
      states.push(session.state);
    });

    clock.advance(4_999);
    await flush();
    expect(renewals).toBe(0);

    clock.advance(1);
    await flush();

    expect(renewals).toBe(1);
    expect(states).toContain("stalled");
    expect(states).not.toContain("failed");
    expect(session.liveStream.manifestUrl).toBe(renewed.manifestUrl);
    expect(starts[1]?.url).toBe(renewed.manifestUrl);

    readers[1]!.latest = frame();
    expect(session.takeLatestFrame()).not.toBeNull();
    expect(session.state).toBe("playing");
  });

  test("teardown keeps the registry occupied until the frame reader finishes stopping", async () => {
    const { registry, readers } = createHarness({ slowStop: true });
    await startPlaying(registry, readers, {
      surfaceId: "pane-a",
      liveStream: liveStream(),
      width: WIDTH,
      height: HEIGHT,
    });
    const firstReader = readers[0]!;

    const teardownDone = registry.teardown();
    await flush();
    expect(registry.current).not.toBeNull();
    expect(firstReader.stopped).toBe(true);
    expect(readers).toHaveLength(1);

    const startDone = registry.start({
      surfaceId: "pane-b",
      liveStream: liveStream({ videoId: "other", manifestUrl: "https://example.test/other.m3u8" }),
      width: WIDTH,
      height: HEIGHT,
    });
    await flush();
    expect(readers).toHaveLength(1);

    firstReader.completeStop();
    await expect(startDone).rejects.toBeInstanceOf(PlaybackRegistryShutdownError);
    await teardownDone;

    expect(readers).toHaveLength(1);
    expect(readers[0]!.stopped).toBe(true);
    expect(registry.current).toBeNull();
  });

  test("teardown during start displacement waits and suppresses the replacement session", async () => {
    const { registry, readers } = createHarness({ slowStop: true });
    await startPlaying(registry, readers, {
      surfaceId: "pane-a",
      liveStream: liveStream(),
      width: WIDTH,
      height: HEIGHT,
    });
    const firstReader = readers[0]!;

    const startDone = registry.start({
      surfaceId: "pane-b",
      liveStream: liveStream({ videoId: "other", manifestUrl: "https://example.test/other.m3u8" }),
      width: WIDTH,
      height: HEIGHT,
    });
    await flush();
    expect(firstReader.stopped).toBe(true);
    expect(readers).toHaveLength(1);

    const teardownDone = registry.teardown();
    await flush();

    firstReader.completeStop();
    await expect(startDone).rejects.toBeInstanceOf(PlaybackRegistryShutdownError);
    await teardownDone;

    expect(readers).toHaveLength(1);
    expect(registry.current).toBeNull();
  });

  test("reacquire during release teardown stops only the prior session", async () => {
    const { registry, readers } = createHarness({ slowStop: true });
    registry.acquire();
    await startPlaying(registry, readers, {
      surfaceId: "pane-a",
      liveStream: liveStream(),
      width: WIDTH,
      height: HEIGHT,
    });
    const firstReader = readers[0]!;

    const releaseDone = registry.release();
    await flush();
    expect(firstReader.stopped).toBe(true);

    registry.acquire();
    const startDone = registry.start({
      surfaceId: "pane-b",
      liveStream: liveStream({ videoId: "other", manifestUrl: "https://example.test/other.m3u8" }),
      width: WIDTH,
      height: HEIGHT,
    });
    await flush();

    firstReader.completeStop();
    const next = await startDone;
    readers.at(-1)!.latest = frame();
    expect(next.takeLatestFrame()).not.toBeNull();
    await releaseDone;

    expect(next.state).toBe("playing");
    expect(registry.current).toBe(next);
    expect(readers[1]!.stopped).toBe(false);
  });

  test("release only tears down when the last services owner is released", async () => {
    const { registry, readers } = createHarness();
    registry.acquire();
    await startPlaying(registry, readers, {
      surfaceId: "pane-a",
      liveStream: liveStream(),
      width: WIDTH,
      height: HEIGHT,
    });

    registry.acquire();
    await registry.release();
    expect(readers[0]!.stopped).toBe(false);
    expect(registry.current).not.toBeNull();

    await registry.release();
    expect(readers[0]!.stopped).toBe(true);
    expect(registry.current).toBeNull();
  });

  test("pane close and app teardown stop the process and empty the registry", async () => {
    const { registry, readers } = createHarness();
    const session = await startPlaying(registry, readers, {
      surfaceId: "pane-a",
      liveStream: liveStream(),
      width: WIDTH,
      height: HEIGHT,
    });

    await session.stop("pane-close");
    expect(session.state).toBe("stopped");
    expect(session.stopReason).toBe("pane-close");
    expect(readers[0]!.stopped).toBe(true);
    expect(registry.current).toBeNull();

    const next = await startPlaying(registry, readers, {
      surfaceId: "pane-a",
      liveStream: liveStream(),
      width: WIDTH,
      height: HEIGHT,
    });
    await registry.teardown();
    expect(next.state).toBe("stopped");
    expect(next.stopReason).toBe("teardown");
    expect(readers[1]!.stopped).toBe(true);
    expect(registry.current).toBeNull();
  });

  test("a failed renewal keeps the current session playing", async () => {
    const { clock, registry, readers } = createHarness();
    const session = await startPlaying(registry, readers, {
      surfaceId: "pane-a",
      liveStream: liveStream({ expiresAt: LIVE_STREAM_RENEWAL_MARGIN_MS + 5_000 }),
      width: WIDTH,
      height: HEIGHT,
      renewLiveStream: async () => {
        throw new Error("resolver unavailable");
      },
    });

    clock.advance(5_000);
    await flush();

    expect(session.state).toBe("playing");
    expect(readers).toHaveLength(1);
    expect(readers[0]!.stopped).toBe(false);
  });

  test("an unexpected process death fails the session without leaving it playing", async () => {
    const { registry, readers } = createHarness();
    const session = await startPlaying(registry, readers, {
      surfaceId: "pane-a",
      liveStream: liveStream(),
      width: WIDTH,
      height: HEIGHT,
    });

    readers[0]!.finish();
    await flush();

    expect(session.state).toBe("failed");
    expect(session.failureMessage).toMatch(/stopped unexpectedly/i);
    expect(registry.current).toBe(session);
  });

  test("stopping a failed session releases the registry slot", async () => {
    const { registry, readers } = createHarness();
    const session = await startPlaying(registry, readers, {
      surfaceId: "pane-a",
      liveStream: liveStream(),
      width: WIDTH,
      height: HEIGHT,
    });

    readers[0]!.finish();
    await flush();

    expect(session.state).toBe("failed");
    expect(registry.current).toBe(session);

    await session.stop("pane-close");
    expect(session.stopReason).toBe("pane-close");
    expect(registry.current).toBeNull();
  });

  test("displacing a failed session releases it from the registry", async () => {
    const { registry, readers } = createHarness();
    await startPlaying(registry, readers, {
      surfaceId: "pane-a",
      liveStream: liveStream(),
      width: WIDTH,
      height: HEIGHT,
    });

    readers[0]!.finish();
    await flush();
    expect(registry.current?.state).toBe("failed");

    const next = await registry.start({
      surfaceId: "pane-b",
      liveStream: liveStream(),
      width: WIDTH,
      height: HEIGHT,
    });
    expect(registry.current).toBe(next);
    expect(registry.current?.surfaceId).toBe("pane-b");
  });

  test("forwards a silent-audio warning from the frame reader", async () => {
    const { registry, readers } = createHarness();
    const session = await startPlaying(registry, readers, {
      surfaceId: "pane-a",
      liveStream: liveStream(),
      width: WIDTH,
      height: HEIGHT,
    });

    readers[0]!.warning = "Audio is unavailable; playing silent video.";
    expect(session.warning).toBeNull();

    session.takeLatestFrame();
    expect(session.warning).toMatch(/silent video/i);
  });

  test("a failed restart retries until the pipeline starts again without reporting failed", async () => {
    const clock = createManualClock();
    const readers: FakeFrameReader[] = [];
    let starts = 0;
    const registry = createPlaybackSessionRegistry({
      now: clock.now,
      schedule: clock.schedule,
      startFrameReader: () => {
        starts += 1;
        if (starts === 2) throw new Error("ffmpeg failed to start");
        const reader = new FakeFrameReader();
        readers.push(reader);
        return reader;
      },
    });
    registries.push(registry);

    const session = await startPlaying(registry, readers, {
      surfaceId: "pane-a",
      liveStream: liveStream(),
      width: WIDTH,
      height: HEIGHT,
    });
    const states: PlaybackSessionState[] = [];
    session.subscribe(() => {
      states.push(session.state);
    });

    session.setSize(8, 4);
    clock.advance(PLAYBACK_RESIZE_DEBOUNCE_MS);
    await flush();

    expect(session.state).toBe("stalled");
    expect(states).not.toContain("failed");
    expect(readers).toHaveLength(1);

    clock.advance(PLAYBACK_PIPELINE_RESTART_RETRY_MS);
    await flush();

    expect(readers).toHaveLength(2);
    readers[1]!.latest = frame();
    expect(session.takeLatestFrame()).not.toBeNull();
    expect(session.state).toBe("playing");
    expect(states).not.toContain("failed");
  });
});

