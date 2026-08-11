---
name: ci-watch
description: Pre-push verification and automated GitHub Actions CI monitoring with auto-remediation loop. Use before pushing code to GitHub and after pushing to monitor CI until all checks pass.
---

# CI Watch & Auto-Remediation Skill

## Overview

Ensure that code is fully validated locally before pushing, and monitor remote GitHub Actions CI runs post-push. If any CI job fails on GitHub, automatically fetch logs, diagnose the failure, fix the code, re-verify locally, and re-push in a continuous loop until all checks pass (capped at 2 remediation attempts).

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
   # If on a newly created branch without an upstream tracking branch:
   # git push -u origin HEAD
   ```
3. **Get the current commit SHA**:
   ```powershell
   $commitSha = (git rev-parse HEAD).Trim()
   ```
4. **Locate the GitHub Actions workflow run for this commit using the GitHub CLI (`gh`)**:
   GitHub Actions may take 5–15 seconds to register a newly pushed commit. Filter by the workflow name (e.g., `"CI"`) or fallback to any workflow for the commit if the workflow name differs, and check that `$rawId` is not empty or `"null"` (since `jq` on an unregistered run outputs `"null"`, which PowerShell evaluates as truthy):
   ```powershell
   $runId = ""
   for ($i = 0; $i -lt 6; $i++) {
       # 1. Try finding workflow named "CI"
       $rawId = (gh run list --workflow "CI" --commit $commitSha --limit 1 --json databaseId --jq '.[0].databaseId 2>$null')
       # 2. Fallback to any workflow for this commit if "CI" is not found
       if (-not $rawId -or $rawId -eq "null") {
           $rawId = (gh run list --commit $commitSha --limit 1 --json databaseId --jq '.[0].databaseId 2>$null')
       }
       if ($rawId -and $rawId -ne "null") {
           $runId = $rawId
           break
       }
       Start-Sleep -Seconds 5
   }
   ```

---

## Phase 3: Post-Push GitHub CI Monitoring

Monitor the remote CI workflow until completion using non-interactive querying with `gh`.

### Polling the CI Run

To prevent UI terminal locks and API rate-limiting, poll the run status at 15-second intervals. Safely check `$json` before piping to `ConvertFrom-Json` to avoid crashing on network blips or `stderr` messages:

```powershell
# Poll run status until completion
do {
    $json = gh run view $runId --json status,conclusion 2>$null
    if ($json) {
        $run = $json | ConvertFrom-Json
        if ($run.status -eq "completed") { break }
    }
    Start-Sleep -Seconds 15
} while ($true)

# $run.status -> "completed"
# $run.conclusion -> "success", "failure", "cancelled"
```

> **Note**: Avoid interactive streaming commands like `gh run watch` in automated subagent or background sessions as they can lock up terminal standard input/output streams. When monitoring in an agent session, avoid holding synchronous turns in a sleeping loop (`Start-Sleep`). Instead, run the polling loop in a non-blocking background command or use background timers (`schedule` tool) / subagents to check CI status asynchronously and yield control cleanly.

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
gh run view $runId --log-failed

# View full log if needed
gh run view $runId --log
```

Identify:

- Which job failed (`quality`, `test`, or `package`)
- Which environment failed (e.g., `windows-latest` vs `macos-latest`, Node version)
- The exact error message, stack trace, or failed assertion

### 2. Root-Cause Analysis & Clean Code Remediation

Before making any code edits:

1. **Diagnose the Exact Root Cause**:
   - Do **NOT** guess, suppress errors, or add quick hacky workarounds (e.g., `any`, `// @ts-ignore`, or silent `catch` blocks).
   - Trace the exact file and line number that triggered the failure in the remote CI logs.
   - Explicitly identify _why_ it failed (e.g., OS path separator mismatch `\` vs `/`, unhandled promise rejection, missing build dependency, or timing race condition).

2. **Apply Clean Code & TDD Standards**:
   - Write or update a local test first to reproduce the failure scenario whenever possible.
   - Implement the fix following modular design standards: extract helper functions, validate inputs at boundaries, maintain immutability, and preserve cross-platform compatibility.
   - Never write single-use test cleanup methods directly on production classes; put test helpers in test utility modules.

3. **Verify Code Integrity**:
   - Ensure the fix addresses the core logic error rather than hiding the symptom.

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
- [ ] Monitored GitHub Actions run via non-interactive `gh run view --json status,conclusion` loop (with 15s delays)
- [ ] On failure (within 2 attempts): fetched failed logs via `gh run view --log-failed`
- [ ] Fixed code based on failure logs
- [ ] Verified local tests and checks pass
- [ ] Re-committed with descriptive message, re-pushed, and resumed CI watch loop until ALL green (or max attempts reached)
