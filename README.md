# PingBack

Never miss when your AI coding agent needs you.

PingBack v0.2 runs locally in the background and notifies you when Claude Code needs your attention during a long-running coding task. It supports configurable notification delays and sound, tracks concurrent projects independently, and can return you to the associated editor when you activate a notification.

Supported:

- Windows
- macOS
- Claude Code

## The problem

You give Claude Code a long task and switch to something else. Claude works for a few minutes, then stops to ask for permission to run a command — and waits. You don't notice for twenty minutes, because nothing told you.

PingBack closes that gap. When Claude needs you, you get a desktop notification and a sound, wherever you are on your machine.

## Installation

Requires Node.js 20 or newer.

```bash
npm install -g pingback-cli
```

The package is [`pingback-cli`](https://www.npmjs.com/package/pingback-cli) on npm (`pingback` was already taken). The command you run is still `pingback`. Tagged builds are also on [GitHub Releases](https://github.com/vijaysai1102/PingBack/releases).

## Setup

```bash
pingback setup
```

This detects your OS, Node.js, and Claude Code, installs the Claude Code integration, verifies notifications and sound, reports running supported editors, and starts the background daemon. No editor is required.

Restart any Claude Code sessions that are already open — hooks are read at session start.

That's it. Use Claude Code normally.

### Commands

| Command                              | What it does                                                |
| ------------------------------------ | ----------------------------------------------------------- |
| `pingback setup`                     | Detect Claude Code, install the integration, start PingBack |
| `pingback status`                    | Show daemon status and tracked sessions                     |
| `pingback start`                     | Start the background daemon                                 |
| `pingback stop`                      | Stop the background daemon                                  |
| `pingback config`                    | Show current settings                                       |
| `pingback config get <path>`         | Read a configuration section or value                       |
| `pingback config set <path> <value>` | Change a setting                                            |
| `pingback uninstall`                 | Remove the Claude Code integration                          |

`pingback status` looks like this:

```text
PINGBACK

Status: ● Running
Platform: Windows

Claude Code: [ok] Connected

Sessions
────────────────────────────────

⚠ Claude
  Project: PingBack
  Status: Waiting
  Waiting: 42s

● Claude
  Project: FinBot
  Status: Working
  Running: 1m 15s

2 active sessions
1 session needs your attention.
```

## How it works

PingBack registers [Claude Code hooks](https://docs.claude.com/en/docs/claude-code/hooks) in `~/.claude/settings.json`. When Claude fires a hook, a short-lived script forwards the payload to the PingBack daemon over a local IPC channel. The daemon normalizes the payload, updates the session, and decides whether to notify you.

```text
Claude Code
    │  hook fires
    ▼
hook-entry script
    │  local IPC (named pipe / Unix socket)
    ▼
PingBack daemon ──► session tracking
    │
    ▼
desktop notification + sound
```

Five hooks are installed:

| Hook               | Meaning for PingBack                                               |
| ------------------ | ------------------------------------------------------------------ |
| `Notification`     | Claude wants your attention (permission prompt, idle, needs input) |
| `StopFailure`      | Claude stopped because of an error                                 |
| `SessionStart`     | Session is working                                                 |
| `UserPromptSubmit` | Session is working                                                 |
| `SessionEnd`       | Session completed                                                  |

### When it makes a sound

Events are classified by priority, and each priority gets a distinct tone so you can tell what happened without looking at the screen.

| Priority | Example                          | Sound        |
| -------- | -------------------------------- | ------------ |
| High     | Claude needs permission or input | `attention`  |
| Medium   | Claude stopped with an error     | `error`      |
| Low      | Turn or task finished            | `completion` |

All enabled v0.2 event types notify and play a short sound by default. You can disable sound globally or choose a lower volume without disabling the desktop notification.

The sounds are plain WAV tones generated at build time, so there are no bundled audio assets or licensing concerns. Playback uses `afplay` on macOS and PowerShell on Windows.

### Duplicate suppression

The daemon drops repeated events — both by event ID and within a short time window — so a burst of hooks produces one notification rather than a stream of them.

## Configuration

```bash
pingback config
pingback config get notifications
pingback config set notifications.sound.enabled false
pingback config set notifications.sound.volume 0.8
pingback config set notifications.events.attention_required.delaySeconds 5
```

| Key                                                    | Values                 | Default |
| ------------------------------------------------------ | ---------------------- | ------- |
| `notifications.enabled`                                | `true` / `false`       | `true`  |
| `notifications.sound.enabled`                          | `true` / `false`       | `true`  |
| `notifications.sound.volume`                           | number from `0` to `1` | `1`     |
| `notifications.events.attention_required.delaySeconds` | non-negative seconds   | `5`     |
| `notifications.events.question.delaySeconds`           | non-negative seconds   | `5`     |
| `notifications.events.turn_completion.delaySeconds`    | non-negative seconds   | `5`     |
| `notifications.events.error.delaySeconds`              | non-negative seconds   | `5`     |
| `notifications.events.task_completed.delaySeconds`     | non-negative seconds   | `5`     |

Every event also supports an `.enabled` boolean at the same path. By default, all events wait 5 seconds before firing so you have time to respond directly in the terminal without interruption. Setting `delaySeconds` to `0` causes an event to notify immediately. Existing v0.1 `notifications.desktop` and boolean `notifications.sound` settings are read safely as backward-compatible inputs.

Restart PingBack after changing settings:

```bash
pingback stop && pingback start
```

A malformed config file never prevents PingBack from starting — invalid fields fall back to defaults with a warning.

## Editor focusing

When you activate a PingBack notification, it can bring the associated VS Code or Cursor application to the foreground on Windows and macOS. PingBack only considers an editor when that editor's own process command line explicitly includes the Claude session's project path. A running editor alone is never enough.

This is best effort: OS foreground rules or macOS accessibility permissions can prevent focusing, but the notification is still delivered. PingBack does **not** focus individual terminal windows, terminal tabs, or switch terminal sessions.

### File locations

**Windows**

```text
%APPDATA%\PingBack\config.json           settings
%LOCALAPPDATA%\PingBack\sessions.json    tracked sessions
%LOCALAPPDATA%\PingBack\logs\daemon.log  log
```

**macOS**

```text
~/Library/Application Support/PingBack/config.json     settings
~/Library/Application Support/PingBack/sessions.json   tracked sessions
~/Library/Logs/PingBack/daemon.log                     log
```

## Privacy

PingBack is completely local. It makes no network requests, has no telemetry, no accounts, and no external services.

It never reads or stores your conversations, prompts, or code. A session record contains only what's needed to tell you which project needs attention:

```json
{
  "id": "71c8ce2f-e046-42c5-96c1-a116e571ca2e",
  "agent": "claude",
  "status": "waiting",
  "startedAt": 1786223520275,
  "lastActivityAt": 1786223520837,
  "cwd": "C:\\PingBack",
  "pid": 34676
}
```

Notification text comes from Claude's own hook message (for example, "Claude needs your permission to use Bash"). Log fields are truncated to 500 characters so nothing large is ever written to disk.

The daemon listens on a named pipe (Windows) or a Unix domain socket (macOS) — never a network port — and requires a token stored with restricted permissions, so other users on the machine can't inject events.

Editor inspection happens only while preparing a notification or during setup. It uses process name, command line, and process ID transiently to find a project-specific editor; none of that process data is persisted in session storage.

## Troubleshooting

**No notifications appear**

Check the daemon is running and Claude is connected:

```bash
pingback status
```

If it says `Not running`, run `pingback start`.

**Claude Code shows as not connected**

The hooks aren't installed. Run `pingback setup` again, then restart your Claude Code sessions — hooks are only read when a session starts.

**Notifications work but there's no sound**

Confirm sound is enabled with `pingback config`. Sound failures never block a notification: if audio fails, you still get the toast and a warning is written to the log.

**Check the log**

The log records whether a notification was actually delivered:

```json
{"level":"info","msg":"event routed","type":"attention_required","priority":"high"}
{"level":"info","msg":"notification delivered","priority":"high"}
```

If you see `event routed` but no `notification delivered`, the OS rejected the toast. Set `logLevel` to `debug` for more detail.

**Windows notifications are silent or hidden**

Check Windows Focus Assist / Do Not Disturb, and confirm notifications are allowed in Settings → System → Notifications.

**A notification does not focus my editor**

Open the project in VS Code or Cursor before the attention event, and ensure the editor command line includes that project path. On macOS, grant the host terminal or PingBack accessibility permission if System Events requests it. A focus failure never blocks the toast.

**Start over**

```bash
pingback uninstall
pingback setup
```

`uninstall` removes PingBack's hooks and leaves the rest of your Claude Code settings untouched.

## Security note on dependencies

`npm audit` reports a moderate advisory ([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)) for `uuid`, pulled in transitively by `node-notifier`. There is no upstream fix available.

It is not reachable from PingBack. The advisory covers a missing buffer bounds check in `uuid`'s `v3`/`v5`/`v6` functions when a `buf` argument is supplied. `node-notifier` calls `uuid` in exactly one place — `v4()` with no arguments, to name a pipe — so the affected code path is never executed.

We kept `node-notifier` deliberately. It is the most widely used notification library in the Node ecosystem and bundles the native toast helper that gives PingBack a proper app identity on Windows. Swapping it for a smaller, less-audited fork to silence a warning about unreachable code would trade a cosmetic issue for real supply-chain risk.

## Development

```bash
npm install
npm run build      # generates sounds, then compiles TypeScript
npm test
npm run lint
npm run typecheck
npm run format
```

Testing uses Vitest. `tests/integration/end-to-end.test.ts` drives the full chain — hook payload through daemon to notification and session state — with the notifier stubbed.

To try local changes against real Claude Code:

```bash
npm run build
npm pack
npm install -g ./pingback-cli-0.2.1.tgz
pingback setup
```

`setup` rewrites the hook path in place, so switching between a development checkout and a global install won't leave duplicate hooks behind.

### Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

- **Quality** — formatting, lint, and types.
- **Test** — the full suite on Windows and macOS across Node 20.19, 22, and 24.
- **Package smoke** — packs the real tarball, installs it globally, and drives the CLI from outside the repo, including the daemon start/status/stop lifecycle and a config round-trip.

The package smoke job exists because the failures that hurt most are the ones unit tests can't see: a broken `bin` path, a missing bundled sound, or a bad `files` list. Those only appear once someone actually installs the package.

Two constraints shape the workflow. The build must run before the tests, because the sound assets are generated rather than committed. And every job runs on Windows or macOS — never Linux — because `package.json` declares `os: ["win32", "darwin"]`, which makes `npm ci` fail outright on a Linux runner.

`.github/workflows/release.yml` runs on a `v*` tag. It repeats the full gate on both platforms, checks that the tag matches the version in `package.json`, runs `npm publish --dry-run`, verifies the tarball contains the CLI, daemon, hook entry point, and sounds while containing no tests, and uploads the tarball as a build artifact. `pingback-cli` is published on npm from the tagged release; the workflow's own publish job is still commented out pending an `NPM_TOKEN` repository secret.

## Architecture

PingBack keeps agent-specific code out of the core. Nothing in `core/`, `notifications/`, or `sessions/` knows that Claude Code exists.

The short agent brief (loaded every Claude Code session) lives in [`CLAUDE.md`](CLAUDE.md). Milestone specifications and work logs live in [`docs/versions/`](docs/versions/) (such as the [v0.1 baseline specification](docs/versions/v0.1.md)).

```text
src/
  core/           events, routing, IPC, daemon
  agents/         adapter interface + Claude Code integration
  sessions/       session tracking and persistence
  notifications/  desktop notifications and sound
  platform/       Windows and macOS specifics
  config/         settings
  cli/            command line interface
  utils/          logging, paths, errors
```

Platform differences — file locations, IPC endpoint, sound playback — sit behind a single `Platform` interface with one implementation per OS, so no OS checks are scattered through the codebase.

Agent events are normalized into a common model (`attention_required`, `question`, `turn_completion`, `error`, `task_completed`) at the boundary. Adding an agent means writing an adapter that produces those events, not modifying the core.

## Limitations

- Claude Code is the only supported agent in v0.2.
- Windows and macOS only. Linux is not supported.
- Notifications are local to the machine Claude is running on; there is no phone or remote delivery.
- Editor foregrounding supports VS Code and Cursor only when a project-specific association is reliable.
- PingBack does not focus individual terminal windows, terminal tabs, or terminal sessions.

## Future agent integrations

The adapter interface keeps future integrations isolated from the core. v0.2 ships Claude Code only, and PingBack does not claim support for anything that isn't implemented.

## License

[MIT](LICENSE) © Vijay Sai Chigullapally
