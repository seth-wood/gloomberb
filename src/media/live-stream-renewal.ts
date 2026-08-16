import { LIVE_STREAM_RENEWAL_MARGIN_MS, type ResolvedLiveStream } from "../types/media";

export const LIVE_STREAM_RENEWAL_RETRY_MS = 5_000;

interface ScheduledTask {
  cancel(): void;
}

type ScheduleFn = (callback: () => void, delayMs: number) => ScheduledTask;

const defaultSchedule: ScheduleFn = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  return { cancel: () => clearTimeout(timer) };
};

export interface ScheduleLiveStreamRenewalOptions {
  liveStream: ResolvedLiveStream;
  renewLiveStream: (current: ResolvedLiveStream) => Promise<ResolvedLiveStream>;
  isActive: () => boolean;
  onRenewed: (next: ResolvedLiveStream, previous: ResolvedLiveStream) => void;
  now?: () => number;
  schedule?: ScheduleFn;
}

export function scheduleLiveStreamRenewal(options: ScheduleLiveStreamRenewalOptions): { cancel(): void } {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? defaultSchedule;
  let cancelled = false;
  let timer: ScheduledTask | null = null;

  const arm = (current: ResolvedLiveStream, delayMs?: number) => {
    if (cancelled || !options.isActive()) return;
    timer?.cancel();
    const waitMs = delayMs ?? Math.max(0, current.expiresAt - LIVE_STREAM_RENEWAL_MARGIN_MS - now());
    timer = schedule(() => {
      timer = null;
      if (cancelled || !options.isActive()) return;
      void options.renewLiveStream(current).then((next) => {
        if (cancelled || !options.isActive()) return;
        options.onRenewed(next, current);
        arm(next);
      }).catch(() => {
        if (!cancelled && options.isActive()) arm(current, LIVE_STREAM_RENEWAL_RETRY_MS);
      });
    }, waitMs);
  };

  arm(options.liveStream);

  return {
    cancel() {
      cancelled = true;
      timer?.cancel();
      timer = null;
    },
  };
}
