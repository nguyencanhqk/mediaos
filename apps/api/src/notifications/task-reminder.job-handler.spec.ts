/**
 * S20-TASK-DUEREMIND-1 — unit (KHÔNG DB) cho TaskReminderJobHandler + hàm thuần của phần đọc.
 *
 * Phần đọc SQL (`queryReminderCandidates` · `findRemindedPairs`) được giả; mọi hàm thuần (khoá, người nhận,
 * vị từ «đã từng nhận») và `NotificationDedupeService` là THẬT — để khoá job kiểm trước luôn là khoá engine
 * tính. Hành vi trên Postgres thật: `test/integration/task-reminder-job.int-spec.ts`.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InternalEventIntakeDto } from "@mediaos/contracts";
import { NotificationDedupeService } from "./notification-dedupe.service";
import { TaskReminderJobHandler } from "./task-reminder.job-handler";
import * as q from "./task-reminder.job-handler.query";

vi.mock("./task-reminder.job-handler.query", async (importOriginal) => {
  const real = await importOriginal<typeof import("./task-reminder.job-handler.query")>();
  return { ...real, queryReminderCandidates: vi.fn(), findRemindedPairs: vi.fn() };
});

const FAKE_TX = { fake: "tx" };
const COMPANY = randomUUID();

function cand(
  dueAt: string,
  assignee: string,
  reporter: string | null = null,
): q.ReminderCandidate {
  return {
    id: randomUUID(),
    title: "việc",
    dueAt,
    assigneeUserId: assignee,
    reporterUserId: reporter,
  };
}

interface HarnessOpts {
  reminded?: Set<string>;
  catalogStrategy?: string | null;
  failFor?: string;
}

function harness(found: q.ReminderCandidates, opts: HarnessOpts = {}) {
  vi.mocked(q.queryReminderCandidates).mockResolvedValue(found);
  vi.mocked(q.findRemindedPairs).mockResolvedValue(opts.reminded ?? new Set());
  const db = {
    withTenant: vi.fn(async (_c: string, fn: (tx: unknown) => Promise<unknown>) => fn(FAKE_TX)),
  };
  const engine = {
    intake: vi.fn(async (_c: string, dto: InternalEventIntakeDto) => {
      if (dto.sourceEntityId === opts.failFor) throw new Error("intake hỏng ở một việc");
      return { createdCount: 1, skippedCount: 0, dedupedCount: 0 };
    }),
  };
  const eventRepo = {
    findEnabledEvent: vi.fn(async (_tx: unknown, _c: string, eventCode: string) =>
      opts.catalogStrategy === null
        ? undefined
        : { eventCode, dedupeStrategy: opts.catalogStrategy ?? "None", dedupeWindowSeconds: null },
    ),
  };
  const handler = new TaskReminderJobHandler(
    db as never,
    engine as never,
    eventRepo as never,
    new NotificationDedupeService(),
  );
  return { handler, engine, eventRepo };
}

function intakeFor(engine: { intake: ReturnType<typeof vi.fn> }, taskId: string) {
  return engine.intake.mock.calls
    .map((c) => c[1] as InternalEventIntakeDto)
    .filter((dto) => dto.sourceEntityId === taskId);
}

const DUE = "2026-10-26T08:00:00.000Z";

describe("hàm thuần của phần đọc", () => {
  it("khoá: chuỗi có offset +07:00, text kiểu PG và Date cùng thời điểm ⇒ CÙNG khoá UTC mili-giây", () => {
    const id = randomUUID();
    const expected = `${id}:${DUE}`;
    expect(q.reminderDedupeKey(id, "2026-10-26T15:00:00+07:00")).toBe(expected);
    expect(q.reminderDedupeKey(id, "2026-10-26 08:00:00+00")).toBe(expected);
    expect(q.reminderDedupeKey(id, new Date(Date.UTC(2026, 9, 26, 8, 0, 0)))).toBe(expected);
    expect(() => q.toUtcIso("không-phải-ngày")).toThrow(/due_at/);
  });

  it("người nhận: DUE_SOON chỉ phụ trách; OVERDUE phụ trách ∪ reporter, không trùng", () => {
    const a = randomUUID();
    const r = randomUUID();
    expect(q.reminderRecipients(q.TASK_DUE_SOON_EVENT, cand(DUE, a, r))).toEqual([a]);
    expect(q.reminderRecipients(q.TASK_OVERDUE_EVENT, cand(DUE, a, r))).toEqual([a, r]);
    expect(q.reminderRecipients(q.TASK_OVERDUE_EVENT, cand(DUE, a, a))).toEqual([a]);
    expect(q.reminderRecipients(q.TASK_OVERDUE_EVENT, cand(DUE, a, null))).toEqual([a]);
  });

  it("lookback quá hạn = 7 ngày, cửa sổ sắp hạn = 24h (quyết định owner 26/10)", () => {
    expect(q.OVERDUE_LOOKBACK_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(q.DUE_SOON_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("vị từ «đã từng nhận» = tầng 1 của engine TRỪ deleted_at (+ user_id cho index)", () => {
    const recipient = randomUUID();
    const rendered = new PgDialect().sqlToQuery(
      q.remindedPairsWhere(COMPANY, q.TASK_OVERDUE_EVENT, [recipient], ["k1"]),
    );
    const text = rendered.sql.replace(/\s+/g, " ");
    for (const col of ["company_id", "event_code", "recipient_user_id", "user_id", "dedupe_key"]) {
      expect(text).toContain(`"notifications"."${col}"`);
    }
    expect(text).not.toContain("deleted_at");
    expect(rendered.params).toEqual(
      expect.arrayContaining([COMPANY, q.TASK_OVERDUE_EVENT, recipient, "k1"]),
    );
  });
});

describe("TaskReminderJobHandler.run", () => {
  beforeEach(() => vi.clearAllMocks());

  it("phát đúng DTO: khoá (việc, mốc hạn), người nhận gộp, mọi phần đọc trong withTenant", async () => {
    const a = randomUUID();
    const r = randomUUID();
    const soon = cand(DUE, a, r);
    const late = cand(DUE, a, r);
    const self = cand(DUE, a, a);
    const { handler, engine } = harness({
      dueSoon: [soon],
      overdue: [late, self],
      overdueSkippedByLookback: 2,
    });

    const res = await handler.run({ companyId: COMPANY });

    const [soonDto] = intakeFor(engine, soon.id);
    expect(soonDto?.eventCode).toBe(q.TASK_DUE_SOON_EVENT);
    expect(soonDto?.recipient).toEqual({ mode: "UserIds", userIds: [a], employeeIds: [] });
    expect(soonDto?.dedupeKey).toBe(`${soon.id}:${DUE}`);
    const [lateDto] = intakeFor(engine, late.id);
    expect(lateDto?.eventCode).toBe(q.TASK_OVERDUE_EVENT);
    expect(lateDto?.recipient.mode === "UserIds" && lateDto.recipient.userIds).toEqual([a, r]);
    expect(intakeFor(engine, self.id)[0]?.recipient).toMatchObject({ userIds: [a] });
    expect(q.queryReminderCandidates).toHaveBeenCalledWith(FAKE_TX, COMPANY, expect.any(Date));
    expect(res).toEqual({
      total: 3,
      success: 3,
      failed: 0,
      metadata: {
        dueSoonCount: 1,
        overdueCount: 2,
        overdueSkippedByLookback: 2,
        alreadyRemindedCount: 0,
      },
    });
  });

  it("kiểm trước bằng khoá engine: người đã từng nhận bị bỏ; còn 0 người ⇒ không intake, đếm alreadyReminded", async () => {
    const a = randomUUID();
    const r = randomUUID();
    const partly = cand(DUE, a, r);
    const fully = cand(DUE, a, null);
    const engineKey = (t: q.ReminderCandidate) => `${q.TASK_OVERDUE_EVENT}:${t.id}:${DUE}`;
    const reminded = new Set([
      q.recipientKeyId(a, engineKey(partly)),
      q.recipientKeyId(a, engineKey(fully)),
    ]);
    const { handler, engine } = harness(
      { dueSoon: [], overdue: [partly, fully], overdueSkippedByLookback: 0 },
      { reminded },
    );

    const res = await handler.run({ companyId: COMPANY });

    expect(q.findRemindedPairs).toHaveBeenCalledWith(FAKE_TX, COMPANY, q.TASK_OVERDUE_EVENT, [
      { recipientUserId: a, key: engineKey(partly) },
      { recipientUserId: r, key: engineKey(partly) },
      { recipientUserId: a, key: engineKey(fully) },
    ]);
    expect(intakeFor(engine, partly.id)[0]?.recipient).toMatchObject({ userIds: [r] });
    expect(intakeFor(engine, fully.id)).toHaveLength(0);
    expect(res.success).toBe(2);
    expect(res.metadata).toMatchObject({ alreadyRemindedCount: 1 });
  });

  it("intake ném ở một việc ⇒ việc khác vẫn phát, failed đếm đúng", async () => {
    const a = randomUUID();
    const broken = cand(DUE, a);
    const healthy = cand(DUE, a);
    const { handler, engine } = harness(
      { dueSoon: [], overdue: [broken, healthy], overdueSkippedByLookback: 0 },
      { failFor: broken.id },
    );

    const res = await handler.run({ companyId: COMPANY });

    expect(intakeFor(engine, healthy.id)).toHaveLength(1);
    expect(res).toMatchObject({ total: 2, success: 1, failed: 1 });
  });

  it("chiến lược catalog khác DedupeKey ⇒ cảnh báo + metadata, khoá kiểm trước theo chiến lược engine", async () => {
    const a = randomUUID();
    const late = cand(DUE, a);
    const { handler } = harness(
      { dueSoon: [cand(DUE, a)], overdue: [late], overdueSkippedByLookback: 0 },
      { catalogStrategy: "EntityRecipient" },
    );

    const res = await handler.run({ companyId: COMPANY });

    expect(res.metadata).toMatchObject({
      dedupeStrategyMismatch: [q.TASK_DUE_SOON_EVENT, q.TASK_OVERDUE_EVENT],
    });
    expect(q.findRemindedPairs).toHaveBeenCalledWith(FAKE_TX, COMPANY, q.TASK_OVERDUE_EVENT, [
      { recipientUserId: a, key: `${q.TASK_OVERDUE_EVENT}:${late.id}:${a}` },
    ]);
  });

  it("sự kiện tắt/không có trong catalog ⇒ không kiểm trước, engine tự quyết", async () => {
    const a = randomUUID();
    const late = cand(DUE, a);
    const { handler, engine } = harness(
      { dueSoon: [], overdue: [late], overdueSkippedByLookback: 0 },
      { catalogStrategy: null },
    );

    await handler.run({ companyId: COMPANY });

    expect(q.findRemindedPairs).not.toHaveBeenCalled();
    expect(intakeFor(engine, late.id)).toHaveLength(1);
  });
});
