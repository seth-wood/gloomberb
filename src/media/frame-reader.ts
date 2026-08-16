export interface RgbaFrame {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface FrameSourceProcess {
  readonly pid: number | undefined;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  kill(signal?: "SIGTERM" | "SIGKILL"): void;
  readonly exited: Promise<number>;
}

export type SpawnFrameSource = (argv: readonly string[]) => FrameSourceProcess;

export type FrameAudioMode = "system" | "none";
export type FrameAudioOutput = "system" | "silent";

export interface FrameReader {
  takeLatestFrame(): RgbaFrame | null;
  readonly done: Promise<void>;
  readonly pid: number | undefined;
  readonly audio: FrameAudioOutput;
  readonly warning: string | null;
  stop(): Promise<void>;
}

export interface StartFrameReaderOptions {
  url: string;
  width: number;
  height: number;
  fps?: number;
  muted?: boolean;
  audio?: FrameAudioMode;
  /** ffmpeg `-f` before `-i`. Use `lavfi` for generated test patterns. */
  inputFormat?: string;
  /** Pace a source that would otherwise generate frames as fast as possible. */
  realtime?: boolean;
  spawn?: SpawnFrameSource;
  ffmpegPath?: string;
}

const BYTES_PER_PIXEL = 4;
const STOP_KILL_TIMEOUT_MS = 1000;
const SILENT_AUDIO_WARNING = "Audio is unavailable; playing silent video.";

/** Frame-rate cap implied by the kitty write-path measurement in ADR 0001. */
export const TERMINAL_VIDEO_FPS_CEILING = 12;

export function startFrameReader(options: StartFrameReaderOptions): FrameReader {
  const requestedFps = options.fps ?? TERMINAL_VIDEO_FPS_CEILING;
  if (options.width <= 0 || options.height <= 0 || requestedFps <= 0) {
    throw new Error("Frame reader needs a positive width, height, and frame rate.");
  }
  const fps = Math.min(requestedFps, TERMINAL_VIDEO_FPS_CEILING);

  const spawn = options.spawn ?? spawnFfmpegProcess;
  const ffmpegPath = options.ffmpegPath ?? (options.spawn ? "ffmpeg" : resolveFfmpegPath());
  const requestedAudio = options.audio ?? "system";
  const audioFormat = requestedAudio === "system" ? systemAudioFormat(process.platform) : null;
  const sized = { ...options, fps };

  return new PipeFrameReader({
    spawn,
    argvWithAudio: audioFormat ? buildFfmpegArgv(sized, ffmpegPath, audioFormat) : null,
    argvSilent: buildFfmpegArgv(sized, ffmpegPath, null),
    width: options.width,
    height: options.height,
  });
}

function resolveFfmpegPath(): string {
  const path = Bun.which("ffmpeg");
  if (!path) {
    throw new Error("ffmpeg is required for terminal TV playback. Install ffmpeg and try again.");
  }
  return path;
}

function systemAudioFormat(platform: NodeJS.Platform): string | null {
  switch (platform) {
    case "darwin":
      return "audiotoolbox";
    case "linux":
      return "pulse";
    case "win32":
      return "wasapi";
    default:
      return null;
  }
}

function buildFfmpegArgv(
  options: StartFrameReaderOptions & { fps: number },
  ffmpegPath: string,
  audioFormat: string | null,
): string[] {
  const argv = [
    ffmpegPath,
    "-nostdin",
    "-hide_banner",
    "-loglevel", "error",
    ...(options.inputFormat ? ["-f", options.inputFormat] : []),
    ...(options.realtime ? ["-re"] : []),
    "-i", options.url,
    "-map", "0:v:0",
    "-vf", `scale=${options.width}:${options.height}:flags=fast_bilinear,fps=${options.fps},format=rgba`,
    "-pix_fmt", "rgba",
    "-f", "rawvideo",
    "pipe:1",
  ];
  if (!audioFormat) return argv;

  argv.push("-map", "0:a:0?");
  if (options.muted) argv.push("-af", "volume=0");
  argv.push("-f", audioFormat, "default");
  return argv;
}

function spawnFfmpegProcess(argv: readonly string[]): FrameSourceProcess {
  const subprocess = Bun.spawn([...argv], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!subprocess.stdout || !subprocess.stderr) {
    subprocess.kill();
    throw new Error("ffmpeg did not expose stdout and stderr pipes.");
  }
  return {
    pid: subprocess.pid,
    stdout: subprocess.stdout,
    stderr: subprocess.stderr,
    kill(signal?: "SIGTERM" | "SIGKILL") {
      subprocess.kill(signal ?? "SIGTERM");
    },
    exited: subprocess.exited,
  };
}

class PipeFrameReader implements FrameReader {
  private latest: RgbaFrame | null = null;
  private stopped = false;
  private source: FrameSourceProcess;
  private stdoutReader: ReadableStreamDefaultReader<Uint8Array>;
  private stderrReader: ReadableStreamDefaultReader<Uint8Array>;
  private audioOutput: FrameAudioOutput;
  private fallbackWarning: string | null = null;
  readonly done: Promise<void>;

  constructor(
    private readonly config: {
      spawn: SpawnFrameSource;
      argvWithAudio: string[] | null;
      argvSilent: string[];
      width: number;
      height: number;
    },
  ) {
    const argv = config.argvWithAudio ?? config.argvSilent;
    this.audioOutput = config.argvWithAudio ? "system" : "silent";
    this.source = config.spawn(argv);
    this.stdoutReader = this.source.stdout.getReader();
    this.stderrReader = this.source.stderr.getReader();
    this.done = this.run();
  }

  get pid(): number | undefined {
    return this.source.pid;
  }

  get audio(): FrameAudioOutput {
    return this.audioOutput;
  }

  get warning(): string | null {
    return this.fallbackWarning;
  }

  takeLatestFrame(): RgbaFrame | null {
    const frame = this.latest;
    this.latest = null;
    return frame;
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      await this.done;
      return;
    }
    this.stopped = true;
    await this.terminateSource();
    await this.done;
  }

  private async run(): Promise<void> {
    await this.drainCurrentSource();
    if (this.stopped) return;

    const exitCode = await this.source.exited.catch(() => 1);
    if (this.stopped || exitCode === 0 || !this.config.argvWithAudio || this.audioOutput === "silent") return;

    this.audioOutput = "silent";
    this.fallbackWarning = SILENT_AUDIO_WARNING;
    this.source = this.config.spawn(this.config.argvSilent);
    this.stdoutReader = this.source.stdout.getReader();
    this.stderrReader = this.source.stderr.getReader();
    await this.drainCurrentSource();
  }

  private async drainCurrentSource(): Promise<void> {
    const frameBytes = this.config.width * this.config.height * BYTES_PER_PIXEL;
    const buffer = new Uint8Array(frameBytes);
    let filled = 0;
    void this.discardStderr(this.stderrReader);
    try {
      while (!this.stopped) {
        const { done, value } = await this.stdoutReader.read();
        if (done || !value) break;
        let offset = 0;
        while (offset < value.length) {
          const take = Math.min(frameBytes - filled, value.length - offset);
          buffer.set(value.subarray(offset, offset + take), filled);
          filled += take;
          offset += take;
          if (filled === frameBytes) {
            this.latest = {
              width: this.config.width,
              height: this.config.height,
              pixels: buffer.slice(),
            };
            filled = 0;
          }
        }
      }
    } catch {}
  }

  private async discardStderr(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {}
  }

  private async terminateSource(): Promise<void> {
    this.source.kill("SIGTERM");
    await this.stdoutReader.cancel().catch(() => {});
    await this.stderrReader.cancel().catch(() => {});
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timeoutId = setTimeout(() => resolve("timeout"), STOP_KILL_TIMEOUT_MS);
    });
    try {
      const exited = await Promise.race([
        this.source.exited.then(() => "exited" as const),
        timeout,
      ]).catch(() => "timeout" as const);
      if (exited === "timeout") {
        this.source.kill("SIGKILL");
        await this.source.exited.catch(() => {});
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}
