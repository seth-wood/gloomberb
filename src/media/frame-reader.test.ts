import { afterEach, describe, expect, test } from "bun:test";
import { startFrameReader, type FrameSourceProcess, type SpawnFrameSource } from "./frame-reader";

const WIDTH = 4;
const HEIGHT = 2;
const FRAME_BYTES = WIDTH * HEIGHT * 4;

const readers: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(readers.splice(0).map((reader) => reader.stop()));
});

function rgbaFrame(fill: number): Uint8Array {
  const pixels = new Uint8Array(FRAME_BYTES);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = fill;
    pixels[index + 1] = 0;
    pixels[index + 2] = 0;
    pixels[index + 3] = 255;
  }
  return pixels;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function splitAt(bytes: Uint8Array, sizes: number[]): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const size of sizes) {
    chunks.push(bytes.subarray(offset, offset + size));
    offset += size;
  }
  if (offset < bytes.length) chunks.push(bytes.subarray(offset));
  return chunks;
}

function spawnFromChunks(chunks: Uint8Array[]): SpawnFrameSource & { killed: { value: boolean } } {
  const killed = { value: false };
  const spawn: SpawnFrameSource = () => {
    let resolveExit: (code: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const stdout = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
        resolveExit(0);
      },
    });
    const stderr = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    return {
      pid: 4242,
      stdout,
      stderr,
      kill() {
        killed.value = true;
        resolveExit(0);
      },
      exited,
    } satisfies FrameSourceProcess;
  };
  return Object.assign(spawn, { killed });
}

function spawnClosed(exitCode: number): SpawnFrameSource {
  return () => {
    const stdout = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const stderr = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    return {
      pid: 7,
      stdout,
      stderr,
      kill() {},
      exited: Promise.resolve(exitCode),
    } satisfies FrameSourceProcess;
  };
}

function spawnHanging(): SpawnFrameSource & { killed: { value: boolean } } {
  const killed = { value: false };
  const spawn: SpawnFrameSource = () => {
    let resolveExit: (code: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const stdout = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise(() => {});
      },
      cancel() {
        resolveExit(0);
      },
    });
    const stderr = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    return {
      pid: 4242,
      stdout,
      stderr,
      kill() {
        killed.value = true;
        resolveExit(0);
      },
      exited,
    } satisfies FrameSourceProcess;
  };
  return Object.assign(spawn, { killed });
}

async function waitForDone(done: Promise<void>, timeoutMs = 1000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out waiting for the frame source to finish")), timeoutMs);
  });
  try {
    await Promise.race([done, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe("frame reader", () => {
  test("reassembles frames when chunks split a frame mid-pixel", async () => {
    const first = rgbaFrame(11);
    const second = rgbaFrame(22);
    const spawn = spawnFromChunks(splitAt(concat([first, second]), [1, 3, 7, 2]));
    const reader = startFrameReader({
      url: "test-pattern",
      width: WIDTH,
      height: HEIGHT,
      fps: 12,
      audio: "none",
      spawn,
    });
    readers.push(reader);

    await waitForDone(reader.done);
    const frame = reader.takeLatestFrame();
    expect(frame).not.toBeNull();
    expect(frame!.width).toBe(WIDTH);
    expect(frame!.height).toBe(HEIGHT);
    expect(frame!.pixels).toEqual(second);
  });

  test("discards stale frames so the consumer only receives the newest complete one", async () => {
    const frames = [rgbaFrame(1), rgbaFrame(2), rgbaFrame(3)];
    const spawn = spawnFromChunks(frames);
    const reader = startFrameReader({
      url: "test-pattern",
      width: WIDTH,
      height: HEIGHT,
      fps: 12,
      audio: "none",
      spawn,
    });
    readers.push(reader);

    await waitForDone(reader.done);
    expect(reader.takeLatestFrame()?.pixels).toEqual(frames[2]!);
    expect(reader.takeLatestFrame()).toBeNull();
  });

  test("stopping the reader terminates the producing process", async () => {
    const spawn = spawnHanging();
    const reader = startFrameReader({
      url: "test-pattern",
      width: WIDTH,
      height: HEIGHT,
      fps: 12,
      audio: "none",
      spawn,
    });
    readers.push(reader);

    await reader.stop();
    expect(spawn.killed.value).toBe(true);
    await waitForDone(reader.done);
  });

  test("maps audio to the system output device and mutes with a volume filter", () => {
    let argv: readonly string[] = [];
    const spawn = spawnFromChunks([]);
    const reader = startFrameReader({
      url: "https://example.test/live.m3u8",
      width: WIDTH,
      height: HEIGHT,
      fps: 12,
      muted: true,
      audio: "system",
      spawn: (command) => {
        argv = command;
        return spawn(command);
      },
    });
    readers.push(reader);

    expect(argv).toContain("pipe:1");
    expect(argv).toContain("-map");
    expect(argv).toContain("0:a:0?");
    expect(argv).toContain("-af");
    expect(argv).toContain("volume=0");
    if (process.platform === "darwin") expect(argv).toContain("audiotoolbox");
    if (process.platform === "linux") expect(argv).toContain("pulse");
    if (process.platform === "win32") expect(argv).toContain("wasapi");
  });

  test("paces a generated input in real time", () => {
    let argv: readonly string[] = [];
    const spawn = spawnFromChunks([]);
    const reader = startFrameReader({
      url: "testsrc2=rate=12",
      width: WIDTH,
      height: HEIGHT,
      inputFormat: "lavfi",
      realtime: true,
      audio: "none",
      spawn: (command) => {
        argv = command;
        return spawn(command);
      },
    });
    readers.push(reader);

    expect(argv.indexOf("-re")).toBeGreaterThan(-1);
    expect(argv.indexOf("-re")).toBeLessThan(argv.indexOf("-i"));
  });

  test("stop during an unsuccessful audio exit does not spawn a silent fallback", async () => {
    let starts = 0;
    const reader = startFrameReader({
      url: "https://example.test/live.m3u8",
      width: WIDTH,
      height: HEIGHT,
      fps: 12,
      audio: "system",
      spawn: () => {
        starts += 1;
        let resolveExit: (code: number) => void = () => {};
        const exited = new Promise<number>((resolve) => {
          resolveExit = resolve;
        });
        return {
          pid: starts,
          stdout: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.close();
            },
          }),
          stderr: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.close();
            },
          }),
          kill() {
            resolveExit(1);
          },
          exited,
        } satisfies FrameSourceProcess;
      },
    });
    readers.push(reader);

    await Promise.resolve();
    await Promise.resolve();
    await reader.stop();
    expect(starts).toBe(1);
  });

  test("audio fallback still produces frames when the first process leaves stderr open", async () => {
    let starts = 0;
    const frame = rgbaFrame(9);
    const reader = startFrameReader({
      url: "https://example.test/live.m3u8",
      width: WIDTH,
      height: HEIGHT,
      fps: 12,
      audio: "system",
      spawn: (argv) => {
        starts += 1;
        if (starts === 1) {
          return {
            pid: 1,
            stdout: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            }),
            stderr: new ReadableStream<Uint8Array>({
              pull() {
                return new Promise(() => {});
              },
            }),
            kill() {},
            exited: Promise.resolve(1),
          } satisfies FrameSourceProcess;
        }
        return spawnFromChunks([frame])(argv);
      },
    });
    readers.push(reader);

    await waitForDone(reader.done);
    expect(starts).toBe(2);
    expect(reader.takeLatestFrame()?.pixels).toEqual(frame);
  });

  test("warns when system audio is unavailable on the platform", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { configurable: true, value: "freebsd" });
    try {
      const reader = startFrameReader({
        url: "https://example.test/live.m3u8",
        width: WIDTH,
        height: HEIGHT,
        fps: 12,
        audio: "system",
        spawn: spawnFromChunks([]),
      });
      readers.push(reader);

      expect(reader.audio).toBe("silent");
      expect(reader.warning).toMatch(/silent video/i);
    } finally {
      if (platform) Object.defineProperty(process, "platform", platform);
    }
  });

  test("retries silently when the process with audio exits unsuccessful", async () => {
    let starts = 0;
    const frame = rgbaFrame(9);
    const reader = startFrameReader({
      url: "https://example.test/live.m3u8",
      width: WIDTH,
      height: HEIGHT,
      fps: 12,
      audio: "system",
      spawn: (argv) => {
        starts += 1;
        if (starts === 1) {
          return spawnClosed(1)(argv);
        }
        return spawnFromChunks([frame])(argv);
      },
    });
    readers.push(reader);

    await waitForDone(reader.done);
    expect(starts).toBe(2);
    expect(reader.audio).toBe("silent");
    expect(reader.warning).toMatch(/silent video/i);
    expect(reader.takeLatestFrame()?.pixels).toEqual(frame);
  });
});

const ffmpegDescribe = Bun.which("ffmpeg") ? describe : describe.skip;

async function waitForFrame(
  reader: { takeLatestFrame(): { width: number; height: number; pixels: Uint8Array } | null },
  timeoutMs = 4000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const frame = reader.takeLatestFrame();
    if (frame) return frame;
    await Bun.sleep(10);
  }
  throw new Error("timed out waiting for a frame");
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

ffmpegDescribe("frame reader with ffmpeg testsrc", () => {
  test("produces raw RGBA frames at the requested pixel size", async () => {
    const reader = startFrameReader({
      url: "testsrc=size=64x48:rate=10:duration=1",
      inputFormat: "lavfi",
      width: 20,
      height: 10,
      fps: 8,
      audio: "none",
    });
    readers.push(reader);

    const frame = await waitForFrame(reader);
    expect(frame.width).toBe(20);
    expect(frame.height).toBe(10);
    expect(frame.pixels.byteLength).toBe(20 * 10 * 4);
  });

  test("keeps draining while the consumer never takes a frame, then hands over the newest", async () => {
    const started = Date.now();
    const reader = startFrameReader({
      url: "testsrc=size=64x64:rate=30:duration=0.8",
      inputFormat: "lavfi",
      width: 64,
      height: 64,
      fps: 30,
      audio: "none",
    });
    readers.push(reader);

    await waitForDone(reader.done, 4000);
    expect(Date.now() - started).toBeLessThan(3000);
    const frame = reader.takeLatestFrame();
    expect(frame).not.toBeNull();
    expect(frame!.pixels.byteLength).toBe(64 * 64 * 4);
  });

  test("stop terminates the ffmpeg process", async () => {
    const reader = startFrameReader({
      url: "testsrc=size=16x16:rate=5:duration=30",
      inputFormat: "lavfi",
      width: 16,
      height: 16,
      fps: 5,
      audio: "none",
    });
    readers.push(reader);

    await waitForFrame(reader);
    const pid = reader.pid;
    expect(pid).toBeGreaterThan(0);
    expect(pidIsAlive(pid!)).toBe(true);

    await reader.stop();
    expect(pidIsAlive(pid!)).toBe(false);
  });

  test("falls back to silent video when the source has no audio stream", async () => {
    const reader = startFrameReader({
      url: "testsrc=size=16x16:rate=8:duration=0.5",
      inputFormat: "lavfi",
      width: 16,
      height: 16,
      fps: 8,
      audio: "system",
    });
    readers.push(reader);

    const frame = await waitForFrame(reader, 6000);
    expect(frame.pixels.byteLength).toBe(16 * 16 * 4);
    expect(reader.audio).toBe("silent");
    expect(reader.warning).toMatch(/silent video/i);
  });
});
