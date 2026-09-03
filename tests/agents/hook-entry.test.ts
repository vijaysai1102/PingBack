import { describe, expect, it, vi } from 'vitest';
import { deliverWithDaemonRecovery } from '../../src/agents/claude/hook-entry.js';

describe('deliverWithDaemonRecovery', () => {
  it('retries the original event after it starts a stopped daemon', async () => {
    const delivery = vi
      .fn<() => Promise<{ accepted: true }>>()
      .mockRejectedValueOnce(new Error('daemon unavailable'))
      .mockResolvedValueOnce({ accepted: true });
    const startDaemon = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);

    await expect(deliverWithDaemonRecovery(delivery, startDaemon, 100)).resolves.toEqual({
      accepted: true,
    });
    expect(startDaemon).toHaveBeenCalledOnce();
    expect(delivery).toHaveBeenCalledTimes(2);
  });
});
