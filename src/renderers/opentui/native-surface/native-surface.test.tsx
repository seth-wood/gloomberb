import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { act, createElement, useCallback, useRef } from "react";
import type { CellRect } from "../../../components/chart/native/chart-rasterizer";
import { getNativeSurfaceManager } from "../../../components/chart/native/surface/manager";
import { useNativeRenderer } from "../../../ui";
import { createOpenTuiTestRoot } from "../test-utils";
import {
  resolveCellInsets,
  useKittySupport,
  useNativeSurfaceGeometry,
  useNativeSurfacePublication,
  type NativeSurfaceRenderableNode,
} from "./index";

let testSetup: Awaited<ReturnType<typeof createTestRenderer>> | undefined;
let root: ReturnType<typeof createOpenTuiTestRoot> | undefined;
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

const bitmap = {
  width: 4,
  height: 4,
  pixels: new Uint8Array(4 * 4 * 4).fill(255),
};

const SURFACE_ID = "test-native-surface";

function setNativeRendererReady(): void {
  (testSetup!.renderer as { _capabilities: unknown })._capabilities = { kitty_graphics: true };
  (testSetup!.renderer as { _resolution: unknown })._resolution = { width: 800, height: 400 };
}

function surfaces(): Map<string, { snapshot: { rect: CellRect; visibleRect: CellRect | null } }> {
  const manager = getNativeSurfaceManager(testSetup!.renderer as never) as unknown as {
    surfaces: Map<string, { snapshot: { rect: CellRect; visibleRect: CellRect | null } }>;
  };
  return manager.surfaces;
}

async function flushFrames(): Promise<void> {
  await act(async () => {
    await testSetup!.renderOnce();
    await testSetup!.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await testSetup!.renderOnce();
  });
}

/** A Surface that is not the image Surface, built only from the shared machinery. */
function ProbeSurface(boxProps: Record<string, unknown>) {
  const renderer = useNativeRenderer();
  const renderableRef = useRef<NativeSurfaceRenderableNode | null>(null);
  const setRenderableRef = useCallback((node: unknown) => {
    renderableRef.current = node as NativeSurfaceRenderableNode | null;
  }, []);
  const kittySupport = useKittySupport(renderer);
  const geometry = useNativeSurfaceGeometry({
    renderer,
    renderableRef,
    enabled: kittySupport === true,
    insets: resolveCellInsets(boxProps),
  });

  useNativeSurfacePublication({
    renderer,
    surfaceId: SURFACE_ID,
    paneId: null,
    surface: geometry?.visibleRect
      ? {
        rect: geometry.rect,
        visibleRect: geometry.visibleRect,
        bitmap,
        bitmapKey: `probe:${geometry.pixelWidth}x${geometry.pixelHeight}`,
      }
      : null,
  });

  return createElement("box" as any, { ...boxProps, ref: setRenderableRef });
}

afterEach(() => {
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = undefined;
  }
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});

describe("native surface machinery", () => {
  test("publishes a surface inset by the renderable's border and padding", async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 40, height: 12 });
    setNativeRendererReady();
    root = createOpenTuiTestRoot(testSetup.renderer);

    act(() => {
      root!.render(<ProbeSurface width={20} height={6} border paddingX={2} />);
    });
    await flushFrames();

    const snapshot = surfaces().get(SURFACE_ID)?.snapshot;
    expect(snapshot?.rect).toEqual({ x: 3, y: 1, width: 14, height: 4 });
    expect(snapshot?.visibleRect).toEqual({ x: 3, y: 1, width: 14, height: 4 });
  });

  test("removes the published surface when the Surface unmounts", async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 40, height: 12 });
    setNativeRendererReady();
    root = createOpenTuiTestRoot(testSetup.renderer);

    act(() => {
      root!.render(<ProbeSurface width={20} height={6} />);
    });
    await flushFrames();
    expect(surfaces().has(SURFACE_ID)).toBe(true);

    act(() => {
      root!.unmount();
    });
    root = undefined;
    await flushFrames();

    expect(surfaces().has(SURFACE_ID)).toBe(false);
  });
});
