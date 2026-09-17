import { ForbiddenException, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { PAYSLIP_PDF_BATCH_RUNTIME_CAP_MS, type PayslipPdfBatchFailure } from "@mediaos/contracts";
import JSZip from "jszip";
import { DatabaseService } from "../db/db.service";
import { EventBus, type EventContext } from "../events/event-bus";
import { ServerFileService } from "../foundation/files/server-file.service";
import type { ServerFileRow } from "../foundation/files/server-file.repository";
import { buildPayslipPdfDocument, type PayslipPdfInput } from "./payslip-pdf.document";
import { PayslipPdfRenderer } from "./payslip-pdf.renderer";
import { PayrollAccessService } from "./payroll-access.service";
import { payslipZipEntryName, toPayslipPdfInput } from "./payroll-payslip-pdf.document-input";
import { PayrollPayslipPdfRepository } from "./payroll-payslip-pdf.repository";
import {
  PAYROLL_FILE_MODULE,
  PAYSLIP_PDF_BATCH_ENTITY,
  PAYSLIP_PDF_BATCH_EVENT,
} from "./payroll-pdf.const";
import { PayrollPeopleRepository } from "./payroll-people.repository";
import type { PayslipItemRow } from "./payroll-payslips.repository";

export const PAYSLIP_PDF_BATCH_CONSUMER = "payroll-payslip-pdf-batch";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ZipEntry {
  name: string;
  input: PayslipPdfInput;
}

type Loaded =
  | { kind: "skip"; reason: "missing" | "not-pending" }
  | { kind: "failed"; failure: PayslipPdfBatchFailure }
  | { kind: "ready"; file: ServerFileRow; entries: ZipEntry[] };

class BatchTimeoutError extends Error {
  constructor() {
    super("payslip-pdf-batch: quá trần thời gian chạy");
    this.name = "BatchTimeoutError";
  }
}

/**
 * S15-PAYROLL-BE-5B — consumer outbox của 085 (owner O-5).
 *
 * - Payload chỉ để tìm `fileId`; kỳ + người yêu cầu đọc từ HÀNG tệp + link (không tin payload).
 * - Hàng không còn `Pending` ⇒ bỏ qua (idempotent — event có thể được giao lại). Không thấy hàng ⇒ `warn`.
 * - Dựng lại actor của người yêu cầu bằng CHÍNH `PayrollAccessService` (cả hai cặp của 085); mất cặp hoặc tài
 *   khoản đã xoá ⇒ `Failed{forbidden}`.
 * - Đọc trong MỘT tx ngắn, sinh PDF NGOÀI tx, nhả event loop sau mỗi phiếu, trần thời gian < reaper outbox.
 * - Lỗi sinh/ghi ⇒ `Failed` và KHÔNG ném lại (không retry mù). Ghi `Failed` mà lỗi ⇒ NÉM để outbox thử lại.
 * - Lỗi lúc ĐỌC (khác 403) ⇒ `Failed{generation-failed}` rồi NÉM (outbox ghi nhận lỗi; lượt giao lại thấy hàng
 *   không còn Pending nên bỏ qua) — plan §8.2 #2.
 */
@Injectable()
export class PayrollPayslipPdfBatchConsumer implements OnModuleInit {
  private readonly logger = new Logger(PayrollPayslipPdfBatchConsumer.name);

  constructor(
    private readonly bus: EventBus,
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly pdfRepo: PayrollPayslipPdfRepository,
    private readonly people: PayrollPeopleRepository,
    private readonly renderer: PayslipPdfRenderer,
    private readonly files: ServerFileService,
  ) {}

  onModuleInit(): void {
    this.bus.register({
      consumerName: PAYSLIP_PDF_BATCH_CONSUMER,
      eventType: PAYSLIP_PDF_BATCH_EVENT,
      handle: (ctx) => this.handle(ctx),
    });
  }

  async handle(ctx: EventContext): Promise<void> {
    const fileId = ctx.payload.fileId;
    if (typeof fileId !== "string" || !UUID_RE.test(fileId)) {
      this.logger.warn(`event ${ctx.eventId}: payload thiếu fileId hợp lệ — bỏ qua`);
      return;
    }
    const loaded = await this.loadOrFail(ctx.companyId, fileId);
    if (loaded.kind === "skip") {
      if (loaded.reason === "missing") {
        this.logger.warn(`event ${ctx.eventId}: không thấy lô PDF ${fileId} của tenant — bỏ qua`);
      }
      return;
    }
    if (loaded.kind === "failed") {
      await this.markFailed(ctx.companyId, fileId, loaded.failure);
      return;
    }
    try {
      const zip = await this.buildZip(
        loaded.entries,
        Date.now() + PAYSLIP_PDF_BATCH_RUNTIME_CAP_MS,
      );
      const stored = await this.files.store(
        ctx.companyId,
        { fileId, storageKey: loaded.file.storagePath },
        "zip",
        zip,
      );
      if (!stored)
        this.logger.warn(`lô PDF ${fileId} không còn Pending khi chốt — lượt khác đã xử lý`);
    } catch (err) {
      const failure: PayslipPdfBatchFailure =
        err instanceof BatchTimeoutError ? "timeout" : "generation-failed";
      this.logger.error(`lô PDF ${fileId} hỏng (${errorName(err)}) — đánh dấu Failed{${failure}}`);
      await this.markFailed(ctx.companyId, fileId, failure);
    }
  }

  private async loadOrFail(companyId: string, fileId: string): Promise<Loaded> {
    try {
      return await this.load(companyId, fileId);
    } catch (err) {
      this.logger.error(
        `lô PDF ${fileId} đọc dữ liệu lỗi (${errorName(err)}) — đánh dấu Failed{generation-failed} rồi ném lại`,
      );
      // Ghi Failed mà lỗi ⇒ lỗi đó nổi lên (hàng còn Pending — outbox chạy lại cả lượt).
      await this.markFailed(companyId, fileId, "generation-failed");
      throw err;
    }
  }

  private load(companyId: string, fileId: string): Promise<Loaded> {
    return this.db.withTenant(companyId, async (tx): Promise<Loaded> => {
      const file = await this.files.findByIdTx(tx, companyId, fileId, PAYROLL_FILE_MODULE);
      if (!file || file.link.entityType !== PAYSLIP_PDF_BATCH_ENTITY) {
        return { kind: "skip", reason: "missing" };
      }
      if (file.uploadStatus !== "Pending") return { kind: "skip", reason: "not-pending" };

      const requester = { id: file.uploadedBy, companyId };
      let actor;
      try {
        actor = await this.access.resolveActor(requester, "payslipPdfBatch");
        await this.access.resolveActor(requester, "payslipList");
      } catch (err) {
        if (err instanceof ForbiddenException) return { kind: "failed", failure: "forbidden" };
        throw err;
      }
      // Tài khoản đã xoá mềm vắng khỏi bảng tên ⇒ coi như mất quyền.
      const self = await this.people.namesByUserIdsTx(tx, actor, [requester.id]);
      if (!self.has(requester.id)) return { kind: "failed", failure: "forbidden" };

      const periodId = file.link.entityId;
      const payslips = await this.pdfRepo.batchPayslipsTx(tx, actor, periodId);
      const items = await this.pdfRepo.itemsByPayslipIdsTx(
        tx,
        companyId,
        payslips.map((p) => p.id),
      );
      const names = await this.people.namesByUserIdsTx(
        tx,
        actor,
        payslips.map((p) => p.user_id),
      );
      const companyName = await this.pdfRepo.companyNameTx(tx, companyId);

      const itemsByPayslip = groupItems(items);
      const seen = new Set<string>();
      const entries = payslips.map((row) => {
        const person = names.get(row.user_id);
        return {
          name: payslipZipEntryName(row.period_month, row.user_id, person, seen),
          input: toPayslipPdfInput(companyName, row, itemsByPayslip.get(row.id) ?? [], person),
        };
      });
      return { kind: "ready", file, entries };
    });
  }

  private async buildZip(entries: readonly ZipEntry[], deadline: number): Promise<Uint8Array> {
    const zip = new JSZip();
    for (const entry of entries) {
      if (Date.now() > deadline) throw new BatchTimeoutError();
      const bytes = await this.renderer.render(buildPayslipPdfDocument(entry.input));
      zip.file(entry.name, bytes, { binary: true });
      // Nhả event loop sau mỗi phiếu — HTTP không bị chặn trong lúc sinh lô (SPEC-11 §19.1).
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    // PDF đã nén sẵn ⇒ STORE (không nén lại).
    return zip.generateAsync({ type: "uint8array", compression: "STORE" });
  }

  private async markFailed(
    companyId: string,
    fileId: string,
    failure: PayslipPdfBatchFailure,
  ): Promise<void> {
    // Lỗi ở đây NÉM ra ⇒ outbox thử lại event (hàng còn Pending) — không nuốt.
    const updated = await this.db.withTenant(companyId, (tx) =>
      this.files.markFailedTx(tx, companyId, fileId, failure),
    );
    if (updated === 0) {
      this.logger.warn(
        `lô PDF ${fileId} không còn Pending khi ghi Failed{${failure}} — lượt khác đã chốt/xoá, bỏ qua`,
      );
    }
  }
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function groupItems(items: readonly PayslipItemRow[]): Map<string, PayslipItemRow[]> {
  const out = new Map<string, PayslipItemRow[]>();
  for (const item of items) {
    const list = out.get(item.payslip_id) ?? [];
    list.push(item);
    out.set(item.payslip_id, list);
  }
  return out;
}
