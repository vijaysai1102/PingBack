# PingBack — v0.1 Engineering Specification

> **For coding agents:** start with the short brief in [`CLAUDE.md`](../CLAUDE.md) at
> the repo root. That file is loaded every session. Open this document only when you
> need the full engineering detail behind a decision.

## 1. Project Overview

Build **PingBack**, a cross-platform developer attention/notification tool for AI coding agents.

The initial goal is very focused:

> When Claude Code is running a long-running coding task and reaches a state where it needs the developer's attention, PingBack should detect that event and notify the developer with a desktop notification and optional sound.

The developer may have stepped away from the computer, switched to another application, or simply forgotten that Claude Code was running.

PingBack exists to bring the developer's attention back to the correct coding session.

### v0.1 scope

Support:

* Windows
* macOS
* Claude Code
* npm global installation
* TypeScript
* Local background daemon
* Claude Code integration
* Desktop notifications
* Notification sounds
* Basic Claude session tracking
* Clean CLI
* Local-only operation
* No account
* No cloud backend
* No telemetry

Do **not** implement Codex, AGY/Antigravity, Cursor, GitHub Copilot, Gemini CLI, Linux, mobile applications, cloud synchronization, or a web dashboard in v0.1.

However, the architecture MUST make it straightforward to add other agents later.

---

# 2. Product Philosophy

PingBack is NOT an alarm clock.

It is an **agent attention layer**.

The conceptual flow is:

```text
Developer
    ↓
Starts Claude Code
    ↓
Claude works autonomously
    ↓
Developer switches away / walks away
    ↓
Claude needs developer attention
    ↓
PingBack detects the event
    ↓
PingBack determines the relevant session
    ↓
Desktop notification + optional sound
    ↓
Developer returns to the coding session
```

The product should feel:

* lightweight
* invisible while nothing requires attention
* reliable
* developer-focused
* cross-platform
* privacy-friendly
* easy to install
* zero-config for normal users

Do not turn this into a general productivity application.

---

# 3. Core Design Principle

The architecture MUST separate:

1. PingBack Core
2. Agent integrations/adapters
3. Session management
4. Notification system
5. Platform-specific functionality
6. CLI

Do NOT hard-code Claude-specific behavior throughout the core.

Use an adapter architecture.

The intended future architecture is:

```text
                    PingBack Core
                         │
                 Agent Adapter API
                         │
            ┌────────────┼────────────┐
            │            │            │
          Claude        Codex        AGY
          Adapter       Adapter      Adapter
```

Only implement the Claude adapter in v0.1.

The future addition of Codex or AGY should require creating a new adapter rather than rewriting the core.

---

# 4. Technology Requirements

Use:

* Node.js
* TypeScript
* npm
* modern TypeScript configuration
* strict TypeScript mode
* ESLint
* Prettier
* a suitable test framework such as Vitest
* a suitable desktop notification library that works on Windows and macOS

Prefer well-maintained, lightweight dependencies.

Do not introduce a heavy framework unless there is a strong technical reason.

The package must be distributable through npm.

The intended installation is:

```bash
npm install -g pingback
```

The package must expose a CLI executable named:

```bash
pingback
```

---

# 5. Cross-Platform Requirement

v0.1 MUST support:

* Windows
* macOS

Do not build Windows first and postpone macOS.

The application architecture must account for both from the beginning.

Avoid scattering platform checks throughout the codebase.

Bad:

```typescript
if (process.platform === "win32") {
   // random implementation
}

if (process.platform === "darwin") {
   // another random implementation
}
```

Instead, isolate platform-specific functionality behind interfaces.

For example:

```typescript
interface NotificationService {
  notify(options: NotificationOptions): Promise<void>;
}
```

and:

```text
platform/
    windows/
    macos/
```

The core should interact with interfaces rather than directly with operating-system APIs.

---

# 6. Proposed Project Structure

Start with a clean structure similar to:

```text
pingback/
│
├── src/
│   ├── cli/
│   │   ├── index.ts
│   │   └── commands/
│   │       ├── setup.ts
│   │       ├── start.ts
│   │       ├── stop.ts
│   │       ├── status.ts
│   │       └── config.ts
│   │
│   ├── core/
│   │   ├── daemon.ts
│   │   ├── event-bus.ts
│   │   ├── event-router.ts
│   │   └── types.ts
│   │
│   ├── agents/
│   │   ├── adapter.ts
│   │   └── claude/
│   │       ├── adapter.ts
│   │       ├── detector.ts
│   │       └── types.ts
│   │
│   ├── sessions/
│   │   ├── session-manager.ts
│   │   └── session-store.ts
│   │
│   ├── notifications/
│   │   ├── notification-service.ts
│   │   ├── desktop-notification.ts
│   │   └── sound-service.ts
│   │
│   ├── platform/
│   │   ├── platform.ts
│   │   ├── windows/
│   │   └── macos/
│   │
│   ├── config/
│   │   └── config-manager.ts
│   │
│   └── utils/
│
├── tests/
│   ├── core/
│   ├── agents/
│   ├── sessions/
│   └── notifications/
│
├── assets/
│   └── sounds/
│
├── package.json
├── tsconfig.json
├── eslint.config.js
├── prettier.config.js
├── vitest.config.ts
├── README.md
└── CLAUDE.md
```

You may modify this structure if there is a strong reason, but keep the same architectural separation.

Do not over-engineer the project.

---

# 7. Core Event Model

Create a normalized internal event system.

The core MUST NOT need to understand Claude-specific event formats.

Define a common event model similar to:

```typescript
type AgentType = "claude";

type AgentEventType =
  | "attention_required"
  | "task_completed"
  | "error"
  | "question";

interface AgentEvent {
  id: string;
  agent: AgentType;
  sessionId: string;
  type: AgentEventType;

  title: string;
  message: string;

  cwd?: string;
  pid?: number;

  timestamp: number;

  metadata?: Record<string, unknown>;
}
```

Keep this extensible for future agents.

Do not assume Claude is the only possible agent in the architecture.

---

# 8. Attention Priority

The notification system should understand event priority.

Define something similar to:

```typescript
type EventPriority =
  | "low"
  | "medium"
  | "high";
```

Suggested behavior:

### Low

Examples:

* task completed

Notification:

* desktop notification
* no sound by default

### Medium

Examples:

* error

Notification:

* desktop notification
* short sound

### High

Examples:

* Claude requires user attention
* permission/approval required
* Claude asks a question

Notification:

* desktop notification
* attention sound

The exact event classification must be based on Claude's real integration mechanisms.

Do NOT invent event types that Claude does not actually expose.

---

# 9. Claude Code Integration

This is the most important part of v0.1.

Before implementing the Claude adapter:

1. Research the currently supported Claude Code integration mechanisms.
2. Prefer official Claude Code hooks/events/APIs over process-output scraping.
3. Determine exactly which events can indicate that Claude needs user attention.
4. Determine what session information is available.
5. Determine whether the Claude process/session PID can be associated with the event.
6. Determine what information is available about the current working directory.
7. Determine how Claude sessions can be identified or resumed.

Do not assume an API exists.

Do not invent undocumented hook names.

Do not build the system around parsing arbitrary terminal output unless there is no reliable official mechanism available.

If official mechanisms do not expose a required piece of information, document the limitation and design the smallest reliable fallback.

---

# 10. Claude Adapter Interface

Create a generic adapter interface similar to:

```typescript
interface AgentAdapter {
  readonly name: string;

  detect(): Promise<boolean>;

  setup(): Promise<void>;

  uninstall(): Promise<void>;

  getSessions(): Promise<AgentSession[]>;

  start(): Promise<void>;

  stop(): Promise<void>;
}
```

The exact interface may change based on the actual Claude integration.

The important principle is:

> PingBack Core communicates with adapters through a stable abstraction.

Claude-specific implementation stays inside:

```text
src/agents/claude/
```

---

# 11. Session Tracking

v0.1 needs basic session tracking.

A session should contain enough information to identify a Claude session and understand its state.

Use something similar to:

```typescript
type SessionStatus =
  | "working"
  | "waiting"
  | "completed"
  | "error"
  | "unknown";

interface AgentSession {
  id: string;

  agent: "claude";

  pid?: number;

  cwd?: string;

  status: SessionStatus;

  startedAt: number;

  lastActivityAt?: number;

  metadata?: Record<string, unknown>;
}
```

Do not build a complicated database.

A lightweight local persistence mechanism is sufficient.

JSON or another simple local store is acceptable for v0.1.

The session store should survive daemon restarts when practical.

---

# 12. Session Identity

Session identity is important.

If the developer has:

```text
Terminal 1 → Claude → Project A
Terminal 2 → Claude → Project B
Terminal 3 → Claude → Project C
```

PingBack must avoid confusing the sessions.

At minimum, use available:

* session ID
* process ID
* working directory
* agent metadata

to distinguish sessions.

Do not assume that one Claude process means one global user session.

---

# 13. Local Daemon

PingBack should run as a local background daemon.

The daemon is responsible for:

```text
Agent integrations
      ↓
Event ingestion
      ↓
Event normalization
      ↓
Session tracking
      ↓
Notification routing
```

The daemon MUST:

* run locally
* not require an internet connection
* not require a PingBack account
* not send user source code anywhere
* not require a remote server

Use local IPC, localhost HTTP, Unix sockets, named pipes, or another appropriate mechanism for communication.

Choose the simplest reliable approach that works on Windows and macOS.

Do not create a cloud backend.

---

# 14. CLI

The CLI should initially provide:

```bash
pingback
pingback setup
pingback start
pingback stop
pingback status
pingback config
```

### `pingback setup`

This should:

1. Detect supported operating system.
2. Detect Node.js.
3. Detect Claude Code.
4. Configure the Claude integration.
5. Configure notification support.
6. Configure sound support.
7. Start/configure the daemon.
8. Display a clear success message.

Example:

```text
PINGBACK

Checking your system...

✓ macOS detected
✓ Node.js detected
✓ Claude Code detected

Setting up Claude Code integration...
✓ Done

Setting up notifications...
✓ Done

Starting PingBack...
✓ Running

PingBack is ready.

You can use Claude Code normally.
We'll notify you when Claude needs your attention.
```

Do not ask unnecessary questions.

Normal users should not need to manually edit configuration files.

---

# 15. `pingback status`

Implement:

```bash
pingback status
```

Example:

```text
PINGBACK

Status: ● Running
Platform: macOS

Claude Code: ✓ Connected

Sessions
────────────────────────────────

● Claude
  Project: finbot
  Status: Working
  Running: 12m

⚠ Claude
  Project: agent-monitor
  Status: Waiting
  Waiting: 42s

1 session needs your attention.
```

This is primarily a diagnostic command.

Keep the output readable.

---

# 16. Desktop Notifications

Use the operating system's native notification system or a well-maintained Node abstraction.

Notifications should include:

* PingBack application name
* agent name
* event title
* useful short description
* project/workspace when available

Example:

```text
PingBack

Claude Code needs your attention

Claude is waiting for permission.

Project: finbot
```

Do not put huge amounts of terminal output in notifications.

Keep notifications concise.

---

# 17. Notification Sound

v0.1 must support a short attention sound.

The sound should:

* be short
* be subtle
* not be obnoxious
* work on Windows and macOS
* be bundled with the package if licensing permits

Provide at least:

```text
attention sound
```

Optionally:

```text
completion sound
error sound
```

Do not require the user to install additional software just to hear the sound.

If the operating system or notification mechanism already provides a reliable sound option, use that where appropriate.

---

# 18. Notification Configuration

Provide sensible defaults.

Suggested defaults:

```json
{
  "notifications": {
    "desktop": true,
    "sound": true
  }
}
```

Do not make configuration complicated.

Eventually support:

```bash
pingback config
```

but do not build an elaborate settings UI in v0.1.

---

# 19. Privacy

Privacy is a core product principle.

v0.1 should be completely local.

Never:

* upload source code
* upload terminal output
* upload Claude conversations
* collect project names remotely
* collect file names remotely
* require authentication

Do not add telemetry.

If logging is needed, log locally.

Provide a way to inspect local logs for debugging.

---

# 20. Error Handling

The application should fail gracefully.

Examples:

### Claude Code isn't installed

```text
Claude Code was not detected.

Install Claude Code and run:

    pingback setup
```

### Notification unavailable

```text
PingBack could not initialize desktop notifications.

Claude integration is still running.

Run `pingback status` for details.
```

### Daemon isn't running

```text
PingBack daemon is not running.

Run:

    pingback start
```

Do not crash with an unhandled stack trace for normal user errors.

Detailed stack traces should be available through debug logging.

---

# 21. Logging

Implement structured local logging.

Levels:

```text
debug
info
warn
error
```

Logs should help diagnose:

* daemon startup
* Claude detection
* integration setup
* session creation
* session state changes
* incoming agent events
* notification creation
* notification failures

Never log sensitive terminal content unnecessarily.

Do not log complete Claude conversations.

---

# 22. Testing

Testing is mandatory.

Write unit tests for:

### Core

* event routing
* event normalization
* event priority
* session management

### Claude adapter

* detection
* event conversion
* session identification
* malformed input handling

### Notifications

* notification payload generation
* priority behavior
* sound selection

### Configuration

* default configuration
* loading
* saving
* invalid configuration handling

### CLI

Test important commands and failure states.

Also create integration tests where practical.

The code should be testable without requiring a real Claude Code installation for every test.

Use mocks/fakes for agent integrations.

---

# 23. Cross-Platform Testing

The implementation must account for:

```text
Windows
macOS
```

Platform-specific code should be isolated.

At minimum test:

* path handling
* process handling
* configuration directory
* notification behavior
* daemon lifecycle

Do not use hard-coded Unix paths.

Do not use Windows-only assumptions in the core.

Do not use macOS-only assumptions in the core.

---

# 24. Security

The local daemon must not expose an unnecessary network surface.

If using localhost HTTP:

* bind only to localhost
* do not bind to `0.0.0.0`
* validate requests
* use an authentication token or another local trust mechanism if appropriate

If IPC provides a safer/simple cross-platform mechanism, prefer it.

Do not expose PingBack's control API to the public network.

---

# 25. npm Package Requirements

The final package should:

* compile TypeScript to distributable JavaScript
* include only required runtime files
* expose the CLI through `bin`
* work after global installation
* not require the repository to be present
* correctly locate bundled assets such as sounds
* handle Windows and macOS paths correctly

Expected usage:

```bash
npm install -g pingback
```

Then:

```bash
pingback setup
```

Then:

```bash
pingback status
```

---

# 26. Package Scripts

Provide sensible scripts such as:

```json
{
  "scripts": {
    "build": "...",
    "dev": "...",
    "test": "...",
    "test:watch": "...",
    "lint": "...",
    "format": "...",
    "typecheck": "..."
  }
}
```

All of these should work before considering v0.1 complete.

---

# 27. Documentation

Create a high-quality README.

The README should explain:

1. What PingBack is.
2. The problem it solves.
3. Supported platforms.
4. Supported agent.
5. Installation.
6. Setup.
7. How it works.
8. Configuration.
9. Privacy.
10. Troubleshooting.
11. Development setup.
12. Architecture.
13. Future agent integrations.

Example opening:

```text
# PingBack

Never miss when your AI coding agent needs you.

PingBack runs locally in the background and notifies you
when Claude Code needs your attention during a long-running
coding task.

Supported:
- Windows
- macOS
- Claude Code
```

Do not claim support for features that have not actually been implemented.

---

# 28. What NOT to build in v0.1

Strictly avoid scope creep.

Do NOT build:

* Codex integration
* AGY/Antigravity integration
* Cursor integration
* GitHub Copilot integration
* Gemini integration
* Linux support
* mobile app
* browser extension
* web dashboard
* cloud backend
* user accounts
* authentication service
* analytics
* telemetry
* team features
* subscriptions
* payment system
* AI-generated summaries
* remote notifications
* phone notifications
* complicated GUI
* large database
* complicated plugin marketplace

The architecture should allow these later, but implementation should remain out of v0.1.

---

# 29. Future Architecture

The long-term product is intended to become a universal attention layer for agentic coding.

Future:

```text
                    PingBack Core
                         │
          ┌──────────────┼──────────────┐
          │              │              │
       Claude          Codex           AGY
       Adapter         Adapter         Adapter
          │              │              │
       Cursor         Copilot       Gemini CLI
       Adapter         Adapter         Adapter
```

Each agent should produce normalized PingBack events.

Potential future events:

```text
attention_required
permission_required
question
task_completed
task_failed
agent_idle
context_required
```

The v0.1 architecture should make this possible without rewriting the core.

---

# 30. Development Method

Do not attempt to implement everything at once.

Work in milestones.

## Milestone 1 — Repository foundation

Implement:

* TypeScript
* npm configuration
* CLI
* linting
* formatting
* tests
* build
* project structure

Verify:

```bash
npm run build
npm test
npm run lint
npm run typecheck
```

all work.

---

## Milestone 2 — Core event system

Implement:

* AgentEvent
* EventBus
* EventRouter
* session manager
* basic local state

Write tests.

Do not implement Claude-specific behavior inside the core.

---

## Milestone 3 — Daemon

Implement:

* daemon lifecycle
* start
* stop
* status
* local IPC

Verify the daemon can run independently.

---

## Milestone 4 — Notifications

Implement:

* desktop notification
* sound
* priority handling
* cross-platform abstraction

Test manually on:

* Windows
* macOS

---

## Milestone 5 — Claude integration

Research the current official Claude Code integration mechanisms first.

Then implement:

* Claude detection
* Claude integration setup
* event ingestion
* event normalization
* session identification
* attention event handling

Do not guess undocumented APIs.

---

## Milestone 6 — Session tracking

Implement:

* session creation
* session updates
* session completion
* waiting state
* error state
* local persistence

---

## Milestone 7 — End-to-end test

The target scenario is:

```text
Install PingBack
       ↓
pingback setup
       ↓
Claude Code detected
       ↓
daemon starts
       ↓
Claude starts
       ↓
Claude works
       ↓
Claude requires user attention
       ↓
PingBack receives event
       ↓
PingBack identifies session
       ↓
Desktop notification appears
       ↓
Sound plays
       ↓
Session appears as "waiting"
       ↓
Developer returns to Claude
```

This must work reliably before calling v0.1 complete.

---

# 31. Important Engineering Rule

When you encounter an API, hook, CLI behavior, or integration detail that is uncertain:

**DO NOT GUESS.**

Research the current official documentation first.

If documentation is ambiguous:

1. inspect the installed CLI
2. inspect available help commands
3. create a minimal test
4. verify behavior
5. document the result

Never build critical architecture around an assumed undocumented behavior.

---

# 32. Another Important Rule

Before adding a dependency, ask:

1. Is Node.js/TypeScript sufficient?
2. Is the dependency actively maintained?
3. Does it support Windows and macOS?
4. Does it introduce unnecessary complexity?
5. Can the functionality be isolated behind an interface?

Prefer fewer dependencies.

---

# 33. Developer Experience

The final user should be able to go from zero to working PingBack with:

```bash
npm install -g pingback
pingback setup
```

No manual configuration should be required for the normal case.

The final experience should feel like:

> Install → setup → forget PingBack exists → get notified when Claude needs you.

That is the product.

---

# 34. Definition of Done

v0.1 is complete only when all of the following are true:

### Installation

```bash
npm install -g pingback
```

works on Windows and macOS.

### Setup

```bash
pingback setup
```

detects Claude Code and configures PingBack.

### Daemon

PingBack can run locally in the background.

### Claude

PingBack can receive reliable Claude Code events through the appropriate supported integration mechanism.

### Sessions

PingBack can identify and track basic Claude sessions.

### Notifications

PingBack can produce a desktop notification.

### Sound

PingBack can produce an attention sound.

### CLI

These commands work:

```bash
pingback setup
pingback start
pingback stop
pingback status
```

### Reliability

The daemon handles:

* restart
* malformed events
* missing Claude
* missing notification capability
* duplicate events
* multiple Claude sessions

gracefully.

### Privacy

No cloud service or telemetry is required.

### Tests

Unit tests and important integration tests pass.

### Documentation

README explains installation, setup, architecture, privacy, troubleshooting, and limitations.

---

# 35. How You Should Work on This Project

Act as the lead engineer for PingBack.

Before writing substantial code:

1. Inspect the repository.
2. Inspect the existing package configuration.
3. Research the current Claude Code integration mechanisms.
4. Verify the actual behavior instead of assuming.
5. Propose the implementation plan.
6. Implement incrementally.
7. Run tests after each major milestone.
8. Fix errors before moving forward.
9. Keep the architecture simple.
10. Do not add features outside v0.1 scope.

When a design decision has multiple viable options, prefer the option that:

* is simplest
* is cross-platform
* is maintainable
* minimizes dependencies
* preserves future extensibility
* keeps the user experience zero-config

Do not rewrite working code unnecessarily.

Do not introduce abstractions merely for the sake of abstraction.

---

# 36. Final Product Principle

PingBack should disappear into the developer's workflow.

The user should not think:

> "I need to use PingBack."

They should think:

> "I can start Claude Code, walk away, and trust that PingBack will bring me back when Claude needs me."

That is the core value proposition.

Build v0.1 around that single experience.
