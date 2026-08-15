Stack: Bun + OpenTUI

Tests:
- Be selective: add or keep a test only when it protects behavior that is easy to break and hard to catch in review.
- Good test targets: parser/math/state complexity, async/cache/persistence behavior, integration boundaries, and regressions with a concrete failure mode that could plausibly return.
- Weak test targets: static metadata, default props, simple pass-through wiring, copied UI text, or behavior that is obvious from reading the implementation.
- Bug-fix tests are not automatically worth keeping. Keep them only when the bug came from non-obvious behavior or a boundary likely to regress.
- Do not keep low-value tests just because they already exist or improve coverage counts.
- When touching a test file, trim nearby low-value tests if the cleanup is clear and low-risk.

Use tmux to test terminal TUI changes (see the `tui-testing` skill). Always kill the tmux session when done.
Pane footers/status bars should only show status that can change, such as loading, error, live/delayed, stale, or auth state. Do not use them for fixed pane labels, row counts, or generic keyboard hints.
Information density matters: never repeat the same information in a pane title/header and again in the body. If a stack/detail title already names the item, start the body with metadata or content.
For Electrobun/desktop-web-only work, do not load the OpenTUI or tui-testing skills unless the change also touches terminal OpenTUI behavior or explicitly needs tmux coverage.
For desktop/Electrobun/web UI, do not draw GUI primitives with terminal cell characters. Use real DOM/CSS/canvas/SVG primitives for lines, markers, shapes, overlays, and interaction affordances; reserve cell-character drawing for the OpenTUI terminal renderer only.
Add mouse/cursor interactivity for everything interactive.
Never fix chart issues by disabling / turning off the kitty renderer; preserve kitty support and fix the root cause.
When adding new pane/plugin, read PLUGINS.md check how others are made first to keep UI consistent. Always prefer shared UI components and plugin APIs before rolling your own.

## Cursor Cloud specific instructions

Bun is the runtime and package manager (pinned by `package.json` `packageManager`). It is installed at `~/.bun/bin` and on `PATH` via `~/.bashrc`; the startup update script refreshes deps with `bun install --frozen-lockfile`. Standard scripts live in `package.json` and setup in `CONTRIBUTING.md`.

Non-obvious gotchas:
- `bun dev` / `bun run dev` uses `--watch` and never exits — use it only for the interactive TUI. For one-shot CLI/data commands use `bun start <cmd>` (e.g. `bun start quote AAPL`), which maps to `bun src/index.tsx <cmd>`.
- CLI data commands require an initialized data directory (`~/gloomberb/`) or they exit with "No data directory configured." This is created the first time the TUI launches and its onboarding wizard is completed. The snapshot already has this initialized; if a fresh data dir is ever needed, launch `bun run dev` once and step through onboarding.
- To exercise the TUI end to end, run it under tmux and drive it with keystrokes (see the `tui-testing` skill). Live market data (Yahoo/Cloud) works without auth; cloud/chat/AI features may return `auth_required` without a signed-in account.
- Checks mirror CI (`.github/workflows/verify.yml`): `bun run typecheck`, `bun test`, `bun run desktop:view:build`, `bun run build`.
