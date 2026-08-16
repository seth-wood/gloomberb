import {
  findPaneInstance,
  normalizePaneId,
  TICKER_RESEARCH_PANE_ID,
  type LayoutConfig,
  type PaneInstanceConfig,
} from "../types/config";
import { isPaneInLayout } from "./pane-manager";

export function resolveTickerNavigationReplacementPane(
  layout: LayoutConfig,
  sourcePaneId: string | null,
): PaneInstanceConfig | null {
  const sourceInstance = sourcePaneId ? findPaneInstance(layout, sourcePaneId) : null;
  return sourceInstance?.paneId === TICKER_RESEARCH_PANE_ID && isPaneInLayout(layout, sourceInstance.instanceId)
    ? sourceInstance
    : null;
}

export function isFollowBoundTickerResearchPane(instance: PaneInstanceConfig | null | undefined): boolean {
  if (!instance || instance.paneId !== TICKER_RESEARCH_PANE_ID) return false;
  const binding = instance.binding;
  if (!binding) return false;
  switch (binding.kind) {
    case "follow":
      return true;
    case "fixed":
    case "none":
      return false;
    default: {
      const _exhaustive: never = binding;
      return _exhaustive;
    }
  }
}

export function findFixedTickerPaneForSymbol(
  layout: LayoutConfig,
  paneId: string,
  symbol: string,
): PaneInstanceConfig | null {
  return layout.instances.find((instance) =>
    instance.paneId === normalizePaneId(paneId)
    && instance.binding?.kind === "fixed"
    && instance.binding.symbol === symbol
    && isPaneInLayout(layout, instance.instanceId)
  ) ?? null;
}

export function shouldFocusTickerNavigationTarget({
  sourcePaneId,
  currentFocusedPaneId,
  targetPaneId,
}: {
  sourcePaneId: string | null;
  currentFocusedPaneId: string | null;
  targetPaneId: string | null;
}): boolean {
  if (!sourcePaneId) return true;
  return currentFocusedPaneId === sourcePaneId || currentFocusedPaneId === targetPaneId;
}
