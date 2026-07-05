/**
 * FOUNDATION-BE-6 — HolidayService unit tests (repo/db mocked, no Postgres).
 *
 * Covers: working-day resolution (weekday/weekend/holiday), company-overrides-global, getHolidaysInRange
 * batch override, and CRUD deny paths (unique conflict → 409, not-found → 404).
 */

import { ConflictException, NotFoundException } from "@nestjs/common";
import { FOUNDATION_ERROR_CODES } from "@mediaos/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HolidaysService } from "./holidays.service";

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const actor = { id: ACTOR_ID, companyId: COMPANY_ID };

// 2024-01-01 = Mon, 2024-01-06 = Sat.
const MON = "2024-01-01";
const SAT = "2024-01-06";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr",
    companyId: null,
    holidayCode: "TET",
    name: "Holiday",
    holidayDate: MON,
    holidayType: "PublicHoliday",
    countryCode: null,
    regionCode: null,
    isRecurring: false,
    affectsAttendance: true,
    affectsLeaveCalculation: true,
    isPaidHoliday: true,
    status: "Active",
    source: "seed",
    description: null,
    ...overrides,
  };
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    findInRange: vi.fn().mockResolvedValue([]),
    findOwnByIdTx: vi.fn().mockResolvedValue([makeRow({ companyId: COMPANY_ID })]),
    insertTx: vi
      .fn()
      .mockResolvedValue([makeRow({ companyId: COMPANY_ID, holidayType: "CompanyHoliday" })]),
    updateOwnTx: vi.fn().mockResolvedValue([makeRow({ companyId: COMPANY_ID })]),
    softDeleteOwnTx: vi.fn().mockResolvedValue([makeRow({ companyId: COMPANY_ID })]),
    ...overrides,
  };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

// withTenant(_c, fn) runs fn with the repo standing in for the tx (mirrors attendance.service.spec).
// tx === repo ⇒ audit.record nhận CÙNG tx với mutation → chứng minh audit-in-tx (0 orphan, BẤT BIẾN #2).
function makeService(repo: ReturnType<typeof makeRepo>, audit = makeAudit()) {
  const db = {
    withTenant: vi
      .fn()
      .mockImplementation((_c: string, fn: (tx: unknown) => Promise<unknown>) => fn(repo)),
  };
  return new HolidaysService(db as never, repo as never, audit as never);
}

describe("HolidaysService.isWorkingDay", () => {
  it("weekday with no holidays → true", async () => {
    const svc = makeService(makeRepo({ findInRange: vi.fn().mockResolvedValue([]) }));
    expect(await svc.isWorkingDay(COMPANY_ID, MON)).toBe(true);
  });

  it("weekend with no holidays → false", async () => {
    const svc = makeService(makeRepo({ findInRange: vi.fn().mockResolvedValue([]) }));
    expect(await svc.isWorkingDay(COMPANY_ID, SAT)).toBe(false);
  });

  it("global holiday on a weekday → false", async () => {
    const svc = makeService(
      makeRepo({ findInRange: vi.fn().mockResolvedValue([makeRow({ companyId: null })]) }),
    );
    expect(await svc.isWorkingDay(COMPANY_ID, MON)).toBe(false);
  });

  it("company WorkingDayOverride beats a global holiday on the same date → true (làm bù)", async () => {
    const svc = makeService(
      makeRepo({
        findInRange: vi
          .fn()
          .mockResolvedValue([
            makeRow({ companyId: null, holidayDate: SAT, holidayType: "PublicHoliday" }),
            makeRow({ companyId: COMPANY_ID, holidayDate: SAT, holidayType: "WorkingDayOverride" }),
          ]),
      }),
    );
    expect(await svc.isWorkingDay(COMPANY_ID, SAT)).toBe(true);
  });
});

describe("HolidaysService.getHolidaysInRange (override company>global)", () => {
  it("collapses a co-dated global+company pair to the company row, keeps lone global on other dates", async () => {
    const svc = makeService(
      makeRepo({
        findInRange: vi
          .fn()
          .mockResolvedValue([
            makeRow({ companyId: null, holidayDate: MON, holidayCode: "G-MON" }),
            makeRow({ companyId: COMPANY_ID, holidayDate: MON, holidayCode: "C-MON" }),
            makeRow({ companyId: null, holidayDate: SAT, holidayCode: "G-SAT" }),
          ]),
      }),
    );
    const out = await svc.getHolidaysInRange(COMPANY_ID, "2024-01-01", "2024-02-01");
    expect(out.map((h) => h.holidayCode)).toEqual(["C-MON", "G-SAT"]);
    expect(out.find((h) => h.holidayCode === "C-MON")?.scope).toBe("company");
    expect(out.find((h) => h.holidayCode === "G-SAT")?.scope).toBe("global");
  });
});

describe("HolidaysService CRUD deny paths", () => {
  it("create → unique violation surfaces as ConflictException", async () => {
    const svc = makeService(makeRepo({ insertTx: vi.fn().mockRejectedValue({ code: "23505" }) }));
    await expect(
      svc.createHoliday(actor, { holidayCode: "TET", name: "Tết", holidayDate: MON }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("create → company-scoped row returned with scope 'company'", async () => {
    const svc = makeService(makeRepo());
    const out = await svc.createHoliday(actor, {
      holidayCode: "TET",
      name: "Tết",
      holidayDate: MON,
    });
    expect(out.scope).toBe("company");
  });

  it("update → missing own row → NotFoundException", async () => {
    const svc = makeService(makeRepo({ findOwnByIdTx: vi.fn().mockResolvedValue([]) }));
    await expect(svc.updateHoliday(actor, "nope", { name: "x" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("delete → missing own row → NotFoundException", async () => {
    const svc = makeService(makeRepo({ softDeleteOwnTx: vi.fn().mockResolvedValue([]) }));
    await expect(svc.deleteHoliday(actor, "nope")).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * S2-FND-CONTRACT-1 (testTask#8 — message-preservation): mỗi throw ĐÃ chuyển sang payload {code,message}
 * (holidays.service.ts:203/244 = 409 HOLIDAY_DUPLICATE · 219/251/265 = 404 HOLIDAY_NOT_FOUND) vẫn TRẢ
 * message GỐC bên cạnh mã FOUNDATION-ERR-* — client KHÔNG mất ngữ cảnh, KHÔNG bị thay bằng class-name mặc
 * định. Cần ≥1 case 404 VÀ ≥1 case 409 (ghép với case 404 sẵn có ở "CRUD deny paths").
 */
describe("HolidaysService message-preservation (payload {code,message} — testTask#8)", () => {
  const HOLIDAY_ID = "rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr";

  it("409 create → HOLIDAY_DUPLICATE giữ mã + message gốc (unique violation 23505)", async () => {
    const svc = makeService(makeRepo({ insertTx: vi.fn().mockRejectedValue({ code: "23505" }) }));
    try {
      await svc.createHoliday(actor, { holidayCode: "TET", name: "Tết", holidayDate: MON });
      throw new Error("expected ConflictException");
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      const body = (err as ConflictException).getResponse() as { code: string; message: string };
      expect(body.code).toBe(FOUNDATION_ERROR_CODES.HOLIDAY_DUPLICATE);
      expect(body.message).toBe("Ngày nghỉ trùng (mã + ngày đã tồn tại trong công ty).");
    }
  });

  it("409 update → HOLIDAY_DUPLICATE giữ mã + message gốc (unique violation trên updateOwnTx)", async () => {
    const svc = makeService(
      makeRepo({ updateOwnTx: vi.fn().mockRejectedValue({ code: "23505" }) }),
    );
    try {
      await svc.updateHoliday(actor, HOLIDAY_ID, { name: "Đổi tên" });
      throw new Error("expected ConflictException");
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      const body = (err as ConflictException).getResponse() as { code: string; message: string };
      expect(body.code).toBe(FOUNDATION_ERROR_CODES.HOLIDAY_DUPLICATE);
      expect(body.message).toBe("Ngày nghỉ trùng (mã + ngày).");
    }
  });

  it("404 update → HOLIDAY_NOT_FOUND giữ mã + message gốc (row không tồn tại)", async () => {
    const svc = makeService(makeRepo({ findOwnByIdTx: vi.fn().mockResolvedValue([]) }));
    try {
      await svc.updateHoliday(actor, "nope", { name: "x" });
      throw new Error("expected NotFoundException");
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundException);
      const body = (err as NotFoundException).getResponse() as { code: string; message: string };
      expect(body.code).toBe(FOUNDATION_ERROR_CODES.HOLIDAY_NOT_FOUND);
      expect(body.message).toBe("Không tìm thấy ngày nghỉ.");
    }
  });
});

/**
 * S2-FND-BE-6 (RED-trước, QA02-FOUNDATION-AUDIT-001 / QA06-AUDIT-008, SPEC-01 §16.3) —
 * mỗi create/update/delete ghi audit CONFIG object_type='public_holiday' ĐÚNG 1 lần BÊN TRONG cùng
 * withTenant tx (tx === repo trong mock); mutation lỗi → audit.record KHÔNG chạy (0 orphan cùng tx).
 */
describe("HolidaysService audit-on-CONFIG (BẤT BIẾN #2 append-only + in-tx)", () => {
  const HOLIDAY_ID = "rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr";
  let audit: ReturnType<typeof makeAudit>;

  beforeEach(() => {
    audit = makeAudit();
  });

  it("create → audit.record ĐÚNG 1 lần với shape public_holiday/CONFIG trong CÙNG tx (tx===repo)", async () => {
    const repo = makeRepo();
    const svc = makeService(repo, audit);
    await svc.createHoliday(actor, { holidayCode: "TET", name: "Tết", holidayDate: MON });

    expect(audit.record).toHaveBeenCalledTimes(1);
    const [tx, entry] = audit.record.mock.calls[0];
    expect(tx).toBe(repo); // audit-in-tx: cùng tx với insertTx (0 orphan / cùng commit-rollback)
    expect(entry).toMatchObject({
      action: "HOLIDAY_CREATED",
      objectType: "public_holiday",
      objectId: HOLIDAY_ID,
      actorUserId: ACTOR_ID,
      actorType: "User",
      actionGroup: "CONFIG",
      dataScope: "Company",
      sensitivityLevel: "Normal",
      resultStatus: "Success",
    });
    expect(entry.oldValues ?? null).toBeNull(); // create: chưa có snapshot cũ
    expect(entry.newValues).toMatchObject({ holidayCode: "TET" });
  });

  it("update → audit.record ĐÚNG 1 lần HOLIDAY_UPDATED, old=snapshot existing, new=snapshot mới", async () => {
    const repo = makeRepo();
    const svc = makeService(repo, audit);
    await svc.updateHoliday(actor, HOLIDAY_ID, { name: "Đổi tên" });

    expect(audit.record).toHaveBeenCalledTimes(1);
    const [tx, entry] = audit.record.mock.calls[0];
    expect(tx).toBe(repo);
    expect(entry).toMatchObject({
      action: "HOLIDAY_UPDATED",
      objectType: "public_holiday",
      objectId: HOLIDAY_ID,
      actorType: "User",
      actionGroup: "CONFIG",
      dataScope: "Company",
    });
    expect(entry.oldValues).toBeTruthy();
    expect(entry.newValues).toBeTruthy();
  });

  it("delete → audit.record ĐÚNG 1 lần HOLIDAY_DELETED, old=snapshot row, new=null", async () => {
    const repo = makeRepo();
    const svc = makeService(repo, audit);
    await svc.deleteHoliday(actor, HOLIDAY_ID);

    expect(audit.record).toHaveBeenCalledTimes(1);
    const [tx, entry] = audit.record.mock.calls[0];
    expect(tx).toBe(repo);
    expect(entry).toMatchObject({
      action: "HOLIDAY_DELETED",
      objectType: "public_holiday",
      objectId: HOLIDAY_ID,
      actorType: "User",
      actionGroup: "CONFIG",
    });
    expect(entry.oldValues).toBeTruthy();
    expect(entry.newValues ?? null).toBeNull();
  });

  it("create → insertTx throw ⇒ audit.record KHÔNG chạy (0 orphan cùng tx)", async () => {
    const repo = makeRepo({ insertTx: vi.fn().mockRejectedValue(new Error("insert boom")) });
    const svc = makeService(repo, audit);
    await expect(
      svc.createHoliday(actor, { holidayCode: "TET", name: "Tết", holidayDate: MON }),
    ).rejects.toThrow();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("update → updateOwnTx throw ⇒ audit.record KHÔNG chạy (0 orphan)", async () => {
    const repo = makeRepo({ updateOwnTx: vi.fn().mockRejectedValue(new Error("update boom")) });
    const svc = makeService(repo, audit);
    await expect(svc.updateHoliday(actor, HOLIDAY_ID, { name: "x" })).rejects.toThrow();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("delete → softDeleteOwnTx throw ⇒ audit.record KHÔNG chạy (0 orphan)", async () => {
    const repo = makeRepo({ softDeleteOwnTx: vi.fn().mockRejectedValue(new Error("del boom")) });
    const svc = makeService(repo, audit);
    await expect(svc.deleteHoliday(actor, HOLIDAY_ID)).rejects.toThrow();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("update → row không tồn tại (NotFound) ⇒ audit.record KHÔNG chạy", async () => {
    const repo = makeRepo({ findOwnByIdTx: vi.fn().mockResolvedValue([]) });
    const svc = makeService(repo, audit);
    await expect(svc.updateHoliday(actor, "nope", { name: "x" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });
});
