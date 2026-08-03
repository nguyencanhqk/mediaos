import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AuditService } from "../events/audit.service";
import { DatabaseService } from "../db/db.service";
import { DataScopeService } from "../permission/data-scope.service";
// CỐ Ý dùng CHUNG hằng số của đường đọc danh bạ thay vì viết literal thứ tư: `data_scope` là
// PER-(permission, role), nên gate một cặp mà bound hàng theo cặp khác = lỗ im lặng
// (memory `read-path-gate-pair-must-match-download-pair`). Chỉ import HẰNG SỐ — không phụ thuộc DI
// vào OrgModule, không có vòng import.
import { ORG_EMPLOYEE_DIRECTORY } from "../org/org.permissions";
import {
  ChatDerivedRoomsSyncService,
  ChatSyncRevokeError,
} from "../chat/chat-derived-rooms-sync.service";
import { RecycleBinRepository } from "./recycle-bin.repository";

type RequestUser = { id: string; companyId: string };

@Injectable()
export class RecycleBinService {
  private readonly logger = new Logger(RecycleBinService.name);

  constructor(
    private readonly repo: RecycleBinRepository,
    private readonly db: DatabaseService,
    private readonly auditService: AuditService,
    // PermissionModule (đã import sẵn cho PermissionGuard) export DataScopeService ⇒ không đổi wiring.
    private readonly dataScope: DataScopeService,
    // S7-CHAT-BE-5 (W13): vào lại phòng dẫn xuất ngay trong tx khôi phục.
    private readonly chatSync: ChatDerivedRoomsSyncService,
  ) {}

  /**
   * S6-SEC-IDENTITYBOUND-1 (N-1d, KI-051) — liệt kê hồ sơ đã xoá mềm, DANH TÍNH bound theo `data_scope`.
   *
   * TRƯỚC WO này: gate `read:employee` rồi trả `userFullName` + `userEmail` của MỌI hồ sơ đã xoá, không
   * resolve một scope nào. Đo PROD 2026-07-30: role SEEDED `employee` giữ `read:employee@Own` với
   * **45/46 user sống** và KHÔNG có `view:user` nào ⇒ mỗi nhân viên đọc được danh bạ toàn bộ nhân sự
   * đã nghỉ việc. Guard chỉ trả lời "có cặp không", KHÔNG trả lời "cặp đó tới đâu".
   *
   * `resolveOrNull`, KHÔNG `resolveAndAssert`: thiếu cặp danh bạ KHÔNG được biến thành 403 cả route —
   * `read:employee` vẫn cho phép xem vế nghiệp vụ của thùng rác (nhất quán với quyết định N-1c).
   */
  async listDeletedEmployees(user: RequestUser) {
    const scope = await this.dataScope.resolveOrNull(
      user.id,
      user.companyId,
      ORG_EMPLOYEE_DIRECTORY.action,
      ORG_EMPLOYEE_DIRECTORY.resourceType,
    );
    if (scope === null) {
      // Nhánh fail-closed phải để lại dấu vết: `buildUserScopeCondition` tự log cho Team/Department,
      // ca "không grant nào" không đi qua đó. Không log thì admin thấy cột danh tính trống mà không
      // có đường chẩn (đúng F1 của FULL gate N-1).
      this.logger.warn(
        "recycle bin: actor không có grant nào cho cặp danh bạ → BỎ cột danh tính của mọi hàng",
        { userId: user.id, companyId: user.companyId },
      );
    }
    const identityCond =
      scope === null
        ? null
        : this.dataScope.buildUserScopeCondition(scope, {
            userId: user.id,
            companyId: user.companyId,
          });
    const rows = await this.db.withTenant(user.companyId, (tx) =>
      this.repo.listDeletedEmployeesTx(tx, user.companyId, identityCond),
    );
    return rows.map(({ identityInScope, userFullName, userEmail, ...rest }) =>
      identityInScope ? { ...rest, userFullName, userEmail } : rest,
    );
  }

  /**
   * Restore a soft-deleted employee (clear deletedAt).
   * Audits the restore action inside the same transaction so the audit cannot succeed
   * without the restore committing (and vice-versa).
   */
  async restoreEmployee(user: RequestUser, id: string) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const row = await this.repo.restoreEmployeeTx(tx, id, user.companyId);
        if (!row) throw new NotFoundException("Employee not found in recycle bin");

        await this.auditService.record(tx, {
          action: "employee.restored",
          objectType: "employee",
          objectId: id,
          actorUserId: user.id,
        });

        // S7-CHAT-BE-5 (W13) — khôi phục ⇒ vào lại phòng dẫn xuất NGAY trong tx khôi phục, không chờ
        // nhịp job. Đối xứng với W14 (xoá mềm ⇒ rời phòng): thiếu vế này thì thùng rác trở thành đường
        // một chiều — xoá nhầm rồi khôi phục xong người đó vẫn ngồi ngoài phòng tới 15 phút.
        //
        // Đọc `user_id` từ `.returning()` của chính câu UPDATE khôi phục (repo trả thêm cột) — KHÔNG
        // query lại: query lại là đọc một trạng thái khác thời điểm với câu ghi.
        await this.chatSync.syncUserDerivedMembershipTx(tx, user.companyId, row.userId, {
          kind: "system",
          userId: user.id,
        });

        return { id: row.id };
      });
    } catch (err) {
      if (err instanceof ChatSyncRevokeError) {
        await this.chatSync.reportRevokeFailure(user.companyId, err);
      }
      throw err;
    }
  }
}
