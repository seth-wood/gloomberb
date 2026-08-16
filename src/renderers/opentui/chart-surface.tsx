import { createElement, forwardRef, useCallback, useEffect, useMemo, useRef, type ForwardedRef, type ReactNode } from "react";
import {
  intersectCellRects,
  renderCrosshairStrips,
  type CellRect,
  type NativeChartBitmap,
} from "../../components/chart/native/chart-rasterizer";
import { scaleLocalPixelCoordinate } from "../../components/chart/core/pointer";
import type { ChartRendererPreference } from "../../components/chart/core/types";
import { useResolvedChartRendererState } from "../../components/chart/native/renderer-selection";
import { getNativeSurfaceManager } from "../../components/chart/native/surface/manager";
import { useOptionalAppSelector, useOptionalPaneInstanceId } from "../../state/app/context";
import { useNativeRenderer, type ChartSurfaceProps } from "../../ui";
import type { ChartCrosshairOverlay } from "../../ui/host";
import {
  useNativeSurfaceGeometry,
  useNativeSurfacePublication,
  type NativeSurfaceRenderableNode,
} from "./native-surface";

let nextChartSurfaceId = 1;

// Crosshair strips must land above the plot they annotate; plots use the kitty default.
const CROSSHAIR_Z_INDEX = 1;

function assignRef(ref: ForwardedRef<unknown>, value: unknown) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) {
    (ref as { current: unknown }).current = value;
  }
}

// ponytail: identity token instead of hashing every pixel — renderers always
// build a new bitmap object per raster, and hashing megabytes per crosshair
// move was the dominant cost. Mutating a bitmap in place would need a hash.
const bitmapTokens = new WeakMap<NativeChartBitmap, string>();
let nextBitmapToken = 1;

function bitmapKey(bitmap: NativeChartBitmap): string {
  const existing = bitmapTokens.get(bitmap);
  if (existing) return existing;
  const token = `${bitmap.width}x${bitmap.height}:${nextBitmapToken++}`;
  bitmapTokens.set(bitmap, token);
  return token;
}

export const OpenTuiChartSurface = forwardRef<unknown, ChartSurfaceProps>(function OpenTuiChartSurface(
  { children, bitmap, bitmaps, crosshair, nativeBitmapsEnabled = true, ...props },
  forwardedRef,
) {
  const renderer = useNativeRenderer();
  const paneId = useOptionalPaneInstanceId();
  const preferredRenderer = useOptionalAppSelector<ChartRendererPreference>(
    (state) => state.config.chartPreferences.renderer,
    "braille",
  );
  const rendererState = useResolvedChartRendererState(preferredRenderer, renderer);
  const nativeSurfacesEnabled = nativeBitmapsEnabled && rendererState.renderer === "kitty";
  const nativeSurfaceManager = useMemo(() => getNativeSurfaceManager(renderer), [renderer]);
  const surfaceId = useRef(`opentui-chart:${nextChartSurfaceId++}`).current;
  const renderableRef = useRef<NativeSurfaceRenderableNode | null>(null);
  // Only the base layer reaches the terminal: each extra layer would need its own
  // kitty surface and z-index. Composite overlays into the bitmap you pass here.
  const firstBitmap = Array.isArray(bitmaps) ? bitmaps[0] : null;
  const nativeBitmap = (firstBitmap ?? bitmap ?? null) as NativeChartBitmap | null;
  const nativeCrosshair = (crosshair ?? null) as ChartCrosshairOverlay | null;
  const nativeBitmapKey = useMemo(() => (nativeBitmap ? bitmapKey(nativeBitmap) : null), [nativeBitmap]);

  const setRenderableRef = useCallback((node: unknown) => {
    renderableRef.current = node as NativeSurfaceRenderableNode | null;
    assignRef(forwardedRef, node);
  }, [forwardedRef]);

  const geometry = useNativeSurfaceGeometry({
    renderer,
    renderableRef,
    enabled: Boolean(nativeSurfacesEnabled && nativeBitmap && nativeBitmapKey),
  });

  useNativeSurfacePublication({
    renderer,
    surfaceId,
    paneId,
    surface: nativeSurfacesEnabled && geometry?.visibleRect && nativeBitmap && nativeBitmapKey
      ? {
        rect: geometry.rect,
        visibleRect: geometry.visibleRect,
        bitmap: nativeBitmap,
        bitmapKey: `${nativeBitmapKey}:${geometry.pixelWidth}x${geometry.pixelHeight}`,
      }
      : null,
  });

  const crosshairSurfaceIds = useMemo(
    () => [`${surfaceId}:crosshair-v`, `${surfaceId}:crosshair-h`] as const,
    [surfaceId],
  );

  useEffect(() => {
    return () => {
      for (const id of crosshairSurfaceIds) nativeSurfaceManager.removeSurface(id);
    };
  }, [crosshairSurfaceIds, nativeSurfaceManager]);

  // Crosshair moves only re-encode two thin strips, leaving the plot image resident.
  useEffect(() => {
    const removeAll = () => {
      for (const id of crosshairSurfaceIds) nativeSurfaceManager.removeSurface(id);
    };
    const visibleRect = geometry?.visibleRect;
    if (!nativeSurfacesEnabled || !nativeCrosshair || !nativeBitmap || !geometry || !visibleRect) {
      removeAll();
      return;
    }

    const { rect } = geometry;
    const strips = renderCrosshairStrips({
      pixelX: scaleLocalPixelCoordinate(nativeCrosshair.pixelX, nativeBitmap.width, geometry.pixelWidth) ?? 0,
      pixelY: scaleLocalPixelCoordinate(nativeCrosshair.pixelY, nativeBitmap.height, geometry.pixelHeight) ?? 0,
      pixelWidth: geometry.pixelWidth,
      pixelHeight: geometry.pixelHeight,
      cols: rect.width,
      rows: rect.height,
      cellWidth: geometry.cellWidth,
      cellHeight: geometry.cellHeight,
      color: nativeCrosshair.color,
      markers: nativeCrosshair.markers?.map((marker) => ({
        pixelY: scaleLocalPixelCoordinate(marker.pixelY, nativeBitmap.height, geometry.pixelHeight) ?? 0,
        color: marker.color,
      })),
    });
    if (strips.length === 0) {
      removeAll();
      return;
    }

    strips.forEach((strip, index) => {
      const id = crosshairSurfaceIds[index];
      if (!id) return;
      const stripRect: CellRect = {
        x: rect.x + strip.rect.x,
        y: rect.y + strip.rect.y,
        width: strip.rect.width,
        height: strip.rect.height,
      };
      const stripVisibleRect = intersectCellRects(stripRect, visibleRect);
      if (!stripVisibleRect) {
        nativeSurfaceManager.removeSurface(id);
        return;
      }
      nativeSurfaceManager.upsertSurface({
        id,
        paneId: paneId ?? "__global__",
        rect: stripRect,
        visibleRect: stripVisibleRect,
        bitmap: strip.bitmap,
        bitmapKey: `${strip.key}@${stripRect.x}:${stripRect.y}:${stripRect.width}x${stripRect.height}`,
        imageZIndex: CROSSHAIR_Z_INDEX,
      });
    });
    renderer.requestRender();
  }, [
    crosshairSurfaceIds,
    geometry,
    nativeCrosshair,
    nativeBitmap,
    nativeSurfaceManager,
    nativeSurfacesEnabled,
    paneId,
    renderer,
  ]);

  const showFallback = !nativeSurfacesEnabled || !geometry || !nativeBitmap;
  return createElement("box" as any, { ...props, ref: setRenderableRef }, showFallback ? children as ReactNode : null);
});
