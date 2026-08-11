---
name: ci-watch
description: Verify PingBack locally before a GitHub push, then monitor its GitHub Actions CI run and guide an approved remediation loop.
---

# CI Watch & Assisted Remediation

## Overview

Run this workflow before pushing and after a push that can trigger PingBack's `CI` workflow. Keep all work local unless the user explicitly approves each push and each remediation.

---

## 1. Verify locally

Run every check before any push. If one fails, do not push; fix it and rerun the full set.

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
```

---

## 2. Approve and push

Check authentication, working tree, and branch:

```powershell
gh auth status
git status
$currentBranch = (git branch --show-current).Trim()
```

Before **every** push, obtain the user's explicit approval for the exact branch and commit(s). A prior approval does not cover a later remediation commit. Explicitly identify `main` or a protected release branch before requesting approval.

```powershell
git push
# If on a newly created branch without an upstream tracking branch:
# git push -u origin HEAD
```

## 3. Find the expected CI run

PingBack's `CI` workflow runs for pushes to `main` and pull requests. A feature-branch push without an open PR creates no CI run; report that result and stop watching instead of reporting an error.

```powershell
$openPrNumber = (gh pr list --head $currentBranch --state open --json number --jq '.[0].number')

if ($currentBranch -ne "main" -and (-not $openPrNumber -or $openPrNumber -eq "null")) {
    Write-Output "No open pull request exists for '$currentBranch'. PingBack CI will not run for this branch push."
    return
}
```

```powershell
$commitSha = (git rev-parse HEAD).Trim()
$workflowName = "CI"
$runId = ""

for ($i = 0; $i -lt 8; $i++) {
    $rawId = (gh run list --workflow $workflowName --commit $commitSha --limit 1 --json databaseId --jq '.[0].databaseId' 2>$null)

    if ($rawId -and $rawId -ne "null") {
        $runId = $rawId
        break
    }
    # Bounded run-registration wait: at most 40 seconds total.
    Start-Sleep -Seconds 5
}

if (-not $runId) {
    Write-Error "Failed to locate GitHub Actions workflow '$workflowName' for commit $commitSha after 40 seconds. Report this to the user and request guidance."
    return
}
```

---

## 4. Monitor CI

Make one non-interactive query per turn. Do not assume a scheduler exists or hold an unbounded synchronous sleep loop. If the run is queued or in progress, report that it remains pending and check again in a later turn.

```powershell
$runInfo = gh run view $runId --json status,conclusion | ConvertFrom-Json
```

- `completed` + `success`: all `quality`, `test`, and `package` jobs passed; report success and stop.
- `completed` + any other conclusion: continue to remediation.

---

## 5. Diagnose and remediate (at most twice)

Maintain `$attemptCount`. If it reaches `2`, stop, give the user the failed-log summary, and request guidance.

Inspect only the useful failure context:

```powershell
gh run view $runId
gh run view $runId --log-failed | Select-Object -First 200
```

Identify the failed job, operating system/Node version, and root cause. For OS-specific failures, check path separators, line endings, and shell-specific package scripts. Do not guess, suppress errors with `any` or `// @ts-ignore`, or add silent `try/catch` blocks. Fix the cause and add or update a reproducing unit test where practical.

Propose the exact remediation and obtain user approval before editing. After approval, make the change and rerun every local check from step 1.

Stage only reviewed files belonging to the fix—never `git add -A`, `git add .`, or `git add -u`:

```powershell
git add src/path/to/modified-file.ts tests/path/to/modified-test.ts
```

Show the files, commit message, and target branch; obtain fresh explicit approval before committing and pushing:

```powershell
git commit -m "fix(ci): resolve <specific-issue> in <job-name>"
git push
```

Increment `$attemptCount`, get the new commit SHA, locate its CI run with step 3, and resume step 4.

---

## Quick checklist

- Local checks passed before each push.
- User approved each push and each remediation edit.
- CI was expected for the branch before looking up a run.
- CI was checked one query at a time.
- Remediation was diagnosed from targeted logs, re-verified locally, and explicitly staged.
- No more than two remediation attempts were made.
