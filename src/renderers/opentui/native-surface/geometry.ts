import { useEffect, useMemo, useState, type RefObject } from "react";
import {
  computeBitmapSize,
  intersectCellRects,
  type CellRect,
} from "../../../components/chart/native/chart-rasterizer";
import {
  getRenderableCellRect,
  resolveNativeSurfaceVisibleRect,
  type NativeSurfaceRenderableNode as VisibilityNode,
} from "../../../components/chart/native/surface/visibility";
import type { BoxRenderable, NativeRendererHost } from "../../../ui";
import { insetCellRect, type CellInsets } from "./insets";

export interface NativeSurfaceRenderableNode extends BoxRenderable, VisibilityNode {
  x: number;
  y: number;
  width: number;
  height: number;
  parent: NativeSurfaceRenderableNode | null;
  onLifecyclePass: (() => void) | null;
}

export interface NativeSurfaceGeometry {
  /** Where the Surface's pixels belong, in terminal cells. */
  rect: CellRect;
  /** The part of `rect` no ancestor or occluder clips away; `null` means nothing shows. */
  visibleRect: CellRect | null;
  pixelWidth: number;
  pixelHeight: number;
  cellWidth: number;
  cellHeight: number;
}

interface NativeSurfaceGeometryOptions {
  renderer: NativeRendererHost;
  renderableRef: RefObject<NativeSurfaceRenderableNode | null>;
  /** Geometry is only tracked while the Surface can actually draw natively. */
  enabled: boolean;
  insets?: CellInsets | null;
}

function sameRect(left: CellRect | null, right: CellRect | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function sameGeometry(left: NativeSurfaceGeometry | null, right: NativeSurfaceGeometry | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.pixelWidth === right.pixelWidth
    && left.pixelHeight === right.pixelHeight
    && left.cellWidth === right.cellWidth
    && left.cellHeight === right.cellHeight
    && sameRect(left.rect, right.rect)
    && sameRect(left.visibleRect, right.visibleRect);
}

/**
 * Tracks where a native Surface sits and how much of it shows, resynced from the
 * renderer's lifecycle pass so layout changes land in the same frame as the cells.
 */
export function useNativeSurfaceGeometry({
  renderer,
  renderableRef,
  enabled,
  insets = null,
}: NativeSurfaceGeometryOptions): NativeSurfaceGeometry | null {
  const [geometry, setGeometry] = useState<NativeSurfaceGeometry | null>(null);
  // Compared by value: callers resolve insets from box props inline, and a fresh
  // object per render would restart the geometry effect forever.
  const stableInsets = useMemo(
    () => insets,
    [insets?.top, insets?.right, insets?.bottom, insets?.left],
  );

  useEffect(() => {
    const renderable = renderableRef.current;
    if (!renderable || !enabled) {
      setGeometry(null);
      return;
    }

    let mountTimer: Timer | null = null;
    const previousLifecyclePass = renderable.onLifecyclePass;
    const syncGeometry = () => {
      const rect = insetCellRect(getRenderableCellRect(renderable), stableInsets);
      if (!rect || !renderer.resolution || renderer.terminalWidth <= 0 || renderer.terminalHeight <= 0) {
        setGeometry((current) => (current === null ? current : null));
        return;
      }

      const outerVisibleRect = resolveNativeSurfaceVisibleRect(
        renderable,
        renderer.terminalWidth,
        renderer.terminalHeight,
      );
      const size = computeBitmapSize(rect, renderer.resolution, renderer.terminalWidth, renderer.terminalHeight);
      const next: NativeSurfaceGeometry = {
        rect,
        visibleRect: outerVisibleRect ? intersectCellRects(rect, outerVisibleRect) : null,
        pixelWidth: size.pixelWidth,
        pixelHeight: size.pixelHeight,
        cellWidth: size.cellWidth,
        cellHeight: size.cellHeight,
      };
      setGeometry((current) => (sameGeometry(current, next) ? current : next));
    };
    const lifecyclePass = () => {
      previousLifecyclePass?.();
      syncGeometry();
    };

    renderable.onLifecyclePass = lifecyclePass;
    renderer.registerLifecyclePass(renderable);
    syncGeometry();
    // The first pass runs before layout settles, so resync once the mount frame lands.
    mountTimer = setTimeout(() => {
      syncGeometry();
      renderer.requestRender();
    }, 0);

    return () => {
      if (mountTimer) clearTimeout(mountTimer);
      if (renderable.onLifecyclePass === lifecyclePass) {
        renderable.onLifecyclePass = previousLifecyclePass;
      }
      renderer.unregisterLifecyclePass(renderable);
      setGeometry(null);
    };
  }, [enabled, stableInsets, renderableRef, renderer]);

  return geometry;
}
