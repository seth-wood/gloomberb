import { expect, test } from "bun:test";
import type { PluginRegistry } from "../../../plugins/registry";
import type { BrokerAdapter } from "../../../types/broker";
import { createCommandBarCollectionWorkflowActions } from "./collection-actions";

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
