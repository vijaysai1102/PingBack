import { createDaemon } from './create-daemon.js';

/**
 * Entry point for the background daemon process. Started detached by
 * `pingback start`; never intended to be run in the foreground by users.
 */
async function run(): Promise<void> {
  const { daemon, logger } = createDaemon();

  daemon.onStopped(() => {
    process.exitCode = 0;
  });

  const shutdown = (signal: string): void => {
    logger.info('shutdown signal received', { signal });
    void daemon.stop();
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });

  process.on('uncaughtException', (error) => {
    logger.error('uncaught exception', { err: error });
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', { err: reason });
  });

  await daemon.start();
}

run().catch((error: unknown) => {
  process.stderr.write(`PingBack daemon failed to start: ${String(error)}\n`);
  process.exitCode = 1;
});
