import { useEffect, useMemo } from "react";
import type { CellRect, NativeChartBitmap } from "../../../components/chart/native/chart-rasterizer";
import { getNativeSurfaceManager } from "../../../components/chart/native/surface/manager";
import type { NativeRendererHost } from "../../../ui";

export interface NativeSurfaceContent {
  rect: CellRect;
  visibleRect: CellRect;
  bitmap: NativeChartBitmap;
  bitmapKey: string;
  imageZIndex?: number;
}

interface NativeSurfacePublicationOptions {
  renderer: NativeRendererHost;
  surfaceId: string;
  paneId: string | null | undefined;
  /** `null` withdraws the surface — while loading, hidden, or fully occluded. */
  surface: NativeSurfaceContent | null;
}

/**
 * Publishes one native surface and guarantees it is withdrawn on unmount, so a
 * torn-down Surface can never leave pixels resident in the terminal.
 */
export function useNativeSurfacePublication({
  renderer,
  surfaceId,
  paneId,
  surface,
}: NativeSurfacePublicationOptions): void {
  const manager = useMemo(() => getNativeSurfaceManager(renderer), [renderer]);
  // Field-level deps, not the wrapper object: callers build that inline every
  // render, and republishing per render would re-request a frame forever.
  const rect = surface?.rect ?? null;
  const visibleRect = surface?.visibleRect ?? null;
  const bitmap = surface?.bitmap ?? null;
  const bitmapKey = surface?.bitmapKey ?? null;
  const imageZIndex = surface?.imageZIndex;

  useEffect(() => {
    return () => {
      manager.removeSurface(surfaceId);
    };
  }, [manager, surfaceId]);

  useEffect(() => {
    if (!rect || !visibleRect || !bitmap || !bitmapKey) {
      manager.removeSurface(surfaceId);
      return;
    }

    manager.upsertSurface({
      id: surfaceId,
      paneId: paneId ?? "__global__",
      rect,
      visibleRect,
      bitmap,
      bitmapKey,
      ...(imageZIndex === undefined ? {} : { imageZIndex }),
    });
    renderer.requestRender();
  }, [bitmap, bitmapKey, imageZIndex, manager, paneId, rect, renderer, surfaceId, visibleRect]);
}
