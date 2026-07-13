import { ConflictException, Injectable } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { ME_ANOMALY_AUDIT_ACTION, ME_DATA_INCONSISTENT_CODE } from "./me.constants";
import { MeRepository, type MeActiveEmployeeRow } from "./me.repository";

/** Ngữ cảnh current-person đã resolve (SPEC-09 §12.1). Account luôn có; employee link chỉ khi 'linked'. */
export type CurrentPerson =
  | { linkStatus: "unlinked"; employee: null }
  | { linkStatus: "linked"; employee: MeActiveEmployeeRow };

interface Actor {
  id: string;
  companyId: string;
}

/**
 * S5-ME-BE-1 — MeCurrentPersonResolver (SPEC-09 §12.1/§12.2/§12.4).
 *
 * ĐẾM TẤT CẢ employee active theo user_id token-resolved TRONG withTenant (RLS+FORCE, BẤT BIẾN #1) —
 * KHÔNG reader LIMIT-1, KHÔNG nhận employee_id từ client (chống IDOR §14.4):
 *   0 active → linkStatus 'unlinked' (ME vẫn chạy ở mức account — §12.2).
 *   1 active → linkStatus 'linked' + employee link tối thiểu (directory-class).
 *  >1 active → BẤT THƯỜNG (§12.4): KHÔNG tự chọn ngẫu nhiên → ném ConflictException 409
 *              ME-ERR-DATA-INCONSISTENT + ghi audit object_type='user' (CHECK 0011) CÙNG tx, cần Admin/HR xử lý.
 *
 * Partial-unique (company_id,user_id) WHERE deleted_at IS NULL là hàng rào đầu (DB chặn 2 non-deleted);
 * resolver là defense-in-depth (nếu vẫn >1 do dữ liệu lỗi lịch sử) — fail-LOUD thay vì đoán.
 */
@Injectable()
export class MeCurrentPersonResolver {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MeRepository,
    private readonly audit: AuditService,
  ) {}

  async resolve(actor: Actor): Promise<CurrentPerson> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const rows = await this.repo.findActiveEmployeesByUserIdTx(tx, actor.companyId, actor.id);

      if (rows.length === 0) return { linkStatus: "unlinked", employee: null };
      if (rows.length === 1) return { linkStatus: "linked", employee: rows[0] };

      // >1 active — ghi audit (append-only, object_type='user') CÙNG tx TRƯỚC khi ném (audit fail = rollback).
      await this.audit.record(tx, {
        action: ME_ANOMALY_AUDIT_ACTION,
        objectType: "user",
        objectId: actor.id,
        actorUserId: actor.id,
        metadata: { activeEmployeeCount: rows.length, code: ME_DATA_INCONSISTENT_CODE },
      });
      throw new ConflictException({
        code: ME_DATA_INCONSISTENT_CODE,
        message:
          "Tài khoản liên kết nhiều hồ sơ nhân viên đang hoạt động — cần Admin/HR xử lý cấu hình dữ liệu.",
      });
    });
  }
}
