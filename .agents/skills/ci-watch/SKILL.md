---
name: ci-watch
description: >-
  Verify PingBack locally, then watch the GitHub Actions workflow named CI
  after an approved push, using the bundled helper. ONLY activate when the user
  explicitly requests to watch CI, check GitHub Actions, run "/ci-watch", or
  monitor a workflow run. Do NOT invoke automatically or autonomously.
---

# CI Watch

Execute the helper. Do not improvise PowerShell or `gh` polling loops, and do
not use `gh run watch` (it opens a TUI). This skill watches the workflow named
`CI` only — not `Release`.

```bash
node .agents/skills/ci-watch/scripts/ci-watch.mjs expect
node .agents/skills/ci-watch/scripts/ci-watch.mjs find
node .agents/skills/ci-watch/scripts/ci-watch.mjs watch
node .agents/skills/ci-watch/scripts/ci-watch.mjs failed [run-id]
```

Stdout is one JSON object. Read `action` (and `run.url`). Stderr is progress.
The helper never pushes, commits, or edits files.

---

## 1. Verify locally

`npm test` needs generated sound assets, so run `build` before `test`. If one
check fails, fix it and rerun the full set. Do not push red local checks.

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
```

This is `quality` + `test` on the current OS/Node only. It does not cover the
OS × Node matrix or the `package` smoke job.

---

## 2. Approve and push

Ask for the exact branch and commit before **every** push, including
remediations. Call out `main`. Do not push unrelated dirty files.

```bash
git push
# git push -u origin HEAD
```

Then run `watch` (it will `find` if needed). If `action` is `push-first`, the
push did not land.

---

## 3. Watch until completion

Run `watch` as **one** command. This matrix is often 8–15 minutes; the helper
waits up to 20 minutes and follows cancelled successor runs (concurrency
cancels superseded jobs on the same ref). Do not treat `queued` /
`in_progress` as done. If you cannot block, background the same command and
resume when it exits.

| `action`         | What to do                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `no-ci`          | Feature branch with no PR. Tell the user; offer to open a PR; do not open one unless asked. |
| `push-first`     | HEAD is not on origin. Push first.                                                          |
| `not-found`      | Expected a run and none appeared. Ask. Do not keep polling.                                 |
| `report-success` | `quality`, `test`, and `package` passed. Stop.                                              |
| `diagnose`       | Step 4. Failed-job tails are already in `failures`.                                         |
| `cancelled`      | No successor to follow. Ask. Not a product bug by itself.                                   |
| `ask-user`       | Timeout, startup failure, or unknown. Do not guess a product fix.                           |

---

## 4. Remediate (at most two approved pushes)

Read [diagnose.md](diagnose.md). Count approved remediation pushes in this
conversation — not a shell variable. After two, stop and ask.

Propose the fix and wait. After approval: change the code, rerun step 1, stage
**explicit paths** (never `git add -A` / `.` / `-u`), get a **fresh** push
approval, then `watch` again.

If the fix is a behavior change, follow `test-driven-development` (reproducing
test first). Do not suppress errors with `any`, `@ts-ignore`, or silent
`try/catch`.

---

## Mid-flow

- Local verify only → stop after step 1.
- Already pushed / "watch CI" → `watch`.
- Known failed run → `failed <run-id>`.
