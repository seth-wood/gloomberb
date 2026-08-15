import { describe, expect, spyOn, test } from "bun:test";
import { createInitialState } from "../../state/app/context";
import { createDefaultConfig } from "../../types/config";
import type { BrokerAdapter } from "../../types/broker";
import { PluginRegistry } from "../../plugins/registry";
import * as configSaveScheduler from "../../state/config-save-scheduler";
import { bindPluginRegistryRuntimeAccess } from "./plugin-bindings";

describe("bindPluginRegistryRuntimeAccess broker updates", () => {
  test("disconnects the old session before persisting broker credential changes", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-plugin-bindings");
    config.brokerInstances = [{
      id: "schwab-main",
      brokerType: "schwab",
      label: "Schwab",
      config: {
        appKey: "old-key",
        appSecret: "old-secret",
        callbackUrl: "https://127.0.0.1:8182",
      },
    }];

    const state = createInitialState(config);
    const dispatch = () => {};
    const importBrokerPositions = async () => {};
    const marketData = {
      getTickerFinancialsSync: () => null,
    } as never;
    const tickerRepository = {
      deleteTicker: async () => {},
      saveTicker: async () => {},
    } as never;
    const dataProvider = {} as never;

    const registry = new PluginRegistry(dataProvider, tickerRepository, {
      resources: {
        list: () => [],
      } as never,
      sessions: {} as never,
      tickers: {} as never,
    });

    const order: string[] = [];
    const broker: BrokerAdapter = {
      id: "schwab",
      name: "Schwab",
      configSchema: [],
      validate: async () => true,
      importPositions: async () => [],
      getSessionKey: (instance) => `${instance.config.appKey}:${instance.config.appSecret}`,
      disconnect: async () => {
        order.push("disconnect");
      },
    };
    registry.brokers.set("schwab", broker);

    const saveSpy = spyOn(configSaveScheduler, "saveConfigImmediately").mockImplementation(async () => {
      order.push("save");
    });

    bindPluginRegistryRuntimeAccess({
      dataProvider,
      dispatch,
      importBrokerPositions,
      marketData,
      pluginRegistry: registry,
      state,
      tickerRepository,
    });

    await registry.updateBrokerInstance("schwab-main", {
      appKey: "new-key",
      appSecret: "new-secret",
      callbackUrl: "https://127.0.0.1:8182",
    }, { replaceConfig: true });

    expect(order).toEqual(["disconnect", "save"]);
    saveSpy.mockRestore();
  });
});
