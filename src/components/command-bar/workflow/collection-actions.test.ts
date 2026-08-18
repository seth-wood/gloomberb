import { describe, expect, test } from "bun:test";
import type { Dispatch } from "react";
import { createInitialState, type AppAction, type AppState } from "../../../state/app/context";
import { createDefaultConfig } from "../../../types/config";
import type { DataProvider } from "../../../types/data-provider";
import type { TickerRecord } from "../../../types/ticker";
import type { BrokerAdapter } from "../../../types/broker";
import { EventBus } from "../../../plugins/event-bus";
import type { PluginRegistry } from "../../../plugins/registry";
import { createCommandBarCollectionWorkflowActions } from "./collection-actions";

function ticker(symbol: string, portfolios: string[] = []): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange: "NASDAQ",
      currency: "USD",
      name: symbol,
      portfolios,
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
    },
  };
}

function createMembershipHarness(initialTicker: TickerRecord) {
  const state: AppState = {
    ...createInitialState(createDefaultConfig(":memory:")),
    tickers: new Map([[initialTicker.metadata.ticker, initialTicker]]),
  };
  const order: string[] = [];
  const payloads: Array<{ symbol: string; portfolioId: string }> = [];
  const events = new EventBus();
  const pluginRegistry = { events } as PluginRegistry;
  events.on("command-bar:portfolio-membership-persisted", (payload) => {
    order.push("event");
    payloads.push(payload);
  });

  const actions = createCommandBarCollectionWorkflowActions({
    activeCollectionId: "main",
    activeTickerSymbol: initialTicker.metadata.ticker,
    dataProvider: {} as DataProvider,
    dispatch: ((action: AppAction) => {
      expect(action.type).toBe("UPDATE_TICKER");
      order.push("dispatch");
    }) as Dispatch<AppAction>,
    getState: () => state,
    notify: () => {},
    persistConfig: () => {},
    pluginRegistry,
    setActiveCollection: () => {},
    tickerRepository: {
      loadAllTickers: async () => [],
      loadTicker: async () => null,
      saveTicker: async () => {
        order.push("save:start");
        await Promise.resolve();
        order.push("save:end");
      },
      createTicker: async () => initialTicker,
      deleteTicker: async () => {},
    },
  });

  return { actions, order, payloads };
}

describe("command-bar collection workflow actions", () => {
  test("connectBrokerProfile authorizes the broker before syncing positions", async () => {
    const calls: string[] = [];
    const adapter: BrokerAdapter = {
      id: "demo",
      name: "Demo",
      configSchema: [{ key: "host", label: "Host", type: "text", required: true }],
      validate: async () => true,
      importPositions: async () => [],
      connect: async () => {
        calls.push("connect");
      },
    };
    const pluginRegistry = {
      brokers: new Map([["demo", adapter]]),
      createBrokerInstanceFn: async () => {
        calls.push("create");
        return {
          id: "demo-1",
          brokerType: "demo",
          label: "Demo",
          config: { host: "paper" },
          enabled: true,
        };
      },
      syncBrokerInstanceFn: async () => {
        calls.push("sync");
      },
      getConfigFn: () => ({ portfolios: [] }),
    } as unknown as PluginRegistry;

    const actions = createCommandBarCollectionWorkflowActions({
      activeCollectionId: null,
      activeTickerSymbol: null,
      dataProvider: {} as never,
      dispatch: () => {},
      getState: () => ({ config: { portfolios: [] } }) as never,
      notify: () => {},
      persistConfig: () => {},
      pluginRegistry,
      setActiveCollection: () => {},
      tickerRepository: {} as never,
    });

    await actions.connectBrokerProfile("demo", { host: "paper" });
    expect(calls).toEqual(["create", "connect", "sync"]);
  });

  test("emits portfolio membership after the ticker is saved and dispatched", async () => {
    const { actions, order, payloads } = createMembershipHarness(ticker("AAPL"));

    await actions.addTickerMembershipFromWorkflow({
      portfolioId: "main",
      ticker: "AAPL",
    });

    expect(order).toEqual(["save:start", "save:end", "dispatch", "event"]);
    expect(payloads).toEqual([{ symbol: "AAPL", portfolioId: "main" }]);
  });

  test("emits portfolio membership when a resumed AP finds it already durable", async () => {
    const { actions, order, payloads } = createMembershipHarness(ticker("AAPL", ["main"]));

    await actions.addTickerMembershipFromWorkflow({
      portfolioId: "main",
      ticker: "AAPL",
    });

    expect(order).toEqual(["event"]);
    expect(payloads).toEqual([{ symbol: "AAPL", portfolioId: "main" }]);
  });
});
