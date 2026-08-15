import type { BrokerAdapter } from "../types/broker";
import type { BrokerInstanceConfig } from "../types/config";

export async function connectValidatedBroker(
  broker: BrokerAdapter,
  instance: BrokerInstanceConfig,
): Promise<void> {
  const valid = await broker.validate(instance).catch(() => false);
  if (!valid) {
    throw new Error(`${broker.name} setup is incomplete.`);
  }
  await broker.connect?.(instance);
}
