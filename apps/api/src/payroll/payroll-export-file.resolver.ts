import { Injectable } from "@nestjs/common";
import type { FilePermissionInput } from "../foundation/files/file-policy.types";
import type { FileOwnerPermissionResolver } from "../foundation/files/resolvers/file-owner-permission-resolver";
import {
  PAYROLL_FILE_MODULE,
  PAYSLIP_PDF_BATCH_ENTITY,
  PAYSLIP_PDF_ENTITY,
} from "./payroll-pdf.const";

/**
 * S15-PAYROLL-BE-5B — resolver file-policy cho tệp PDF/ZIP phiếu lương (plan E-5 · §0b).
 *
 * TỪ CHỐI MỌI THAO TÁC trên route file chung (`/foundation/files/*`): tệp PAYROLL chỉ giao qua 083/084/085, nơi
 * đã assert cặp PAYROLL + sàn scope + audit. Không có resolver thì tệp đã link vẫn bị `deny-no-resolver`, nhưng
 * đăng ký tường minh để (a) ý đồ nằm trong code, (b) ca test ghim được, (c) `canUnlinkFile` cũng bị chặn —
 * company-admin gỡ link PAYROLL thì tệp rơi về quyền FOUNDATION chung.
 */
@Injectable()
export class PayrollExportFileResolver implements FileOwnerPermissionResolver {
  readonly moduleCode = PAYROLL_FILE_MODULE;
  readonly entityTypes = [PAYSLIP_PDF_ENTITY, PAYSLIP_PDF_BATCH_ENTITY] as const;

  canViewFile(_input: FilePermissionInput): Promise<boolean> {
    return Promise.resolve(false);
  }

  canDownloadFile(_input: FilePermissionInput): Promise<boolean> {
    return Promise.resolve(false);
  }

  canLinkFile(_input: FilePermissionInput): Promise<boolean> {
    return Promise.resolve(false);
  }

  canUnlinkFile(_input: FilePermissionInput): Promise<boolean> {
    return Promise.resolve(false);
  }

  canDeleteFile(_input: FilePermissionInput): Promise<boolean> {
    return Promise.resolve(false);
  }
}
