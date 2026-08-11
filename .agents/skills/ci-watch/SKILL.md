---
name: ci-watch
description: Pre-push verification and automated GitHub Actions CI monitoring with auto-remediation loop. Use before pushing code to GitHub and after pushing to monitor CI until all checks pass.
---

# CI Watch & Auto-Remediation Skill

## Overview

Ensure that code is fully validated locally before pushing, and monitor remote GitHub Actions CI runs post-push. If any CI job fails on GitHub, automatically fetch logs, diagnose the failure, fix the code, re-verify locally, and re-push in a continuous loop until all CI checks pass (capped at 2 remediation attempts).

---

## Phase 1: Pre-Push Local Verification

Before executing `git push`, **always** run the full local quality and test suite to catch errors early.

### Local Check Commands (PingBack)

```powershell
# 1. Formatting check
npm run format:check

# 2. Linting
npm run lint

# 3. Type checking
npm run typecheck

# 4. Build (generates required assets like sound files)
npm run build

# 5. Unit & Integration Tests
npm test
```

- **If any local check fails**: Do **NOT** push. Fix the errors locally and re-run all checks until pristine.

---

## Phase 2: Push & Trigger CI Watch

Once local checks pass cleanly:

1. **Pre-flight authentication & status check**:
   ```powershell
   gh auth status
   git status
   ```
2. **Push your commit to GitHub**:
   ```powershell
   git push
   ```
3. **Get the current commit SHA**:
   ```powershell
   $commitSha = (git rev-parse HEAD).Trim()
   ```
4. **Locate the GitHub Actions workflow run for this commit using the GitHub CLI (`gh`)**:
   ```powershell
   gh run list --commit $commitSha --limit 1
   ```

---

## Phase 3: Post-Push GitHub CI Monitoring

Monitor the remote CI workflow until completion using GitHub CLI.

### Polling / Watching the CI Run

For non-interactive agent environments, query status using JSON format to avoid UI terminal locks:

```powershell
# Query status and conclusion in JSON format
$run = gh run view <run-id> --json status,conclusion | ConvertFrom-Json
# $run.status -> "in_progress", "completed"
# $run.conclusion -> "success", "failure", "cancelled"
```

Alternatively, watch the run directly if running interactively:

```powershell
gh run watch <run-id>
```

### Evaluating CI Outcome

- **SUCCESS (All Green)**: All jobs (`quality`, `test`, `package`) passed. The workflow is complete. Stop here.
- **FAILURE / CANCELLED**: At least one job failed. Proceed immediately to **Phase 4 (Auto-Remediation Loop)**.

---

## Phase 4: Auto-Remediation & Retry Loop

When a remote CI check fails, follow this recovery process (capped at **max 2 remediation attempts**):

### Circuit Breaker Limit

Maintain an attempt counter (`$attemptCount`). If `$attemptCount >= 2`, **STOP** the loop, surface the failure logs to the user, and ask for manual guidance to avoid infinite loops caused by flaky tests or remote infrastructure issues.

### 1. Fetch & Inspect Failure Logs

Use `gh` to retrieve log details for the failed run:

```powershell
# View only the failed steps and error output
gh run view <run-id> --log-failed

# View full log if needed
gh run view <run-id> --log
```

Identify:

- Which job failed (`quality`, `test`, or `package`)
- Which environment failed (e.g., `windows-latest` vs `macos-latest`, Node version)
- The exact error message, stack trace, or failed assertion

### 2. Edit Code Based on Logs

- Analyze the root cause from the logs.
- Edit the codebase to fix the issue (e.g., path separator issues on Windows/macOS, missing dependencies, timing issues, or broken assertions).

### 3. Verify Functionality & Local CI Checks

Re-run all local checks to ensure the fix works and didn't introduce regressions:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
```

### 4. Stage & Commit the Fix

Write descriptive commit messages referencing the specific failing check, or amend unpushed local work:

```powershell
git add -A
git commit -m "fix(ci): resolve <specific-issue> in <job-name> check"
```

### 5. Push Updated Code

```powershell
git push
```

### 6. Redo GitHub CI Monitoring Loop

- Increment attempt counter: `$attemptCount++`
- Get the new commit SHA.
- Obtain the new workflow run ID (`gh run list --commit <new-commit-sha>`).
- Resume monitoring in Phase 3 until all CI checks pass cleanly or max attempts reached.

---

## Summary Checklist

- [ ] Verified `gh auth status` and checked pre-flight git status
- [ ] Ran local pre-push checks (`format:check`, `lint`, `typecheck`, `build`, `test`)
- [ ] Pushed commit to GitHub
- [ ] Monitored GitHub Actions run via non-interactive `gh run view --json status,conclusion` or `gh run watch`
- [ ] On failure (within 2 attempts): fetched failed logs via `gh run view --log-failed`
- [ ] Fixed code based on failure logs
- [ ] Verified local tests and checks pass
- [ ] Re-committed with descriptive message, re-pushed, and resumed CI watch loop until ALL green (or max attempts reached)
