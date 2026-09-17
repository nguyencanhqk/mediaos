import { ForbiddenException, Logger } from "@nestjs/common";
import { PAYSLIP_PDF_BATCH_MAX } from "@mediaos/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseService, TenantTx } from "../db/db.service";
import type { EventBus, EventContext } from "../events/event-bus";
import type { ServerFileRow } from "../foundation/files/server-file.repository";
import type { ServerFileService } from "../foundation/files/server-file.service";
import type { PayslipPdfRenderer } from "./payslip-pdf.renderer";
import type { PayrollAccessService } from "./payroll-access.service";
import {
  PAYSLIP_PDF_BATCH_CONSUMER,
  PayrollPayslipPdfBatchConsumer,
} from "./payroll-payslip-pdf-batch.consumer";
import {
  DEFAULT_PAYSLIP_PDF_BATCH_LIMITS,
  PayrollPayslipPdfBatchService,
} from "./payroll-payslip-pdf-batch.service";
import { PAYSLIP_PDF_BATCH_EVENT } from "./payroll-pdf.const";
import type { PayrollPayslipPdfRepository } from "./payroll-payslip-pdf.repository";
import type { PayrollPeopleRepository } from "./payroll-people.repository";
import type { PayslipRow } from "./payroll-payslips.repository";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const FILE_ID = "33333333-3333-4333-8333-333333333333";
const REQUESTER = "22222222-2222-4222-8222-222222222222";
const TX = {} as TenantTx;

const fileRow = (over: Partial<ServerFileRow> = {}): ServerFileRow => ({
  id: FILE_ID,
  originalName: "phieu-luong-2026-08.zip",
  mimeType: "application/zip",
  storagePath: `${COMPANY}/files/${FILE_ID}`,
  uploadStatus: "Pending",
  scanStatus: "NotRequired",
  uploadedBy: REQUESTER,
  metadata: {},
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 86_400_000),
  link: {
    linkId: "l1",
    moduleCode: "PAYROLL",
    entityType: "payslip-pdf-batch",
    entityId: "period-1",
  },
  ...over,
});

const payslip = (id: string): PayslipRow =>
  ({
    id,
    user_id: REQUESTER,
    period_month: "2026-08",
    base_salary: "1.00",
    total_allowances: "0",
    bonus_amount: "0",
    penalty_amount: "0",
    deduction_amount: "0",
    adjustment_amount: "0",
    gross: "1.00",
    net: "1.00",
    work_days: "1",
    present_days: "1",
    paid_leave_days: "0",
    unpaid_leave_days: "0",
  }) as unknown as PayslipRow;

function harness(opts: { file?: ServerFileRow | null; payslips?: PayslipRow[] } = {}) {
  const bus = { register: vi.fn() };
  const db = {
    withTenant: async <T>(_c: string, fn: (tx: TenantTx) => Promise<T>) => fn(TX),
  } as unknown as DatabaseService;
  const access = { resolveActor: vi.fn(async () => ({ routeScope: "Company" })) };
  const pdfRepo = {
    batchPayslipsTx: vi.fn(async () => opts.payslips ?? [payslip("p1")]),
    itemsByPayslipIdsTx: vi.fn(async () => []),
    companyNameTx: vi.fn(async () => "Cty"),
  };
  const people = {
    namesByUserIdsTx: vi.fn(
      async () =>
        new Map([[REQUESTER, { userId: REQUESTER, displayName: "A", employeeCode: "NV1" }]]),
    ),
  };
  const renderer = { render: vi.fn(async () => Buffer.from("%PDF-1.3")) };
  const files = {
    findByIdTx: vi.fn(async () => (opts.file === undefined ? fileRow() : opts.file)),
    store: vi.fn(async () => true),
    markFailedTx: vi.fn(async () => 1),
  };
  const consumer = new PayrollPayslipPdfBatchConsumer(
    bus as unknown as EventBus,
    db,
    access as unknown as PayrollAccessService,
    pdfRepo as unknown as PayrollPayslipPdfRepository,
    people as unknown as PayrollPeopleRepository,
    renderer as unknown as PayslipPdfRenderer,
    files as unknown as ServerFileService,
  );
  return { consumer, bus, access, files, renderer, people, pdfRepo };
}

const ctx = (payload: Record<string, unknown> = { fileId: FILE_ID }): EventContext => ({
  eventId: "ev1",
  companyId: COMPANY,
  eventType: PAYSLIP_PDF_BATCH_EVENT,
  payload,
});

describe("PayrollPayslipPdfBatchConsumer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("onModuleInit đăng ký đúng consumerName + eventType", () => {
    const h = harness();
    h.consumer.onModuleInit();
    expect(h.bus.register).toHaveBeenCalledWith(
      expect.objectContaining({
        consumerName: PAYSLIP_PDF_BATCH_CONSUMER,
        eventType: PAYSLIP_PDF_BATCH_EVENT,
      }),
    );
  });

  it.each([{}, { fileId: 42 }, { fileId: "not-a-uuid" }])(
    "payload %j không hợp lệ ⇒ warn + bỏ qua (không đọc DB)",
    async (payload) => {
      const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      const h = harness();
      await h.consumer.handle(ctx(payload));
      expect(h.files.findByIdTx).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );

  it("không thấy hàng / entity khác ⇒ warn, không sinh", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    for (const file of [
      null,
      fileRow({ link: { ...fileRow().link, entityType: "payslip-pdf" } }),
    ]) {
      const h = harness({ file });
      await h.consumer.handle(ctx());
      expect(h.renderer.render).not.toHaveBeenCalled();
      expect(h.files.markFailedTx).not.toHaveBeenCalled();
    }
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("hàng không còn Pending ⇒ im lặng bỏ qua (event giao lại — idempotent)", async () => {
    const h = harness({ file: fileRow({ uploadStatus: "Uploaded" }) });
    await h.consumer.handle(ctx());
    expect(h.access.resolveActor).not.toHaveBeenCalled();
    expect(h.files.store).not.toHaveBeenCalled();
  });

  it("dựng lại actor của NGƯỜI YÊU CẦU (từ hàng tệp) với CẢ HAI cặp của 085", async () => {
    const h = harness();
    await h.consumer.handle(ctx());
    expect(h.access.resolveActor.mock.calls).toEqual([
      [{ id: REQUESTER, companyId: COMPANY }, "payslipPdfBatch"],
      [{ id: REQUESTER, companyId: COMPANY }, "payslipList"],
    ]);
    expect(h.files.store).toHaveBeenCalledTimes(1);
  });

  it("mất cặp ⇒ Failed{forbidden}, không sinh", async () => {
    const h = harness();
    h.access.resolveActor.mockRejectedValueOnce(new ForbiddenException());
    await h.consumer.handle(ctx());
    expect(h.files.markFailedTx).toHaveBeenCalledWith(TX, COMPANY, FILE_ID, "forbidden");
    expect(h.renderer.render).not.toHaveBeenCalled();
  });

  it("tài khoản người yêu cầu đã xoá (vắng bảng tên) ⇒ Failed{forbidden}", async () => {
    const h = harness();
    h.people.namesByUserIdsTx.mockResolvedValueOnce(new Map());
    await h.consumer.handle(ctx());
    expect(h.files.markFailedTx).toHaveBeenCalledWith(TX, COMPANY, FILE_ID, "forbidden");
  });

  it("lỗi KHÁC 403 khi dựng actor ⇒ Failed{generation-failed} rồi NÉM (plan §8.2 #2)", async () => {
    const error = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const h = harness();
    h.access.resolveActor.mockRejectedValueOnce(new Error("db down"));
    await expect(h.consumer.handle(ctx())).rejects.toThrow("db down");
    expect(h.files.markFailedTx).toHaveBeenCalledWith(TX, COMPANY, FILE_ID, "generation-failed");
    expect(error).toHaveBeenCalledTimes(1);
    expect(h.renderer.render).not.toHaveBeenCalled();
  });

  it("đọc phiếu lỗi (batchPayslipsTx ném) ⇒ log error có fileId + Failed{generation-failed} + NÉM", async () => {
    const error = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const h = harness();
    h.pdfRepo.batchPayslipsTx.mockRejectedValueOnce(new TypeError("bad row"));
    await expect(h.consumer.handle(ctx())).rejects.toThrow("bad row");
    expect(h.files.markFailedTx).toHaveBeenCalledWith(TX, COMPANY, FILE_ID, "generation-failed");
    expect(String(error.mock.calls[0][0])).toContain(FILE_ID);
    expect(String(error.mock.calls[0][0])).toContain("TypeError");
    expect(h.files.store).not.toHaveBeenCalled();
  });

  it("đọc phiếu lỗi mà ghi Failed cũng lỗi ⇒ NÉM (hàng còn Pending — outbox chạy lại)", async () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const h = harness();
    h.pdfRepo.batchPayslipsTx.mockRejectedValueOnce(new Error("read"));
    h.files.markFailedTx.mockRejectedValueOnce(new Error("db down"));
    await expect(h.consumer.handle(ctx())).rejects.toThrow();
  });

  it("ghi Failed chạm 0 hàng (không còn Pending) ⇒ warn, không im lặng (plan §8.2 #6)", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const h = harness();
    h.access.resolveActor.mockRejectedValueOnce(new ForbiddenException());
    h.files.markFailedTx.mockResolvedValueOnce(0);
    await h.consumer.handle(ctx());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(FILE_ID);
  });

  it("render lỗi ⇒ Failed{generation-failed}, KHÔNG ném lại", async () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const h = harness();
    h.renderer.render.mockRejectedValueOnce(new Error("font"));
    await expect(h.consumer.handle(ctx())).resolves.toBeUndefined();
    expect(h.files.markFailedTx).toHaveBeenCalledWith(TX, COMPANY, FILE_ID, "generation-failed");
  });

  it("quá trần thời gian ⇒ Failed{timeout}", async () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const h = harness({ payslips: [payslip("p1"), payslip("p2")] });
    // Đồng hồ nhảy 10 phút NGAY SAU phiếu đầu ⇒ lượt kiểm trần ở phiếu thứ hai phải dừng.
    const realNow = Date.now();
    let jumped = false;
    vi.spyOn(Date, "now").mockImplementation(() => (jumped ? realNow + 10 * 60_000 : realNow));
    h.renderer.render.mockImplementation(async () => {
      jumped = true;
      return Buffer.from("%PDF-1.3");
    });
    await h.consumer.handle(ctx());
    expect(h.files.markFailedTx).toHaveBeenCalledWith(TX, COMPANY, FILE_ID, "timeout");
    expect(h.renderer.render).toHaveBeenCalledTimes(1);
    expect(h.files.store).not.toHaveBeenCalled();
  });

  it("ghi Failed mà lỗi ⇒ NÉM (không nuốt — outbox thử lại)", async () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const h = harness();
    h.files.store.mockRejectedValueOnce(new Error("s3 down"));
    h.files.markFailedTx.mockRejectedValueOnce(new Error("db down"));
    await expect(h.consumer.handle(ctx())).rejects.toThrow("db down");
  });

  it("store trả false (lượt khác đã chốt) ⇒ warn, không đánh Failed", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const h = harness();
    h.files.store.mockResolvedValueOnce(false);
    await h.consumer.handle(ctx());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(h.files.markFailedTx).not.toHaveBeenCalled();
  });
});

describe("PayrollPayslipPdfBatchService — trần trên HẰNG THẬT (SPEC-11 §19.1)", () => {
  const svc = new PayrollPayslipPdfBatchService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    DEFAULT_PAYSLIP_PDF_BATCH_LIMITS,
  );
  const assertSize = (n: number) =>
    (svc as unknown as { assertBatchSize(n: number): void }).assertBatchSize(n);

  it("trần mặc định = 2.000", () => {
    expect(DEFAULT_PAYSLIP_PDF_BATCH_LIMITS.maxPayslips).toBe(PAYSLIP_PDF_BATCH_MAX);
    expect(PAYSLIP_PDF_BATCH_MAX).toBe(2000);
  });

  it("2.000 phiếu qua; 2.001 ⇒ 422 031 pdf-batch-too-large", () => {
    expect(() => assertSize(2000)).not.toThrow();
    try {
      assertSize(2001);
      expect.unreachable();
    } catch (err) {
      const body = (
        err as {
          getResponse(): { code: string; details: Array<{ field: string; message: string }> };
        }
      ).getResponse();
      expect((err as { getStatus(): number }).getStatus()).toBe(422);
      expect(body.code).toBe("PAYROLL-ERR-031");
      expect(body.details[0]).toEqual(
        expect.objectContaining({ field: "kind", message: "pdf-batch-too-large" }),
      );
    }
  });

  it("0 phiếu ⇒ 409 007 no-payslip-for-pdf", () => {
    try {
      assertSize(0);
      expect.unreachable();
    } catch (err) {
      const body = (
        err as {
          getResponse(): { code: string; details: Array<{ field: string; message: string }> };
        }
      ).getResponse();
      expect((err as { getStatus(): number }).getStatus()).toBe(409);
      expect(body.code).toBe("PAYROLL-ERR-007");
      expect(body.details[0]).toEqual(
        expect.objectContaining({ field: "kind", message: "no-payslip-for-pdf" }),
      );
    }
  });
});
