import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { act } from "react";
import type { RgbaFrame } from "../../media/frame-reader";
import type {
  PlaybackSession,
  PlaybackSessionRegistry,
  StartPlaybackSessionOptions,
} from "../../media/playback-session";
import type { PlaybackSessionState, PlaybackStopReason } from "../../types/media";
import { PLAYBACK_UNEXPECTED_FAILURE_MESSAGE } from "../../media/playback-session";
import { getNativeSurfaceManager } from "../../components/chart/native/surface/manager";
import { createOpenTuiTestRoot } from "./test-utils";
import { OpenTuiMediaSurface } from "./media-surface";

let testSetup: Awaited<ReturnType<typeof createTestRenderer>> | undefined;
let root: ReturnType<typeof createOpenTuiTestRoot> | undefined;
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

function setKittySupport(supported: boolean): void {
  (testSetup!.renderer as { _capabilities: unknown })._capabilities = { kitty_graphics: supported };
  (testSetup!.renderer as { _resolution: unknown })._resolution = { width: 800, height: 400 };
}

function surfaceCount(): number {
  const manager = getNativeSurfaceManager(testSetup!.renderer as never) as unknown as {
    surfaces: Map<string, unknown>;
  };
  return manager.surfaces.size;
}

function createRegistryHarness(options: {
  startDelayMs?: number;
  onStart?: (options: StartPlaybackSessionOptions) => void;
} = {}) {
  const starts: StartPlaybackSessionOptions[] = [];
  const stops: PlaybackStopReason[] = [];
  const mutedCalls: boolean[] = [];
  let frame: RgbaFrame | null = null;
  let current: PlaybackSession | null = null;

  const registry: PlaybackSessionRegistry = {
    get current() {
      return current;
    },
    acquire() {},
    async release() {},
    async start(startOptions) {
      if (current) await current.stop("displaced");
      starts.push(startOptions);
      options.onStart?.(startOptions);
      if (options.startDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.startDelayMs));
      }
      frame = {
        width: startOptions.width,
        height: startOptions.height,
        pixels: new Uint8Array(startOptions.width * startOptions.height * 4).fill(127),
      };
      let state: PlaybackSessionState = "starting";
      let stopReason: PlaybackStopReason | null = null;
      let failureMessage: string | null = null;
      let warning: string | null = null;
      let muted = startOptions.muted ?? false;
      const listeners = new Set<() => void>();
      const session: PlaybackSession = {
        id: `test-session-${starts.length + 1}`,
        surfaceId: startOptions.surfaceId,
        get state() {
          return state;
        },
        get stopReason() {
          return stopReason;
        },
        get failureMessage() {
          return failureMessage;
        },
        get warning() {
          return warning;
        },
        liveStream: startOptions.liveStream,
        takeLatestFrame() {
          const next = frame;
          frame = null;
          if (next && state === "starting") state = "playing";
          return next;
        },
        setVisible() {},
        setMuted(nextMuted: boolean) {
          muted = nextMuted;
          mutedCalls.push(nextMuted);
        },
        setSize() {},
        async stop(reason) {
          stops.push(reason);
          state = "stopped";
          stopReason = reason;
          for (const listener of listeners) listener();
          if (current === session) current = null;
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        fail(message: string) {
          state = "failed";
          failureMessage = message;
          for (const listener of listeners) listener();
        },
        setWarning(message: string | null) {
          warning = message;
          for (const listener of listeners) listener();
        },
      };
      current = session;
      return session;
    },
    async teardown() {},
  };

  return { registry, starts, stops, mutedCalls, get current() { return current; } };
}

async function flushFrames(delayMs = 0): Promise<void> {
  await act(async () => {
    await testSetup!.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await testSetup!.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await testSetup!.renderOnce();
  });
}

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
      await Promise.resolve();
    });
    root = undefined;
  }
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});

describe("OpenTUI Media Surface", () => {
  test("publishes generated moving frames at the Surface size without suspending the renderer", async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 40, height: 12 });
    setKittySupport(true);
    root = createOpenTuiTestRoot(testSetup.renderer);
    const harness = createRegistryHarness();

    act(() => {
      root!.render(
        <OpenTuiMediaSurface
          src="generated:test-pattern"
          title="Test pattern"
          autoPlay
          muted
          width={20}
          height={6}
          sessionRegistry={harness.registry}
          frameIntervalMs={60_000}
        >
          <text>fallback</text>
        </OpenTuiMediaSurface>,
      );
    });
    await flushFrames();

    expect(harness.starts).toHaveLength(1);
    expect(harness.starts[0]?.frameSource).toEqual({
      url: "testsrc2=rate=12",
      inputFormat: "lavfi",
      realtime: true,
      audio: "none",
      fps: 12,
    });
    expect(harness.starts[0]!.width).toBeGreaterThan(0);
    expect(harness.starts[0]!.height).toBeGreaterThan(0);
    expect(surfaceCount()).toBe(1);
    expect(testSetup.renderer.isSuspended).not.toBe(true);
  });

  test("stops the Playback Session and withdraws its Surface when closed", async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 40, height: 12 });
    setKittySupport(true);
    root = createOpenTuiTestRoot(testSetup.renderer);
    const harness = createRegistryHarness();

    act(() => {
      root!.render(
        <OpenTuiMediaSurface
          src="generated:test-pattern"
          autoPlay
          muted
          width={20}
          height={6}
          sessionRegistry={harness.registry}
          frameIntervalMs={60_000}
        />,
      );
    });
    await flushFrames();
    expect(surfaceCount()).toBe(1);

    act(() => root!.unmount());
    root = undefined;
    await flushFrames();

    expect(harness.stops).toEqual(["pane-close"]);
    expect(surfaceCount()).toBe(0);
  });

  test("shows fallback content and starts no process without kitty graphics", async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 40, height: 12 });
    setKittySupport(false);
    root = createOpenTuiTestRoot(testSetup.renderer);
    const harness = createRegistryHarness();

    act(() => {
      root!.render(
        <OpenTuiMediaSurface
          src="generated:test-pattern"
          autoPlay
          width={20}
          height={6}
          sessionRegistry={harness.registry}
          frameIntervalMs={60_000}
        >
          <text>Kitty graphics are required for video.</text>
        </OpenTuiMediaSurface>,
      );
    });
    await flushFrames();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Kitty graphics are");
    expect(frame).toContain("required for video.");
    expect(harness.starts).toHaveLength(0);
    expect(surfaceCount()).toBe(0);
    expect(testSetup.renderer.isSuspended).not.toBe(true);
  });

  test("reports decoder failure, clears the surface, and restarts after refresh", async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 40, height: 12 });
    setKittySupport(true);
    root = createOpenTuiTestRoot(testSetup.renderer);
    const harness = createRegistryHarness();
    const errors: string[] = [];
    const warnings: Array<string | null> = [];
    const states: PlaybackSessionState[] = [];
    let generation = 0;

    act(() => {
      root!.render(
        <OpenTuiMediaSurface
          src="generated:test-pattern"
          autoPlay
          muted
          width={20}
          height={6}
          playbackGeneration={generation}
          sessionRegistry={harness.registry}
          frameIntervalMs={10}
          onError={(message) => errors.push(message)}
          onWarning={(message) => warnings.push(message)}
          onPlaybackStateChange={(state) => states.push(state)}
        />,
      );
    });
    await flushFrames();
    expect(surfaceCount()).toBe(1);

    const session = harness.current as PlaybackSession & {
      fail(message: string): void;
    };
    act(() => {
      session.fail(PLAYBACK_UNEXPECTED_FAILURE_MESSAGE);
    });
    await flushFrames(20);

    expect(errors).toEqual([PLAYBACK_UNEXPECTED_FAILURE_MESSAGE]);
    expect(states).toContain("failed");
    expect(surfaceCount()).toBe(0);

    generation += 1;
    act(() => {
      root!.render(
        <OpenTuiMediaSurface
          src="generated:test-pattern"
          autoPlay
          muted
          width={20}
          height={6}
          playbackGeneration={generation}
          sessionRegistry={harness.registry}
          frameIntervalMs={10}
          onError={(message) => errors.push(message)}
          onWarning={(message) => warnings.push(message)}
          onPlaybackStateChange={(state) => states.push(state)}
        />,
      );
    });
    await flushFrames();

    expect(harness.starts).toHaveLength(2);
    expect(surfaceCount()).toBe(1);
  });

  test("starts the new source when src changes during an in-flight start", async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 40, height: 12 });
    setKittySupport(true);
    root = createOpenTuiTestRoot(testSetup.renderer);
    const harness = createRegistryHarness({ startDelayMs: 40 });
    let src = "generated:test-pattern";

    act(() => {
      root!.render(
        <OpenTuiMediaSurface
          src={src}
          autoPlay
          muted
          width={20}
          height={6}
          sessionRegistry={harness.registry}
          frameIntervalMs={60_000}
        />,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      src = "https://example.test/live.m3u8";
      root!.render(
        <OpenTuiMediaSurface
          src={src}
          autoPlay
          muted
          width={20}
          height={6}
          sessionRegistry={harness.registry}
          frameIntervalMs={60_000}
        />,
      );
      await testSetup!.renderOnce();
    });
    await flushFrames(60);

    expect(harness.starts).toHaveLength(2);
    expect(harness.starts[1]?.liveStream.manifestUrl).toBe("https://example.test/live.m3u8");
  });

  test("forwards silent-audio warnings from the playback session", async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 40, height: 12 });
    setKittySupport(true);
    root = createOpenTuiTestRoot(testSetup.renderer);
    const harness = createRegistryHarness();
    const warnings: Array<string | null> = [];

    act(() => {
      root!.render(
        <OpenTuiMediaSurface
          src="generated:test-pattern"
          autoPlay
          muted
          width={20}
          height={6}
          sessionRegistry={harness.registry}
          frameIntervalMs={10}
          onWarning={(message) => warnings.push(message)}
        />,
      );
    });
    await flushFrames();

    const session = harness.current as PlaybackSession & {
      setWarning(message: string | null): void;
    };
    act(() => {
      session.setWarning("Audio is unavailable; playing silent video.");
    });
    await flushFrames(20);

    expect(warnings).toContain("Audio is unavailable; playing silent video.");
  });

  test("resumes playback after displacement when the displacing surface closes", async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 40, height: 12 });
    setKittySupport(true);
    root = createOpenTuiTestRoot(testSetup.renderer);
    const harness = createRegistryHarness();

    act(() => {
      root!.render(
        <>
          <OpenTuiMediaSurface
            src="generated:test-pattern"
            autoPlay
            muted
            width={20}
            height={6}
            sessionRegistry={harness.registry}
            frameIntervalMs={10}
          />
          <OpenTuiMediaSurface
            src="generated:test-pattern"
            autoPlay
            muted
            width={20}
            height={6}
            sessionRegistry={harness.registry}
            frameIntervalMs={10}
          />
        </>,
      );
    });
    await flushFrames();

    expect(harness.starts).toHaveLength(2);
    expect(harness.stops).toContain("displaced");

    act(() => {
      root!.render(
        <OpenTuiMediaSurface
          src="generated:test-pattern"
          autoPlay
          muted
          width={20}
          height={6}
          sessionRegistry={harness.registry}
          frameIntervalMs={10}
        />,
      );
    });
    await flushFrames(30);

    expect(harness.starts).toHaveLength(3);
    expect(harness.current).not.toBeNull();
  });

  test("restarts playback when playbackGeneration bumps while the session is healthy", async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 40, height: 12 });
    setKittySupport(true);
    root = createOpenTuiTestRoot(testSetup.renderer);
    const harness = createRegistryHarness();
    let generation = 0;

    act(() => {
      root!.render(
        <OpenTuiMediaSurface
          src="generated:test-pattern"
          autoPlay
          muted
          width={20}
          height={6}
          playbackGeneration={generation}
          sessionRegistry={harness.registry}
          frameIntervalMs={10}
        />,
      );
    });
    await flushFrames();
    expect(harness.starts).toHaveLength(1);

    generation += 1;
    act(() => {
      root!.render(
        <OpenTuiMediaSurface
          src="generated:test-pattern"
          autoPlay
          muted
          width={20}
          height={6}
          playbackGeneration={generation}
          sessionRegistry={harness.registry}
          frameIntervalMs={10}
        />,
      );
    });
    await flushFrames();

    expect(harness.starts).toHaveLength(2);
    expect(harness.current).not.toBeNull();
    expect(surfaceCount()).toBe(1);
  });

  test("does not bind a session that completes after pause during an in-flight start", async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 40, height: 12 });
    setKittySupport(true);
    root = createOpenTuiTestRoot(testSetup.renderer);
    const harness = createRegistryHarness({ startDelayMs: 40 });
    const mediaRef: { current: import("../../ui").MediaSurfaceHandle | null } = { current: null };
    const states: PlaybackSessionState[] = [];

    act(() => {
      root!.render(
        <OpenTuiMediaSurface
          src="generated:test-pattern"
          autoPlay
          muted
          width={20}
          height={6}
          sessionRegistry={harness.registry}
          frameIntervalMs={60_000}
          mediaHandleRef={mediaRef}
          onPlaybackStateChange={(state) => states.push(state)}
        />,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      mediaRef.current?.pause();
      await testSetup!.renderOnce();
    });
    await flushFrames(60);

    expect(harness.current).toBeNull();
    expect(harness.stops.filter((reason) => reason === "pane-close").length).toBeGreaterThanOrEqual(1);
    expect(states).toContain("stopped");
    expect(surfaceCount()).toBe(0);
  });

  test("passes renewLiveStream to the registry for manifest playback", async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 40, height: 12 });
    setKittySupport(true);
    root = createOpenTuiTestRoot(testSetup.renderer);
    const harness = createRegistryHarness();
    const liveStream = {
      provider: "youtube" as const,
      sourceId: "bloomberg",
      videoId: "vid",
      title: "Bloomberg Live",
      manifestUrl: "https://example.test/live.m3u8",
      watchUrl: "https://youtube.com/watch?v=vid",
      resolvedAt: Date.now(),
      expiresAt: Date.now() + 3_600_000,
    };
    const renewLiveStream = async () => liveStream;

    act(() => {
      root!.render(
        <OpenTuiMediaSurface
          src={liveStream.manifestUrl}
          liveStream={liveStream}
          renewLiveStream={renewLiveStream}
          autoPlay
          muted
          width={20}
          height={6}
          sessionRegistry={harness.registry}
          frameIntervalMs={60_000}
        />,
      );
    });
    await flushFrames();

    expect(harness.starts).toHaveLength(1);
    expect(harness.starts[0]?.liveStream).toEqual(liveStream);
    expect(harness.starts[0]?.renewLiveStream).toBe(renewLiveStream);
    expect(harness.starts[0]?.frameSource).toBeUndefined();
  });

  test("toggleMuted flips from the live mute state before React re-renders", async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 40, height: 12 });
    setKittySupport(true);
    root = createOpenTuiTestRoot(testSetup.renderer);
    const harness = createRegistryHarness();
    const mediaRef: { current: import("../../ui").MediaSurfaceHandle | null } = { current: null };
    const mutedStates: boolean[] = [];

    act(() => {
      root!.render(
        <OpenTuiMediaSurface
          src="generated:test-pattern"
          autoPlay
          muted
          width={20}
          height={6}
          sessionRegistry={harness.registry}
          frameIntervalMs={60_000}
          mediaHandleRef={mediaRef}
          onMutedChange={(nextMuted) => mutedStates.push(nextMuted)}
        />,
      );
    });
    await flushFrames();

    expect(mediaRef.current?.toggleMuted()).toBe(false);
    expect(mediaRef.current?.toggleMuted()).toBe(true);
    expect(harness.mutedCalls).toEqual([false, true]);
    expect(mutedStates).toEqual([false, true]);
  });

  test("does not show kitty fallback text while awaiting the first frame", async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 40, height: 12 });
    setKittySupport(true);
    root = createOpenTuiTestRoot(testSetup.renderer);
    const harness = createRegistryHarness({ startDelayMs: 40 });

    act(() => {
      root!.render(
        <OpenTuiMediaSurface
          src="generated:test-pattern"
          autoPlay
          muted
          width={20}
          height={6}
          sessionRegistry={harness.registry}
          frameIntervalMs={60_000}
        >
          <text>Kitty graphics are required for video.</text>
        </OpenTuiMediaSurface>,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await testSetup!.renderOnce();
    });

    const bufferingFrame = testSetup.captureCharFrame();
    expect(bufferingFrame).not.toContain("Kitty graphics are");
    expect(bufferingFrame).not.toContain("required for video.");

    await flushFrames(60);
    expect(surfaceCount()).toBe(1);
    expect(harness.current).not.toBeNull();
  });
});
