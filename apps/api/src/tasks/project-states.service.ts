import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateProjectStateRequest,
  UpdateProjectStateRequest,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { TasksRepository } from "./tasks.repository";

interface RequestUser {
  id: string;
  companyId: string;
}

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
  ) {}

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
