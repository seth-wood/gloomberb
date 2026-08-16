import { startFrameReader, type FrameReader, type RgbaFrame, type StartFrameReaderOptions } from "./frame-reader";
import type { PlaybackSessionState, PlaybackStopReason, ResolvedLiveStream } from "../types/media";

export { type PlaybackSessionState, type PlaybackStopReason } from "../types/media";

/** Debounce so a resize drag restarts the pipeline once, not once per event. */
export const PLAYBACK_RESIZE_DEBOUNCE_MS = 150;

/** Ask for a fresh Live Stream this far ahead of expiry, matching the resolver's cache margin. */
export const LIVE_STREAM_RENEWAL_MARGIN_MS = 60_000;

const LIVE_STREAM_RENEWAL_RETRY_MS = 5_000;

/** Retry a restart-driven pipeline start this far after startFrameReader throws. */
export const PLAYBACK_PIPELINE_RESTART_RETRY_MS = 1_000;

interface ScheduledTask {
  cancel(): void;
}

type ScheduleFn = (callback: () => void, delayMs: number) => ScheduledTask;

export interface PlaybackSession {
  readonly id: string;
  readonly surfaceId: string;
  readonly state: PlaybackSessionState;
  readonly stopReason: PlaybackStopReason | null;
  readonly liveStream: ResolvedLiveStream;
  takeLatestFrame(): RgbaFrame | null;
  setVisible(visible: boolean): void;
  setMuted(muted: boolean): void;
  setSize(width: number, height: number): void;
  stop(reason: PlaybackStopReason): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export interface StartPlaybackSessionOptions {
  surfaceId: string;
  liveStream: ResolvedLiveStream;
  width: number;
  height: number;
  muted?: boolean;
  visible?: boolean;
  renewLiveStream?: (current: ResolvedLiveStream) => Promise<ResolvedLiveStream>;
}

export interface PlaybackSessionRegistry {
  readonly current: PlaybackSession | null;
  /** Binds a services lifetime to this registry; playback survives until every owner releases. */
  acquire(): void;
  release(): Promise<void>;
  start(options: StartPlaybackSessionOptions): Promise<PlaybackSession>;
  teardown(): Promise<void>;
}

export class PlaybackRegistryShutdownError extends Error {
  constructor() {
    super("Playback session registry is shutting down.");
    this.name = "PlaybackRegistryShutdownError";
  }
}

export interface PlaybackSessionRegistryOptions {
  startFrameReader?: (options: StartFrameReaderOptions) => FrameReader;
  now?: () => number;
  schedule?: ScheduleFn;
}

const defaultSchedule: ScheduleFn = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  return { cancel: () => clearTimeout(timer) };
};

let sharedRegistry: PlaybackSessionRegistry | undefined;

export function getPlaybackSessionRegistry(): PlaybackSessionRegistry {
  sharedRegistry ??= createPlaybackSessionRegistry();
  return sharedRegistry;
}

export function createPlaybackSessionRegistry(
  options: PlaybackSessionRegistryOptions = {},
): PlaybackSessionRegistry {
  const deps: SessionDeps = {
    startFrameReader: options.startFrameReader ?? startFrameReader,
    now: options.now ?? Date.now,
    schedule: options.schedule ?? defaultSchedule,
  };
  let current: LivePlaybackSession | null = null;
  let nextId = 0;
  let ownerCount = 0;
  let shuttingDown = false;
  let startInFlight: Promise<PlaybackSession> | null = null;
  const runTeardown = async (): Promise<void> => {
    const sessionToStop = current;
    if (startInFlight) {
      await startInFlight.catch(() => {});
    }
    if (sessionToStop) await sessionToStop.stop("teardown");
  };

  const registry: PlaybackSessionRegistry = {
    get current() {
      return current;
    },
    acquire() {
      if (ownerCount === 0) shuttingDown = false;
      ownerCount += 1;
    },
    async release() {
      if (ownerCount === 0) return;
      ownerCount -= 1;
      if (ownerCount === 0) {
        shuttingDown = true;
        await runTeardown();
      }
    },
    async start(startOptions) {
      const run = (async (): Promise<PlaybackSession> => {
        const displaced = current;
        current = null;
        if (displaced) await displaced.stop("displaced");
        if (shuttingDown) throw new PlaybackRegistryShutdownError();

        const session = new LivePlaybackSession({
          id: `playback-session-${++nextId}`,
          options: startOptions,
          deps,
          onStoppedIfCurrent: (stopped) => {
            if (current === stopped) current = null;
          },
        });
        current = session;
        session.begin();
        return session;
      })();
      startInFlight = run;
      try {
        return await run;
      } finally {
        if (startInFlight === run) startInFlight = null;
      }
    },
    async teardown() {
      shuttingDown = true;
      await runTeardown();
    },
  };
  return registry;
}

interface SessionDeps {
  startFrameReader: (options: StartFrameReaderOptions) => FrameReader;
  now: () => number;
  schedule: ScheduleFn;
}

class LivePlaybackSession implements PlaybackSession {
  readonly id: string;
  readonly surfaceId: string;
  private _state: PlaybackSessionState = "idle";
  private _stopReason: PlaybackStopReason | null = null;
  private _liveStream: ResolvedLiveStream;
  private width: number;
  private height: number;
  private muted: boolean;
  private visible: boolean;
  private reader: FrameReader | null = null;
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private readonly deps: SessionDeps;
  private readonly onStoppedIfCurrent: (session: LivePlaybackSession) => void;
  private readonly renewLiveStream?: (current: ResolvedLiveStream) => Promise<ResolvedLiveStream>;
  private resizeTask: ScheduledTask | null = null;
  private renewalTask: ScheduledTask | null = null;
  private pipelineRetryTask: ScheduledTask | null = null;
  private renewing = false;
  private stopInFlight: Promise<void> | null = null;

  constructor(config: {
    id: string;
    options: StartPlaybackSessionOptions;
    deps: SessionDeps;
    onStoppedIfCurrent: (session: LivePlaybackSession) => void;
  }) {
    this.id = config.id;
    this.surfaceId = config.options.surfaceId;
    this._liveStream = config.options.liveStream;
    this.width = config.options.width;
    this.height = config.options.height;
    this.muted = config.options.muted ?? false;
    this.visible = config.options.visible ?? true;
    this.deps = config.deps;
    this.onStoppedIfCurrent = config.onStoppedIfCurrent;
    this.renewLiveStream = config.options.renewLiveStream;
  }

  get state(): PlaybackSessionState {
    return this._state;
  }

  get stopReason(): PlaybackStopReason | null {
    return this._stopReason;
  }

  get liveStream(): ResolvedLiveStream {
    return this._liveStream;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  takeLatestFrame(): RgbaFrame | null {
    const next = this.reader?.takeLatestFrame() ?? null;
    if (next && this.shouldRunPipeline() && (this._state === "starting" || this._state === "stalled")) {
      this.setState("playing");
    }
    return next;
  }

  setVisible(visible: boolean): void {
    if (this.hasEnded() || this.visible === visible) return;
    this.visible = visible;
    this.syncPipeline("visibility");
  }

  setMuted(muted: boolean): void {
    if (this.hasEnded() || this.muted === muted) return;
    this.muted = muted;
    this.syncPipeline("mute");
  }

  setSize(width: number, height: number): void {
    if (this.hasEnded() || (this.width === width && this.height === height)) return;
    this.width = width;
    this.height = height;
    if (!this.shouldRunPipeline()) return;
    this.resizeTask?.cancel();
    this.resizeTask = this.deps.schedule(() => {
      this.resizeTask = null;
      if (this.hasEnded() || !this.shouldRunPipeline()) return;
      void this.restartPipeline();
    }, PLAYBACK_RESIZE_DEBOUNCE_MS);
  }

  async stop(reason: PlaybackStopReason): Promise<void> {
    if (this.stopInFlight) return this.stopInFlight;
    if (this.hasEnded()) return;
    this.stopInFlight = this.finishStop(reason);
    try {
      await this.stopInFlight;
    } finally {
      this.stopInFlight = null;
    }
  }

  private async finishStop(reason: PlaybackStopReason): Promise<void> {
    this.generation += 1;
    this.cancelTimers();
    this._stopReason = reason;
    this._state = "stopped";
    this.notify();
    await this.dropReader();
    this.onStoppedIfCurrent(this);
  }

  begin(): void {
    this.armRenewal();
    if (!this.shouldRunPipeline()) {
      this._stopReason = "hidden-muted";
      this.setState("stopped");
      return;
    }
    this.startPipeline("starting");
  }

  private shouldRunPipeline(): boolean {
    return this.visible || !this.muted;
  }

  private hasEnded(): boolean {
    if (this._state === "failed") return true;
    if (this._state !== "stopped" || this._stopReason === null) return false;
    switch (this._stopReason) {
      case "hidden-muted":
        return false;
      case "displaced":
      case "pane-close":
      case "teardown":
        return true;
      default: {
        const _exhaustive: never = this._stopReason;
        return _exhaustive;
      }
    }
  }

  private syncPipeline(cause: "visibility" | "mute"): void {
    if (!this.shouldRunPipeline()) {
      void this.stopForHiddenMute();
      return;
    }
    if (this._state === "stopped" && this._stopReason === "hidden-muted") {
      void this.restartPipeline();
      return;
    }
    switch (cause) {
      case "mute":
        if (this.reader) void this.restartPipeline();
        return;
      case "visibility":
        return;
      default: {
        const _exhaustive: never = cause;
        return _exhaustive;
      }
    }
  }

  private async stopForHiddenMute(): Promise<void> {
    this.generation += 1;
    this.resizeTask?.cancel();
    this.resizeTask = null;
    this.pipelineRetryTask?.cancel();
    this.pipelineRetryTask = null;
    this._stopReason = "hidden-muted";
    this.setState("stopped");
    await this.dropReader();
  }

  private async dropReader(): Promise<void> {
    const reader = this.reader;
    this.reader = null;
    if (reader) await reader.stop();
  }

  private startPipeline(nextState: "starting" | "stalled"): void {
    const generation = this.generation;
    try {
      this.reader = this.deps.startFrameReader({
        url: this._liveStream.manifestUrl,
        width: this.width,
        height: this.height,
        muted: this.muted,
      });
    } catch {
      if (generation !== this.generation) return;
      if (nextState === "stalled") {
        this.setState("stalled");
        this.schedulePipelineRetry(generation);
        return;
      }
      this.setState("failed");
      return;
    }
    this.pipelineRetryTask?.cancel();
    this.pipelineRetryTask = null;
    this._stopReason = null;
    this.setState(nextState);
    const reader = this.reader;
    if (!reader) return;
    void reader.done.then(() => {
      if (this.generation !== generation || this.reader !== reader) return;
      if (this.hasEnded() || this._state === "stopped") return;
      this.reader = null;
      this.setState("failed");
    });
  }

  private schedulePipelineRetry(generation: number): void {
    this.pipelineRetryTask?.cancel();
    this.pipelineRetryTask = this.deps.schedule(() => {
      this.pipelineRetryTask = null;
      if (this.generation !== generation || this.hasEnded() || !this.shouldRunPipeline()) return;
      this.startPipeline("stalled");
    }, PLAYBACK_PIPELINE_RESTART_RETRY_MS);
  }

  private async restartPipeline(): Promise<void> {
    if (this.hasEnded() || !this.shouldRunPipeline()) return;
    const generation = ++this.generation;
    this.setState("stalled");
    await this.dropReader();
    if (generation !== this.generation) return;
    this.startPipeline("stalled");
  }

  private armRenewal(delayMs?: number): void {
    this.renewalTask?.cancel();
    this.renewalTask = null;
    if (!this.renewLiveStream) return;
    const waitMs = delayMs ?? Math.max(0, this._liveStream.expiresAt - LIVE_STREAM_RENEWAL_MARGIN_MS - this.deps.now());
    this.renewalTask = this.deps.schedule(() => {
      this.renewalTask = null;
      void this.requestRenewal();
    }, waitMs);
  }

  private async requestRenewal(): Promise<void> {
    if (!this.renewLiveStream || this.renewing || this.hasEnded()) return;
    this.renewing = true;
    try {
      const nextStream = await this.renewLiveStream(this._liveStream);
      if (this.hasEnded()) return;
      this._liveStream = nextStream;
      this.armRenewal();
      if (this.shouldRunPipeline()) await this.restartPipeline();
    } catch {
      if (!this.hasEnded()) this.armRenewal(LIVE_STREAM_RENEWAL_RETRY_MS);
    } finally {
      this.renewing = false;
    }
  }

  private cancelTimers(): void {
    this.resizeTask?.cancel();
    this.resizeTask = null;
    this.renewalTask?.cancel();
    this.renewalTask = null;
    this.pipelineRetryTask?.cancel();
    this.pipelineRetryTask = null;
  }

  private setState(state: PlaybackSessionState): void {
    if (this._state === state) return;
    this._state = state;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
