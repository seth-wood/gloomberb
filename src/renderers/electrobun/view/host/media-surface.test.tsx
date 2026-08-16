/** @jsxImportSource react */
import { Window } from "happy-dom";

const testWindow = new Window({ url: "http://localhost" });
Object.assign(globalThis, {
  window: testWindow,
  document: testWindow.document,
  navigator: testWindow.navigator,
  Event: testWindow.Event,
  HTMLElement: testWindow.HTMLElement,
  HTMLMediaElement: testWindow.HTMLMediaElement,
  HTMLVideoElement: testWindow.HTMLVideoElement,
  Node: testWindow.Node,
});
Object.assign(testWindow.HTMLMediaElement.prototype, {
  canPlayType: () => "probably",
  load: () => {},
  pause: () => {},
  play: async () => {},
});

import { afterEach, expect, mock, test } from "bun:test";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LIVE_STREAM_RENEWAL_MARGIN_MS, type ResolvedLiveStream } from "../../../../types/media";

let root: Root | null = null;
let container: HTMLElement | null = null;

async function runAct(callback: () => void | Promise<void>): Promise<void> {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(callback);
  } finally {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}

afterEach(async () => {
  if (root) await runAct(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function liveStream(overrides: Partial<ResolvedLiveStream> = {}): ResolvedLiveStream {
  return {
    provider: "youtube",
    sourceId: "bloomberg",
    videoId: "broadcast-1",
    title: "Bloomberg Live",
    manifestUrl: "https://example.test/broadcast-1.m3u8",
    watchUrl: "https://youtube.com/watch?v=broadcast-1",
    resolvedAt: Date.now(),
    expiresAt: Date.now() + LIVE_STREAM_RENEWAL_MARGIN_MS,
    ...overrides,
  };
}

test("renews an expiring Live Stream and rejoins a rotated broadcast without failure", async () => {
  const { WebMediaSurface } = await import("./media-surface");
  const first = liveStream();
  const rotated = liveStream({
    videoId: "broadcast-2",
    manifestUrl: "https://example.test/broadcast-2.m3u8",
    resolvedAt: Date.now() + 1,
    expiresAt: Date.now() + 3_600_000,
  });
  const states: string[] = [];
  const renew = mock(async () => rotated);

  function Harness() {
    const [stream, setStream] = useState(first);
    return (
      <WebMediaSurface
        src={stream.manifestUrl}
        liveStream={stream}
        renewLiveStream={async (current) => {
          const next = await renew(current);
          setStream(next);
          return next;
        }}
        autoPlay
        muted
        onPlaybackStateChange={(state) => states.push(state)}
        onError={() => states.push("failed")}
      />
    );
  }

  container = testWindow.document.createElement("div") as unknown as HTMLElement;
  testWindow.document.body.appendChild(container as never);
  root = createRoot(container);
  await runAct(async () => {
    root!.render(<Harness />);
  });
  await runAct(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  expect(renew).toHaveBeenCalledTimes(1);
  expect(states).toContain("stalled");
  expect(states).not.toContain("failed");
  expect(container.querySelector("video")?.getAttribute("src")).toBe(rotated.manifestUrl);
});

test("restarts playback when playbackGeneration bumps while the manifest URL is unchanged", async () => {
  const { WebMediaSurface } = await import("./media-surface");
  const stream = liveStream();
  const states: string[] = [];
  let generation = 0;

  function Harness() {
    return (
      <WebMediaSurface
        src={stream.manifestUrl}
        playbackGeneration={generation}
        autoPlay
        muted
        onPlaybackStateChange={(state) => states.push(state)}
      />
    );
  }

  container = testWindow.document.createElement("div") as unknown as HTMLElement;
  testWindow.document.body.appendChild(container as never);
  root = createRoot(container);
  await runAct(async () => {
    root!.render(<Harness />);
  });
  await runAct(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  const startingCount = states.filter((state) => state === "starting").length;
  expect(startingCount).toBe(1);

  generation += 1;
  await runAct(async () => {
    root!.render(<Harness />);
  });
  await runAct(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  expect(states.filter((state) => state === "starting").length).toBeGreaterThan(startingCount);
});
