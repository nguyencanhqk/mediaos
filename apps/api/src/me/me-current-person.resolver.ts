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
 *  >1 active → BẤT THƯỜNG (§12.4): KHÔNG tự chọn ngẫu nhiên → ghi audit object_type='user' (CHECK 0011) ở
 *              transaction RIÊNG đã COMMIT, RỒI ném ConflictException 409 ME-ERR-DATA-INCONSISTENT, cần
 *              Admin/HR xử lý.
 *
 * BẤT BIẾN #2 (audit append-only PHẢI persist): audit KHÔNG được ghi CÙNG tx với nhánh throw. `withTenant`
 * bọc db.transaction ⇒ throw TRONG callback ⇒ ROLLBACK toàn tx ⇒ dòng audit vừa insert BỐC HƠI (anomaly
 * vô hình với Admin/HR). Vì vậy audit đi withTenant(companyId) RIÊNG (commit khi callback resolve) TRƯỚC khi
 * throw — bản ghi bền vững độc lập với lỗi 409 trả về client. Chi phí: nhánh anomaly hiếm (partial-unique
 * DB đã chặn 2 non-deleted); path 0/1 chỉ 1 transaction đọc.
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
    // (1) ĐẾM active employee trong withTenant (RLS+FORCE) — read-only, không throw ở nhánh 0/1.
    const rows = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.findActiveEmployeesByUserIdTx(tx, actor.companyId, actor.id),
    );

    if (rows.length === 0) return { linkStatus: "unlinked", employee: null };
    if (rows.length === 1) return { linkStatus: "linked", employee: rows[0] };

    // (2) >1 active — BẤT THƯỜNG (§12.4). Ghi audit ở withTenant RIÊNG đã COMMIT TRƯỚC khi throw để bản ghi
    // KHÔNG bị rollback theo ConflictException (bất biến #2 append-only — audit anomaly PHẢI persist cho
    // Admin/HR xử lý). Nếu ghi audit fail → propagate (fail-LOUD), KHÔNG nuốt (silent-failure).
    await this.db.withTenant(actor.companyId, (tx) =>
      this.audit.record(tx, {
        action: ME_ANOMALY_AUDIT_ACTION,
        objectType: "user",
        objectId: actor.id,
        actorUserId: actor.id,
        metadata: { activeEmployeeCount: rows.length, code: ME_DATA_INCONSISTENT_CODE },
      }),
    );

    // (3) Audit đã COMMIT ở tx (2) → giờ mới ném 409 (rollback nếu có cũng không đụng audit đã persist).
    throw new ConflictException({
      code: ME_DATA_INCONSISTENT_CODE,
      message:
        "Tài khoản liên kết nhiều hồ sơ nhân viên đang hoạt động — cần Admin/HR xử lý cấu hình dữ liệu.",
    });
  }
}
