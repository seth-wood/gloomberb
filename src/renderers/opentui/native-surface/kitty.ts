import { useEffect, useState } from "react";
import { ensureKittySupport, getCachedKittySupport } from "../../../components/chart/native/kitty/support";
import type { NativeRendererHost } from "../../../ui";

/**
 * `null` until the terminal has answered the kitty-graphics query — a Surface
 * must not fall back to cells before then, or it flashes on every mount.
 */
export function useKittySupport(renderer: NativeRendererHost): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(() => getCachedKittySupport(renderer));

  useEffect(() => {
    let cancelled = false;
    setSupported(getCachedKittySupport(renderer));
    ensureKittySupport(renderer).then((value) => {
      if (!cancelled) setSupported(value);
    });
    return () => {
      cancelled = true;
    };
  }, [renderer]);

  return supported;
}
