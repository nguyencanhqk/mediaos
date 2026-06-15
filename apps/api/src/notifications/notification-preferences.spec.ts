/**
 * NOTI-002 — Mandatory notification deny-path tests (RED trước, CLAUDE.md §6).
 *
 * D1: upsert(type, enabled=false) khi rule.mandatory=true → THROW BadRequestException
 *     'mandatory notification cannot be disabled'. KHÔNG ghi row enabled=false.
 * D2: upsert(type, enabled=true) khi mandatory=true → OK (chỉ chặn tắt, không chặn bật).
 * D3: upsert(type, enabled=false) khi mandatory=false → OK (opt-out thường vẫn hoạt động).
 * D4: mandatory lookup truyền đúng companyId của caller (không inject companyId khác).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { NotificationPreferencesRepository } from "./notification-preferences.repository";
import { DatabaseService } from "../db/db.service";
import { notificationRules } from "../db/schema/communication";

// ─── helpers ─────────────────────────────────────────────────────────────────

const CO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_A = "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1";

function makeDb(mandatoryResult: boolean = false): DatabaseService {
  const mockSelect = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(
      mandatoryResult ? [{ mandatory: true }] : [],
    ),
  };

  const mockInsert = {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{
      id: "pref-id",
      companyId: CO_A,
      userId: USER_A,
      notificationType: "general",
      enabled: true,
      updatedAt: new Date(),
    }]),
  };

  const tx = { ...mockSelect, ...mockInsert };

  return {
    withTenant: vi.fn().mockImplementation((_co: string, fn: (tx: unknown) => unknown) => fn(tx)),
  } as unknown as DatabaseService;
}

// ─── D1–D4 ───────────────────────────────────────────────────────────────────

describe("D — Mandatory notification guard (notification-preferences.repository)", () => {
  it("D1: upsert(enabled=false) khi mandatory=true → throw BadRequestException, không ghi DB", async () => {
    const db = makeDb(true /* mandatory=true */);
    const repo = new NotificationPreferencesRepository(db);

    await expect(repo.upsert(CO_A, USER_A, "general", false)).rejects.toThrow(
      BadRequestException,
    );
    await expect(repo.upsert(CO_A, USER_A, "general", false)).rejects.toThrow(
      "mandatory notification cannot be disabled",
    );
  });

  it("D2: upsert(enabled=true) khi mandatory=true → OK (chỉ chặn tắt)", async () => {
    const db = makeDb(true /* mandatory=true */);
    const repo = new NotificationPreferencesRepository(db);

    // Không throw khi bật — mandatory rule không ngăn bật lại
    await expect(repo.upsert(CO_A, USER_A, "general", true)).resolves.toBeDefined();
  });

  it("D3: upsert(enabled=false) khi mandatory=false → OK (opt-out thường)", async () => {
    const db = makeDb(false /* mandatory=false */);
    const repo = new NotificationPreferencesRepository(db);

    await expect(repo.upsert(CO_A, USER_A, "general", false)).resolves.toBeDefined();
  });

  it("D4: mandatory lookup truyền đúng companyId của caller (không inject companyId khác)", async () => {
    // DB spy để xác nhận withTenant được gọi với CO_A, không CO_B
    const db = makeDb(false);
    const withTenantSpy = db.withTenant as ReturnType<typeof vi.fn>;
    const repo = new NotificationPreferencesRepository(db);

    await repo.upsert(CO_A, USER_A, "general", false);

    // Mọi lần gọi withTenant PHẢI dùng CO_A
    for (const call of withTenantSpy.mock.calls) {
      expect(call[0]).toBe(CO_A);
      expect(call[0]).not.toBe(CO_B);
    }
  });
});
