# Terminal video is a native Surface fed by ffmpeg, not mpv

**Status**: accepted

Terminal TV used to call `renderer.suspend()` and hand the whole TTY to `mpv --vo=kitty`, which froze the entire app for the duration of playback. Live video is now a native Surface like charts are: a Playback Session decodes frames and pushes them through `NativeSurfaceManager`, so video composites with the rest of the TUI and obeys pane occlusion, clipping, and z-index. The frame and audio source is **ffmpeg**, not mpv.

## Considered Options

The obvious question a future reader will ask is "why not mpv, it's a media player." It was measured, not assumed:

- **`mpv --vo=kitty`, piped and screen-scraped** (attempted in 3a578a0, reverted in e8fe5f6). Parsing kitty escape sequences out of mpv's stdout bypasses `NativeSurfaceManager` entirely, so video paints over floating panes and ignores clipping. Teardown also had to delete *all* kitty images and ask every chart to retransmit.
- **`mpv --o=- --of=rawvideo` (encode mode).** Does emit raw RGBA to stdout, but no audio output device is ever opened — measured `[encode] audio: encoded 0 bytes`. Video-only, and audio is required.
- **`mpv --vo=image`.** Genuinely does both: realtime-paced (3167ms elapsed for a 3000ms source) with audio playing normally, and per-frame decode through Jimp costs only ~4.7ms at pane resolution. It was rejected on disk churn — ~290KB/frame at 736×544 is **15.5 GB/hour** of PNG writes (1.7 GB/hour as JPEG), plus a directory watcher, file cleanup, and a partial-read hazard where mpv is still writing frame N as we read it.
- **ffmpeg, one process** — `-map 0:v -f rawvideo -pix_fmt rgba pipe:1` alongside `-map 0:a -f audiotoolbox`. One network pull, frames at fixed byte offsets, no disk, no decode, and the audio device paces the pipeline in realtime.

## Consequences

- We give up mpv's `--input-ipc-server` control channel and its more robust HLS live handling. Mute is still reachable — ffmpeg's `volume` filter carries the runtime-command flag — but there is no pause or live-edge reseek. This is tolerable only because a Live Stream is never scrubbed: every restart rejoins at the Live Edge anyway.
- The audio output device is OS-specific. `audiotoolbox` is confirmed on macOS; Linux depends on how the user's ffmpeg was built. Missing ffmpeg refuses playback with an explanation; a missing audio device falls back to silent video and says so.
- The pipe must never be the thing that blocks — a stalled reader becomes an audio glitch, which is the failure people notice most. Frames are capped at source *and* dropped in the reader.

## Kitty write-path ceiling

Measured 2026-08-15 on this machine, at the realistic pane resolution used while comparing mpv options (**736×544** RGBA, 1,601,536 uncompressed bytes). The path timed is `KittyImageManager.render` for a *new* bitmap every frame: deflate level 3, base64, kitty transmit, placement, and `renderer.write` (write itself is a no-op sink, so this is CPU cost, not TTY bandwidth).

| Pixel content | p50 | p95 | payload | write-path ceiling |
|---|---|---|---|---|
| Video-like (smooth sines) | 16.5 ms | 17.0 ms | ~1.3 MB | ~59 fps |
| Incompressible (CSPRNG) | 17.5 ms | 18.2 ms | ~2.1 MB | ~55 fps |

That ceiling assumes video owns the terminal. It does not: chart redraws share the same kitty write path. At **12 fps** the write costs ~20% of the 83 ms frame budget and leaves room for a chart raster; at 30 fps it would consume half the budget before the TUI has done anything else. The rest of the work should treat **12 fps** as the source cap (`TERMINAL_VIDEO_FPS_CEILING`).

## SET-64 gate result

Resolved 2026-08-16: the existing transmission path carries the target rate. A 10-second end-to-end local run used ffmpeg's paced `testsrc2`, 736×544 RGBA frames, the Playback Session's latest-frame slot, and `KittyImageManager`; a separate 736×300 chart bitmap was retransmitted once per second to simulate interactive chart redraws. The renderer write was a no-op sink, matching the ceiling measurement above.

- Video: **120 frames / 10.03 s = 11.97 fps**, with no missed frame slots
- Chart: **11 redraws** during the same run
- Combined kitty encode/transmit preparation: **4.76 ms mean**, **12.70 ms max**, against an 83.3 ms video frame budget

A detached tmux smoke at 120×40 verified the no-kitty path: the TV pane showed fallback content, Ctrl-P opened the command bar while it remained mounted, moving and closing the pane completed through the remote-control API, no runtime warnings were logged, no ffmpeg process was started or orphaned, and the session was killed afterward. Native pixel placement, clipping, overlap, hide/reveal, move/resize, and withdrawal are covered by the native Surface manager and OpenTUI component tests because detached tmux cannot answer a terminal graphics capability query or capture kitty pixel layers.
