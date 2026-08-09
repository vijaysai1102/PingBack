import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/event-bus.js';

interface TestEvents {
  ping: { value: number };
  pong: string;
}

describe('EventBus', () => {
  it('delivers payloads to every subscriber', async () => {
    const bus = new EventBus<TestEvents>();
    const first = vi.fn();
    const second = vi.fn();

    bus.on('ping', first);
    bus.on('ping', second);
    await bus.emit('ping', { value: 7 });

    expect(first).toHaveBeenCalledWith({ value: 7 });
    expect(second).toHaveBeenCalledWith({ value: 7 });
  });

  it('does not deliver across event names', async () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    bus.on('pong', handler);
    await bus.emit('ping', { value: 1 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('awaits async subscribers', async () => {
    const bus = new EventBus<TestEvents>();
    const seen: number[] = [];

    bus.on('ping', async ({ value }) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(value);
    });

    await bus.emit('ping', { value: 42 });
    expect(seen).toEqual([42]);
  });

  it('isolates a throwing subscriber from the others', async () => {
    const onListenerError = vi.fn();
    const bus = new EventBus<TestEvents>({ onListenerError });
    const healthy = vi.fn();

    bus.on('ping', () => {
      throw new Error('bad listener');
    });
    bus.on('ping', healthy);

    await expect(bus.emit('ping', { value: 1 })).resolves.toBeUndefined();
    expect(healthy).toHaveBeenCalledOnce();
    expect(onListenerError).toHaveBeenCalledOnce();
    expect(onListenerError.mock.calls[0]?.[1]).toBe('ping');
  });

  it('isolates a rejecting async subscriber', async () => {
    const onListenerError = vi.fn();
    const bus = new EventBus<TestEvents>({ onListenerError });
    const healthy = vi.fn();

    bus.on('ping', () => Promise.reject(new Error('async boom')));
    bus.on('ping', healthy);

    await expect(bus.emit('ping', { value: 1 })).resolves.toBeUndefined();
    expect(healthy).toHaveBeenCalledOnce();
    expect(onListenerError).toHaveBeenCalledOnce();
  });

  it('unsubscribes via the returned disposer', async () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    const dispose = bus.on('ping', handler);
    dispose();
    await bus.emit('ping', { value: 1 });

    expect(handler).not.toHaveBeenCalled();
    expect(bus.listenerCount('ping')).toBe(0);
  });

  it('fires a once subscriber exactly one time', async () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    bus.once('ping', handler);
    await bus.emit('ping', { value: 1 });
    await bus.emit('ping', { value: 2 });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ value: 1 });
  });

  it('tolerates a subscriber unsubscribing during dispatch', async () => {
    const bus = new EventBus<TestEvents>();
    const second = vi.fn();

    const disposeSecond = bus.on('ping', second);
    bus.on('ping', () => {
      disposeSecond();
    });

    await expect(bus.emit('ping', { value: 1 })).resolves.toBeUndefined();
  });

  it('emitting with no subscribers is a no-op', async () => {
    const bus = new EventBus<TestEvents>();
    await expect(bus.emit('ping', { value: 1 })).resolves.toBeUndefined();
  });

  it('removeAll drops every subscription', async () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    bus.on('ping', handler);
    bus.removeAll();
    await bus.emit('ping', { value: 1 });

    expect(handler).not.toHaveBeenCalled();
  });
});
