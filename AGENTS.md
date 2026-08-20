# PingBack

Never miss when your AI coding agent needs you.

PingBack is a **local agent attention layer**: a background daemon that detects when
an AI coding agent (like Claude Code) needs the developer and raises a desktop notification + optional sound.

Published as `pingback-cli` on npm (`pingback` was taken). The CLI command is `pingback`.
Repo: https://github.com/vijaysai1102/PingBack

## Project Status & Versioning

- **v0.1**: Completed and CI-green (Windows + macOS baseline with Claude Code adapter, daemon, desktop toasts + sound, session tracking, and CLI).
- **v0.2, v0.3, ...**: Active development proceeds through iterative version milestones.

## Version Milestone Workflow & Logging Protocol

- **Mandatory Version File Creation**: Whenever the developer mentions, asks for, or begins working on a new version (e.g. `v0.2`, `v0.3`, etc.), the agent **must immediately create or open a dedicated version file** named `<version_name>.md` under `docs/versions/` (e.g. `docs/versions/v0.2.md`).
- **Structured Specification from `SPEC.md`**: Read the developer's prompt/spec from `SPEC.md` (or chat) and structure `docs/versions/<version_name>.md` as follows:
  1. **Goals & Summary**: Core purpose and milestone description.
  2. **Scope & Requirements**: Bulleted list of all functional requirements and acceptance criteria from `SPEC.md`.
  3. **Technical Plan**: Affected modules, new components, and design decisions.
  4. **Continuous Work Log**: Live, running log of actions taken, files modified/created, decisions made, and test verification results.
- **Continuous Work Logging**: As code is implemented, keep the work log updated throughout the version until completion.
- **Preserve Invariants**: Every new version must preserve the core architecture, test coverage, and product rules.

## Product Rules & Invariants

- **Local only**: No accounts, cloud backend, telemetry, or network control plane.
- **Invisible when idle**: Notify only when developer attention is actually required.
- **Zero-config default**: `npm install -g pingback-cli` → `pingback setup`.
- **Adapter architecture**: Agent-specific code stays under `src/agents/<agent>/`. Core must never hard-code agent-specific behaviors.
- **Platform abstraction**: Platform-specific logic stays behind interfaces in `src/platform/`, not scattered `process.platform` checks.
- **Official integrations**: Do not guess or scrape terminal output when official hooks or APIs are available.

## Platform & Runtime Support

- Platforms: Windows (`win32`) & macOS (`darwin`)
- Runtime: Node.js >= 20 (CI-tested on Node 20, 22, and 24), TypeScript (ESM)
- Distribution: npm global package (`pingback-cli`)

## Architecture & Layout

```text
src/core/           events, routing, IPC, daemon lifecycle
src/agents/         adapter API + agent integrations (e.g. claude)
src/sessions/       session tracking + local JSON persistence
src/notifications/  desktop toasts + audio feedback
src/platform/       windows/ and macos/ platform implementations
src/config/         user settings and file paths
src/cli/            CLI commands (commander)
docs/versions/      milestone specs and work logs (v0.1.md, v0.2.md, ...)
```

### Key Entry Points
- CLI Entry: `src/cli/index.ts`
- Daemon Process: `src/daemon/main.ts` & `src/core/daemon.ts`
- Claude Adapter & Hooks: `src/agents/claude/`
- Platform Bridges (Toast/Audio): `src/platform/`
- Session Tracking: `src/sessions/`
- Notification Policy: `src/notifications/notification-policy.ts`

## How It Works

1. Agent hooks (e.g. Claude Code hooks) → `hook-entry` binary.
2. `hook-entry` sends payload over local IPC (named pipe on Windows / Unix socket on macOS, authenticated with local token) to background daemon.
3. Daemon normalizes events, updates session store, and determines notification priority.
4. Daemon dispatches desktop toast notification and/or sound.

## Event & Attention Model

- **High Attention** (Notification / StopFailure / Input needed): Triggers desktop toast + audio feedback.
- **Session Tracking** (SessionStart / UserPromptSubmit / SessionEnd): Updates session state in `session-store.ts` without triggering sound.

## Commands Agents Should Know

```bash
npm install          # install dependencies and prepare build tooling
npm run build        # compile TypeScript to dist/
npm test             # run unit and integration tests (vitest)
npm run test:watch   # vitest in watch mode
npm run lint         # run eslint checks
npm run lint:fix     # run eslint and auto-fix
npm run typecheck    # verify TypeScript types
npm run format:check # check code formatting (prettier)
npm run format       # format code with prettier

# CLI commands
pingback setup|start|stop|status|config|uninstall
```

CI: `.github/workflows/ci.yml` (Windows + macOS across Node 20, 22, and 24).

## Engineering Standards

1. Inspect the repo and existing patterns before adding or refactoring code.
2. Prefer simple, cross-platform implementations; minimize external dependencies.
3. Fail gracefully for user errors; keep stack traces behind debug logs.
4. Never log conversations, prompts, or large terminal dumps.
5. Tests are mandatory for core, router, sessions, adapters, notifications, and config.
6. Use Conventional Commits: `feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`.
7. Keep this file lean and evergreen.

## Privacy & Security

- Local daemon binds only to local IPC (named pipe / Unix domain socket), never `0.0.0.0` or public network ports.
- Auth token is stored on disk with restricted permissions.
- Session store holds session metadata (`id`, `cwd`, `pid`, `status`), never conversation or prompt text.
