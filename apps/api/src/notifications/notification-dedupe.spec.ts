/**
 * S4-NOTI-BE-2 (unit) — NotificationDedupeService.resolveStrategy + computeKey (logic thuần, rẻ-tiền).
 * Bổ sung theo yêu cầu QA vòng nghiệm thu (coverage ≥80% dedupe/renderer/errors, testing.md unit+integration).
 * KHÔNG cần DB — service này không chạm tx trong 2 hàm dưới.
 */
import { describe, expect, it } from "vitest";
import { NotificationDedupeService } from "./notification-dedupe.service";
import { DEFAULT_DEDUPE_WINDOW_SECONDS } from "./notification-dedupe.const";

const USER_A = "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1";

function makeService(): NotificationDedupeService {
  return new NotificationDedupeService();
}

// ─── resolveStrategy ─────────────────────────────────────────────────────────

describe("NotificationDedupeService.resolveStrategy", () => {
  it("catalog != 'None' → THẮNG, dùng nguyên catalog + window (kể cả event có DEFAULT_DEDUPE)", () => {
    const svc = makeService();
    const resolved = svc.resolveStrategy({
      eventCode: "TASK_COMMENT_CREATED", // có DEFAULT_DEDUPE, nhưng catalog override phải thắng
      dedupeStrategy: "DedupeKey",
      dedupeWindowSeconds: 120,
    });
    expect(resolved).toEqual({ strategy: "DedupeKey", windowSeconds: 120 });
  });

  it("catalog='None' + eventCode có DEFAULT_DEDUPE (TASK_COMMENT_CREATED) → fallback TimeWindow/300s", () => {
    const svc = makeService();
    const resolved = svc.resolveStrategy({
      eventCode: "TASK_COMMENT_CREATED",
      dedupeStrategy: "None",
      dedupeWindowSeconds: null,
    });
    expect(resolved).toEqual({ strategy: "TimeWindow", windowSeconds: 300 });
  });

  it("catalog='None' + eventCode có DEFAULT_DEDUPE (TASK_STATUS_CHANGED) → fallback TimeWindow/300s", () => {
    const svc = makeService();
    const resolved = svc.resolveStrategy({
      eventCode: "TASK_STATUS_CHANGED",
      dedupeStrategy: "None",
      dedupeWindowSeconds: null,
    });
    expect(resolved).toEqual({ strategy: "TimeWindow", windowSeconds: 300 });
  });

  it("catalog='None' + eventCode KHÔNG có fallback → giữ None/null (không dedupe)", () => {
    const svc = makeService();
    const resolved = svc.resolveStrategy({
      eventCode: "TASK_ASSIGNED",
      dedupeStrategy: "None",
      dedupeWindowSeconds: null,
    });
    expect(resolved).toEqual({ strategy: "None", windowSeconds: null });
  });
});

// ─── computeKey ──────────────────────────────────────────────────────────────

describe("NotificationDedupeService.computeKey", () => {
  it("None → null (không set dedupe_key)", () => {
    const svc = makeService();
    const key = svc.computeKey({
      strategy: "None",
      windowSeconds: null,
      eventCode: "TASK_ASSIGNED",
      recipientUserId: USER_A,
    });
    expect(key).toBeNull();
  });

  it("DedupeKey + có dtoDedupeKey → `{eventCode}:{dtoDedupeKey}`", () => {
    const svc = makeService();
    const key = svc.computeKey({
      strategy: "DedupeKey",
      windowSeconds: null,
      eventCode: "TASK_ASSIGNED",
      recipientUserId: USER_A,
      dedupeKey: "client-key-1",
    });
    expect(key).toBe("TASK_ASSIGNED:client-key-1");
  });

  it("DedupeKey + KHÔNG có dtoDedupeKey → null", () => {
    const svc = makeService();
    const key = svc.computeKey({
      strategy: "DedupeKey",
      windowSeconds: null,
      eventCode: "TASK_ASSIGNED",
      recipientUserId: USER_A,
      dedupeKey: null,
    });
    expect(key).toBeNull();
  });

  it("EntityRecipient + có sourceEntityId → `{eventCode}:{sourceEntityId}:{recipientUserId}`", () => {
    const svc = makeService();
    const key = svc.computeKey({
      strategy: "EntityRecipient",
      windowSeconds: null,
      eventCode: "TASK_COMMENT_CREATED",
      recipientUserId: USER_A,
      sourceEntityId: "task-42",
    });
    expect(key).toBe(`TASK_COMMENT_CREATED:task-42:${USER_A}`);
  });

  it("EntityRecipient + KHÔNG có sourceEntityId → null", () => {
    const svc = makeService();
    const key = svc.computeKey({
      strategy: "EntityRecipient",
      windowSeconds: null,
      eventCode: "TASK_COMMENT_CREATED",
      recipientUserId: USER_A,
      sourceEntityId: null,
    });
    expect(key).toBeNull();
  });

  it("TimeWindow: ổn định TRONG cùng bucket (occurredAtMs lệch vài giây, cùng window)", () => {
    const svc = makeService();
    const windowSeconds = 300;
    const epochSeconds = 1_700_000_000; // mốc cố định, không phụ thuộc Date.now()
    const bucket = Math.floor(epochSeconds / windowSeconds);
    const base = epochSeconds * 1000;

    const keyA = svc.computeKey({
      strategy: "TimeWindow",
      windowSeconds,
      eventCode: "TASK_COMMENT_CREATED",
      recipientUserId: USER_A,
      sourceEntityId: "task-1",
      occurredAtMs: base,
    });
    const keyB = svc.computeKey({
      strategy: "TimeWindow",
      windowSeconds,
      eventCode: "TASK_COMMENT_CREATED",
      recipientUserId: USER_A,
      sourceEntityId: "task-1",
      occurredAtMs: base + 1_000, // +1s, vẫn trong window 300s
    });

    expect(keyA).toBe(`TASK_COMMENT_CREATED:task-1:${USER_A}:${bucket}`);
    expect(keyB).toBe(keyA);
  });

  it("TimeWindow: đổi key khi qua bucket kế (occurredAtMs + đúng 1 window)", () => {
    const svc = makeService();
    const windowSeconds = 300;
    const epochSeconds = 1_700_000_000;
    const base = epochSeconds * 1000;

    const keyA = svc.computeKey({
      strategy: "TimeWindow",
      windowSeconds,
      eventCode: "TASK_COMMENT_CREATED",
      recipientUserId: USER_A,
      sourceEntityId: "task-1",
      occurredAtMs: base,
    });
    const keyNext = svc.computeKey({
      strategy: "TimeWindow",
      windowSeconds,
      eventCode: "TASK_COMMENT_CREATED",
      recipientUserId: USER_A,
      sourceEntityId: "task-1",
      occurredAtMs: base + windowSeconds * 1_000, // sang bucket kế
    });

    expect(keyNext).not.toBe(keyA);
  });

  it("TimeWindow: dùng occurredAtMs (không phải Date.now()) — 2 lời gọi cùng occurredAtMs cho key giống hệt", () => {
    const svc = makeService();
    const occurredAtMs = 1_500_000_000_000; // mốc quá khứ cố định, khác xa Date.now() thật
    const args = {
      strategy: "TimeWindow" as const,
      windowSeconds: 300,
      eventCode: "TASK_STATUS_CHANGED",
      recipientUserId: USER_A,
      sourceEntityId: "task-9",
      occurredAtMs,
    };
    const key1 = svc.computeKey(args);
    const key2 = svc.computeKey({ ...args });
    expect(key1).toBe(key2);
    expect(key1).toContain(String(Math.floor(occurredAtMs / 1000 / 300)));
  });

  it("TimeWindow: windowSeconds null/0 → fallback DEFAULT_DEDUPE_WINDOW_SECONDS", () => {
    const svc = makeService();
    const epochSeconds = 1_700_000_000;
    const bucket = Math.floor(epochSeconds / DEFAULT_DEDUPE_WINDOW_SECONDS);
    const key = svc.computeKey({
      strategy: "TimeWindow",
      windowSeconds: null,
      eventCode: "TASK_COMMENT_CREATED",
      recipientUserId: USER_A,
      sourceEntityId: "task-1",
      occurredAtMs: epochSeconds * 1000,
    });
    expect(key).toBe(`TASK_COMMENT_CREATED:task-1:${USER_A}:${bucket}`);
  });
});
