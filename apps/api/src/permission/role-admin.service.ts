import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  ApplyPermissionRuleRequest,
  AssignRolePermissionRequest,
  CreateRoleRequest,
  PermissionRulePreview,
  RevokeRolePermissionRequest,
  RoleDeleteResultDto,
  RoleMemberListDto,
  RolePermissionGrantsDto,
  RoleWriteResultDto,
  UpdateRoleRequest,
  DataScope,
} from "@mediaos/contracts";
import { users, type Role } from "../db/schema";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { PermissionService } from "./permission.service";
import { PermissionAdminRepository } from "./permission-admin.repository";
import { RoleAdminRepository } from "./role-admin.repository";
import { DataScopeService } from "./data-scope.service";
import { fromScope, type IdentityGrant } from "./identity-projection";
import {
  pgErrorCode,
  pgErrorField,
  PG_CHECK_VIOLATION,
  PG_FK_VIOLATION,
  PG_UNIQUE_VIOLATION,
} from "../common/db-error";

type RequestUser = { id: string; companyId: string };

/** SCOPE CEILING (S2-AUTH-BE-6 done_when — CHỐT 2026-07-02): dataScope gán cho role PHẢI ≤ Company. */
const MAX_ASSIGNABLE_DATA_SCOPE = "System";

/**
 * S2-AUTH-PERMRULE-1 — preset action khớp theo MẪU TÊN (không tập cứng) để bắt cả verb-suffix của catalog
 * (ATT/LEAVE: view-own/view-team/view-company; update-draft…). `-|$` = đúng token hoặc `token-<suffix>`.
 * read-only = chỉ đọc; crud = đọc + tạo/sửa/xoá. Quyền ngoài preset → dùng preset 'custom' (chọn tay).
 */
const READ_ONLY_ACTION_RE = /^(view|read|list)(-|$)/;
const CRUD_ACTION_RE = /^(create|read|update|delete|view|list)(-|$)/;

/**
 * S2-AUTH-PERMRULE-1 (security-reviewer MED) — trần số grant 1 luật được phép tạo/đổi trong 1 lần. Luật
 * resourceTypes=[] (mọi resource) + crud bung trên TOÀN catalog (hàng trăm cặp) → nếu áp sẽ là hàng trăm
 * assign tuần tự (mỗi cái 1 tx) trong 1 request. Vượt trần → 400 (buộc thu hẹp), CHẶN cả dryRun để admin
 * thấy sớm. Non-breaking: luật theo module/resource thực tế hiếm khi > 100 cặp.
 */
const MAX_RULE_GRANTS = 200;

/**
 * DTO write result cho create/update role — CHỈ field theo roleWriteResultSchema (S2-AUTH-BE-6/11),
 * KHÔNG lộ deletedAt (soft-delete internal). requiresTwoFactor phản chiếu roles.requires_two_factor.
 */
function toRoleWriteResult(role: Role): RoleWriteResultDto {
  return {
    id: role.id,
    companyId: role.companyId,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    requiresTwoFactor: role.requiresTwoFactor,
  };
}

/**
 * RoleAdminService (S2-AUTH-BE-6) — quản lý role WRITE (create/update, KHÔNG sửa system role) + gán/gỡ
 * permission cho role (role_permissions). CROWN JEWEL — chống leo thang đặc quyền.
 *
 * HỢP ĐỒNG mọi mutation — TRONG CÙNG 1 transaction: (1) ghi row (roles/role_permissions),
 * (2) audit_logs (BẤT BIẾN #2). role_permissions KHÔNG emit permission.changed cache-invalidation ở đây
 * (out-of-scope done_when S2-AUTH-BE-6 — theo dõi ở S2-AUTH-BE-6 follow-up nếu cần realtime).
 *
 * Permission gate: create/update:role (seed 0005, is_sensitive=false, company-admin đã có sẵn) ·
 * assign:permission (seed 0460, is_sensitive=true — ANTI-ESCALATION pin company-admin, KHÔNG kế thừa
 * wildcard, KHÔNG mirror grant thực actor — N=1 chưa có non-admin giữ assign:permission).
 */
@Injectable()
export class RoleAdminService {
  private readonly logger = new Logger(RoleAdminService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly permissionService: PermissionService,
    private readonly audit: AuditService,
    private readonly repo: RoleAdminRepository,
    // S6-SEC-IDENTITY-PROJ-1 (KI-053): BẮT BUỘC, KHÔNG optional-với-default như `permissionCatalog`
    // bên dưới. Một default ở đây nghĩa là spec nào dựng service bằng tay sẽ lặng lẽ chạy với một
    // resolver rỗng — tức test xanh trên đúng nhánh mà bản vá bảo vệ. Vỡ TYPECHECK ồn ào hơn.
    private readonly dataScope: DataScopeService,
    // S2-AUTH-PERMRULE-1: đọc catalog permission (bung luật). Cùng PermissionModule → acyclic. Optional-với-
    // default để int-spec cũ dựng RoleAdminService bằng tay (4 arg) KHÔNG vỡ; DI luôn truyền instance thật.
    private readonly permissionCatalog: PermissionAdminRepository = new PermissionAdminRepository(),
  ) {}

  // ── (A0) đọc thành viên role (S2-AUTH-ROLEMEM-1) ─────────────────────────────

  /**
   * GET /auth/roles/:id/members — user ACTIVE đang giữ role này trong tenant của actor.
   * Gate view:user (non-sensitive — response là dữ liệu account-level đã lộ sẵn qua GET /auth/users;
   * KHÔNG PII HR). READ-ONLY: không audit, không mutation. Role lạ/đã xoá/operator-audience → 404.
   */
  async listMembers(actor: RequestUser, roleId: string): Promise<RoleMemberListDto> {
    await this.assertCan(actor, "view", "user", false);
    // ⚠️ `try` bọc CẢ phần phân giải scope, không chỉ phần truy vấn: nếu `resolveOrNull` ném (vd
    // timeout khi đọc `data_scope`) mà nằm ngoài try thì lỗi vẫn nổi thành 500 nhưng MẤT ngữ cảnh
    // `mapError` dựng ra (`roleId` + context + mã lỗi PG) — đúng route mà WO này đang gia cố.
    try {
      return await this.listMembersInner(actor, roleId);
    } catch (err) {
      throw this.mapError(err, "Failed to list role members");
    }
  }

  /**
   * S10-SEC-ROLEMEMBERROW-1 (KI-071) — ĐIỂM ĐÚC vị từ chặn TẬP HÀNG cho `GET /auth/roles/:id/members`.
   * Điểm đúc THỨ BA của cơ chế (sau `auth-logs-viewer` và `foundation/audit`) ⇒ phải ký lại ở
   * `ROW_SCOPE_MINT_PINS`. Bằng chứng deny/allow của chính bảng: `identity-projection-scope.int-spec.ts`
   * — DENY `A2·A3·R-D2·R-D3·R-T1·R-T2·R-G1·R-X1` / ALLOW `A1·R-A3`; cộng tầng KHÔNG-cần-DB
   * `role-admin.row-scope.spec.ts` (U1·U1b·U1c·U2·U3·U4).
   *
   * **Ngữ nghĩa `Own` ở route này — phát biểu TRƯỚC khi đọc vị từ (plan D2):** hàng là một TƯ CÁCH
   * THÀNH VIÊN (`user_roles`), cột NGƯỜI của hàng là THÀNH VIÊN (`users.id` qua inner join) ⇒
   * `Own` = **"hàng NÓI VỀ tôi"**, tức tư cách thành viên của chính tôi trong role này. Cùng họ với
   * `login_logs` (KI-070), KHÁC `audit_logs` (KI-072, `Own` = hàng do tôi GÂY RA). Hệ quả CÓ CHỦ Ý:
   * `@Own` gọi role mình không có chân ⇒ 0 hàng + HTTP 200, KHÔNG 404 — 404 ở đó là oracle
   * "role này có/không có bạn trong đó".
   *
   * ⚠️ CỐ Ý KHÔNG trích dùng chung với `AuthLogsViewerService.rowScopeFor` /
   * `AuditQueryService.rowScopeFor` (khuôn gần như giống hệt): trích là refactor CROWN chạm hai đường
   * đã nghiệm thu, VÀ nó gộp ba bề mặt bound-HÀNG thành MỘT điểm đúc ⇒ `ROW_SCOPE_MINT_PINS` (pin theo
   * DANH SÁCH, không theo số đếm) mất khả năng nhìn thấy từng bề mặt. Docblock của pin đó đã đăng ký
   * trước điều kiện gộp: "khi KI-071 thêm điểm THỨ BA thì đó mới là lúc cân nhắc lại, ở một WO riêng"
   * — WO này thêm điểm thứ ba và GHI NỢ, không gộp.
   *
   * ⚠️ KHAI BẰNG CÚ PHÁP METHOD, không phải property arrow: census `enclosing()` của
   * `identity-projection-census.ts` chỉ nhận `MethodDeclaration`/`FunctionDeclaration`; arrow property
   * trả `"?"` ⇒ `ROW_SCOPE_MINT_PINS` ĐỎ dù đã ký đúng chuỗi.
   *
   * ⚠️ Nhận `scope` ĐÃ phân giải thay vì tự resolve (khác hình dạng của hai tiền lệ): route này bound
   * cả HÀNG lẫn CỘT bằng CÙNG một cặp, và luật "phân giải mỗi cặp ĐÚNG MỘT LẦN/request" (KI-070 D11)
   * đòi một lời gọi duy nhất. Cú ném 403 vì thế nằm ở `listMembersInner` (nơi resolve), không nằm
   * trong hàm này — xem docblock ở đó.
   */
  private rowScopeFor(scope: DataScope, actor: RequestUser): IdentityGrant {
    return fromScope(
      this.dataScope.buildUserScopeConditionOn(
        scope,
        { userId: actor.id, companyId: actor.companyId },
        // `idCol` = cột NGƯỜI của hàng. Ở đây là THÀNH VIÊN (`users.id`) — KHÔNG phải `companyId`.
        // `rowScopeSql` chỉ assert TÊN BẢNG, mà hai cột cùng thuộc `users`, nên nhầm ở đây đi LỌT
        // cổng đó và biến vị từ `Own` thành `company_id = <uuid người dùng>` (0 hàng, im lặng).
        { idCol: users.id, companyIdCol: users.companyId },
      ),
      "scoped-predicate",
      "GET /auth/roles/:id/members — TẬP HÀNG đi theo data_scope của cặp gate view:user (KI-071)",
      // Buộc vị từ vào ĐÚNG bảng: `rowScopeSql` ném nếu ai đem grant này AND vào truy vấn bảng kia.
      users.id,
    );
  }

  private async listMembersInner(actor: RequestUser, roleId: string): Promise<RoleMemberListDto> {
    // S6-SEC-IDENTITY-PROJ-1 (KI-053) — `assertCan` ở trên chỉ trả lời CÓ/KHÔNG có cặp `view:user`;
    // nó KHÔNG đọc `data_scope`. Trước bản vá, một vai giữ `view:user@Own` qua được assert rồi nhận
    // TRỌN email + họ tên của mọi thành viên role. Đây là gốc chung của N-1/N-1c/N-1d/N-1e.
    //
    // MỘT lời gọi resolve cho CẢ HAI tầng (KI-070 D11 — phân giải mỗi cặp ĐÚNG MỘT LẦN/request).
    //
    // ⚠️ KHÔNG truyền `opts`: cặp này `is_sensitive = false` (đo PROD 22/08) và route gate bằng
    // `@RequirePermission("view","user")` không cờ + `assertCan(…, false)`. Thêm `{ isSensitive: true }`
    // theo khuôn `foundation/audit` sẽ lọc EXACT non-wildcard ⇒ **403 mọi vai chỉ giữ `*:*` trong im
    // lặng**. Đây là dòng dễ copy sai nhất của cả bản vá.
    const scope = await this.dataScope.resolveOrNull(actor.id, actor.companyId, "view", "user");

    // ⟲ S10-SEC-ROLEMEMBERROW-1 (KI-071) — FAIL-CLOSED, đổi từ fail-soft của KI-053.
    //
    // Vì sao đổi: docstring của chính `resolveOrNull` viết "đừng dùng hàm này cho route mà cặp gate =
    // cặp bound (ở đó `resolveAndAssert` mới đúng, vì `null` nghĩa là guard đã hỏng)". Route này ĐÚNG
    // hình dạng đó — cặp bound (`view:user`) TRÙNG cặp gate. Nhánh cũ ("BỎ cột danh tính, vẫn trả
    // hàng") nay KHÔNG THỂ VỚI TỚI vì tầng HÀNG ném trước, nên nó bị gỡ thay vì để lại code chết.
    // Đây là SIẾT, không phải nới: không ai được thêm quyền, và chỉ với tới được ở ba cửa sổ dưới.
    //
    // BA nguyên nhân phải phân biệt khi trực ca (KHÔNG có K1 ở route này — kill-switch
    // `PERMISSION_GUARD_ENABLED=false` chỉ fail-open `PermissionGuard`, còn `assertCan` ở trên gọi
    // thẳng `permissionService.can()` và KHÔNG đọc cờ đó, nên vai thiếu grant vẫn dừng ở 403 CŨ):
    //   K2 — cửa sổ cache guard 300s: grant/role vừa bị GỠ, hoặc một hàng DENY vừa được THÊM, trong
    //        khi `can()` còn phục vụ tập allow cũ. Quyền đã đổi THẬT ⇒ 403 là ĐÚNG.
    //   K3 — `data_scope` trong DB không chuẩn hoá được ⇒ fail-closed VĨNH VIỄN (không phải cửa sổ).
    //        ⚠️ Hôm nay K3 KHÔNG với tới được: `role_permissions_data_scope_chk` CHECK ép
    //        `data_scope IN (Own,Team,Department,Company,System)` (đo 2026-08-22) ⇒ muốn chạm K3
    //        phải DROP constraint đó trước. GIỮ nhánh phòng thủ, nhưng đừng để người trực ca
    //        đuổi theo một ngõ cụt: kiểm K2/K4 trước.
    //   K4 — lỗi HẠ TẦNG ở câu scope: `resolveStrongestScope` bắt MỌI exception rồi trả `null`, trong
    //        khi `can()` có thể phục vụ hoàn toàn từ cache (`getCompanyRoleGrantsWithScope` là
    //        passthrough KHÔNG cache) ⇒ một timeout riêng ở câu scope biến "200 + che cột" thành 403.
    // Log CỐ Ý không chẩn đoán hộ một nguyên nhân — đối chiếu dòng
    // `resolveStrongestScope() infrastructure error` cùng request trước khi kết luận.
    if (scope === null) {
      this.logger.error(
        "role members: guard + assertCan cho qua nhưng resolveStrongestScope trả null — grant vừa bị " +
          "gỡ/DENY vừa thêm trong cửa sổ cache 300s (K2), data_scope trong DB không chuẩn hoá được " +
          "(K3, vĩnh viễn), HOẶC lỗi hạ tầng ở câu scope trong khi can() phục vụ từ cache (K4)",
        { userId: actor.id, companyId: actor.companyId, roleId },
      );
      // Chuỗi giữ NGUYÊN VĂN của `resolveAndAssert`: trùng `status`/`code`/`type` với 403 của guard,
      // chỉ khác `message`. Cấm làm message giàu thông tin hơn ("scope resolution failed", tên cặp,
      // tên bảng) — đó mới là oracle.
      throw new ForbiddenException("AUTH-ERR-FORBIDDEN: out of permission scope");
    }

    const rowScope = this.rowScopeFor(scope, actor);
    const identity = fromScope(
      this.dataScope.buildUserScopeConditionOn(
        scope,
        { userId: actor.id, companyId: actor.companyId },
        { idCol: users.id, companyIdCol: users.companyId },
      ),
      "identity-gated",
      "GET /auth/roles/:id/members — cột danh tính đi theo data_scope của cặp danh bạ view:user (KI-053)",
      users.id,
    );
    return this.db.withTenant(actor.companyId, async (tx) => {
      if (!(await this.repo.findRoleByIdTx(tx, roleId))) {
        throw new NotFoundException("Role not found");
      }
      const rows = await this.repo.listRoleMembersTx(tx, actor.companyId, roleId, {
        rowScope,
        identity,
      });
      // BỎ HẲN khoá khi ngoài scope — `roleMemberSchema.email` khai `.optional()`, KHÔNG `.nullable()`.
      // Và `identityInScope` là siêu dữ liệu phân quyền của repo: KHÔNG được lọt ra response.
      const members = rows.map(({ identityInScope, email, fullName, ...rest }) =>
        identityInScope ? { ...rest, email: email ?? undefined, fullName } : rest,
      );
      return { members };
    });
  }

  /**
   * S2-AUTH-PERMUX-1 — GET /auth/roles/:id/permissions: toàn bộ grant (ALLOW + DENY) của role.
   * Gate view:permission (non-sensitive — cùng cặp catalog GET /auth/permissions; topology quyền
   * là admin-only theo seed). READ-ONLY. Role lạ/cross-tenant/operator → 404 (mirror listMembers).
   */
  async listRolePermissions(actor: RequestUser, roleId: string): Promise<RolePermissionGrantsDto> {
    await this.assertCan(actor, "view", "permission", false);
    try {
      return await this.db.withTenant(actor.companyId, async (tx) => {
        if (!(await this.repo.findRoleByIdTx(tx, roleId))) {
          throw new NotFoundException("Role not found");
        }
        const rows = await this.repo.listRolePermissionsTx(tx, roleId);
        return {
          grants: rows.map((r) => ({
            action: r.action,
            resourceType: r.resourceType,
            effect: r.effect === "DENY" ? ("DENY" as const) : ("ALLOW" as const),
            dataScope: r.dataScope,
            isSensitive: r.isSensitive,
          })),
        };
      });
    } catch (err) {
      throw this.mapError(err, "Failed to list role permissions");
    }
  }

  // ── (A) create / update role ─────────────────────────────────────────────────

  async createRole(actor: RequestUser, dto: CreateRoleRequest): Promise<RoleWriteResultDto> {
    await this.assertCan(actor, "create", "role", false);
    try {
      return await this.db.withTenant(actor.companyId, async (tx) => {
        const inserted = await this.repo.insertRoleTx(tx, {
          companyId: actor.companyId,
          name: dto.name,
          description: dto.description ?? null,
          // Optional ⇒ client cũ không gửi → false (non-breaking). Chỉ role thường (insert is_system=false).
          requiresTwoFactor: dto.requiresTwoFactor ?? false,
        });

        await this.audit.record(tx, {
          action: "RoleCreated",
          objectType: "role",
          objectId: inserted.id,
          actorUserId: actor.id,
          before: null,
          after: {
            name: inserted.name,
            description: inserted.description,
            requiresTwoFactor: inserted.requiresTwoFactor,
          },
        });

        return toRoleWriteResult(inserted);
      });
    } catch (err) {
      throw this.mapError(err, "Failed to create role");
    }
  }

  async updateRole(
    actor: RequestUser,
    roleId: string,
    dto: UpdateRoleRequest,
  ): Promise<RoleWriteResultDto> {
    await this.assertCan(actor, "update", "role", false);
    try {
      return await this.db.withTenant(actor.companyId, async (tx) => {
        const existing = await this.repo.findRoleByIdTx(tx, roleId);
        if (!existing) {
          throw new NotFoundException("Role not found");
        }
        // system-defined role (is_system=true) → KHÔNG cho sửa (kể cả khi RLS lộ nó cho tenant đọc).
        // Rule này bao trọn requiresTwoFactor: gửi cờ lên system role → REJECT 400 TRƯỚC mọi update/audit.
        if (existing.isSystem) {
          throw new BadRequestException("Cannot modify a system-defined role");
        }
        // RLS WITH CHECK cũng chặn ghi company_id khác-tenant; kiểm tường minh ở app cho lỗi rõ ràng.
        if (existing.companyId !== actor.companyId) {
          throw new NotFoundException("Role not found");
        }

        const patch: { name?: string; description?: string | null; requiresTwoFactor?: boolean } =
          {};
        if (dto.name !== undefined) patch.name = dto.name;
        if (dto.description !== undefined) patch.description = dto.description;
        if (dto.requiresTwoFactor !== undefined) patch.requiresTwoFactor = dto.requiresTwoFactor;

        if (Object.keys(patch).length === 0) {
          return toRoleWriteResult(existing);
        }

        const updated = await this.repo.updateRoleTx(tx, actor.companyId, roleId, patch);
        if (!updated) {
          throw new NotFoundException("Role not found");
        }

        await this.audit.record(tx, {
          action: "RoleUpdated",
          objectType: "role",
          objectId: updated.id,
          actorUserId: actor.id,
          before: {
            name: existing.name,
            description: existing.description,
            requiresTwoFactor: existing.requiresTwoFactor,
          },
          after: {
            name: updated.name,
            description: updated.description,
            requiresTwoFactor: updated.requiresTwoFactor,
          },
        });

        return toRoleWriteResult(updated);
      });
    } catch (err) {
      throw this.mapError(err, "Failed to update role");
    }
  }

  /**
   * DELETE /auth/roles/:id — xoá MỀM 1 role company-scope (BẤT BIẾN #2 — soft-delete, KHÔNG hard-delete),
   * CASCADE gỡ role khỏi MỌI thành viên (soft-delete user_roles). Gate delete:role (seed 0005 is_sensitive=
   * false, company-admin đã có ALLOW/Company). system role (is_system=true) → 400, KHÔNG xoá được (RLS WITH
   * CHECK cũng chặn ghi row company_id NULL). Role lạ/cross-tenant/đã xoá → 404. Ghi audit TRONG CÙNG tx
   * (revokedMembers cho vết forensic). Thành viên MẤT quyền của role NGAY ở request kế (engine đọc thẳng DB).
   */
  async deleteRole(actor: RequestUser, roleId: string): Promise<RoleDeleteResultDto> {
    await this.assertCan(actor, "delete", "role", false);
    try {
      return await this.db.withTenant(actor.companyId, async (tx) => {
        const existing = await this.repo.findRoleByIdTx(tx, roleId);
        if (!existing) {
          throw new NotFoundException("Role not found");
        }
        // system-defined role (is_system=true) → KHÔNG cho xoá (mirror updateRole; RLS chặn thêm ở DB).
        if (existing.isSystem) {
          throw new BadRequestException("Cannot delete a system-defined role");
        }
        // Kiểm tường minh own-tenant (RLS WITH CHECK cũng chặn) — lỗi rõ ràng thay vì 0-row mơ hồ.
        if (existing.companyId !== actor.companyId) {
          throw new NotFoundException("Role not found");
        }

        // CASCADE: gỡ role khỏi mọi thành viên TRƯỚC (soft-delete user_roles) → thu số bị gỡ cho audit.
        const revokedMembers = await this.repo.softDeleteRoleMembersTx(
          tx,
          actor.companyId,
          roleId,
          actor.id,
        );

        const deleted = await this.repo.softDeleteRoleTx(tx, actor.companyId, roleId);
        if (!deleted) {
          // Đua với 1 request xoá khác đã set deleted_at giữa findRoleByIdTx và update → coi như không thấy.
          throw new NotFoundException("Role not found");
        }

        await this.audit.record(tx, {
          action: "RoleDeleted",
          objectType: "role",
          objectId: roleId,
          actorUserId: actor.id,
          before: {
            name: existing.name,
            description: existing.description,
            requiresTwoFactor: existing.requiresTwoFactor,
          },
          after: { deleted: true, revokedMembers },
        });

        return { id: roleId, revokedMembers };
      });
    } catch (err) {
      throw this.mapError(err, "Failed to delete role");
    }
  }

  // ── (B) assign / revoke permission cho role (role_permissions) ────────────────

  async assignPermissionToRole(
    actor: RequestUser,
    roleId: string,
    dto: AssignRolePermissionRequest,
  ) {
    // SCOPE CEILING (fail-closed TRƯỚC mọi DB access): dataScope='System' → 400, 0 row, 0 audit.
    if ((dto.dataScope as string) === MAX_ASSIGNABLE_DATA_SCOPE) {
      throw new BadRequestException(
        "dataScope 'System' is not assignable via role write API (scope ceiling)",
      );
    }
    // ANTI-ESCALATION: assign:permission CHỈ company-admin (isSensitive:true, wildcard KHÔNG kế thừa).
    await this.assertCan(actor, "assign", "permission", true);

    try {
      return await this.db.withTenant(actor.companyId, async (tx) => {
        const role = await this.repo.findRoleByIdTx(tx, roleId);
        if (!role) {
          throw new NotFoundException("Role not found");
        }
        if (role.companyId !== null && role.companyId !== actor.companyId) {
          throw new NotFoundException("Role not found");
        }
        // S6-SEC-1 · S0-B: role hệ thống (kể cả role TOÀN CỤC `company_id IS NULL` mà RLS cố ý lộ cho
        // tenant ĐỌC) là BẤT KHẢ XÂM PHẠM. Thiếu chốt này thì kiểm tra ở trên lọt: role toàn cục có
        // `companyId === null` nên KHÔNG rơi vào nhánh cross-tenant. Mirror `updateRole`/`deleteRole`.
        // Khoá theo CẢ hai điều kiện: `isSystem` VÀ `companyId === null`. Hôm nay hai cái trùng nhau
        // (PROD: 13 role toàn cục đều is_system=true, 7 role tenant đều false) nhưng KHÔNG có CHECK nào
        // ràng buộc điều đó — một migration sau seed role toàn cục với is_system=false là guard hở lại.
        if (role.isSystem || role.companyId === null) {
          throw new BadRequestException("Cannot modify permissions of a system-defined role");
        }

        // Cặp KHÔNG có trong catalog → 400 (KHÔNG 500/FK error).
        const permission = await this.repo.findPermissionTx(tx, dto.action, dto.resourceType);
        if (!permission) {
          throw new BadRequestException(`Unknown permission: ${dto.action}:${dto.resourceType}`);
        }

        const existing = await this.repo.findRolePermissionTx(tx, roleId, permission.id, "ALLOW");
        // Cùng data_scope ⇒ no-op idempotent.
        if (existing && existing.dataScope === dto.dataScope) {
          return {
            roleId,
            permissionId: permission.id,
            action: dto.action,
            resourceType: dto.resourceType,
            effect: "ALLOW" as const,
            dataScope: existing.dataScope,
          };
        }
        // Đổi scope: KHÔNG có UPDATE grant ⇒ DELETE + INSERT.
        if (existing) {
          await this.repo.deleteRolePermissionReturningTx(tx, roleId, permission.id, "ALLOW");
        }

        const inserted = await this.repo.insertRolePermissionTx(tx, {
          roleId,
          permissionId: permission.id,
          effect: "ALLOW",
          dataScope: dto.dataScope,
        });
        if (!inserted) {
          throw new ConflictException("Permission grant already exists");
        }

        await this.audit.record(tx, {
          action: existing ? "PermissionReassigned" : "PermissionAssigned",
          objectType: "role_permission",
          objectId: roleId,
          actorUserId: actor.id,
          before: existing
            ? {
                action: dto.action,
                resourceType: dto.resourceType,
                effect: "ALLOW",
                dataScope: existing.dataScope,
              }
            : null,
          after: {
            action: dto.action,
            resourceType: dto.resourceType,
            effect: "ALLOW",
            dataScope: dto.dataScope,
          },
        });

        return {
          roleId,
          permissionId: permission.id,
          action: dto.action,
          resourceType: dto.resourceType,
          effect: "ALLOW" as const,
          dataScope: dto.dataScope,
        };
      });
    } catch (err) {
      throw this.mapError(err, "Failed to assign permission to role");
    }
  }

  async revokePermissionFromRole(
    actor: RequestUser,
    roleId: string,
    dto: RevokeRolePermissionRequest,
  ) {
    await this.assertCan(actor, "assign", "permission", true);

    try {
      await this.db.withTenant(actor.companyId, async (tx) => {
        const role = await this.repo.findRoleByIdTx(tx, roleId);
        if (!role) {
          throw new NotFoundException("Role not found");
        }
        if (role.companyId !== null && role.companyId !== actor.companyId) {
          throw new NotFoundException("Role not found");
        }
        // S6-SEC-1 · S0-B — xem chú thích ở assignPermissionToRole. Nhánh REVOKE là nhánh ĐÃ BỊ KHAI
        // THÁC được trong bản RED: nó xoá thật grant của role hệ thống toàn cục và KHÔNG hoàn tác
        // được qua app (WITH CHECK chặn INSERT khôi phục).
        // Khoá theo CẢ hai điều kiện: `isSystem` VÀ `companyId === null`. Hôm nay hai cái trùng nhau
        // (PROD: 13 role toàn cục đều is_system=true, 7 role tenant đều false) nhưng KHÔNG có CHECK nào
        // ràng buộc điều đó — một migration sau seed role toàn cục với is_system=false là guard hở lại.
        if (role.isSystem || role.companyId === null) {
          throw new BadRequestException("Cannot modify permissions of a system-defined role");
        }

        const permission = await this.repo.findPermissionTx(tx, dto.action, dto.resourceType);
        if (!permission) {
          throw new BadRequestException(`Unknown permission: ${dto.action}:${dto.resourceType}`);
        }

        const deleted = await this.repo.deleteRolePermissionReturningTx(
          tx,
          roleId,
          permission.id,
          "ALLOW",
        );
        if (!deleted) {
          throw new NotFoundException("Role does not have this permission");
        }

        await this.audit.record(tx, {
          action: "PermissionRevoked",
          objectType: "role_permission",
          objectId: roleId,
          actorUserId: actor.id,
          before: {
            action: dto.action,
            resourceType: dto.resourceType,
            effect: "ALLOW",
            dataScope: deleted.dataScope,
          },
        });
      });
    } catch (err) {
      throw this.mapError(err, "Failed to revoke permission from role");
    }
  }

  // ── (C.rule) S2-AUTH-PERMRULE-1 — gán quyền theo LUẬT khớp mẫu ────────────────

  /**
   * POST /auth/roles/:id/permissions/apply-rule — bung 1 luật (match catalog × action-preset × scope)
   * thành tập grant, xem trước (dryRun) hoặc áp. KHÔNG cổng ghi mới: áp qua assignPermissionToRole
   * (assign:permission isSensitive + scope-ceiling + audit từng grant). Bất biến giữ nguyên:
   *  - Gate assign:permission (chỉ company-admin) fail-closed TRƯỚC DB.
   *  - System role → 400 (mirror update/delete; RLS role_permissions cũng chặn ghi company_id NULL).
   *  - Cross-tenant → 404. Scope ≤ Company (Zod). effect chỉ ALLOW.
   *  - Chống leo-thang: loại sensitive mặc định + CHẶN (includeSensitive && mọi-resource) → 400.
   *  - dryRun ⇒ 0 ghi, 0 audit. !dryRun ⇒ áp tuần tự + 1 summary audit (objectType role_permission).
   */
  async applyPermissionRuleToRole(
    actor: RequestUser,
    roleId: string,
    dto: ApplyPermissionRuleRequest,
  ): Promise<PermissionRulePreview> {
    await this.assertCan(actor, "assign", "permission", true);

    // Lan can matcher (BadRequest, 0 DB access):
    if (dto.match.actionPreset === "custom" && dto.match.actions.length === 0) {
      throw new BadRequestException("Luật 'tuỳ chọn' phải chọn ít nhất một hành động (action)");
    }
    if (dto.match.includeSensitive && dto.match.resourceTypes.length === 0) {
      throw new BadRequestException(
        "Luật gồm quyền nhạy cảm phải giới hạn resourceType cụ thể (không áp cho mọi tài nguyên)",
      );
    }

    try {
      // Bung + diff (READ-ONLY) trong 1 withTenant: role-guard + catalog + grants hiện có.
      const plan = await this.db.withTenant(actor.companyId, async (tx) => {
        const role = await this.repo.findRoleByIdTx(tx, roleId);
        if (!role) {
          throw new NotFoundException("Role not found");
        }
        if (role.isSystem) {
          throw new BadRequestException("Cannot apply a rule to a system-defined role");
        }
        if (role.companyId !== actor.companyId) {
          throw new NotFoundException("Role not found");
        }
        const catalog = await this.permissionCatalog.listPermissionsTx(tx);
        const grants = await this.repo.listRolePermissionsTx(tx, roleId);
        return this.buildRulePlan(dto, catalog, grants);
      });

      // Trần bung (chống unbounded — security MED): tổng thay đổi (thêm + đổi scope) vượt trần → 400,
      // buộc thu hẹp tài nguyên/hành động. Chặn CẢ dryRun để admin biết sớm (KHÔNG áp mù hàng trăm cặp).
      const changeTotal = plan.counts.toAdd + plan.counts.toChangeScope;
      if (changeTotal > MAX_RULE_GRANTS) {
        throw new BadRequestException(
          `Luật khớp quá nhiều quyền (${changeTotal}) — hãy thu hẹp tài nguyên hoặc hành động (tối đa ${MAX_RULE_GRANTS} mỗi lần).`,
        );
      }

      // dryRun → preview thuần, KHÔNG ghi/audit.
      if (dto.dryRun) {
        return { dryRun: true, ...plan, applied: null };
      }

      // Áp tuần tự toAdd ∪ toChangeScope qua assignPermissionToRole (audit + anti-escalation cổng cuối).
      const applied: NonNullable<PermissionRulePreview["applied"]> = [];
      let addedOk = 0;
      let changedOk = 0;
      const apply = async (
        p: { action: string; resourceType: string },
        onOk: () => void,
      ): Promise<void> => {
        try {
          await this.assignPermissionToRole(actor, roleId, {
            action: p.action,
            resourceType: p.resourceType,
            dataScope: dto.dataScope,
          });
          applied.push({
            action: p.action,
            resourceType: p.resourceType,
            status: "ok",
            detail: null,
          });
          onOk();
        } catch (err) {
          applied.push({
            action: p.action,
            resourceType: p.resourceType,
            status: "error",
            detail: this.mapError(err, "assign").message,
          });
        }
      };
      for (const p of plan.toAdd) await apply(p, () => (addedOk += 1));
      for (const p of plan.toChangeScope) await apply(p, () => (changedOk += 1));

      // Summary-audit — CHỈ khi !dryRun. objectType 'role_permission' (thành viên union hợp lệ). withTenant
      // riêng. BEST-EFFORT (security LOW): grant đã COMMIT + đã audit riêng từng cái (PermissionAssigned)
      // → lỗi ghi summary KHÔNG được làm 500 che partial success; log cảnh báo, vẫn trả applied[].
      try {
        await this.db.withTenant(actor.companyId, (tx) =>
          this.audit.record(tx, {
            action: "RolePermissionRuleApplied",
            objectType: "role_permission",
            objectId: roleId,
            actorUserId: actor.id,
            after: {
              resourceTypes: dto.match.resourceTypes,
              actionPreset: dto.match.actionPreset,
              effect: dto.effect,
              dataScope: dto.dataScope,
              addedCount: addedOk,
              changedCount: changedOk,
              errorCount: applied.filter((a) => a.status === "error").length,
            },
          }),
        );
      } catch (err) {
        this.logger.warn(
          `applyPermissionRuleToRole: ghi summary-audit thất bại (grant đã áp + đã audit riêng): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      return { dryRun: false, ...plan, applied };
    } catch (err) {
      throw this.mapError(err, "Failed to apply permission rule");
    }
  }

  /**
   * Bung luật thuần (KHÔNG DB) → diff so grants hiện có. Tách riêng để unit test không cần DB.
   * DENY ưu tiên (skip TRƯỚC — deny-overrides luôn thắng, ghi ALLOW là churn vô nghĩa). Action theo
   * MẪU TÊN (regex) để bắt cả verb-suffix của ATT/LEAVE (view-own/view-team/view-company).
   */
  private buildRulePlan(
    dto: ApplyPermissionRuleRequest,
    catalog: Array<{ action: string; resourceType: string; isSensitive: boolean }>,
    grants: Array<{ action: string; resourceType: string; effect: string; dataScope: string }>,
  ): Omit<PermissionRulePreview, "dryRun" | "applied"> {
    const { match } = dto;
    const resourceSet = match.resourceTypes.length ? new Set(match.resourceTypes) : null;
    const actionMatches = (action: string): boolean => {
      if (match.actionPreset === "custom") return match.actions.includes(action);
      if (match.actionPreset === "read-only") return READ_ONLY_ACTION_RE.test(action);
      return CRUD_ACTION_RE.test(action);
    };

    const allowScopeByPair = new Map<string, string>();
    const denyPairs = new Set<string>();
    for (const g of grants) {
      const k = `${g.action}:${g.resourceType}`;
      if (g.effect === "ALLOW") allowScopeByPair.set(k, g.dataScope);
      else denyPairs.add(k);
    }

    const toAdd: PermissionRulePreview["toAdd"] = [];
    const toChangeScope: PermissionRulePreview["toChangeScope"] = [];
    const skipped: PermissionRulePreview["skipped"] = [];
    const excludedSensitive: PermissionRulePreview["excludedSensitive"] = [];

    for (const p of catalog) {
      if (resourceSet && !resourceSet.has(p.resourceType)) continue;
      if (!actionMatches(p.action)) continue;
      const base = { action: p.action, resourceType: p.resourceType, isSensitive: p.isSensitive };
      if (p.isSensitive && !match.includeSensitive) {
        excludedSensitive.push(base);
        continue;
      }
      const k = `${p.action}:${p.resourceType}`;
      if (denyPairs.has(k)) {
        skipped.push({ ...base, reason: "denied" });
        continue;
      }
      const cur = allowScopeByPair.get(k);
      if (cur === undefined) {
        toAdd.push({ ...base, dataScope: dto.dataScope });
      } else if (cur === dto.dataScope) {
        skipped.push({ ...base, reason: "already-granted" });
      } else {
        toChangeScope.push({ ...base, fromScope: cur, toScope: dto.dataScope });
      }
    }

    return {
      toAdd,
      toChangeScope,
      skipped,
      excludedSensitive,
      counts: {
        toAdd: toAdd.length,
        toChangeScope: toChangeScope.length,
        skipped: skipped.length,
        excludedSensitive: excludedSensitive.length,
      },
    };
  }

  // ── internals ─────────────────────────────────────────────────────────────────

  /**
   * Fail-closed gate — company-level explicit ALLOW đủ (KHÔNG cần object-grant).
   * isSensitive=true (assign:permission) ⇒ wildcard `*:*` KHÔNG kế thừa, cần ALLOW tường minh.
   * isSensitive=false (create/update:role — catalog is_sensitive=false, mig 0005) ⇒ wildcard hợp lệ,
   * khớp hành vi @RequirePermission không kèm { isSensitive:true } ở các controller khác (auth-users…).
   */
  private async assertCan(
    actor: RequestUser,
    action: string,
    resourceType: string,
    isSensitive: boolean,
  ): Promise<void> {
    const decision = await this.permissionService.can({
      userId: actor.id,
      companyId: actor.companyId,
      action,
      resourceType,
      resourceId: null,
      isSensitive,
      objectGrantRequired: false,
    });
    if (!decision.allow) {
      throw new ForbiddenException(`Insufficient permission: ${action}:${resourceType}`);
    }
  }

  /** PG/infra → 500 generic (KHÔNG leak schema); FK/unique/check → 4xx; HttpException giữ nguyên. */
  private mapError(err: unknown, context: string): HttpException {
    if (err instanceof HttpException) return err;
    const code = pgErrorCode(err);
    if (code === PG_FK_VIOLATION) {
      return new BadRequestException("Referenced entity does not exist");
    }
    if (code === PG_UNIQUE_VIOLATION) {
      return new ConflictException("Role name already exists");
    }
    if (code === PG_CHECK_VIOLATION) {
      return new BadRequestException("Invalid role write");
    }
    this.logger.error(context, {
      stack: err instanceof Error ? err.stack : String(err),
      pgCode: code,
      pgDetail: pgErrorField(err, "detail"),
      pgConstraint: pgErrorField(err, "constraint"),
    });
    return new InternalServerErrorException(context);
  }
}
