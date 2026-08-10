# PingBack

Never miss when your AI coding agent needs you.

PingBack is a **local agent attention layer**: a background daemon that detects when
Claude Code needs the developer and raises a desktop notification + optional sound.

Published as `pingback-cli` on npm (`pingback` was taken). The CLI command is still
`pingback`. Repo: https://github.com/vijaysai1102/PingBack

## Status (v0.1)

v0.1 is **implemented and CI-green** on Windows + macOS. Do not rebuild from the
milestone list unless fixing a real gap. Prefer reading existing code over rewriting.

Full original engineering spec (milestones, event model, CLI UX, DoD, etc.):

See [`docs/SPEC.md`](docs/SPEC.md) — open only when you need detail, not every session.

## Product rules

- Local only: no accounts, cloud, telemetry, or network control plane.
- Invisible when idle; notify only when attention is required.
- Zero-config for the normal path: `npm install -g pingback-cli` → `pingback setup`.
- Adapter architecture: Claude-specific code stays under `src/agents/claude/`. Core
  must not hard-code Claude behavior.
- Platform code behind interfaces (`src/platform/`), not scattered `process.platform`
  checks.
- Do **not** invent Claude hooks/APIs — research official docs or verify on the
  installed CLI first.

## v0.1 scope (supported)

Windows · macOS · Claude Code · TypeScript/Node ≥20 · local daemon · desktop
notifications · sounds · session tracking · CLI (`setup` / `start` / `stop` /
`status` / `config` / `uninstall`)

## Out of scope (do not build)

Codex · AGY · Cursor · Copilot · Gemini · Linux · mobile · browser extension · web
dashboard · cloud sync · remote/phone notifications · accounts · payments · telemetry
· team features · heavy GUI · plugin marketplace

Architecture should allow other agents later via new adapters, not core rewrites.

## Layout

```text
src/core/           events, routing, IPC, daemon
src/agents/         adapter API + Claude Code integration
src/sessions/       session tracking + JSON persistence
src/notifications/  desktop toasts + sound
src/platform/       windows/ + macos/
src/config/         settings
src/cli/            commander CLI
docs/SPEC.md        full v0.1 engineering specification
```

## How it works (short)

Claude Code hooks → `hook-entry` → local IPC (named pipe / Unix socket, token auth) →
daemon → normalize event → update session → notify (priority → sound).

Hooks used: `Notification`, `StopFailure`, `SessionStart`, `UserPromptSubmit`,
`SessionEnd`. Prefer official hooks over scraping terminal output.

## Commands agents should know

```bash
npm install          # also runs prepare (build tooling)
npm run build
npm test
npm run lint
npm run typecheck
npm run format:check

pingback setup|start|stop|status|config
```

CI: `.github/workflows/ci.yml` (Windows + macOS matrix). Release dry-run:
`.github/workflows/release.yml` (no npm publish until enabled).

## Engineering habits

1. Inspect the repo and existing patterns before adding code.
2. Prefer the simplest cross-platform option; minimize dependencies.
3. Fail gracefully for user errors; stack traces only via debug/logging.
4. Never log conversations, prompts, or large terminal dumps.
5. Tests are mandatory for core/router/sessions/adapter/notifications/config.
6. Do not claim support for features that are not implemented.
7. Keep this file short. Put lasting detail in `docs/SPEC.md` or the README — not here.

## Privacy / security

Daemon binds to a local pipe/socket only (never `0.0.0.0`). Auth token on disk with
restricted permissions. Session store holds id/cwd/pid/status — not chat content.
