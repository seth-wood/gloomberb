import type { CellRect } from "../../../components/chart/native/chart-rasterizer";

export interface CellInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function readInset(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** Box props eat into the Surface: pixels must land inside the border and padding, not on them. */
export function resolveCellInsets(props: Record<string, unknown>): CellInsets {
  const border = props.border ? 1 : 0;
  const padding = readInset(props.padding);
  const paddingX = readInset(props.paddingX ?? padding);
  const paddingY = readInset(props.paddingY ?? padding);
  return {
    top: border + readInset(props.paddingTop ?? paddingY),
    right: border + readInset(props.paddingRight ?? paddingX),
    bottom: border + readInset(props.paddingBottom ?? paddingY),
    left: border + readInset(props.paddingLeft ?? paddingX),
  };
}

export function insetCellRect(rect: CellRect, insets: CellInsets | null): CellRect | null {
  if (!insets) return rect;
  const width = rect.width - insets.left - insets.right;
  const height = rect.height - insets.top - insets.bottom;
  if (width <= 0 || height <= 0) return null;
  return {
    x: rect.x + insets.left,
    y: rect.y + insets.top,
    width,
    height,
  };
}
