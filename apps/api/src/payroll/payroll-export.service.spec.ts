import { ForbiddenException, UnprocessableEntityException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { PayrollExportService, PAYROLL_EXPORT_MAX_ROWS } from "./payroll-export.service";
import type { PayrollActor, PayrollRequestUser } from "./payroll.types";

/**
 * S13-PAYROLL-BE-2 — `PAYROLL-API-017` export: hai nhánh CỔNG mà int-spec khó/đắt chạm tới.
 *
 *  1. **HAI cặp quyền** (SPEC-11 §18 · API-18 §5.1). Đo bằng THỨ TỰ và NỘI DUNG lời gọi
 *     `resolveActor`, không bằng "có 403 hay không": route đã 403 sẵn nếu thiếu `export:payroll` ở
 *     decorator, nên một ca HTTP đơn thuần KHÔNG phân biệt được "đã assert `view-line`" với "quên
 *     assert `view-line`" — đúng lớp bẫy `deny-cases-vacuous-without-allow-case`.
 *  2. **Trần 10.000 dòng ⇒ 422 `016`**. Gieo 10.001 dòng thật vào DB cho mỗi lượt chạy CI là chi phí
 *     không tương xứng; ở đây stub repository trả đúng số lượng biên (10.000 / 10.001).
 *
 * Cả hai đều chạy trên CODE THẬT của service — chỉ phụ thuộc ngoài (DB/repo/audit) là stub.
 */

const USER: PayrollRequestUser = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
};

const actorFor = (routeKey: PayrollActor["routeKey"]): PayrollActor => ({
  actorUserId: USER.id,
  companyId: USER.companyId,
  routeKey,
  routeScope: "Company",
  peopleVisibleCond: sql`true`,
  canSeeMoney: true,
});

/** `withTenant` chạy thẳng callback với một tx giả — service không đụng tx trực tiếp. */
const dbStub = { withTenant: (_c: string, fn: (tx: unknown) => unknown) => fn({}) };

const lineStub = (i: number) => ({
  id: `line-${i}`,
  user_id: `user-${i}`,
  work_days: "22.00",
  present_days: "22.00",
  paid_leave_days: "0.00",
  unpaid_leave_days: "0.00",
  late_minutes: 0,
  base_amount: "1000.00",
  allowance_amount: "0.00",
  bonus_amount: "0.00",
  penalty_amount: "0.00",
  deduction_amount: "0.00",
  adjustment_amount: "0.00",
  adjustment_reason: null as string | null,
  gross: "1000.00",
  net: "1000.00",
});

function build(rowCount: number) {
  const resolveActor = vi.fn(async (_u: PayrollRequestUser, key: PayrollActor["routeKey"]) =>
    actorFor(key),
  );
  const audit = { record: vi.fn(async (_tx: unknown, _entry: unknown) => undefined) };
  const periods = { findTx: vi.fn(async () => ({ id: "p1", periodMonth: "2028-06" })) };
  const calc = {
    allLinesForExportTx: vi.fn(async () => Array.from({ length: rowCount }, (_, i) => lineStub(i))),
  };
  const people = {
    namesByUserIdsTx: vi.fn(
      async (_tx: unknown, _a: PayrollActor, ids: readonly string[]) =>
        new Map(ids.map((id) => [id, { userId: id, displayName: `NV ${id}`, employeeCode: id }])),
    ),
  };
  const svc = new PayrollExportService(
    dbStub as never,
    { resolveActor } as never,
    periods as never,
    calc as never,
    people as never,
    audit as never,
  );
  return { svc, resolveActor, audit, calc };
}

describe("S13-PAYROLL-BE-2 · export 017 — hai cặp quyền", () => {
  it("assert ĐỦ HAI cặp: `view-line:payroll-period` TRƯỚC, rồi `export:payroll`", async () => {
    const { svc, resolveActor } = build(2);
    await svc.export(USER, "p1", {});
    expect(resolveActor).toHaveBeenCalledTimes(2);
    expect(resolveActor.mock.calls.map((c) => c[1])).toEqual(["periodLines", "periodExport"]);
  });

  it("thiếu `view-line` ⇒ 403 và **KHÔNG chạm DB** (deny để lại ZERO side-effect)", async () => {
    const { svc, resolveActor, calc, audit } = build(2);
    resolveActor.mockImplementationOnce(async () => {
      throw new ForbiddenException("AUTH-ERR-FORBIDDEN");
    });
    await expect(svc.export(USER, "p1", {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(calc.allLinesForExportTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("thiếu `export:payroll` (vế THỨ HAI) ⇒ 403, vẫn không chạm DB", async () => {
    const { svc, resolveActor, calc } = build(2);
    resolveActor
      .mockImplementationOnce(async () => actorFor("periodLines"))
      .mockImplementationOnce(async () => {
        throw new ForbiddenException("AUTH-ERR-FORBIDDEN");
      });
    await expect(svc.export(USER, "p1", {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(calc.allLinesForExportTx).not.toHaveBeenCalled();
  });
});

describe("S13-PAYROLL-BE-2 · export 017 — trần dòng (biên 10.000 / 10.001)", () => {
  it(`ĐÚNG trần ${PAYROLL_EXPORT_MAX_ROWS} dòng ⇒ vẫn xuất được (ALLOW đối chứng)`, async () => {
    const { svc } = build(PAYROLL_EXPORT_MAX_ROWS);
    const out = await svc.export(USER, "p1", {});
    expect(out.filename).toBe("bang-luong-2028-06.xlsx");
    expect(out.buffer.byteLength).toBeGreaterThan(0);
  }, 60_000);

  it("VƯỢT trần một dòng ⇒ 422 PAYROLL-ERR-016 `export-limit`, KHÔNG cắt bớt im lặng", async () => {
    // Cắt bớt rồi trả file "đủ" là báo cáo lương THIẾU NGƯỜI mà không ai biết.
    const { svc, audit } = build(PAYROLL_EXPORT_MAX_ROWS + 1);
    const err = await svc.export(USER, "p1", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    const body = (err as UnprocessableEntityException).getResponse() as {
      code: string;
      details: Array<Record<string, string>>;
    };
    expect(body.code).toBe("PAYROLL-ERR-016");
    expect(body.details.find((d) => d["field"] === "kind")?.["message"]).toBe("export-limit");
    // Vượt trần ⇒ KHÔNG ghi audit "đã xuất": không có lượt xuất nào xảy ra.
    expect(audit.record).not.toHaveBeenCalled();
  }, 60_000);
});

describe("S13-PAYROLL-BE-2 · export 017 — audit + lọc `q`", () => {
  it("ghi ĐÚNG MỘT hàng audit, payload KHÔNG có số tiền", async () => {
    const { svc, audit } = build(3);
    await svc.export(USER, "p1", {});
    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0][1] as { after: Record<string, unknown> };
    expect(entry.after).toEqual({ periodMonth: "2028-06", q: null, rows: 3 });
    expect(JSON.stringify(entry.after)).not.toMatch(/gross|net|amount|salary/i);
  });

  it("`q` lọc SAU khi đã chiếu danh tính — route này không phân trang nên lọc-sau an toàn", async () => {
    const { svc, audit } = build(5);
    await svc.export(USER, "p1", { q: "user-3" });
    const entry = audit.record.mock.calls[0][1] as { after: { rows: number; q: string | null } };
    expect(entry.after.rows).toBe(1);
    expect(entry.after.q).toBe("user-3");
  });
});

/**
 * S15-PAYROLL-QA-1 (P1) — 017 chống formula-injection như 071/082: ba ô VĂN BẢN do người dùng nhập (mã NV · họ tên ·
 * lý do điều chỉnh) đi qua `xlsxSafe`. Trước vá, 017 ghi thô ⇒ `=HYPERLINK(...)` thành công thức sống khi mở tệp.
 * Đọc lại tệp THẬT bằng exceljs — assert trên chuỗi đầu vào của `addRow` không chứng minh được thứ người dùng mở ra.
 */
describe("S15-PAYROLL-QA-1 · export 017 — ô văn bản chống formula-injection", () => {
  const TEXT_COLUMNS = { code: 1, name: 2, reason: 14 } as const;

  async function exportWith(
    person: { displayName: string; employeeCode: string },
    reason: string | null,
  ): Promise<string[]> {
    const { svc, calc } = build(1);
    calc.allLinesForExportTx.mockImplementationOnce(async () => [
      { ...lineStub(0), adjustment_reason: reason },
    ]);
    const people = (svc as unknown as { people: { namesByUserIdsTx: ReturnType<typeof vi.fn> } })
      .people;
    people.namesByUserIdsTx.mockImplementationOnce(
      async () => new Map([["user-0", { userId: "user-0", ...person }]]),
    );
    const out = await svc.export(USER, "p1", {});
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.buffer as unknown as ArrayBuffer);
    const row = wb.worksheets[0].getRow(2);
    expect(wb.worksheets[0].getRow(1).getCell(TEXT_COLUMNS.reason).value).toBe("Lý do điều chỉnh");
    return [TEXT_COLUMNS.code, TEXT_COLUMNS.name, TEXT_COLUMNS.reason].map((c) => {
      const v = row.getCell(c).value;
      expect(typeof v === "string" || v === null, `ô ${c} phải là chữ, không phải công thức`).toBe(
        true,
      );
      return String(v ?? "");
    });
  }

  it("ALLOW đối chứng: chữ thường đi nguyên vẹn (không tiền tố thừa)", async () => {
    expect(
      await exportWith({ displayName: "Nguyễn Văn A", employeeCode: "NV001" }, "Truy thu"),
    ).toEqual(["NV001", "Nguyễn Văn A", "Truy thu"]);
  });

  it.each([
    ['=HYPERLINK("http://x","bấm")', "=", "@SUM(A1)"],
    ["+1+1", "-2+3", "\tcmd"],
    ["@cmd", "\r=1", "=1+1"],
  ])(
    "họ tên %j · mã %j · lý do %j ⇒ cả ba ô bắt đầu bằng dấu nháy đơn",
    async (name, code, reason) => {
      const cells = await exportWith({ displayName: name, employeeCode: code }, reason);
      // exceljs đọc lại CR thành LF (chuẩn hoá XML) — so trên cùng dạng; tiền tố `'` là thứ đang được đo.
      const lf = (v: string) => v.replace(/\r/g, "\n");
      expect(cells).toEqual([`'${code}`, `'${name}`, `'${reason}`].map(lf));
    },
  );
});
