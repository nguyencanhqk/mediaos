import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { FOUNDATION_FILE_ERROR_CODES, type LinkFileInput } from "@mediaos/contracts";
import { isUniqueViolation, pgErrorField } from "../../common/db-error";
import type { FileRecord } from "../../db/schema/files";
import type { FileAccessContext } from "./file-access-decision";
import type { FilePolicyService } from "./file-policy.service";

/**
 * S19-SEC-FILELINKGATE-1 — các kiểm thuần của biên gắn tệp `FileService.link()` (ném lỗi Nest, không DB).
 * Thứ tự gọi do `FileService` giữ: cặp đích → `canLink` → `decideLinkAccess` của người gắn → trạng thái tệp →
 * (trong tx ghi) khoá hàng tệp, so lại ảnh chụp liên kết.
 */

/** 403 FOUNDATION-FILE-ERR-FORBIDDEN mang lý do của quyết định (như `GET /foundation/files/:id`). */
export function fileForbidden(reason: string): ForbiddenException {
  return new ForbiddenException({
    code: FOUNDATION_FILE_ERROR_CODES.FORBIDDEN,
    message: `${FOUNDATION_FILE_ERROR_CODES.FORBIDDEN}: ${reason}`,
  });
}

function linkRejected(message: string): BadRequestException {
  return new BadRequestException({
    code: FOUNDATION_FILE_ERROR_CODES.LINK,
    message: `${FOUNDATION_FILE_ERROR_CODES.LINK}: ${message}`,
  });
}

/** 400 LINK — tệp không thuộc tenant / không tồn tại (cross-company ⇒ RLS 0 hàng). */
export function linkFileMissing(): BadRequestException {
  return linkRejected("file không thuộc công ty hiện tại hoặc không tồn tại.");
}

/**
 * Cặp `(moduleCode, entityType)` đích phải thuộc một resolver đã đăng ký và đúng dạng chính tắc của nó.
 *
 * - Lệch chính tả (S7-CHAT-BE-3): registry tra resolver bằng khoá đã chuẩn hoá còn module truy vấn
 *   `file_links` bằng so-chuỗi chính xác ⇒ một cặp lệch tạo được liên kết mà resolver vẫn cấp quyền nhưng
 *   module không thấy, không gỡ được. Từ chối thay vì âm thầm nhận/viết lại.
 * - Không resolver nào nhận cặp: liên kết tạo ra sẽ làm tệp `deny-no-resolver` với mọi người và không
 *   module nào quản. Nguồn danh sách cặp hợp lệ = chính registry resolver (không chép tay). Người gọi ghi
 *   dòng log từ chối qua `onUnregistered` trước khi lỗi được ném.
 */
export async function assertRegisteredLinkTarget(
  policy: Pick<FilePolicyService, "canonicalOwnerKey">,
  input: Pick<LinkFileInput, "moduleCode" | "entityType">,
  onUnregistered: () => Promise<void>,
): Promise<void> {
  const canonical = policy.canonicalOwnerKey(input.moduleCode, input.entityType);
  if (canonical === null) {
    await onUnregistered();
    throw linkRejected("không module nào nhận gắn tệp vào moduleCode/entityType này.");
  }
  if (canonical.moduleCode !== input.moduleCode || canonical.entityType !== input.entityType) {
    throw linkRejected(
      `moduleCode/entityType phải đúng dạng chính tắc ` +
        `("${canonical.moduleCode}"/"${canonical.entityType}").`,
    );
  }
}

/**
 * Trạng thái tệp gắn được: không Infected (QA-06) · không phải tệp TẠM hệ thống sinh (S15-PAYROLL-BE-5B —
 * liên kết thật khiến TEMP_FILE_CLEANUP giữ tệp mãi). Gọi SAU quyết định xem: người không xem được tệp
 * không học được trạng thái của nó.
 */
export function assertLinkableFile(row: Pick<FileRecord, "scanStatus" | "isTemporary">): void {
  if (row.scanStatus === "Infected") {
    throw new BadRequestException({
      code: FOUNDATION_FILE_ERROR_CODES.INFECTED,
      message: `${FOUNDATION_FILE_ERROR_CODES.INFECTED}: không thể link file đang ở trạng thái Infected.`,
    });
  }
  if (row.isTemporary) throw linkRejected("tệp tạm do hệ thống sinh không gắn link được.");
}

/**
 * Ảnh chụp liên kết đọc lại trong tx ghi phải trùng ảnh chụp đã dùng để quyết định (tập id liên kết sống +
 * cờ đã từng gắn). Lệch ⇒ quyết định không còn đứng ⇒ 409 để client thử lại; không ghi gì.
 */
export function assertSameLinkSnapshot(
  decided: FileAccessContext,
  current: FileAccessContext,
): void {
  const ids = (ctx: FileAccessContext) => ctx.live.map((l) => l.id).sort();
  const before = ids(decided);
  const now = ids(current);
  const same =
    decided.everLinked === current.everLinked &&
    before.length === now.length &&
    before.every((id, i) => id === now[i]);
  if (same) return;
  throw new ConflictException({
    code: FOUNDATION_FILE_ERROR_CODES.LINK,
    message: `${FOUNDATION_FILE_ERROR_CODES.LINK}: liên kết của tệp vừa thay đổi, hãy thử lại.`,
  });
}

/**
 * Tên 2 constraint UNIQUE trên `file_links` mà biên gắn PHÂN BIỆT khi bắt 23505 (S2-FND-DB-2-B) — không gộp
 * một mã lỗi cho hai nguyên nhân:
 *  - `uq_file_links_entity_file_active` (6 cột, WHERE deleted_at IS NULL, mig 0472): tệp NÀY đã gắn vào ĐÚNG
 *    thực thể + link_type này rồi ⇒ 409 DUP-LINK.
 *  - `uq_file_links_primary_per_entity_type` (5 cột is_primary=true, mig 0433): thực thể ĐÃ có một tệp KHÁC
 *    primary cho cùng link_type ⇒ 409 DUP-PRIMARY.
 */
const UQ_FILE_LINKS_ENTITY_FILE_ACTIVE = "uq_file_links_entity_file_active";
const UQ_FILE_LINKS_PRIMARY_PER_ENTITY_TYPE = "uq_file_links_primary_per_entity_type";

/**
 * Ném lỗi của insert `file_links`: 23505 của hai constraint trên ⇒ 409 tương ứng; 23505 constraint khác
 * hoặc lỗi khác ⇒ ném NGUYÊN lỗi gốc (không nuốt — silent-failure-hunter).
 */
export function rethrowLinkInsertError(err: unknown): never {
  if (!isUniqueViolation(err)) throw err;
  const constraint = pgErrorField(err, "constraint");
  if (constraint === UQ_FILE_LINKS_ENTITY_FILE_ACTIVE) {
    throw new ConflictException({
      code: FOUNDATION_FILE_ERROR_CODES.DUP_LINK,
      message: `${FOUNDATION_FILE_ERROR_CODES.DUP_LINK}: file đã được gắn vào entity này với cùng link_type (chưa gỡ).`,
    });
  }
  if (constraint === UQ_FILE_LINKS_PRIMARY_PER_ENTITY_TYPE) {
    throw new ConflictException({
      code: FOUNDATION_FILE_ERROR_CODES.DUP_PRIMARY,
      message: `${FOUNDATION_FILE_ERROR_CODES.DUP_PRIMARY}: entity này đã có 1 file khác làm primary cho cùng link_type.`,
    });
  }
  throw err;
}
