/**
 * G10-2 Notification deny-path + contract tests (CLAUDE.md §9.4 — RED trước).
 *
 * 3 nhóm bắt buộc (nhạy cảm tenant-iso + preference + outbox masking):
 *   A. Tenant isolation — user công ty A KHÔNG đọc được notification công ty B.
 *   B. Preference filter — type bị tắt (enabled=false) → KHÔNG tạo notification.
 *   C. Outbox payload contract — payload đi qua notificationSchema.parse (strip field thừa).
 *
 * S6-SEC-NOTITX-1 (KI-034) thêm nhóm:
 *   D. Atomicity — insert + outbox + audit phải nằm TRONG MỘT transaction; bất kỳ bước nào ném thì
 *      thao tác KHÔNG được "thành công một nửa" (hàng tồn tại mà mất audit/sự kiện) và KHÔNG được
 *      emit WS. Xem docs/plans/S6-SEC-NOTITX-1.md §6 (bảng RED-proof từng ca).
 *
 * Dùng mock repo (KHÔNG cần Postgres). Xác nhận RED vì behaviour chưa implement.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { notificationSchema } from "@mediaos/contracts";
import { NotificationsService } from "./notifications.service";
import type { NotificationsRepository } from "./notifications.repository";
import type { NotificationPreferencesRepository } from "./notification-preferences.repository";
import type { OutboxService } from "../events/outbox.service";
import type { AuditService } from "../events/audit.service";
import type { RealtimeEmitterService } from "../realtime/realtime-emitter.service";
import type { DatabaseService } from "../db/db.service";

// ─── helpers ─────────────────────────────────────────────────────────────────

const CO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_A = "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1";
const USER_B = "b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1";
const NOTIF_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function makeNotifRow(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTIF_ID,
    companyId: CO_A,
    userId: USER_A,
    type: "general",
    refId: null,
    refType: null,
    body: "Hello",
    isRead: false,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    // extra DB column that must NOT leak to client
    __internal_secret: "must-be-stripped",
    ...overrides,
  };
}

function makeRepo(): NotificationsRepository {
  return {
    findByUser: vi.fn(),
    countUnread: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    create: vi.fn(),
  } as unknown as NotificationsRepository;
}

function makePrefRepo(): NotificationPreferencesRepository {
  return {
    findByUser: vi.fn(),
    upsert: vi.fn(),
    isTypeEnabled: vi.fn(),
  } as unknown as NotificationPreferencesRepository;
}

function makeOutbox(): OutboxService {
  return { enqueue: vi.fn().mockResolvedValue("evt-id") } as unknown as OutboxService;
}

function makeAudit(): AuditService {
  return { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

function makeEmitter(): RealtimeEmitterService {
  return { emitNotification: vi.fn() } as unknown as RealtimeEmitterService;
}

function makeDb(): DatabaseService {
  return {
    withTenant: vi.fn().mockImplementation((_co: string, fn: (tx: unknown) => unknown) => fn({})),
  } as unknown as DatabaseService;
}

function makeService(
  repo = makeRepo(),
  prefRepo = makePrefRepo(),
  outbox = makeOutbox(),
  audit = makeAudit(),
  emitter = makeEmitter(),
  db = makeDb(),
): NotificationsService {
  return new NotificationsService(repo, prefRepo, outbox, audit, emitter, db);
}

// ─── A. Tenant isolation ─────────────────────────────────────────────────────

describe("A — Tenant isolation", () => {
  let repo: NotificationsRepository;
  let service: NotificationsService;

  beforeEach(() => {
    repo = makeRepo();
    service = makeService(repo);
  });

  it("A1: markRead với notificationId của tenant A nhưng companyId=B → 0 row → NotFoundException", async () => {
    (repo.markRead as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await expect(service.markRead(CO_B, NOTIF_ID, USER_B)).rejects.toThrow(NotFoundException);
  });

  it("A2: listForUser chỉ truyền đúng companyId của caller vào repo", async () => {
    (repo.findByUser as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await service.listForUser(CO_A, USER_A);
    expect(repo.findByUser).toHaveBeenCalledWith(CO_A, USER_A, undefined);
  });

  it("A3: create truyền companyId=A vào repo (không cho inject companyId khác)", async () => {
    const prefRepo = makePrefRepo();
    (prefRepo.isTypeEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (repo.create as ReturnType<typeof vi.fn>).mockResolvedValue([makeNotifRow({ userId: USER_B })]);
    const svc = makeService(repo, prefRepo);

    await svc.create(CO_A, { userId: USER_B, type: "general", body: "test" });

    // S6-SEC-NOTITX-1: repo.create nay nhận thêm tham số thứ 3 `tx` (một transaction cho cả
    // insert + outbox + audit). Ý của ca này KHÔNG đổi — companyId vẫn phải là của caller.
    expect(repo.create).toHaveBeenCalledWith(
      CO_A,
      expect.objectContaining({ userId: USER_B }),
      expect.anything(),
    );
  });
});

// ─── B. Preference filter ────────────────────────────────────────────────────

describe("B — Preference filter", () => {
  it("B1: create với preference enabled=false → KHÔNG gọi repo.create, trả null", async () => {
    const repo = makeRepo();
    const prefRepo = makePrefRepo();
    (prefRepo.isTypeEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const svc = makeService(repo, prefRepo);

    const result = await svc.create(CO_A, { userId: USER_A, type: "general", body: "filtered" });

    expect(repo.create).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("B2: create với preference enabled=true → gọi repo.create, trả DTO", async () => {
    const repo = makeRepo();
    const prefRepo = makePrefRepo();
    (prefRepo.isTypeEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (repo.create as ReturnType<typeof vi.fn>).mockResolvedValue([makeNotifRow()]);
    const svc = makeService(repo, prefRepo);

    const result = await svc.create(CO_A, { userId: USER_A, type: "general", body: "allowed" });

    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
  });

  it("B3: create khi không có preference row (isTypeEnabled=true) → default enabled=true, tạo bình thường", async () => {
    const repo = makeRepo();
    const prefRepo = makePrefRepo();
    (prefRepo.isTypeEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (repo.create as ReturnType<typeof vi.fn>).mockResolvedValue([makeNotifRow()]);
    const svc = makeService(repo, prefRepo);

    await svc.create(CO_A, { userId: USER_A, type: "task_assigned", body: "new task" });

    expect(repo.create).toHaveBeenCalledTimes(1);
  });
});

// ─── B4–B5: mandatory override preference ────────────────────────────────────

describe("B — Mandatory rule overrides stale preference", () => {
  it("B4: create(type mandatory) khi user CÓ pref enabled=false (stale) → isTypeEnabled=true → vẫn tạo notification", async () => {
    const repo = makeRepo();
    const prefRepo = makePrefRepo();
    // prefRepo.isTypeEnabled phải trả TRUE khi rule mandatory, bất kể pref row
    (prefRepo.isTypeEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (repo.create as ReturnType<typeof vi.fn>).mockResolvedValue([makeNotifRow()]);
    const svc = makeService(repo, prefRepo);

    const result = await svc.create(CO_A, { userId: USER_A, type: "general", body: "mandatory" });

    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
  });

  it("B5: create(type non-mandatory) pref enabled=false → vẫn null (regression giữ hành vi cũ)", async () => {
    const repo = makeRepo();
    const prefRepo = makePrefRepo();
    (prefRepo.isTypeEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const svc = makeService(repo, prefRepo);

    const result = await svc.create(CO_A, { userId: USER_A, type: "general", body: "suppressed" });

    expect(repo.create).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});

// ─── C. Outbox payload đi qua DTO/masking ────────────────────────────────────

describe("C — Outbox payload qua notificationSchema.parse (masking)", () => {
  it("C1: notificationSchema.parse loại bỏ field thừa (__internal_secret không rò ra client)", () => {
    const row = makeNotifRow();
    const dto = notificationSchema.parse({
      ...row,
      createdAt: row.createdAt.toISOString(),
    });
    expect((dto as Record<string, unknown>).__internal_secret).toBeUndefined();
    expect(dto.id).toBe(NOTIF_ID);
    expect(dto.body).toBe("Hello");
  });

  it("C2: create → trả DTO đã qua notificationSchema (strip field thừa)", async () => {
    const repo = makeRepo();
    const prefRepo = makePrefRepo();
    (prefRepo.isTypeEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (repo.create as ReturnType<typeof vi.fn>).mockResolvedValue([makeNotifRow()]);
    const svc = makeService(repo, prefRepo);

    const result = await svc.create(CO_A, { userId: USER_A, type: "general", body: "test" });

    expect(() => notificationSchema.parse(result)).not.toThrow();
    expect((result as Record<string, unknown>).__internal_secret).toBeUndefined();
  });

  it("C3: outbox.enqueue gọi với payload đủ trường (notificationId/companyId/userId) và không có __internal_secret", async () => {
    const repo = makeRepo();
    const prefRepo = makePrefRepo();
    const outbox = makeOutbox();
    const db = makeDb();
    (prefRepo.isTypeEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (repo.create as ReturnType<typeof vi.fn>).mockResolvedValue([makeNotifRow()]);
    const svc = makeService(repo, prefRepo, outbox, makeAudit(), makeEmitter(), db);

    await svc.create(CO_A, { userId: USER_A, type: "general", body: "outbox test" });

    expect(outbox.enqueue).toHaveBeenCalled();
    const calls = (outbox.enqueue as ReturnType<typeof vi.fn>).mock.calls;
    const event = calls[0][1] as { eventType: string; payload: Record<string, unknown> };
    expect(event.eventType).toBe("notification.created");
    expect(event.payload).toMatchObject({
      notificationId: NOTIF_ID,
      companyId: CO_A,
      userId: USER_A,
    });
    expect(event.payload.__internal_secret).toBeUndefined();
  });
});

// ─── D. Atomicity: insert + outbox + audit trong MỘT transaction (S6-SEC-NOTITX-1 · KI-034) ──

type Mock = ReturnType<typeof vi.fn>;

/** Bộ mock đã wire sẵn cho nhóm D — preference bật, repo.create trả 1 hàng. */
function makeAtomicFixture() {
  const repo = makeRepo();
  const prefRepo = makePrefRepo();
  const outbox = makeOutbox();
  const audit = makeAudit();
  const emitter = makeEmitter();
  const db = makeDb();
  (prefRepo.isTypeEnabled as Mock).mockResolvedValue(true);
  (repo.create as Mock).mockResolvedValue([makeNotifRow()]);
  const svc = makeService(repo, prefRepo, outbox, audit, emitter, db);
  return { repo, prefRepo, outbox, audit, emitter, db, svc };
}

describe("D — create(): atomic insert + outbox + audit", () => {
  it("D1: outbox.enqueue ném → create() REJECT (không nuốt thành warn rồi trả DTO)", async () => {
    const f = makeAtomicFixture();
    (f.outbox.enqueue as Mock).mockRejectedValue(new Error("outbox down"));

    await expect(
      f.svc.create(CO_A, { userId: USER_A, type: "general", body: "x" }),
    ).rejects.toThrow("outbox down");
  });

  it("D2: audit.record ném → create() REJECT (mất vết kiểm toán KHÔNG được im lặng)", async () => {
    const f = makeAtomicFixture();
    (f.audit.record as Mock).mockRejectedValue(new Error("audit down"));

    await expect(
      f.svc.create(CO_A, { userId: USER_A, type: "general", body: "x" }),
    ).rejects.toThrow("audit down");
  });

  it("D3: outbox.enqueue ném → KHÔNG emit WS (không phát cho hàng đã rollback)", async () => {
    const f = makeAtomicFixture();
    (f.outbox.enqueue as Mock).mockRejectedValue(new Error("outbox down"));

    await expect(
      f.svc.create(CO_A, { userId: USER_A, type: "general", body: "x" }),
    ).rejects.toThrow();
    expect(f.emitter.emitNotification).not.toHaveBeenCalled();
  });

  it("D4: repo.create · outbox.enqueue · audit.record nhận CÙNG MỘT tx (một transaction duy nhất)", async () => {
    const f = makeAtomicFixture();

    await f.svc.create(CO_A, { userId: USER_A, type: "general", body: "x" });

    expect(f.db.withTenant).toHaveBeenCalledTimes(1);
    // Đối số companyId của withTenant CHÍNH LÀ thứ quyết định GUC app.current_company_id (ngữ cảnh
    // RLS) — khoá luôn, đừng chỉ đếm số lần gọi.
    expect(f.db.withTenant).toHaveBeenCalledWith(CO_A, expect.any(Function));
    const txRepo = (f.repo.create as Mock).mock.calls[0][2];
    const txOutbox = (f.outbox.enqueue as Mock).mock.calls[0][0];
    const txAudit = (f.audit.record as Mock).mock.calls[0][0];
    expect(txRepo).toBeDefined();
    expect(txRepo).toBe(txOutbox);
    expect(txRepo).toBe(txAudit);
  });

  it("D5: repo.create trả [] → REJECT (không trả null câm — null CHỈ có nghĩa 'bị preference lọc')", async () => {
    const f = makeAtomicFixture();
    (f.repo.create as Mock).mockResolvedValue([]);

    await expect(
      f.svc.create(CO_A, { userId: USER_A, type: "general", body: "x" }),
    ).rejects.toThrow();
    expect(f.emitter.emitNotification).not.toHaveBeenCalled();
  });

  it("D5b: hồi quy — preference tắt vẫn trả null (KHÔNG ném), phân biệt được với D5", async () => {
    const f = makeAtomicFixture();
    (f.prefRepo.isTypeEnabled as Mock).mockResolvedValue(false);

    await expect(
      f.svc.create(CO_A, { userId: USER_A, type: "general", body: "x" }),
    ).resolves.toBeNull();
  });
});

describe("D — markRead(): audit cùng transaction với update", () => {
  it("D6: audit.record ném → markRead() REJECT (mark_read đã đáng audit thì không được mất vết)", async () => {
    const repo = makeRepo();
    const audit = makeAudit();
    (repo.markRead as Mock).mockResolvedValue([makeNotifRow()]);
    (audit.record as Mock).mockRejectedValue(new Error("audit down"));
    const svc = makeService(repo, makePrefRepo(), makeOutbox(), audit, makeEmitter(), makeDb());

    await expect(svc.markRead(CO_A, NOTIF_ID, USER_A)).rejects.toThrow("audit down");
  });

  it("D7: repo.markRead và audit.record nhận CÙNG MỘT tx", async () => {
    const repo = makeRepo();
    const audit = makeAudit();
    const db = makeDb();
    (repo.markRead as Mock).mockResolvedValue([makeNotifRow()]);
    const svc = makeService(repo, makePrefRepo(), makeOutbox(), audit, makeEmitter(), db);

    await svc.markRead(CO_A, NOTIF_ID, USER_A);

    expect(db.withTenant).toHaveBeenCalledTimes(1);
    expect(db.withTenant).toHaveBeenCalledWith(CO_A, expect.any(Function));
    const txRepo = (repo.markRead as Mock).mock.calls[0][3];
    const txAudit = (audit.record as Mock).mock.calls[0][0];
    expect(txRepo).toBeDefined();
    expect(txRepo).toBe(txAudit);
  });

  it("D8: hồi quy — 0 hàng (tenant/user khác) vẫn NotFoundException, KHÔNG ghi audit", async () => {
    const repo = makeRepo();
    const audit = makeAudit();
    (repo.markRead as Mock).mockResolvedValue([]);
    const svc = makeService(repo, makePrefRepo(), makeOutbox(), audit, makeEmitter(), makeDb());

    await expect(svc.markRead(CO_B, NOTIF_ID, USER_B)).rejects.toThrow(NotFoundException);
    expect(audit.record).not.toHaveBeenCalled();
  });
});
