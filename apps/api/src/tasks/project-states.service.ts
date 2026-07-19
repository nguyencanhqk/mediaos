import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateProjectStateRequest,
  UpdateProjectStateRequest,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { PermissionService } from "../permission/permission.service";
import { TasksRepository } from "./tasks.repository";
import { ProjectAccessService } from "./project-access.service";

interface RequestUser {
  id: string;
  companyId: string;
}

const ERR_STATE_FORBIDDEN =
  "TASK-ERR-PROJECT-FORBIDDEN: chỉ Owner/Manager của dự án mới được quản lý cột pipeline.";

/**
 * PM-1 (apps/projects, mig 0420) — vòng đời project_states (trạng thái tùy biến theo project).
 *
 * House style: business logic ở service, mọi mutation qua db.withTenant + audit-in-tx (objectType
 * 'project_state'), company_id ở MỌI where (defense-in-depth ngoài RLS), SEC-1 tenant-FK guard TRƯỚC
 * insert (project phải cùng tenant), soft-delete (KHÔNG hard-delete), ≤1 default/project.
 */
@Injectable()
export class ProjectStatesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TasksRepository,
    private readonly audit: AuditService,
    // S5-TASK-PROJROLE-1 (D-28) - tang role per-project cho CUD cot pipeline.
    private readonly permission: PermissionService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /**
   * D-28 (DECISIONS-04, SPEC-06 §9 note): actor có cặp `project_state` ở scope < Company ⇒ PHẢI là
   * Active member Owner/Manager của ĐÚNG project chứa cột; Company/System bypass (§18.6.8). Với seed
   * hiện tại mọi grant project_state đều Company ⇒ tầng này DORMANT/defense-in-depth cho role thật —
   * chỉ kích hoạt khi tương lai có grant scope hẹp. GET list KHÔNG qua đây (đọc giữ hành vi cũ).
   * actorEmployeeId truyền null: member row luôn có user_id (NOT NULL) ⇒ predicate user_id đủ định danh.
   */
  private async assertStateRoleLayer(
    tx: TenantTx,
    user: RequestUser,
    action: "create" | "update" | "delete",
    projectId: string,
  ): Promise<void> {
    const scope = await this.permission.resolveStrongestScope(
      user.id,
      user.companyId,
      action,
      "project_state",
    );
    // Guard route đã chặn thiếu grant; null ở đây = bất thường ⇒ fail-closed (defense-in-depth).
    if (scope === null) throw new ForbiddenException(ERR_STATE_FORBIDDEN);
    if (scope !== "Company" && scope !== "System") {
      await this.projectAccess.assertProjectRoleTx(
        tx,
        user,
        projectId,
        null,
        ["Owner", "Manager"],
        ERR_STATE_FORBIDDEN,
      );
    }
  }

  /** Liệt kê state của 1 project. SEC-1: project phải tồn tại + cùng tenant (chặn chéo tenant qua path). */
  async listStates(companyId: string, projectId: string) {
    await this.db.withTenant(companyId, async (tx) => {
      const ok = await this.repo.projectExistsTx(tx, companyId, projectId);
      if (!ok) throw new NotFoundException(`Project not found: ${projectId}`);
    });
    return this.repo.listStatesByProject(companyId, projectId);
  }

  async createState(user: RequestUser, projectId: string, dto: CreateProjectStateRequest) {
    return this.db.withTenant(user.companyId, async (tx) => {
      const ok = await this.repo.projectExistsTx(tx, user.companyId, projectId);
      if (!ok) throw new NotFoundException(`Project not found: ${projectId}`);
      await this.assertStateRoleLayer(tx, user, "create", projectId);

      const [created] = await this.repo.createStateTx(
        user.companyId,
        {
          projectId,
          name: dto.name,
          stateGroup: dto.stateGroup,
          color: dto.color,
          sortOrder: dto.sortOrder,
        },
        tx,
      );
      if (!created) throw new InternalServerErrorException("Failed to create project state");

      await this.audit.record(tx, {
        action: "ProjectStateCreated",
        objectType: "project_state",
        objectId: created.id,
        actorUserId: user.id,
        after: { projectId, name: dto.name, stateGroup: dto.stateGroup },
      });
      return created;
    });
  }

  async updateState(user: RequestUser, stateId: string, dto: UpdateProjectStateRequest) {
    return this.db.withTenant(user.companyId, async (tx) => {
      const [existing] = await this.repo.findStateByIdTx(tx, user.companyId, stateId);
      if (!existing) throw new NotFoundException(`Project state not found: ${stateId}`);
      await this.assertStateRoleLayer(tx, user, "update", existing.projectId);

      const [updated] = await this.repo.updateStateTx(
        user.companyId,
        stateId,
        {
          name: dto.name,
          stateGroup: dto.stateGroup,
          color: dto.color,
          sortOrder: dto.sortOrder,
          isDefault: dto.isDefault,
        },
        tx,
      );
      if (!updated) throw new InternalServerErrorException("Failed to update project state");

      // ≤1 default/project: khi set default=true, bỏ cờ mọi state KHÁC cùng project trong CÙNG tx.
      if (dto.isDefault === true) {
        await this.repo.clearOtherDefaultsTx(user.companyId, existing.projectId, stateId, tx);
      }

      await this.audit.record(tx, {
        action: "ProjectStateUpdated",
        objectType: "project_state",
        objectId: stateId,
        actorUserId: user.id,
        after: { changed: Object.keys(dto) },
      });
      return updated;
    });
  }

  /**
   * Soft-delete state. Chặn xoá nếu còn task tham chiếu (block 400 — tránh để task mồ côi không-state).
   */
  async deleteState(user: RequestUser, stateId: string) {
    await this.db.withTenant(user.companyId, async (tx) => {
      const [existing] = await this.repo.findStateByIdTx(tx, user.companyId, stateId);
      if (!existing) throw new NotFoundException(`Project state not found: ${stateId}`);
      await this.assertStateRoleLayer(tx, user, "delete", existing.projectId);

      const inUse = await this.repo.countTasksByStateTx(tx, user.companyId, stateId);
      if (inUse > 0) {
        throw new BadRequestException(
          `Không thể xoá trạng thái đang được ${inUse} công việc sử dụng. Hãy chuyển công việc sang trạng thái khác trước.`,
        );
      }

      const [deleted] = await this.repo.softDeleteStateTx(user.companyId, stateId, tx);
      if (!deleted) throw new NotFoundException(`Project state not found: ${stateId}`);

      await this.audit.record(tx, {
        action: "ProjectStateDeleted",
        objectType: "project_state",
        objectId: stateId,
        actorUserId: user.id,
      });
    });
  }
}
