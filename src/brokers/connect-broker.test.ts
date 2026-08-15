import { expect, test } from "bun:test";
import type { BrokerAdapter } from "../types/broker";
import type { BrokerInstanceConfig } from "../types/config";
import { connectValidatedBroker } from "./connect-broker";

function createInstance(): BrokerInstanceConfig {
  return {
    id: "demo-1",
    brokerType: "demo",
    label: "Demo",
    config: { host: "paper" },
    enabled: true,
  };
}

test("connectValidatedBroker rejects invalid profiles before connect", async () => {
  const calls: string[] = [];
  const broker: BrokerAdapter = {
    id: "demo",
    name: "Demo Broker",
    configSchema: [],
    validate: async () => false,
    connect: async () => {
      calls.push("connect");
    },
  };

  await expect(connectValidatedBroker(broker, createInstance())).rejects.toThrow("Demo Broker setup is incomplete.");
  expect(calls).toEqual([]);
});
