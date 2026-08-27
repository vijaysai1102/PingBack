import { describe, expect, it } from 'vitest';
import { buildProgram } from '../../src/cli/index.js';

describe('config command', () => {
  it('registers a get subcommand for hierarchical configuration inspection', () => {
    const config = buildProgram().commands.find((command) => command.name() === 'config');

    expect(config?.commands.map((command) => command.name())).toContain('get');
  });
});
