#!/usr/bin/env node
/**
 * Non-interactive helper for the ci-watch skill.
 * Prints one JSON object to stdout. Progress goes to stderr.
 *
 * Run from anywhere inside the repo:
 *   node .agents/skills/ci-watch/scripts/ci-watch.mjs <command>
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const WORKFLOW = 'CI';
const FIND_TIMEOUT_MS = 90_000;
const WATCH_TIMEOUT_MS = 20 * 60_000;
const FIND_POLL_MS = 5_000;
const WATCH_POLL_MS = 15_000;
const LOG_TAIL_LINES = 120;
const ERROR_LINE_LIMIT = 30;
const MAX_CANCEL_FOLLOWS = 3;

const EXIT = {
  ok: 0,
  usage: 1,
  stop: 2,
  ciUnsuccessful: 3,
};

const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);

function note(message) {
  process.stderr.write(`[ci-watch] ${message}\n`);
}

function emit(payload, code) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(code);
  throw new Error('unreachable');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function exec(bin, args, extra = {}) {
  const candidates = process.platform === 'win32' ? [`${bin}.exe`, bin] : [bin];
  let last = null;
  for (const command of candidates) {
    try {
      const stdout = execFileSync(command, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
        ...extra,
      });
      return { ok: true, stdout: String(stdout).replace(/\s+$/u, ''), stderr: '' };
    } catch (err) {
      last = err;
      if (err.code === 'ENOENT') continue;
      return {
        ok: false,
        stdout: String(err.stdout ?? '').replace(/\s+$/u, ''),
        stderr: String(err.stderr ?? err.message ?? '').replace(/\s+$/u, ''),
        status: err.status ?? 1,
      };
    }
  }
  return {
    ok: false,
    stdout: '',
    stderr: String(last?.message ?? `command not found: ${bin}`),
    status: 127,
  };
}

function mustExec(bin, args, extra = {}) {
  const result = exec(bin, args, extra);
  if (!result.ok) {
    emit(
      {
        ok: false,
        action: 'ask-user',
        error: `${bin} failed`,
        detail: result.stderr || result.stdout || `exit ${result.status}`,
      },
      EXIT.usage,
    );
  }
  return result.stdout;
}

function parseJson(text, fallback) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch (err) {
    emit(
      {
        ok: false,
        action: 'ask-user',
        error: 'failed to parse gh JSON',
        detail: err.message,
      },
      EXIT.usage,
    );
  }
}

function repoRoot() {
  return mustExec('git', ['rev-parse', '--show-toplevel']);
}

function git(args, root) {
  return mustExec('git', args, { cwd: root });
}

function gh(args, root) {
  return exec('gh', args, { cwd: root, env: { ...process.env, CI: 'true' } });
}

function mustGh(args, root) {
  const result = gh(args, root);
  if (!result.ok) {
    emit(
      {
        ok: false,
        action: 'ask-user',
        error: 'gh failed',
        detail: result.stderr || result.stdout || `exit ${result.status}`,
      },
      EXIT.usage,
    );
  }
  return result.stdout;
}

function slimRun(run) {
  if (!run) return null;
  return {
    id: run.databaseId ?? run.id,
    status: run.status ?? null,
    conclusion: run.conclusion ?? null,
    event: run.event ?? null,
    url: run.url ?? null,
    headSha: run.headSha ?? null,
    title: run.displayTitle ?? run.title ?? null,
    createdAt: run.createdAt ?? null,
  };
}

function slimJobs(jobs) {
  return (jobs ?? []).map((job) => ({
    id: job.databaseId,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    url: job.url,
  }));
}

const RUN_JSON_FIELDS =
  'databaseId,status,conclusion,event,url,headSha,createdAt,displayTitle,workflowName';

function listRuns(root, { sha, branch } = {}) {
  const args = [
    'run',
    'list',
    '--workflow',
    WORKFLOW,
    '--limit',
    '10',
    '--json',
    RUN_JSON_FIELDS,
  ];
  if (sha) args.push('--commit', sha);
  if (branch) args.push('--branch', branch);
  return parseJson(mustGh(args, root), []);
}

function pickRun(runs) {
  if (!runs.length) return null;
  const active = runs.find((run) => ACTIVE.has(run.status));
  if (active) return active;
  const completed = runs.filter((run) => run.status === 'completed');
  const useful = completed.find((run) => run.conclusion !== 'cancelled');
  return useful ?? completed[0] ?? runs[0];
}

function viewRun(root, id) {
  const raw = mustGh(
    [
      'run',
      'view',
      String(id),
      '--json',
      'databaseId,status,conclusion,event,url,headSha,createdAt,displayTitle,jobs,workflowName',
    ],
    root,
  );
  const viewed = parseJson(raw, null);
  if (!viewed || viewed.databaseId == null) {
    emit(
      { ok: false, action: 'ask-user', error: `empty gh run view for ${id}` },
      EXIT.usage,
    );
  }
  return viewed;
}

function context(root) {
  const branch = git(['branch', '--show-current'], root);
  const sha = git(['rev-parse', 'HEAD'], root);
  const upstream = exec('git', ['rev-parse', '@{u}'], { cwd: root });
  const upstreamSha = upstream.ok ? upstream.stdout : null;
  const prRaw = gh(
    ['pr', 'list', '--head', branch || sha, '--state', 'open', '--json', 'number,url'],
    root,
  );
  const prs = prRaw.ok ? parseJson(prRaw.stdout, []) : [];
  const pr = prs[0] ? { number: prs[0].number, url: prs[0].url } : null;
  const expected = branch === 'main' || Boolean(pr);
  let reason;
  if (branch === 'main') reason = 'push to main triggers CI';
  else if (pr) reason = `open PR #${pr.number} triggers CI`;
  else reason = 'feature branch with no open PR does not trigger CI';

  return {
    branch: branch || null,
    sha,
    upstreamSha,
    pushed: Boolean(upstreamSha) && upstreamSha === sha,
    pr,
    expected,
    reason,
    workflow: WORKFLOW,
  };
}

function withContext(root, extra) {
  return { ok: extra.ok !== false, workflow: WORKFLOW, ...context(root), ...extra };
}

function tailLines(text, count) {
  const lines = text.split(/\r?\n/u);
  return lines.slice(Math.max(0, lines.length - count)).join('\n');
}

function extractErrors(text) {
  const lines = text
    .split(/\r?\n/u)
    .filter((line) => line.includes('::error::') || line.includes('##[error]'));
  return lines.slice(0, ERROR_LINE_LIMIT);
}

function collectFailures(root, runId) {
  const viewed = viewRun(root, runId);
  const failed = (viewed.jobs ?? []).filter((job) =>
    ['failure', 'timed_out'].includes(job.conclusion),
  );
  const jobs = [];
  for (const job of failed) {
    const log = gh(
      ['run', 'view', String(runId), '--job', String(job.databaseId), '--log-failed'],
      root,
    );
    const text = log.ok ? log.stdout : '';
    jobs.push({
      id: job.databaseId,
      name: job.name,
      conclusion: job.conclusion,
      url: job.url,
      errors: extractErrors(text),
      tail: text
        ? tailLines(text, LOG_TAIL_LINES)
        : log.stderr || 'could not fetch failed logs',
    });
  }
  return { run: slimRun(viewed), jobs };
}

function cmdHelp() {
  process.stdout.write(`ci-watch — non-interactive CI helper for PingBack

Usage:
  node .agents/skills/ci-watch/scripts/ci-watch.mjs <command> [run-id]

Commands:
  expect          Would CI run for this branch? (does not wait)
  find            Locate the CI run for pushed HEAD (waits up to 90s)
  watch [id]      Wait until that run completes (follows cancelled successors)
  failed [id]     Failed jobs + ::error:: lines + log tails
  help            This text

Stdout is one JSON object. Read \`action\` and \`conclusion\`.
Stderr is progress only.

Exit codes:
  0  success / expected snapshot
  1  missing tools, auth, or usage
  2  stop: no CI expected, HEAD not pushed, or run not found
  3  CI finished unsuccessfully (failure, cancelled, timeout, other)
`);
  process.exit(EXIT.ok);
}

function cmdExpect(root) {
  const ctx = context(root);
  emit(
    withContext(root, {
      action: ctx.expected ? 'watch-after-push' : 'no-ci',
      expected: ctx.expected,
    }),
    EXIT.ok,
  );
}

async function cmdFind(root) {
  const ctx = context(root);
  if (!ctx.expected) {
    emit(withContext(root, { action: 'no-ci' }), EXIT.stop);
  }
  if (!ctx.pushed) {
    emit(
      withContext(root, {
        action: 'push-first',
        error: 'HEAD is not on the upstream branch. Push before looking for a CI run.',
      }),
      EXIT.stop,
    );
  }

  const deadline = Date.now() + FIND_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const run = pickRun(listRuns(root, { sha: ctx.sha }));
    if (run) {
      emit(withContext(root, { action: 'watch', run: slimRun(run) }), EXIT.ok);
    }
    note(`waiting for ${WORKFLOW} run on ${ctx.sha.slice(0, 7)}`);
    await sleep(FIND_POLL_MS);
  }
  emit(
    withContext(root, {
      action: 'not-found',
      error: `No ${WORKFLOW} run for ${ctx.sha.slice(0, 7)} after ${FIND_TIMEOUT_MS / 1000}s`,
    }),
    EXIT.stop,
  );
}

function watchAction(conclusion) {
  if (conclusion === 'success') return { action: 'report-success', code: EXIT.ok };
  if (conclusion === 'failure' || conclusion === 'timed_out') {
    return { action: 'diagnose', code: EXIT.ciUnsuccessful };
  }
  if (conclusion === 'cancelled')
    return { action: 'cancelled', code: EXIT.ciUnsuccessful };
  return { action: 'ask-user', code: EXIT.ciUnsuccessful };
}

async function cmdWatch(root, runId) {
  const ctx = context(root);
  let id = runId;
  if (!id) {
    if (!ctx.expected) emit(withContext(root, { action: 'no-ci' }), EXIT.stop);
    if (!ctx.pushed) {
      emit(withContext(root, { action: 'push-first' }), EXIT.stop);
    }
    const found = pickRun(listRuns(root, { sha: ctx.sha }));
    if (!found) {
      const foundAfterWait = await (async () => {
        const deadline = Date.now() + FIND_TIMEOUT_MS;
        while (Date.now() < deadline) {
          note(`waiting for ${WORKFLOW} run on ${ctx.sha.slice(0, 7)}`);
          await sleep(FIND_POLL_MS);
          const run = pickRun(listRuns(root, { sha: ctx.sha }));
          if (run) return run;
        }
        return null;
      })();
      if (!foundAfterWait) {
        emit(
          withContext(root, {
            action: 'not-found',
            error: `No ${WORKFLOW} run for ${ctx.sha.slice(0, 7)}`,
          }),
          EXIT.stop,
        );
      }
      id = foundAfterWait.databaseId;
    } else {
      id = found.databaseId;
    }
  }

  let follows = 0;
  const deadline = Date.now() + WATCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const viewed = viewRun(root, id);
    note(`${id} ${viewed.status}${viewed.conclusion ? `/${viewed.conclusion}` : ''}`);

    if (viewed.status === 'completed') {
      if (viewed.conclusion === 'cancelled' && follows < MAX_CANCEL_FOLLOWS) {
        await sleep(5_000);
        const latest = context(root);
        const successor =
          pickRun(listRuns(root, { sha: latest.sha })) ??
          (latest.branch ? pickRun(listRuns(root, { branch: latest.branch })) : null);
        const successorId = successor?.databaseId;
        if (successorId && String(successorId) !== String(id)) {
          note(`run cancelled; following successor ${successorId}`);
          id = successorId;
          follows += 1;
          continue;
        }
      }

      const { action, code } = watchAction(viewed.conclusion);
      const payload = withContext(root, {
        action,
        run: slimRun(viewed),
        jobs: slimJobs(viewed.jobs),
      });
      if (action === 'diagnose') {
        payload.failures = collectFailures(root, id).jobs;
      }
      emit(payload, code);
    }

    await sleep(WATCH_POLL_MS);
  }

  emit(
    withContext(root, {
      action: 'ask-user',
      error: `timed out waiting for run ${id}`,
      run: { id },
    }),
    EXIT.ciUnsuccessful,
  );
}

function cmdFailed(root, runId) {
  const ctx = context(root);
  let id = runId;
  if (!id) {
    const run = pickRun(listRuns(root, { sha: ctx.sha }));
    if (!run) {
      emit(
        withContext(root, { action: 'not-found', error: 'no CI run to diagnose' }),
        EXIT.stop,
      );
    }
    id = run.databaseId;
  }
  const bundle = collectFailures(root, id);
  emit(withContext(root, { action: 'diagnose', ...bundle }), EXIT.ok);
}

const [command, runId] = process.argv.slice(2);
const root = ['help', '-h', '--help', undefined].includes(command) ? null : repoRoot();

switch (command) {
  case 'help':
  case '-h':
  case '--help':
  case undefined:
    cmdHelp();
    break;
  case 'expect':
    cmdExpect(root);
    break;
  case 'find':
    await cmdFind(root);
    break;
  case 'watch':
    await cmdWatch(root, runId);
    break;
  case 'failed':
    cmdFailed(root, runId);
    break;
  default:
    emit(
      { ok: false, action: 'ask-user', error: `unknown command: ${command}` },
      EXIT.usage,
    );
}
