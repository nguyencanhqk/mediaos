import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type { CreateLabelRequest, UpdateLabelRequest } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { TasksRepository } from "./tasks.repository";

interface RequestUser {
  id: string;
  companyId: string;
}

const PG_UNIQUE_VIOLATION = "23505";

function pgErrorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as Record<string, unknown>)["code"];
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * PM-1 (apps/projects, mig 0420) — vòng đời labels (nhãn màu theo project) + gán/gỡ nhãn cho work item.
 *
 * House style: business logic ở service, mọi mutation qua db.withTenant + audit-in-tx, company_id ở MỌI
 * where, SEC-1 tenant-FK guard TRƯỚC insert, soft-delete cho labels. task_labels là link M:N → hard-DELETE
 * khi gỡ (idempotent add nhờ unique). Gán nhãn audit objectType 'task' (sửa work-item TÁI DÙNG 'task').
 */
@Injectable()
export class LabelsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TasksRepository,
    private readonly audit: AuditService,
  ) {}

  async listLabels(companyId: string, projectId: string) {
    await this.db.withTenant(companyId, async (tx) => {
      const ok = await this.repo.projectExistsTx(tx, companyId, projectId);
      if (!ok) throw new NotFoundException(`Project not found: ${projectId}`);
    });
    return this.repo.listLabelsByProject(companyId, projectId);
  }

  async createLabel(user: RequestUser, projectId: string, dto: CreateLabelRequest) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const ok = await this.repo.projectExistsTx(tx, user.companyId, projectId);
        if (!ok) throw new NotFoundException(`Project not found: ${projectId}`);

        const [created] = await this.repo.createLabelTx(
          user.companyId,
          { projectId, name: dto.name, color: dto.color, createdBy: user.id },
          tx,
        );
        if (!created) throw new InternalServerErrorException("Failed to create label");

        await this.audit.record(tx, {
          action: "LabelCreated",
          objectType: "label",
          objectId: created.id,
          actorUserId: user.id,
          after: { projectId, name: dto.name },
        });
        return created;
      });
    } catch (err) {
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
        throw new ConflictException("Nhãn cùng tên đã tồn tại trong dự án này.");
      }
      throw err;
    }
  }

  async updateLabel(user: RequestUser, labelId: string, dto: UpdateLabelRequest) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const [existing] = await this.repo.findLabelByIdTx(tx, user.companyId, labelId);
        if (!existing) throw new NotFoundException(`Label not found: ${labelId}`);

        const [updated] = await this.repo.updateLabelTx(
          user.companyId,
          labelId,
          { name: dto.name, color: dto.color },
          tx,
        );
        if (!updated) throw new InternalServerErrorException("Failed to update label");

        await this.audit.record(tx, {
          action: "LabelUpdated",
          objectType: "label",
          objectId: labelId,
          actorUserId: user.id,
          after: { changed: Object.keys(dto) },
        });
        return updated;
      });
    } catch (err) {
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
        throw new ConflictException("Nhãn cùng tên đã tồn tại trong dự án này.");
      }
      throw err;
    }
  }

  async deleteLabel(user: RequestUser, labelId: string) {
    await this.db.withTenant(user.companyId, async (tx) => {
      const [existing] = await this.repo.findLabelByIdTx(tx, user.companyId, labelId);
      if (!existing) throw new NotFoundException(`Label not found: ${labelId}`);

      const [deleted] = await this.repo.softDeleteLabelTx(user.companyId, labelId, tx);
      if (!deleted) throw new NotFoundException(`Label not found: ${labelId}`);

      await this.audit.record(tx, {
        action: "LabelDeleted",
        objectType: "label",
        objectId: labelId,
        actorUserId: user.id,
      });
    });
  }
}
