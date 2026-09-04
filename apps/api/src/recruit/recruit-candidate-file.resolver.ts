import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import { DataScopeService } from "../permission/data-scope.service";
import type { FilePermissionInput } from "../foundation/files/file-policy.types";
import type { FileOwnerPermissionResolver } from "../foundation/files/resolvers/file-owner-permission-resolver";
import { FileLinkRepository } from "../foundation/files/file-link.repository";
import { FileRepository } from "../foundation/files/file.repository";
import { CandidatesRepository } from "./candidates.repository";

export const RECRUIT_MODULE = "RECRUIT";
export const CANDIDATE_ENTITY = "candidate";

/** Cặp gác ĐƯỜNG GHI tệp CV (seed 0569, is_sensitive=TRUE) — S14-RECRUIT-FILEGRANT-1. */
const CANDIDATE_FILE_UPLOAD_PAIR = { action: "upload", resourceType: "candidate-file" } as const;

/** `scan_status` được phép gắn — Pending/Failed/Infected đều bị từ chối TRƯỚC khi tạo link. */
const LINKABLE_SCAN = new Set(["Clean", "NotRequired"]);

/**
 * S12-RECRUIT-BE-1 — resolver quyền file CV ứng viên (plan §7, mirror `EmployeeFileResolver`).
 * CV đi qua Foundation Files (API-09); resolver đăng ký cặp (module='RECRUIT', entity='candidate') để
 * route download chuẩn không rơi `deny-no-resolver`; `file_access_logs` do Foundation Files ghi.
 *
 * MỌI resolve truyền `isSensitive: true` — 7 cặp `candidate` là sensitive theo catalog; thiếu cờ thì
 * wildcard mở khoá tải CV cho role không thật sự có quyền đọc ứng viên (plan §4.4/§7).
 * Fail-closed: candidate không tồn tại/khác tenant/xoá mềm ⇒ false.
 *
 * ┌─ S14-RECRUIT-FILEGRANT-1 — `canLinkFile` nay có NĂM vế, ĐỌC TRƯỚC KHI RÚT GỌN ────────────────┐
 * │ `FileService.link` (files.service.ts:530-600) chỉ kiểm *tenant* + scan_status khác Infected.    │
 * │ Nó KHÔNG kiểm `owner_user_id` và KHÔNG kiểm tệp đã từng được gắn ở đâu. Quyết định quyền duy    │
 * │ nhất của đường GHI là `policy.canLink` → pipeline ĐƠN (`decide`), dispatch theo cặp             │
 * │ (moduleCode, entityType) do CLIENT khai — cơ chế AND-across-links của `decideForLinkedFile` chỉ │
 * │ bảo vệ đường ĐỌC. Vì vậy mọi bất biến của đường ghi phải được ép TẠI ĐÂY.                       │
 * │                                                                                                 │
 * │ Với bản CŨ (chỉ hỏi cặp create/update + candidate tồn tại) thì chuỗi sau đi lọt:                 │
 * │   1. một tệp bất kỳ trong tenant bị GỠ LINK (thu hồi) — hàng rào duy nhất còn lại là             │
 * │      `deny-links-revoked` (file-policy.service.ts:216-227);                                      │
 * │   2. recruiter/hr gắn nó vào một ứng viên ⇒ tệp có link SỐNG trở lại;                            │
 * │   3. `decideForLinkedFile` hết rơi nhánh links rỗng ⇒ verdict quay về `view:candidate` ⇒ ALLOW   │
 * │      ⇒ presigned URL. Thu hồi bị vô hiệu hoá VĨNH VIỄN.                                          │
 * │ Biến thể: tệp foundation-owned 0 link (admin tải lên qua System > Files) → gắn vào ứng viên →    │
 * │ tải được.                                                                                        │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
@Injectable()
export class RecruitCandidateFileResolver implements FileOwnerPermissionResolver {
  readonly moduleCode = RECRUIT_MODULE;
  readonly entityTypes: readonly string[] = [CANDIDATE_ENTITY];

  constructor(
    private readonly db: DatabaseService,
    private readonly dataScope: DataScopeService,
    private readonly candidates: CandidatesRepository,
    private readonly fileRepo: FileRepository,
    private readonly linkRepo: FileLinkRepository,
  ) {}

  /** VIEW metadata ⇔ cặp ('view','candidate') sensitive. */
  canViewFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAccessCandidate(input, ["view"]);
  }

  /** DOWNLOAD ⇔ cùng cặp view (SPEC-12 §18 — không grant download riêng). */
  canDownloadFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAccessCandidate(input, ["view"]);
  }

  /**
   * LINK ⇔ NĂM vế cùng đúng (xem khối cảnh báo ở jsdoc lớp; khuôn nguyên văn
   * `ChatMessageFileResolver.canAttach`):
   *
   *   1. `fileId` có mặt — vắng (pre-link check) ⇒ deny, fail-closed;
   *   2. CALLER SỞ HỮU TỆP (`files.owner_user_id === userId`) — chốt chặn TẠI NGUỒN: không mượn kênh
   *      RECRUIT để phát tán tệp người khác (bản scan CCCD/hợp đồng trong tenant);
   *   3. `upload_status === 'Uploaded'` — tệp Pending chưa có bytes, gắn vào là đính một placeholder;
   *   4. `scan_status` thuộc {Clean, NotRequired} — CHẶT HƠN `FileService` (nó chỉ chặn Infected);
   *   5. TỆP CHƯA TỪNG CÓ LINK NÀO (`hasEverBeenLinkedTx` false) — đóng đường tái-link để phục hồi
   *      tệp đã bị thu hồi, và đóng luôn đường gắn tệp foundation-owned 0-link;
   *   6. cặp quyền: create:candidate HOẶC update:candidate HOẶC upload:candidate-file (vế mới của WO
   *      — role `hr` chỉ giữ vế thứ ba), kèm ứng viên còn sống trong tenant.
   *
   * ⚠️ LINK LẦN HAI TRẢ 403, KHÔNG PHẢI 409 `DUP_LINK`: vế 5 chạy TRƯỚC insert nên retry chỉ-bước-link
   * cho cùng (candidate, file) rơi vào `deny-resolver`. CHỐT là chấp nhận 403 — FE luôn retry cả chuỗi
   * (tệp mới) nên luồng không gãy, còn thêm nhánh 409 ở wrapper là dựng bản sao thứ hai của luật link.
   * Ai định sửa cho "đúng mã lỗi" phải đọc lại vế 5 trước khi gỡ nó.
   */
  canLinkFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAttachToCandidate(input);
  }

  /**
   * DELETE ⇔ create/update — CỐ Ý KHÔNG nhận `upload:candidate-file`.
   *
   * Bất đối xứng có chủ đích (plan §3.5 · §9 KI-c): `hr` gắn được CV nhưng KHÔNG gỡ/xoá được. Đó là
   * quyền HẸP HƠN, không phải lỗ. Thêm `upload:candidate-file` vào đây là cấp quyền xoá PII ứng viên
   * cho một cặp mà seed 0569 chỉ định nghĩa cho đường GHI.
   */
  canDeleteFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAccessCandidate(input, ["create", "update"]);
  }

  /** UNLINK ⇔ cùng bất đối xứng như `canDeleteFile` — xem jsdoc ở đó. */
  canUnlinkFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAccessCandidate(input, ["create", "update"]);
  }

  private async canAccessCandidate(
    input: FilePermissionInput,
    actions: readonly string[],
  ): Promise<boolean> {
    let allowed = false;
    for (const action of actions) {
      const scope = await this.dataScope.resolveOrNull(
        input.userId,
        input.companyId,
        action,
        CANDIDATE_ENTITY,
        { isSensitive: true },
      );
      if (scope !== null) {
        allowed = true;
        break;
      }
    }
    if (!allowed) return false;
    return this.candidateIsLive(input);
  }

  /**
   * Vế 1-6 của `canLinkFile`. Thứ tự CÓ Ý NGHĨA: kiểm rẻ trước (fileId có mặt, cặp quyền) rồi mới
   * chạm DB, và trạng thái tệp đọc MỘT LẦN trong cùng một `withTenant`.
   *
   * ⚠️ Wrapper (`RecruitCandidateFileService.link`) KHÔNG được bọc `files.link(...)` trong
   * `withTenant`: resolver này tự mở tenant tx, còn `FileService.link` gọi `policy.canLink` NGOÀI mọi
   * tx (files.service.ts:549 trước :574). Bọc lại ⇒ tx lồng tx dưới PgBouncer transaction-mode.
   */
  private async canAttachToCandidate(input: FilePermissionInput): Promise<boolean> {
    const fileId = input.fileId;
    if (!fileId) return false; // vế 1 — pre-link check, fail-closed.

    // vế 6a — cặp quyền GHI: create/update:candidate (recruiter) HOẶC upload:candidate-file (hr).
    const writeScopes = await this.dataScope.resolveManyOrNull(input.userId, input.companyId, [
      { action: "create", resourceType: CANDIDATE_ENTITY, isSensitive: true },
      { action: "update", resourceType: CANDIDATE_ENTITY, isSensitive: true },
      {
        action: CANDIDATE_FILE_UPLOAD_PAIR.action,
        resourceType: CANDIDATE_FILE_UPLOAD_PAIR.resourceType,
        isSensitive: true,
      },
    ]);
    if (writeScopes.every((s) => s === null)) return false;

    // vế 2-5 — trạng thái tệp, đọc trong MỘT tenant tx.
    const state = await this.db.withTenant(input.companyId, async (tx) => {
      const file = await this.fileRepo.findByIdTx(input.companyId, fileId, tx);
      if (!file) return null;
      const everLinked = await this.linkRepo.hasEverBeenLinkedTx(input.companyId, fileId, tx);
      return { file, everLinked };
    });
    if (state === null) return false;
    if (state.file.ownerUserId !== input.userId) return false; // vế 2
    if (state.file.uploadStatus !== "Uploaded") return false; // vế 3
    if (!LINKABLE_SCAN.has(state.file.scanStatus)) return false; // vế 4
    if (state.everLinked) return false; // vế 5

    // vế 6b — ứng viên còn sống trong tenant.
    return this.candidateIsLive(input);
  }

  /** Candidate CHỈ Company (§13.6) — chỉ cần kiểm tồn tại-sống trong tenant (BẤT BIẾN #1). */
  private async candidateIsLive(input: FilePermissionInput): Promise<boolean> {
    const row = await this.db.withTenant(input.companyId, (tx) =>
      this.candidates.findTx(tx, input.companyId, input.entityId),
    );
    return row !== null;
  }
}
