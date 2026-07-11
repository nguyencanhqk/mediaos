import { Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import type {
  CreateTaskChecklistItemRequest,
  CreateTaskChecklistRequest,
  DataScope,
  TaskChecklistItemResponseDto,
  TaskChecklistResponseDto,
  UpdateTaskChecklistItemRequest,
  UpdateTaskChecklistRequest,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { DataScopeService } from "../permission/data-scope.service";
import { TaskCoreRepository, type TaskCoreRow } from "./task-core.repository";
import {
  TaskChecklistsRepository,
  type TaskChecklistItemRow,
  type TaskChecklistRow,
} from "./task-checklists.repository";
import { TaskActivityService } from "./task-activity.service";

interface RequestUser {
  id: string;
  companyId: string;
}

const ERR = {
  TASK_NOT_FOUND: "TASK-ERR-TASK-NOT-FOUND: không tìm thấy công việc.",
  CHECKLIST_NOT_FOUND: "TASK-ERR-CHECKLIST-NOT-FOUND: không tìm thấy checklist.",
  ITEM_NOT_FOUND: "TASK-ERR-CHECKLIST-ITEM-NOT-FOUND: không tìm thấy hạng mục checklist.",
} as const;

/**
 * S4-TASK-BE-4 — TaskChecklistsService (SPEC-06 §14.16, API-06 §17 · TASK-API-501..504 + items §17.5-17.7).
 *
 * Gate `update:task` cho MỌI route mutate (checklist LẪN item) — OWNER CHỐT ở seed 0485 comment "KHÔNG
 * cặp 'checklist' riêng (gate bằng update:task)" + API-06 §17 header "TK-10". GET dùng `read:task`.
 * Data-scope: tái dùng CHÍNH `TaskCoreRepository` (mirror TaskCoreService.assertInScopeForWrite) — task
 * ngoài scope ⇒ 404.
 *
 * BẤT BIẾN #1: mọi query đi qua db.withTenant(companyId) + repo AND company_id tường minh.
 * BẤT BIẾN #2: xoá = soft (deleted_at) — checklist xoá cascade soft xuống item của nó.
 */
@Injectable()
export class TaskChecklistsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TaskChecklistsRepository,
    private readonly coreRepo: TaskCoreRepository,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
    private readonly activity: TaskActivityService,
  ) {}

  // ── Checklists ────────────────────────────────────────────────────────────────

  async list(user: RequestUser, taskId: string): Promise<TaskChecklistResponseDto[]> {
    const scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "read", "task");
    return this.db.withTenant(user.companyId, async (tx) => {
      await this.assertTaskInScope(tx, user, taskId, scope);
      const checklists = await this.repo.listChecklistsTx(tx, user.companyId, taskId);
      const out: TaskChecklistResponseDto[] = [];
      for (const cl of checklists) {
        const items = await this.repo.listItemsTx(tx, user.companyId, cl.id);
        out.push(this.toChecklistDto(cl, items));
      }
      return out;
    });
  }

  async create(
    user: RequestUser,
    taskId: string,
    dto: CreateTaskChecklistRequest,
  ): Promise<TaskChecklistResponseDto> {
    const scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "update", "task");
    return this.db.withTenant(user.companyId, async (tx) => {
      const task = await this.assertTaskInScope(tx, user, taskId, scope);
      const orderIndex = await this.repo.nextChecklistOrderIndexTx(tx, user.companyId, taskId);
      const created = await this.repo.insertChecklistTx(tx, user.companyId, {
        taskId,
        title: dto.title,
        isRequiredForDone: dto.isRequiredForDone,
        orderIndex,
        createdBy: user.id,
      });

      // order_index tự tính theo THỨ TỰ MẢNG (API-06 §17.2:3) — nextItemOrderIndexTx re-query mỗi vòng
      // (đơn giản, KHÔNG tối ưu N+1) nên luôn phản ánh ĐÚNG số hàng đã chèn trước đó trong CÙNG tx.
      for (const itemTitle of dto.items) {
        const itemOrder = await this.repo.nextItemOrderIndexTx(tx, user.companyId, created.id);
        await this.repo.insertItemTx(tx, user.companyId, {
          taskId,
          checklistId: created.id,
          title: itemTitle,
          orderIndex: itemOrder,
          createdBy: user.id,
        });
      }

      const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      await this.activity.record(tx, {
        action: "CHECKLIST_CREATED",
        targetType: "Checklist",
        targetId: created.id,
        taskId,
        projectId: task.projectId,
        actorUserId: user.id,
        actorEmployeeId: actorEmp?.id ?? null,
        newValues: { title: dto.title, itemCount: dto.items.length },
      });
      await this.audit.record(tx, {
        action: "TaskChecklistCreated",
        objectType: "task",
        objectId: taskId,
        actorUserId: user.id,
        after: { checklistId: created.id, title: dto.title },
      });

      return this.reloadChecklist(tx, user.companyId, taskId, created.id);
    });
  }

  async update(
    user: RequestUser,
    taskId: string,
    checklistId: string,
    dto: UpdateTaskChecklistRequest,
  ): Promise<TaskChecklistResponseDto> {
    const scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "update", "task");
    return this.db.withTenant(user.companyId, async (tx) => {
      const task = await this.assertTaskInScope(tx, user, taskId, scope);
      const existing = await this.repo.findChecklistTx(tx, user.companyId, taskId, checklistId);
      if (!existing || existing.deletedAt !== null)
        throw new NotFoundException(ERR.CHECKLIST_NOT_FOUND);

      const updated = await this.repo.updateChecklistTx(
        tx,
        user.companyId,
        checklistId,
        dto,
        user.id,
      );
      if (!updated) throw new NotFoundException(ERR.CHECKLIST_NOT_FOUND);

      const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      await this.activity.record(tx, {
        action: "CHECKLIST_UPDATED",
        targetType: "Checklist",
        targetId: checklistId,
        taskId,
        projectId: task.projectId,
        actorUserId: user.id,
        actorEmployeeId: actorEmp?.id ?? null,
        newValues: dto,
      });
      await this.audit.record(tx, {
        action: "TaskChecklistUpdated",
        objectType: "task",
        objectId: taskId,
        actorUserId: user.id,
        after: { checklistId, changed: dto },
      });

      return this.reloadChecklist(tx, user.companyId, taskId, checklistId);
    });
  }

  async remove(user: RequestUser, taskId: string, checklistId: string): Promise<void> {
    const scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "update", "task");
    await this.db.withTenant(user.companyId, async (tx) => {
      const task = await this.assertTaskInScope(tx, user, taskId, scope);
      const existing = await this.repo.findChecklistTx(tx, user.companyId, taskId, checklistId);
      if (!existing || existing.deletedAt !== null)
        throw new NotFoundException(ERR.CHECKLIST_NOT_FOUND);

      await this.repo.softDeleteItemsByChecklistTx(tx, user.companyId, checklistId, user.id);
      const removed = await this.repo.softDeleteChecklistTx(
        tx,
        user.companyId,
        checklistId,
        user.id,
      );
      if (!removed) throw new NotFoundException(ERR.CHECKLIST_NOT_FOUND);

      const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      await this.activity.record(tx, {
        action: "CHECKLIST_DELETED",
        targetType: "Checklist",
        targetId: checklistId,
        taskId,
        projectId: task.projectId,
        actorUserId: user.id,
        actorEmployeeId: actorEmp?.id ?? null,
      });
      await this.audit.record(tx, {
        action: "TaskChecklistDeleted",
        objectType: "task",
        objectId: taskId,
        actorUserId: user.id,
        before: { checklistId },
      });
    });
  }

  // ── Items ─────────────────────────────────────────────────────────────────────

  async addItem(
    user: RequestUser,
    taskId: string,
    checklistId: string,
    dto: CreateTaskChecklistItemRequest,
  ): Promise<TaskChecklistItemResponseDto> {
    const scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "update", "task");
    return this.db.withTenant(user.companyId, async (tx) => {
      const task = await this.assertTaskInScope(tx, user, taskId, scope);
      const checklist = await this.repo.findChecklistTx(tx, user.companyId, taskId, checklistId);
      if (!checklist || checklist.deletedAt !== null) {
        throw new NotFoundException(ERR.CHECKLIST_NOT_FOUND);
      }

      const orderIndex =
        dto.orderIndex ?? (await this.repo.nextItemOrderIndexTx(tx, user.companyId, checklistId));
      const created = await this.repo.insertItemTx(tx, user.companyId, {
        taskId,
        checklistId,
        title: dto.title,
        orderIndex,
        createdBy: user.id,
      });

      const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      await this.activity.record(tx, {
        action: "CHECKLIST_ITEM_CREATED",
        targetType: "ChecklistItem",
        targetId: created.id,
        taskId,
        projectId: task.projectId,
        actorUserId: user.id,
        actorEmployeeId: actorEmp?.id ?? null,
        newValues: { title: dto.title, checklistId },
      });
      await this.audit.record(tx, {
        action: "TaskChecklistItemCreated",
        objectType: "task",
        objectId: taskId,
        actorUserId: user.id,
        after: { itemId: created.id, checklistId },
      });

      const row = await this.repo.findItemTx(tx, user.companyId, checklistId, created.id);
      if (!row) throw new InternalServerErrorException("Không tải lại được hạng mục vừa tạo.");
      return this.toItemDto(row);
    });
  }

  /** PATCH tick — is_done=true ⇒ backend tự ghi done_by/done_at; false ⇒ clear (API-06 §17.6). */
  async updateItem(
    user: RequestUser,
    taskId: string,
    checklistId: string,
    itemId: string,
    dto: UpdateTaskChecklistItemRequest,
  ): Promise<TaskChecklistItemResponseDto> {
    const scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "update", "task");
    return this.db.withTenant(user.companyId, async (tx) => {
      const task = await this.assertTaskInScope(tx, user, taskId, scope);
      const checklist = await this.repo.findChecklistTx(tx, user.companyId, taskId, checklistId);
      if (!checklist || checklist.deletedAt !== null) {
        throw new NotFoundException(ERR.CHECKLIST_NOT_FOUND);
      }
      const existing = await this.repo.findItemTx(tx, user.companyId, checklistId, itemId);
      if (!existing || existing.deletedAt !== null) throw new NotFoundException(ERR.ITEM_NOT_FOUND);

      const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      const updated = await this.repo.updateItemTx(tx, user.companyId, itemId, dto, {
        userId: user.id,
        employeeId: actorEmp?.id ?? null,
      });
      if (!updated) throw new NotFoundException(ERR.ITEM_NOT_FOUND);

      // Activity action ưu tiên CHECKLIST_ITEM_DONE khi tick is_done=true (done_when đòi mã CHÍNH XÁC này);
      // các thay đổi khác (title/orderIndex/is_done=false) dùng CHECKLIST_ITEM_UPDATED.
      const action = dto.isDone === true ? "CHECKLIST_ITEM_DONE" : "CHECKLIST_ITEM_UPDATED";
      await this.activity.record(tx, {
        action,
        targetType: "ChecklistItem",
        targetId: itemId,
        taskId,
        projectId: task.projectId,
        actorUserId: user.id,
        actorEmployeeId: actorEmp?.id ?? null,
        oldValues: { title: existing.title, isDone: this.toBool(existing.isDone) },
        newValues: dto,
      });
      await this.audit.record(tx, {
        action: "TaskChecklistItemUpdated",
        objectType: "task",
        objectId: taskId,
        actorUserId: user.id,
        after: { itemId, changed: dto },
      });

      const row = await this.repo.findItemTx(tx, user.companyId, checklistId, itemId);
      if (!row) throw new InternalServerErrorException("Không tải lại được hạng mục vừa sửa.");
      return this.toItemDto(row);
    });
  }

  async removeItem(
    user: RequestUser,
    taskId: string,
    checklistId: string,
    itemId: string,
  ): Promise<void> {
    const scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "update", "task");
    await this.db.withTenant(user.companyId, async (tx) => {
      const task = await this.assertTaskInScope(tx, user, taskId, scope);
      const checklist = await this.repo.findChecklistTx(tx, user.companyId, taskId, checklistId);
      if (!checklist || checklist.deletedAt !== null) {
        throw new NotFoundException(ERR.CHECKLIST_NOT_FOUND);
      }
      const existing = await this.repo.findItemTx(tx, user.companyId, checklistId, itemId);
      if (!existing || existing.deletedAt !== null) throw new NotFoundException(ERR.ITEM_NOT_FOUND);

      const removed = await this.repo.softDeleteItemTx(tx, user.companyId, itemId, user.id);
      if (!removed) throw new NotFoundException(ERR.ITEM_NOT_FOUND);

      const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      await this.activity.record(tx, {
        action: "CHECKLIST_ITEM_DELETED",
        targetType: "ChecklistItem",
        targetId: itemId,
        taskId,
        projectId: task.projectId,
        actorUserId: user.id,
        actorEmployeeId: actorEmp?.id ?? null,
      });
      await this.audit.record(tx, {
        action: "TaskChecklistItemDeleted",
        objectType: "task",
        objectId: taskId,
        actorUserId: user.id,
        before: { itemId, checklistId },
      });
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async assertTaskInScope(
    tx: TenantTx,
    user: RequestUser,
    taskId: string,
    scope: DataScope,
  ): Promise<TaskCoreRow> {
    let scopeExists;
    if (scope !== "Company" && scope !== "System") {
      const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
      const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);
      const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      scopeExists = this.coreRepo.buildReadScopeExists(
        user.companyId,
        scopeCond,
        actorEmp?.id ?? null,
        user.id,
      );
    }
    const row = await this.coreRepo.findScopedByIdTx(tx, user.companyId, taskId, scopeExists);
    if (!row) throw new NotFoundException(ERR.TASK_NOT_FOUND);
    return row;
  }

  private async reloadChecklist(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    checklistId: string,
  ): Promise<TaskChecklistResponseDto> {
    const row = await this.repo.findChecklistTx(tx, companyId, taskId, checklistId);
    if (!row) throw new InternalServerErrorException("Không tải lại được checklist vừa ghi.");
    const items = await this.repo.listItemsTx(tx, companyId, checklistId);
    return this.toChecklistDto(row, items);
  }

  private toBool(v: boolean | string): boolean {
    return v === true || v === "true" || v === "t";
  }

  private toIso(v: string | Date): string {
    return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
  }

  private toChecklistDto(
    row: TaskChecklistRow,
    items: TaskChecklistItemRow[],
  ): TaskChecklistResponseDto {
    return {
      id: row.id,
      taskId: row.taskId,
      title: row.title,
      description: row.description,
      isRequiredForDone: this.toBool(row.isRequiredForDone),
      orderIndex: row.orderIndex,
      items: items.map((i) => this.toItemDto(i)),
      createdAt: this.toIso(row.createdAt),
    };
  }

  private toItemDto(row: TaskChecklistItemRow): TaskChecklistItemResponseDto {
    return {
      id: row.id,
      checklistId: row.checklistId,
      title: row.title,
      isDone: this.toBool(row.isDone),
      doneBy: row.doneBy,
      doneAt: row.doneAt ? this.toIso(row.doneAt) : null,
      orderIndex: row.orderIndex,
    };
  }
}
