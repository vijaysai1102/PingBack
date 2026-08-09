#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { isPingBackError, toMessage } from '../utils/errors.js';
import { packageVersion } from '../utils/paths.js';
import { failure, line } from './output.js';
import { runStatus } from './commands/status.js';
import { runStart } from './commands/start.js';
import { runStop } from './commands/stop.js';
import { runConfigList, runConfigSet } from './commands/config.js';
import { runSetup, runUninstall } from './commands/setup.js';

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('pingback')
    .description('Never miss when your AI coding agent needs you.')
    .version(packageVersion(), '-v, --version', 'Print the PingBack version');

  program
    .command('setup')
    .description('Detect Claude Code, install the integration and start PingBack')
    .action(async () => {
      await runSetup();
    });

  program
    .command('uninstall')
    .description("Remove PingBack's Claude Code integration")
    .action(() => {
      runUninstall();
    });

  program
    .command('start')
    .description('Start the PingBack background daemon')
    .action(async () => {
      await runStart();
    });

  program
    .command('stop')
    .description('Stop the PingBack background daemon')
    .action(async () => {
      await runStop();
    });

  program
    .command('status')
    .description('Show daemon status and tracked agent sessions')
    .action(async () => {
      await runStatus();
    });

  const config = program
    .command('config')
    .description('View or change PingBack settings')
    .action(() => {
      runConfigList();
    });

  config
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action((key: string, value: string) => {
      runConfigSet(key, value);
    });

  return program;
}

function reportError(error: unknown): void {
  if (isPingBackError(error)) {
    failure(error.message);
    if (error.hint !== undefined) {
      line();
      line(error.hint);
    }
  } else {
    failure(toMessage(error));
  }

  if (process.env.PINGBACK_DEBUG === '1' && error instanceof Error && error.stack) {
    line();
    line(error.stack);
  }
}

export async function main(argv: string[] = process.argv): Promise<number> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    reportError(error);
    return 1;
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      reportError(error);
      process.exitCode = 1;
    });
}
