# PingBack

Never miss when your AI coding agent needs you.

PingBack is a local background daemon that tracks supported coding-agent sessions and sends a desktop notification—with optional sound—when an event needs attention. It has no account, cloud service, telemetry, or network listener.

## Supported platforms and agents

- Windows and macOS (Node.js 20+)
- Claude Code
- Codex CLI

## Install and set up

```powershell
npm install -g pingback-cli
pingback setup
```

Setup detects each installed supported CLI, configures only the available integrations, verifies notification delivery, and starts the local daemon. Missing agents are optional and do not prevent setup.

Restart an agent session opened before setup so it reloads its integration configuration.

## Commands

| Command                             | Description                                                            |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `pingback setup`                    | Detect agents, configure integrations, and start the daemon.           |
| `pingback start` / `pingback stop`  | Manage the local daemon.                                               |
| `pingback status`                   | Show the daemon plus sessions grouped by agent.                        |
| `pingback config`                   | Display notification settings.                                         |
| `pingback config set <key> <value>` | Update a notification setting.                                         |
| `pingback uninstall`                | Remove PingBack integrations without removing unrelated configuration. |

## How integrations work

All agent-specific payloads are normalized into the same local event/session model before reaching the session store and notification system.

- Claude Code uses its lifecycle hooks for working, attention, error, and completion events.
- Codex CLI uses its supported `config.toml` `notify` command for completion, plus asynchronous official lifecycle hooks for working state and permission requests. A permission request produces an attention notification, but PingBack deliberately emits no decision or stdout, so Codex's normal approval dialog remains in control. Codex does not expose separate official events for ordinary questions or errors/failures, so PingBack cannot send distinct alerts for those cases. An existing `notify` command is saved, forwarded by the PingBack bridge, and restored by uninstall. After setup, open Codex `/hooks` and trust the new PingBack command once.

## Notification defaults

By default:

- Attention required, questions, and errors show a desktop notification and play sound immediately.
- Task completion shows a desktop notification without sound.
- Desktop notifications and sound can each be disabled globally.
- Volume accepts a value from `0.0` to `1.0`.

### Event reference

| Event                | Meaning                                          | Claude Code                                                             | Codex CLI                      | Default alert   |
| -------------------- | ------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------ | --------------- |
| `attention_required` | The agent is blocked and needs you to intervene. | Permission needed, waiting for input, or stopped awaiting intervention. | Permission or approval needed. | Desktop + sound |
| `question`           | The agent explicitly asks a normal question.     | Supported.                                                              | No separate official event.    | Desktop + sound |
| `error`              | The agent stopped because of a failure.          | Supported.                                                              | No separate official event.    | Desktop + sound |
| `task_completed`     | The agent finished its work or turn.             | Supported.                                                              | Supported.                     | Desktop only    |

Each event can have a grace period. PingBack waits for that period before alerting, so a situation that resolves quickly can avoid an unnecessary notification.

### Change notification settings

View the active local settings:

```powershell
pingback config
```

Set global sound or volume:

```powershell
pingback config set notifications.sound false
pingback config set notifications.volume 0.7
```

Change one event's desktop, sound, or delay setting:

```powershell
pingback config set notifications.events.attention_required.sound false
pingback config set notifications.events.task_completed.desktop false
pingback config set notifications.events.error.delaySeconds 5
```

Event-level `desktop`, `sound`, and optional `delaySeconds` settings are also available through `pingback config set`.

For example, to use a five-second grace period for every event in your local configuration:

```powershell
pingback config set notifications.events.attention_required.delaySeconds 5
pingback config set notifications.events.question.delaySeconds 5
pingback config set notifications.events.error.delaySeconds 5
pingback config set notifications.events.task_completed.delaySeconds 5
```

Restart PingBack after changing settings: `pingback stop`, then `pingback start`.

## Return to Agent

Notifications include a session-bound `Return to <Agent>` action. The action resolves the recorded agent and session ID together, so simultaneous Claude and Codex sessions cannot be mixed up.

- On Windows, PingBack follows the agent PID's parent chain and focuses only a recognized terminal or VS Code window with a visible handle.
- On macOS, PingBack selects a Terminal.app or iTerm tab only when its TTY exactly matches the agent process.
- If the mapping is absent, ambiguous, unsupported, or blocked by OS focus restrictions, PingBack does not focus another window. It shows a fallback with the project path instead.

macOS terminal focus is unit-tested but still needs manual validation on a Mac, including any Automation permission prompt.

## Privacy and security

PingBack stays local:

- The daemon uses a user-scoped named pipe on Windows or Unix socket on macOS.
- IPC requests require a local token.
- Session records contain only ID, agent, status, timestamps, working directory, and PID when available.
- PingBack never stores prompts, conversation transcripts, source code, or terminal buffers.

## Troubleshooting

Run `pingback status` first. If the daemon is stopped, run `pingback start`; if an integration is not configured, rerun `pingback setup` and restart the relevant agent session.

For a failed Return action, use the project path in the fallback notification. PingBack intentionally avoids guessing among unrelated terminal windows.

On Windows, ensure PingBack is allowed in **Settings → System → Notifications**. On macOS, allow notification and Automation permissions when prompted.

## Development

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

The project supports only Windows and macOS. Please do not add cloud services, telemetry, or additional agent integrations without an explicit change request.
