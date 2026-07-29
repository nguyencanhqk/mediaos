import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
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

  listTeams(companyId: string, status?: string) {
    return this.repo.listTeams(companyId, status);
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

  listTeamMembers(companyId: string, teamId: string) {
    return this.repo.listTeamMembers(companyId, teamId);
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
