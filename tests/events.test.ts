// tests/events.test.ts (integration): the typed synchronous event bus.
import { describe, expect, it, vi } from 'vitest';
import { EventBus, type SimEvent } from '../src/core/events';

const gap = (tick: number): SimEvent => ({ type: 'gap', tick, gapId: 'MS-G03', name: 'PLAZA BAR HOP', base: 500 });

describe('EventBus', () => {
  it('delivers typed events to type handlers, then to onAny handlers', () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.on('gap', (e) => order.push(`gap:${e.gapId}:${e.base}`));
    bus.onAny((e) => order.push(`any:${e.type}`));
    bus.on('bail', () => order.push('bail'));
    bus.emit(gap(1));
    expect(order).toEqual(['gap:MS-G03:500', 'any:gap']);
  });

  it('unsubscribe stops delivery', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const off = bus.on('gap', fn);
    bus.emit(gap(1));
    off();
    bus.emit(gap(2));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('an emit inside a handler is delivered after the current event (FIFO)', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on('gap', (e) => {
      seen.push(`gap ${e.tick}`);
      if (e.tick === 1) bus.emit({ type: 'specialReady', tick: 1 });
    });
    bus.onAny((e) => seen.push(`any ${e.type}`));
    bus.emitAll([gap(1), gap(2)]);
    expect(seen).toEqual(['gap 1', 'any gap', 'any specialReady', 'gap 2', 'any gap']);
  });

  it('a throwing handler is reported and does not stop the others', () => {
    const bus = new EventBus();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const after = vi.fn();
    bus.on('gap', () => {
      throw new Error('boom');
    });
    bus.on('gap', after);
    bus.emit(gap(1));
    expect(after).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
