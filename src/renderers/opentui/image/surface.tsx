import { createElement, forwardRef, useCallback, useEffect, useRef, useState, type ForwardedRef } from "react";
import type { NativeChartBitmap } from "../../../components/chart/native/chart-rasterizer";
import { useOptionalPaneInstanceId } from "../../../state/app/context";
import { useNativeRenderer, type ImageSurfaceProps } from "../../../ui";
import {
  resolveCellInsets,
  useKittySupport,
  useNativeSurfaceGeometry,
  useNativeSurfacePublication,
  type NativeSurfaceRenderableNode,
} from "../native-surface";
import { loadOpenTuiImageBitmap } from "./loader";

let nextImageSurfaceId = 1;

function assignRef(ref: ForwardedRef<unknown>, value: unknown) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) {
    (ref as { current: unknown }).current = value;
  }
}

export const OpenTuiImageSurface = forwardRef<unknown, ImageSurfaceProps>(function OpenTuiImageSurface(
  { children, src, alt: _alt, objectFit = "contain", ...props },
  forwardedRef,
) {
  const renderer = useNativeRenderer();
  const paneId = useOptionalPaneInstanceId();
  const surfaceId = useRef(`opentui-image:${nextImageSurfaceId++}`).current;
  const renderableRef = useRef<NativeSurfaceRenderableNode | null>(null);
  const [bitmapState, setBitmapState] = useState<{ key: string; bitmap: NativeChartBitmap } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const imageSrc = typeof src === "string" ? src.trim() : "";
  const resolvedObjectFit = objectFit === "cover" ? "cover" : "contain";
  const kittySupport = useKittySupport(renderer);

  const setRenderableRef = useCallback((node: unknown) => {
    renderableRef.current = node as NativeSurfaceRenderableNode | null;
    assignRef(forwardedRef, node);
  }, [forwardedRef]);

  const geometry = useNativeSurfaceGeometry({
    renderer,
    renderableRef,
    enabled: kittySupport === true && imageSrc !== "",
    insets: resolveCellInsets(props),
  });

  // Decoding is sized to the Surface, so a resize invalidates the decoded image.
  const bitmapKey = geometry
    ? `${imageSrc}\n${resolvedObjectFit}\n${geometry.pixelWidth}x${geometry.pixelHeight}`
    : null;

  useEffect(() => {
    setLoadFailed(false);
    setBitmapState(null);
  }, [imageSrc]);

  useEffect(() => {
    if (!geometry || !bitmapKey || !imageSrc || kittySupport !== true) {
      setBitmapState(null);
      return;
    }

    let cancelled = false;
    setBitmapState((current) => (current?.key === bitmapKey ? current : null));
    loadOpenTuiImageBitmap(imageSrc, {
      width: geometry.pixelWidth,
      height: geometry.pixelHeight,
      objectFit: resolvedObjectFit,
    }).then((bitmap) => {
      if (!cancelled) {
        setLoadFailed(false);
        setBitmapState({ key: bitmapKey, bitmap });
      }
    }).catch(() => {
      if (!cancelled) {
        setLoadFailed(true);
        setBitmapState(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [bitmapKey, geometry, imageSrc, kittySupport, resolvedObjectFit]);

  const decoded = bitmapState && bitmapState.key === bitmapKey ? bitmapState : null;

  useNativeSurfacePublication({
    renderer,
    surfaceId,
    paneId,
    surface: !loadFailed && geometry?.visibleRect && decoded
      ? {
        rect: geometry.rect,
        visibleRect: geometry.visibleRect,
        bitmap: decoded.bitmap,
        bitmapKey: decoded.key,
      }
      : null,
  });

  const showFallback = kittySupport !== true || loadFailed || !geometry || !decoded;

  return (createElement as any)("box", { ...props, ref: setRenderableRef }, showFallback ? children : null);
});
