# Gloomberb

A terminal- and desktop-native financial workspace. This glossary fixes the language the codebase and its agents use. It is a glossary only — no implementation detail, no decisions. Decisions live in `docs/adr/`.

## Live Television

**Channel**:
A branded feed a viewer picks, such as Bloomberg, CNBC, or Yahoo Finance. A Channel is a durable choice that outlives any particular broadcast.
_Avoid_: Station, source, tab, feed

**Live Stream**:
A specific resolved broadcast belonging to a Channel, carrying a manifest and an expiry. A Channel yields a different Live Stream when the broadcaster rotates broadcasts.
_Avoid_: Video, stream URL, broadcast

**Resolution**:
The act of finding a Channel's current Live Stream. Its states are `resolving`, `resolved`, and `unavailable`. Resolution is distinct from playback: a resolved Channel may never be played.
_Avoid_: Loading, fetching

**Playback Session**:
One running instance of a Live Stream, bound to a Surface, holding whatever process and audio output the playback requires. Its states are `idle`, `starting`, `playing`, `stalled`, `stopped`, and `failed`.
_Avoid_: Player, playback, stream session

**Stalled**:
A Playback Session that intends to play but currently has no frames — buffering, reconnecting, or restarting. Distinct from `stopped`.
_Avoid_: Buffering, waiting, loading

**Stopped**:
A Playback Session that has ended and holds no process. A live broadcast cannot be resumed where it left off, so there is no paused state — restarting means rejoining at the live edge.
_Avoid_: Paused

**Live Edge**:
The most recent point of a Live Stream that a viewer can join. Every start and restart of a Playback Session begins here.
_Avoid_: Head, latest, now

## Rendering

**Surface**:
A rectangular region of a Pane into which pixel content is composited, rather than drawn as text cells. A Surface knows which part of itself is currently visible.
_Avoid_: Canvas, viewport, image area

**Pane**:
A single plugin-provided window in the workspace, which the viewer can focus, move, float, and close.
_Avoid_: Widget, panel, window
