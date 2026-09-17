import { Injectable } from "@nestjs/common";
import { PAYSLIP_PDF_FILE_TTL_SEC, type PayslipPdfDto } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import {
  ServerFileService,
  type IssuedServerFileUrl,
  type ReservedServerFile,
} from "../foundation/files/server-file.service";
import type { ServerFileRow } from "../foundation/files/server-file.repository";
import { buildPayslipPdfDocument, type PayslipPdfInput } from "./payslip-pdf.document";
import { PayslipPdfRenderer } from "./payslip-pdf.renderer";
import { PayrollAccessService } from "./payroll-access.service";
import { PayrollPeopleRepository } from "./payroll-people.repository";
import { payslipPdfFileName, toPayslipPdfInput } from "./payroll-payslip-pdf.document-input";
import { PayrollPayslipPdfRepository } from "./payroll-payslip-pdf.repository";
import { PayrollPayslipsRepository } from "./payroll-payslips.repository";
import { payrollNotFound } from "./payroll.errors";
import type { PayrollActor, PayrollRequestUser } from "./payroll.types";

/** Module + entity của link sở hữu tệp PDF một phiếu (resolver PAYROLL chặn route file chung). */
export const PAYROLL_FILE_MODULE = "PAYROLL";
export const PAYSLIP_PDF_ENTITY = "payslip-pdf";

type Phase1 =
  | { kind: "ready"; file: ServerFileRow; url: IssuedServerFileUrl }
  | { kind: "render"; reserved: ReservedServerFile; fileName: string; input: PayslipPdfInput };

/**
 * S15-PAYROLL-BE-5B — `PAYROLL-API-083` (phiếu người khác) · `PAYROLL-API-084` (phiếu của mình).
 *
 * - Dữ liệu = CHÍNH `findTx` + `itemsByPayslipIdTx` của 030/032 (084 truyền `ownerUserId` ⇒ bộ lọc kỳ
 *   `PUBLISHED_PERIOD_STATUSES` nằm trong `selectPayslips` — không danh sách thứ hai). Không thấy ⇒ 404 010.
 * - 083 assert CẢ `payslipPdf` (decorator) lẫn `periodExport`; audit `export` trong tx đọc. 084: 0 audit.
 * - Tệp sống của (người gọi, phiếu) còn hạn ⇒ ký URL lại, KHÔNG sinh PDF mới mỗi lượt GET (plan §0b).
 * - Pha: tx đọc + audit + giữ chỗ tệp → render + PUT NGOÀI tx → tx ngắn ký URL.
 */
@Injectable()
export class PayrollPayslipPdfService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly payslips: PayrollPayslipsRepository,
    private readonly pdfRepo: PayrollPayslipPdfRepository,
    private readonly people: PayrollPeopleRepository,
    private readonly renderer: PayslipPdfRenderer,
    private readonly files: ServerFileService,
    private readonly audit: AuditService,
  ) {}

  /** 083 — PDF phiếu người khác. */
  async adminPdf(user: PayrollRequestUser, payslipId: string): Promise<PayslipPdfDto> {
    const actor = await this.access.resolveActor(user, "payslipPdf");
    await this.access.resolveActor(user, "periodExport");
    return this.deliver(user, actor, payslipId, { ownerUserId: null, audited: true });
  }

  /** 084 — PDF phiếu của chính mình (Own; kỳ đã phát hành). */
  async myPdf(user: PayrollRequestUser, payslipId: string): Promise<PayslipPdfDto> {
    const actor = await this.access.resolveActor(user, "mePayslipPdf");
    return this.deliver(user, actor, payslipId, { ownerUserId: user.id, audited: false });
  }

  private async deliver(
    user: PayrollRequestUser,
    actor: PayrollActor,
    payslipId: string,
    opts: { ownerUserId: string | null; audited: boolean },
  ): Promise<PayslipPdfDto> {
    const { companyId } = user;
    const target = {
      moduleCode: PAYROLL_FILE_MODULE,
      entityType: PAYSLIP_PDF_ENTITY,
      entityId: payslipId,
    };

    const phase1 = await this.db.withTenant(companyId, async (tx): Promise<Phase1> => {
      const row = await this.payslips.findTx(tx, companyId, payslipId, opts.ownerUserId);
      if (!row) throw payrollNotFound();
      if (opts.audited) {
        await this.audit.record(tx, {
          action: "export",
          objectType: "payslip",
          objectId: payslipId,
          actorUserId: user.id,
          before: null,
          after: { format: "pdf", subjectUserId: row.user_id },
        });
      }
      const live = await this.files.findLatestLiveTx(tx, companyId, target, user.id);
      if (live?.uploadStatus === "Uploaded") {
        return {
          kind: "ready",
          file: live,
          url: await this.files.issueUrlTx(tx, companyId, user.id, live),
        };
      }
      const [items, names, companyName] = [
        await this.payslips.itemsByPayslipIdTx(tx, companyId, payslipId),
        await this.people.namesByUserIdsTx(tx, actor, [row.user_id]),
        await this.pdfRepo.companyNameTx(tx, companyId),
      ];
      const fileName = payslipPdfFileName(row.period_month, "pdf");
      const reserved = await this.files.reserveTx(tx, {
        companyId,
        actorUserId: user.id,
        originalName: fileName,
        kind: "pdf",
        ttlSec: PAYSLIP_PDF_FILE_TTL_SEC,
        link: target,
      });
      const input = toPayslipPdfInput(companyName, row, items, names.get(row.user_id));
      return { kind: "render", reserved, fileName, input };
    });

    if (phase1.kind === "ready") return toDto(phase1.file.id, phase1.file.originalName, phase1.url);

    const bytes = await this.renderer.render(buildPayslipPdfDocument(phase1.input));
    const stored = await this.files.store(companyId, phase1.reserved, "pdf", bytes);
    if (!stored) {
      // Hàng vừa giữ chỗ chỉ có request này ghi — mất trạng thái Pending là bất thường, không trả URL mù.
      throw new Error(`payslip-pdf: tệp ${phase1.reserved.fileId} không còn Pending sau khi ghi`);
    }

    return this.db.withTenant(companyId, async (tx) => {
      const file = await this.files.findByIdTx(
        tx,
        companyId,
        phase1.reserved.fileId,
        PAYROLL_FILE_MODULE,
      );
      if (!file) throw new Error(`payslip-pdf: không đọc lại được tệp ${phase1.reserved.fileId}`);
      const url = await this.files.issueUrlTx(tx, companyId, user.id, file);
      return toDto(file.id, phase1.fileName, url);
    });
  }
}

function toDto(fileId: string, fileName: string, url: IssuedServerFileUrl): PayslipPdfDto {
  return { fileId, fileName, url: url.url, expiresAt: url.expiresAt.toISOString() };
}
