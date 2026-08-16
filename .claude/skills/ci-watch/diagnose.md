# PingBack CI failure playbook

Read this only after the helper returns `action: diagnose`. Job names and
matrix come from `.github/workflows/ci.yml` — read that file if this note
and the logs disagree.

## quality — `Lint, format, types`

Windows, Node 22. Reproduces locally:

```bash
npm run format:check
npm run lint
npm run typecheck
```

## test — `Test (<os>, Node <version>)`

Matrix: `windows-latest` + `macos-latest` × Node `20.19`, `22`, `24`.
`fail-fast: false`, so several cells can fail together. The job runs
`npm run build` before `npm test` because sound WAVs are generated, not
committed.

If only the other OS failed, look at `src/platform/`, path separators, and
line endings. Do not "fix" it by skipping a matrix cell.

## package — `Package smoke (<os>)`

Runs only after `quality` and `test` succeed. Uses `bash` on both OSes.
Packs the tarball, installs it globally, then checks `pingback --version` /
`--help`, bundled sounds, daemon start/status/stop, and a config round-trip
from a directory **outside** the repo.

`npm test` will not catch this. Reproduce those steps locally from
`.github/workflows/ci.yml` if you can.

## cancelled

Concurrency group `ci-${{ github.ref }}` cancels superseded runs on the same
ref. That is not a product failure. The helper follows the successor. If it
still reports `cancelled`, ask the user.
