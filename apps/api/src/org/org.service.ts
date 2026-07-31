import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  AddTeamMemberRequest,
  AssignTeamLeaderRequest,
  CreateOrgUnitRequest,
  CreateTeamRequest,
  UpdateOrgUnitRequest,
  UpdateTeamRequest,
} from "@mediaos/contracts";
import { OrgRepository } from "./org.repository";
import { isUniqueViolation } from "../common/db-error";
import { DataScopeService } from "../permission/data-scope.service";
import { ORG_EMPLOYEE_DIRECTORY } from "./org.permissions";

/** Actor tối thiểu cho đường đọc có scope (khớp `req.user` của JwtAuthGuard). */
interface DirectoryActor {
  id: string;
  companyId: string;
}

@Injectable()
export class OrgService {
  private readonly logger = new Logger(OrgService.name);

  constructor(
    private readonly repo: OrgRepository,
    // S6-SEC-ORGSCOPE-1 (N-1): DataScopeService export sẵn từ PermissionModule, OrgModule đã import
    // module đó cho PermissionGuard ⇒ không cần đổi wiring.
    private readonly dataScope: DataScopeService,
  ) {}

  // ── Org Units ────────────────────────────────────────────────────────────────

  listOrgUnits(companyId: string, status?: string) {
    return this.repo.listOrgUnits(companyId, status);
  }

  getOrgTree(companyId: string) {
    return this.repo.getOrgTree(companyId);
  }

  async createOrgUnit(companyId: string, dto: CreateOrgUnitRequest) {
    let unit: Awaited<ReturnType<OrgRepository["createOrgUnit"]>>[number];
    try {
      const rows = await this.repo.createOrgUnit(companyId, {
        name: dto.name,
        type: dto.type ?? "department",
        code: dto.code ?? null,
        description: dto.description ?? null,
        parentId: dto.parentId ?? null,
        headUserId: dto.headUserId ?? null,
      });
      if (!rows[0]) throw new InternalServerErrorException("Failed to create department");
      unit = rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException("Department name or code already exists");
      }
      throw err;
    }

    return unit;
  }

  async updateOrgUnit(companyId: string, id: string, dto: UpdateOrgUnitRequest) {
    try {
      const rows = await this.repo.updateOrgUnit(companyId, id, {
        name: dto.name,
        type: dto.type,
        code: dto.code,
        description: dto.description,
        parentId: dto.parentId,
        headUserId: dto.headUserId,
        status: dto.status,
      });
      if (!rows[0]) throw new NotFoundException("Department not found");
      return rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException("Department name or code already exists");
      }
      throw err;
    }
  }

  async deleteOrgUnit(companyId: string, id: string) {
    const rows = await this.repo.softDeleteOrgUnit(companyId, id);
    if (rows.length === 0) throw new NotFoundException("Department not found");
  }

  // ── Teams ────────────────────────────────────────────────────────────────────

  /**
   * S6-SEC-IDENTITYBOUND-1 (N-1e, KI-052) — `leaderUserName` bound theo scope của cặp danh bạ.
   *
   * Cùng khuôn `listTeamMembers` (N-1c): `read:team` giữ nguyên việc quyết định truy cập *tài nguyên
   * team*; riêng cột danh tính người đi theo `view:user`. `resolveOrNull` chứ không `resolveAndAssert`
   * — role giữ `read:team` mà không có cặp danh bạ (`hr-manager` seeded) vẫn phải xem được danh sách
   * team, chỉ là không nhận tên trưởng nhóm.
   */
  async listTeams(actor: DirectoryActor, status?: string) {
    const scope = await this.dataScope.resolveOrNull(
      actor.id,
      actor.companyId,
      ORG_EMPLOYEE_DIRECTORY.action,
      ORG_EMPLOYEE_DIRECTORY.resourceType,
    );
    if (scope === null) {
      this.logger.warn(
        "teams: actor không có grant nào cho cặp danh bạ → BỎ cột tên trưởng nhóm của mọi hàng",
        { userId: actor.id, companyId: actor.companyId },
      );
    }
    const identityCond =
      scope === null
        ? null
        : this.dataScope.buildUserScopeCondition(scope, {
            userId: actor.id,
            companyId: actor.companyId,
          });
    const rows = await this.repo.listTeams(actor.companyId, status, identityCond);
    return rows.map(({ identityInScope, leaderUserName, ...rest }) =>
      identityInScope ? { ...rest, leaderUserName } : rest,
    );
  }

  async createTeam(companyId: string, dto: CreateTeamRequest) {
    try {
      const rows = await this.repo.createTeam(companyId, {
        name: dto.name,
        orgUnitId: dto.orgUnitId ?? null,
        code: dto.code ?? null,
        type: dto.type ?? "production_team",
        leaderUserId: dto.leaderUserId ?? null,
        description: dto.description ?? null,
        capacity: dto.capacity ?? null,
      });
      if (!rows[0]) throw new InternalServerErrorException("Failed to create team");
      return rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException("Team name or code already exists");
      }
      throw err;
    }
  }

  async updateTeam(companyId: string, id: string, dto: UpdateTeamRequest) {
    try {
      const rows = await this.repo.updateTeam(companyId, id, {
        name: dto.name,
        orgUnitId: dto.orgUnitId,
        code: dto.code,
        type: dto.type,
        leaderUserId: dto.leaderUserId,
        description: dto.description,
        capacity: dto.capacity,
        status: dto.status,
      });
      if (!rows[0]) throw new NotFoundException("Team not found");
      return rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException("Team name or code already exists");
      }
      throw err;
    }
  }

  async assignTeamLeader(companyId: string, teamId: string, dto: AssignTeamLeaderRequest) {
    const rows = await this.repo.updateTeam(companyId, teamId, {
      leaderUserId: dto.leaderId,
    });
    if (!rows[0]) throw new NotFoundException("Team not found");
    return rows[0];
  }

  async deleteTeam(companyId: string, id: string) {
    const rows = await this.repo.softDeleteTeam(companyId, id);
    if (rows.length === 0) throw new NotFoundException("Team not found");
  }

  // ── Team Members ──────────────────────────────────────────────────────────────

  /**
   * S6-SEC-ORGTEAMSCOPE-1 (N-1c, KI-049) — danh sách thành viên team, danh tính BOUND theo scope danh bạ.
   *
   * Route trả HAI lớp dữ liệu và chúng có HAI chủ quyền khác nhau:
   *   • quan hệ thành viên (`teamId`/`userId`/`roleName`/`joinedAt`) → `read:team`, guard đã gate.
   *   • danh tính người (`userFullName`/`userEmail`) → cặp danh bạ `ORG_EMPLOYEE_DIRECTORY`.
   *
   * Trước WO này chỉ có vế thứ nhất ⇒ **cặp gate (`team`) LỆCH cặp của lớp dữ liệu (`user`)**: một role
   * giữ `read:team` mà KHÔNG có `view:user` nào đọc được email của mọi thành viên mọi team. Đo PROD
   * 2026-07-29: role SEEDED `hr-manager` đúng hình dạng đó — nó bị 403 ở `/org/employees` lại lấy được
   * danh bạ qua cửa này. Cùng lớp lỗi N-1 (`/org/employees`) và cùng bài học
   * `read-path-gate-pair-must-match-download-pair`.
   *
   * CỐ Ý KHÔNG định nghĩa ngữ nghĩa `Own`/`Team`/`Department` mới cho `teams` (plan §3.1): làm vậy là
   * đẻ ra hành vi thứ hai cho CÙNG lớp dữ liệu, đúng điều N-1 đã tránh. Ở đây tái dùng nguyên vị từ
   * hình-`users` của danh bạ.
   *
   * Ngoài scope ⇒ **BỎ HẲN KHOÁ** (không trả `null`): contract `teamMemberSchema` khai
   * `userEmail: z.string().email().optional()` — không `.nullable()`.
   */
  async listTeamMembers(actor: DirectoryActor, teamId: string) {
    // `resolveOrNull`, KHÔNG `resolveAndAssert`: thiếu cặp danh bạ KHÔNG được biến thành 403 cả route
    // — `read:team` vẫn cho phép xem vế quan hệ (owner chốt 2026-07-29, plan §3.2 đường A).
    const scope = await this.dataScope.resolveOrNull(
      actor.id,
      actor.companyId,
      ORG_EMPLOYEE_DIRECTORY.action,
      ORG_EMPLOYEE_DIRECTORY.resourceType,
    );
    if (scope === null) {
      // Nhánh fail-closed phải để lại dấu vết. `buildUserScopeCondition` đã tự log cho
      // Team/Department; ca "không grant nào" không đi qua đó nên log ở đây, nếu không admin thấy
      // cột danh tính trống mà không có đường chẩn (đúng F1 của FULL gate N-1).
      this.logger.warn(
        "team members: actor không có grant nào cho cặp danh bạ → BỎ cột danh tính của mọi hàng",
        { userId: actor.id, companyId: actor.companyId, teamId },
      );
    }
    const identityCond =
      scope === null
        ? null
        : this.dataScope.buildUserScopeCondition(scope, {
            userId: actor.id,
            companyId: actor.companyId,
          });
    const rows = await this.repo.listTeamMembers(actor.companyId, teamId, identityCond);
    return rows.map(({ identityInScope, userFullName, userEmail, ...rest }) =>
      identityInScope ? { ...rest, userFullName, userEmail } : rest,
    );
  }

  async addTeamMember(companyId: string, teamId: string, dto: AddTeamMemberRequest) {
    try {
      const rows = await this.repo.addTeamMember(companyId, teamId, {
        userId: dto.userId,
        roleName: dto.roleName,
      });
      if (!rows[0]) throw new InternalServerErrorException("Failed to add team member");
      return rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException("User is already an active member of this team");
      }
      throw err;
    }
  }

  async removeTeamMember(companyId: string, teamId: string, userId: string) {
    const rows = await this.repo.removeTeamMember(companyId, teamId, userId);
    if (rows.length === 0) throw new NotFoundException("Team member not found");
  }

  /**
   * S6-SEC-ORGSCOPE-1 (N-1) — danh bạ tài khoản, BOUND theo `data_scope`.
   *
   * `PermissionGuard` đã gate `ORG_EMPLOYEE_DIRECTORY` TRƯỚC; ở đây resolve scope MẠNH NHẤT của
   * ĐÚNG cặp đó rồi thu hẹp hàng. Trước WO này repo chỉ `withTenant` ⇒ role scope Own/Team/Department
   * (role-admin đúc được — ceiling chỉ chặn `System`) qua guard rồi nhận TRỌN danh bạ kèm email.
   *
   * `resolveAndAssert` ném 403 khi không có grant nào. Về lý thuyết guard đã chặn trước đó; giữ ở đây
   * là defense-in-depth cho mọi caller tương lai KHÔNG đi qua controller này.
   */
  async listEmployees(actor: DirectoryActor) {
    const scope = await this.dataScope.resolveAndAssert(
      actor.id,
      actor.companyId,
      ORG_EMPLOYEE_DIRECTORY.action,
      ORG_EMPLOYEE_DIRECTORY.resourceType,
    );
    // Vị từ hình-`users` (KHÔNG join employee_profiles): user chưa có hồ sơ nhân sự vẫn phải liệt kê
    // được ở scope Company — màn RBAC của console dùng chính route này làm danh sách subject gán role.
    const scopeCond = this.dataScope.buildUserScopeCondition(scope, {
      userId: actor.id,
      companyId: actor.companyId,
    });
    return this.repo.listEmployees(actor.companyId, scopeCond);
  }

  // ── Roles ──────────────────────────────────────────────────────────────────────

  listRoles(companyId: string) {
    return this.repo.listRoles(companyId);
  }
}
