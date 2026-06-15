import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * G2-4 no-silent-drop (unit) — khi consumer (vd audit-write) NÉM, OutboxWorker KHÔNG bao giờ đánh event
 * 'done' im lặng: nó retry (status='pending', attempts++) hoặc dead-letter sau MAX_ATTEMPTS. Test này mock
 * workerDb để chứng minh nhánh "handler ném ⇒ status đặt = done" KHÔNG tồn tại (chống nuốt lỗi cốt lõi G2-4).
 *
 * Hành vi DB thật (row dead_letter_events + alert) phủ ở dead-letter-alert-threshold.int-spec.ts.
 */

interface FakeRow {
  id: string;
  company_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** Trích text SQL thô từ object drizzle `sql\`...\`` (queryChunks chứa StringChunk.value: string[]). */
function sqlText(query: unknown): string {
  const chunks = (query as { queryChunks?: Array<{ value?: unknown }> }).queryChunks;
  if (!Array.isArray(chunks)) return String(query);
  return chunks
    .map((c) => (Array.isArray(c?.value) ? c.value.join("") : ""))
    .join(" ");
}

/** Bộ điều khiển workerDb giả: ghi nhận MỌI status được set lên outbox_events. */
function makeFakeDb(claimRow: FakeRow) {
  const statusUpdates: string[] = [];
  let claimedOnce = false;
  const execute = vi.fn(async (query: unknown) => {
    const text = sqlText(query);
    // claim CTE: trả 1 row lần đầu, sau đó rỗng (không claim lại).
    if (text.includes("UPDATE outbox_events SET status = 'processing'")) {
      if (claimedOnce) return { rows: [] };
      claimedOnce = true;
      return { rows: [claimRow] };
    }
    // reaper (stale processing → pending): KHÔNG tính là finalize.
    if (text.includes("SET status = 'pending'") && text.includes("status = 'processing'")) {
      return { rows: [] };
    }
    // ghi nhận finalize status (done/failed/pending) để assert KHÔNG 'done' khi handler ném.
    const m = text.match(/SET status = '(done|failed|pending)'/);
    if (m) statusUpdates.push(m[1]);
    // processed_events lookup: chưa xử lý.
    if (text.includes("FROM processed_events")) return { rows: [] };
    return { rows: [] };
  });
  return { db: { execute } as unknown as never, statusUpdates };
}

describe("OutboxWorker — no silent drop khi handler ném", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("handler ném ⇒ KHÔNG path nào set status='done' (retry/dead-letter, không nuốt)", async () => {
    const row: FakeRow = {
      id: "11111111-1111-1111-1111-111111111111",
      company_id: "22222222-2222-2222-2222-222222222222",
      event_type: "audit.write",
      payload: { sensitive: "do-not-leak" },
      attempts: 0,
    };
    const { db, statusUpdates } = makeFakeDb(row);

    // workerDb được import bởi outbox-worker — mock module để trỏ vào db giả.
    vi.doMock("../db/index", () => ({ workerDb: db }));
    vi.doMock("../db/worker-role", () => ({ assertWorkerRoleSafe: vi.fn(async () => undefined) }));
    const { OutboxWorker } = await import("./outbox-worker");
    const { EventBus } = await import("./event-bus");

    const bus = new EventBus();
    bus.register({
      consumerName: "audit-writer",
      eventType: "audit.write",
      handle: async () => {
        throw new Error("audit DB down");
      },
    });
    const alert = {
      deadLetter: vi.fn(async () => undefined),
      thresholdBreached: vi.fn(async () => undefined),
    };
    const worker = new OutboxWorker(bus, alert);

    await worker.processBatch();

    // attempts=0 → lần đầu lỗi: retry (status='pending'), KHÔNG 'done'. Drop bị nuốt = 'done' = BUG.
    expect(statusUpdates).not.toContain("done");
    expect(statusUpdates).toContain("pending");
  });
});
