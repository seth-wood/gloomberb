import { expect, test } from "bun:test";
import {
  LIVE_STREAM_RENEWAL_RETRY_MS,
  scheduleLiveStreamRenewal,
} from "./live-stream-renewal";
import { LIVE_STREAM_RENEWAL_MARGIN_MS, type ResolvedLiveStream } from "../types/media";

function liveStream(overrides: Partial<ResolvedLiveStream> = {}): ResolvedLiveStream {
  return {
    provider: "youtube",
    sourceId: "bloomberg",
    videoId: "broadcast-1",
    title: "Bloomberg Live",
    manifestUrl: "https://example.test/broadcast-1.m3u8",
    watchUrl: "https://youtube.com/watch?v=broadcast-1",
    resolvedAt: 0,
    expiresAt: LIVE_STREAM_RENEWAL_MARGIN_MS + 5_000,
    ...overrides,
  };
}

function createClock(start = 0) {
  let now = start;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();

  return {
    now: () => now,
    schedule(callback: () => void, delayMs: number) {
      const id = ++nextId;
      timers.set(id, { at: now + delayMs, callback });
      return {
        cancel() {
          timers.delete(id);
        },
      };
    },
    advance(ms: number) {
      const target = now + ms;
      while (true) {
        let due: { id: number; at: number; callback: () => void } | null = null;
        for (const [id, timer] of timers) {
          if (timer.at > target) continue;
          if (!due || timer.at < due.at || (timer.at === due.at && id < due.id)) {
            due = { id, at: timer.at, callback: timer.callback };
          }
        }
        if (!due) {
          now = target;
          return;
        }
        timers.delete(due.id);
        now = due.at;
        due.callback();
      }
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
}

test("schedules renewal at expiresAt minus the renewal margin", async () => {
  const clock = createClock();
  const renew = async () => liveStream({ manifestUrl: "https://example.test/next.m3u8" });
  let renewals = 0;
  const renewal = scheduleLiveStreamRenewal({
    liveStream: liveStream(),
    renewLiveStream: async () => {
      renewals += 1;
      return await renew();
    },
    now: clock.now,
    schedule: clock.schedule,
    isActive: () => true,
    onRenewed: () => {},
  });

  clock.advance(4_999);
  expect(renewals).toBe(0);

  clock.advance(1);
  expect(renewals).toBe(1);
  renewal.cancel();
});

test("retries failed renewals after LIVE_STREAM_RENEWAL_RETRY_MS", async () => {
  const clock = createClock();
  let attempts = 0;
  const renewal = scheduleLiveStreamRenewal({
    liveStream: liveStream(),
    renewLiveStream: async () => {
      attempts += 1;
      throw new Error("resolver unavailable");
    },
    now: clock.now,
    schedule: clock.schedule,
    isActive: () => true,
    onRenewed: () => {},
  });

  clock.advance(5_000);
  await flush();
  expect(attempts).toBe(1);

  clock.advance(LIVE_STREAM_RENEWAL_RETRY_MS);
  await flush();
  expect(attempts).toBe(2);
  renewal.cancel();
});

test("cancel ignores in-flight renewal success", async () => {
  const clock = createClock();
  let renewed = false;
  const renewal = scheduleLiveStreamRenewal({
    liveStream: liveStream(),
    renewLiveStream: async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return liveStream({ manifestUrl: "https://example.test/next.m3u8" });
    },
    now: clock.now,
    schedule: clock.schedule,
    isActive: () => true,
    onRenewed: () => {
      renewed = true;
    },
  });

  clock.advance(5_000);
  renewal.cancel();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(renewed).toBe(false);
});
