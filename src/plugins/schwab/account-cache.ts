import type { BrokerInstanceConfig } from "../../types/config";
import type { CachePolicy } from "../../types/persistence";
import { fnv1aHashString } from "../../utils/hash";
import { normalizeSchwabConfig } from "./config";

const SCHWAB_ACCOUNT_CACHE_POLICY = {
  staleMs: 6 * 60 * 60 * 1000,
  expireMs: 30 * 24 * 60 * 60 * 1000,
} as const satisfies CachePolicy;

export function getSchwabAccountCacheSourceKey(instance: BrokerInstanceConfig): string {
  return fnv1aHashString(JSON.stringify(normalizeSchwabConfig(instance.config)));
}

export function getSchwabAccountCachePolicy(): CachePolicy {
  return SCHWAB_ACCOUNT_CACHE_POLICY;
}
