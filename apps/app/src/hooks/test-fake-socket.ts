import { vi } from "vitest";

/** Socket giả dùng chung cho spec hook realtime: giữ registry handler để kiểm ĐĂNG KÝ lẫn GỠ. */
export function makeFakeSocket() {
  const handlers = new Map<string, Set<(...args: never[]) => void>>();
  return {
    io: { reconnection: vi.fn() },
    disconnect: vi.fn(),
    connected: false,
    on(event: string, fn: (...args: never[]) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    },
    off(event: string, fn: (...args: never[]) => void) {
      handlers.get(event)?.delete(fn);
    },
    countFor: (event: string) => handlers.get(event)?.size ?? 0,
    totalHandlers() {
      let n = 0;
      for (const set of handlers.values()) n += set.size;
      return n;
    },
    fire(event: string, ...args: unknown[]) {
      for (const fn of [...(handlers.get(event) ?? [])]) (fn as (...a: unknown[]) => void)(...args);
    },
  };
}
export type FakeSocket = ReturnType<typeof makeFakeSocket>;
