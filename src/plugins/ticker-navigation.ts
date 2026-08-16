import { resolveCollectionForPane } from "../core/state/app/layout";
import type { AppState } from "../state/app/context";
import {
  findPaneInstance,
  normalizePaneId,
  resolveFollowBindingInstance,
  TICKER_RESEARCH_PANE_ID,
  type LayoutConfig,
  type PaneInstanceConfig,
} from "../types/config";
import { getCollectionTickersFromConfig } from "./builtin/portfolio-list/pane/data";
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

function isCollectionPaneInstance(instance: PaneInstanceConfig): boolean {
  return instance.paneId === "portfolio-list";
}

export function resolveFollowBoundTickerResearchCollectionPane(
  layout: LayoutConfig,
  instance: PaneInstanceConfig,
): PaneInstanceConfig | null {
  if (!isFollowBoundTickerResearchPane(instance)) return null;
  return resolveFollowBindingInstance(layout, instance.instanceId, isCollectionPaneInstance) ?? null;
}

export function isSymbolInCollectionPane(
  state: Pick<AppState, "config" | "paneState" | "tickers">,
  collectionPaneInstanceId: string,
  symbol: string,
): boolean {
  const collectionId = resolveCollectionForPane(state as AppState, collectionPaneInstanceId);
  return getCollectionTickersFromConfig(state.config, state.tickers, collectionId)
    .some((ticker) => ticker.metadata.ticker === symbol);
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
