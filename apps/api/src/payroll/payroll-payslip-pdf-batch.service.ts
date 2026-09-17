import { Inject, Injectable } from "@nestjs/common";
import {
  PAYSLIP_PDF_BATCH_FILE_TTL_SEC,
  PAYSLIP_PDF_BATCH_MAX,
  type PayslipPdfBatchDto,
  type PayslipPdfBatchRequest,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { ServerFileService } from "../foundation/files/server-file.service";
import type { ServerFileRow } from "../foundation/files/server-file.repository";
import { decideBatch, toBatchFailure } from "./payroll-payslip-pdf-batch.decision";
import { PayrollAccessService } from "./payroll-access.service";
import { payslipPdfFileName } from "./payroll-payslip-pdf.document-input";
import { PayrollPayslipPdfRepository } from "./payroll-payslip-pdf.repository";
import {
  PAYROLL_FILE_MODULE,
  PAYSLIP_PDF_BATCH_ENTITY,
  PAYSLIP_PDF_BATCH_EVENT,
} from "./payroll-pdf.const";
import {
  PAYROLL_ERR,
  payrollConflict,
  payrollDetails,
  payrollNotFound,
  payrollUnprocessable,
} from "./payroll.errors";
import type { PayrollRequestUser } from "./payroll.types";

/** Trần tiêm qua provider — int dùng trần nhỏ, unit giữ biên trên hằng thật (plan §0b). */
export const PAYSLIP_PDF_BATCH_LIMITS = Symbol("PAYSLIP_PDF_BATCH_LIMITS");
export interface PayslipPdfBatchLimits {
  maxPayslips: number;
}
export const DEFAULT_PAYSLIP_PDF_BATCH_LIMITS: PayslipPdfBatchLimits = {
  maxPayslips: PAYSLIP_PDF_BATCH_MAX,
};

export interface PayslipPdfBatchResult {
  httpStatus: 200 | 202;
  dto: PayslipPdfBatchDto;
}

/**
 * S15-PAYROLL-BE-5B — `PAYROLL-API-085` PDF hàng loạt, **lấy-hoặc-tạo** (owner O-4) chạy nền qua outbox (O-5).
 *
 * Thứ tự trong MỘT tx: cặp (`payslipPdfBatch` decorator + `payslipList`) → kỳ (404 010) → đếm + vân tay (trần
 * 031 / rỗng 007 — TRƯỚC mọi ghi) → advisory lock (người, kỳ) → lô sống gần nhất → quyết định. Tạo lô = hàng
 * tệp Pending + link + audit + event outbox trong CÙNG tx (rollback ⇒ không còn gì).
 *
 * KHÔNG `@Idempotent()` (owner O-8): interceptor chốt mã trước handler và cache body có signed-URL. Bấm hai lần
 * đã trả CÙNG một lô nhờ lock + quyết định trên.
 */
@Injectable()
export class PayrollPayslipPdfBatchService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly pdfRepo: PayrollPayslipPdfRepository,
    private readonly files: ServerFileService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(PAYSLIP_PDF_BATCH_LIMITS) private readonly limits: PayslipPdfBatchLimits,
  ) {}

  async request(
    user: PayrollRequestUser,
    periodId: string,
    body: PayslipPdfBatchRequest,
  ): Promise<PayslipPdfBatchResult> {
    const actor = await this.access.resolveActor(user, "payslipPdfBatch");
    await this.access.resolveActor(user, "payslipList");
    const { companyId } = user;

    return this.db.withTenant(companyId, async (tx) => {
      const period = await this.pdfRepo.periodTx(tx, companyId, periodId);
      if (!period) throw payrollNotFound();
      const set = await this.pdfRepo.payslipSetFingerprintTx(tx, actor, periodId);
      this.assertBatchSize(set.count);

      await this.pdfRepo.lockBatchTx(tx, companyId, periodId, user.id);
      const target = {
        moduleCode: PAYROLL_FILE_MODULE,
        entityType: PAYSLIP_PDF_BATCH_ENTITY,
        entityId: periodId,
      };
      const live = await this.files.findLatestLiveTx(tx, companyId, target, user.id);
      const decision = decideBatch(live, set.fingerprint, body.retry === true, new Date());

      if (live && decision.kind === "uploaded") {
        const url = await this.files.issueUrlTx(tx, companyId, user.id, live);
        return {
          httpStatus: 200,
          dto: {
            ...toDto(live, periodId),
            url: url.url,
            expiresAt: url.expiresAt.toISOString(),
          },
        };
      }
      if (live && decision.kind === "pending") {
        return { httpStatus: 202, dto: toDto(live, periodId) };
      }
      if (live && decision.kind === "failed") {
        return {
          httpStatus: 200,
          dto: { ...toDto(live, periodId), status: "Failed", failure: decision.failure },
        };
      }
      return this.create(tx, user, periodId, period.period_month, target, set);
    });
  }

  private assertBatchSize(count: number): void {
    const max = this.limits.maxPayslips;
    if (count > max) {
      throw payrollUnprocessable(
        "REPORT_TOO_LARGE",
        PAYROLL_ERR.PDF_BATCH_TOO_LARGE(count, max),
        payrollDetails("pdf-batch-too-large", { total: count, max }),
      );
    }
    if (count === 0) {
      throw payrollConflict(
        "NO_PAYSLIP",
        PAYROLL_ERR.NO_PAYSLIP_FOR_PDF,
        payrollDetails("no-payslip-for-pdf"),
      );
    }
  }

  private async create(
    tx: TenantTx,
    user: PayrollRequestUser,
    periodId: string,
    periodMonth: string,
    target: { moduleCode: string; entityType: string; entityId: string },
    set: { count: number; fingerprint: string },
  ): Promise<PayslipPdfBatchResult> {
    const fileName = payslipPdfFileName(periodMonth, "zip");
    const reserved = await this.files.reserveTx(tx, {
      companyId: user.companyId,
      actorUserId: user.id,
      originalName: fileName,
      kind: "zip",
      ttlSec: PAYSLIP_PDF_BATCH_FILE_TTL_SEC,
      link: target,
      metadata: { fingerprint: set.fingerprint, payslipCount: set.count },
    });
    await this.audit.record(tx, {
      action: "export",
      objectType: "payroll_period",
      objectId: periodId,
      actorUserId: user.id,
      before: null,
      after: { payslipCount: set.count, format: "zip" },
    });
    // Payload CHỈ id — consumer đọc lại mọi thứ từ hàng tệp + link (không tin payload).
    await this.outbox.enqueue(tx, {
      eventType: PAYSLIP_PDF_BATCH_EVENT,
      payload: { fileId: reserved.fileId },
    });
    return {
      httpStatus: 202,
      dto: {
        fileId: reserved.fileId,
        periodId,
        status: "Pending",
        payslipCount: set.count,
        fileName,
        createdAt: reserved.createdAt.toISOString(),
        fileExpiresAt: reserved.expiresAt.toISOString(),
      },
    };
  }
}

function toDto(file: ServerFileRow, periodId: string): PayslipPdfBatchDto {
  const count = file.metadata.payslipCount;
  const base: PayslipPdfBatchDto = {
    fileId: file.id,
    periodId,
    status:
      file.uploadStatus === "Uploaded"
        ? "Uploaded"
        : file.uploadStatus === "Failed"
          ? "Failed"
          : "Pending",
    payslipCount: typeof count === "number" ? count : 0,
    fileName: file.originalName,
    createdAt: file.createdAt.toISOString(),
    fileExpiresAt: file.expiresAt.toISOString(),
  };
  return base.status === "Failed"
    ? { ...base, failure: toBatchFailure(file.metadata.failure) }
    : base;
}
