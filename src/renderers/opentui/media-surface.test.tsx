import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { act } from "react";
import type { RgbaFrame } from "../../media/frame-reader";
import type {
  PlaybackSession,
  PlaybackSessionRegistry,
  StartPlaybackSessionOptions,
} from "../../media/playback-session";
import type { PlaybackStopReason } from "../../types/media";
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

function createRegistryHarness() {
  const starts: StartPlaybackSessionOptions[] = [];
  const stops: PlaybackStopReason[] = [];
  let frame: RgbaFrame | null = null;
  let current: PlaybackSession | null = null;

  const registry: PlaybackSessionRegistry = {
    get current() {
      return current;
    },
    acquire() {},
    async release() {},
    async start(options) {
      starts.push(options);
      frame = {
        width: options.width,
        height: options.height,
        pixels: new Uint8Array(options.width * options.height * 4).fill(127),
      };
      const session: PlaybackSession = {
        id: "test-session",
        surfaceId: options.surfaceId,
        state: "starting",
        stopReason: null,
        liveStream: options.liveStream,
        takeLatestFrame() {
          const next = frame;
          frame = null;
          return next;
        },
        setVisible() {},
        setMuted() {},
        setSize() {},
        async stop(reason) {
          stops.push(reason);
          if (current === session) current = null;
        },
        subscribe() {
          return () => {};
        },
      };
      current = session;
      return session;
    },
    async teardown() {},
  };

  return { registry, starts, stops };
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
});
