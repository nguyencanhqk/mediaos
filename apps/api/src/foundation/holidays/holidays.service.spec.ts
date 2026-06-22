/**
 * FOUNDATION-BE-6 — HolidayService unit tests (repo/db mocked, no Postgres).
 *
 * Covers: working-day resolution (weekday/weekend/holiday), company-overrides-global, getHolidaysInRange
 * batch override, and CRUD deny paths (unique conflict → 409, not-found → 404).
 */

import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
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
    insertTx: vi.fn().mockResolvedValue([makeRow({ companyId: COMPANY_ID, holidayType: "CompanyHoliday" })]),
    updateOwnTx: vi.fn().mockResolvedValue([makeRow({ companyId: COMPANY_ID })]),
    softDeleteOwnTx: vi.fn().mockResolvedValue([makeRow({ companyId: COMPANY_ID })]),
    ...overrides,
  };
}

// withTenant(_c, fn) runs fn with the repo standing in for the tx (mirrors attendance.service.spec).
function makeService(repo: ReturnType<typeof makeRepo>) {
  const db = {
    withTenant: vi.fn().mockImplementation((_c: string, fn: (tx: unknown) => Promise<unknown>) => fn(repo)),
  };
  return new HolidaysService(db as never, repo as never);
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
        findInRange: vi.fn().mockResolvedValue([
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
        findInRange: vi.fn().mockResolvedValue([
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
    const svc = makeService(
      makeRepo({ insertTx: vi.fn().mockRejectedValue({ code: "23505" }) }),
    );
    await expect(
      svc.createHoliday(actor, { holidayCode: "TET", name: "Tết", holidayDate: MON }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("create → company-scoped row returned with scope 'company'", async () => {
    const svc = makeService(makeRepo());
    const out = await svc.createHoliday(actor, { holidayCode: "TET", name: "Tết", holidayDate: MON });
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
