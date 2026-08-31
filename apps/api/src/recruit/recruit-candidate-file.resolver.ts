import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import { DataScopeService } from "../permission/data-scope.service";
import type { FilePermissionInput } from "../foundation/files/file-policy.types";
import type { FileOwnerPermissionResolver } from "../foundation/files/resolvers/file-owner-permission-resolver";
import { CandidatesRepository } from "./candidates.repository";

export const RECRUIT_MODULE = "RECRUIT";
export const CANDIDATE_ENTITY = "candidate";

/**
 * S12-RECRUIT-BE-1 — resolver quyền file CV ứng viên (plan §7, mirror `EmployeeFileResolver`).
 * CV đi qua Foundation Files (API-09) — RECRUIT KHÔNG có route upload/tải riêng, chỉ đăng ký cặp
 * (module='RECRUIT', entity='candidate') để route download chuẩn không rơi `deny-no-resolver`;
 * `file_access_logs` do Foundation Files ghi.
 *
 * MỌI resolve truyền `isSensitive: true` — 7 cặp `candidate` là sensitive theo catalog; thiếu cờ thì
 * wildcard `*:*` tải được CV của role không thật sự có quyền đọc ứng viên (plan §4.4/§7).
 * Fail-closed: candidate không tồn tại/khác tenant/xoá mềm ⇒ false.
 */
@Injectable()
export class RecruitCandidateFileResolver implements FileOwnerPermissionResolver {
  readonly moduleCode = RECRUIT_MODULE;
  readonly entityTypes: readonly string[] = [CANDIDATE_ENTITY];

  constructor(
    private readonly db: DatabaseService,
    private readonly dataScope: DataScopeService,
    private readonly candidates: CandidatesRepository,
  ) {}

  /** VIEW metadata ⇔ ('view','candidate') sensitive. */
  canViewFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAccessCandidate(input, ["view"]);
  }

  /** DOWNLOAD ⇔ cùng cặp view (SPEC-12 §18 — không grant download riêng). */
  canDownloadFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAccessCandidate(input, ["view"]);
  }

  /** LINK ⇔ ('create','candidate') HOẶC ('update','candidate') — §18: lúc tạo dùng create, hồ sơ có sẵn dùng update; resolver không phân biệt được ngữ cảnh nên OR cả hai. */
  canLinkFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAccessCandidate(input, ["create", "update"]);
  }

  /** DELETE ⇔ cùng OR như link (không gỡ được với quyền yếu hơn quyền đã đính). */
  canDeleteFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAccessCandidate(input, ["create", "update"]);
  }

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
    // Candidate CHỈ Company (§13.6) — chỉ cần kiểm tồn tại-sống trong tenant (BẤT BIẾN #1).
    const row = await this.db.withTenant(input.companyId, (tx) =>
      this.candidates.findTx(tx, input.companyId, input.entityId),
    );
    return row !== null;
  }
}
