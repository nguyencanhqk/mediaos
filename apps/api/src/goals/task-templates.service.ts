import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type {
  CreateTaskTemplateItemRequest,
  CreateTaskTemplateRequest,
  DataScope,
  ListTaskTemplatesQueryRequest,
  TaskTemplateItemResponseDto,
  TaskTemplateResponseDto,
  UpdateTaskTemplateItemRequest,
  UpdateTaskTemplateRequest,
} from "@mediaos/contracts";
import { GOAL_PAGE_LIMIT_MAX, TASK_TEMPLATE_ITEMS_MAX } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { DataScopeService } from "../permission/data-scope.service";
import type { TaskTemplate, TaskTemplateItem } from "../db/schema/task-templates";
import type { GoalRequestUser as RequestUser } from "./goal-access.service";
import { GoalsRepository } from "./goals.repository";
import { TPL_ERR } from "./goals.errors";
import { TaskTemplatesRepository, type TaskTemplateListRow } from "./task-templates.repository";

const DEFAULT_LIST_LIMIT = 50;

/**
 * S5-GOAL-TPL-1 — TaskTemplatesService (GOAL-API-012 · GOAL-FUNC-008 · GOAL-SCREEN-006).
 *
 * ── PHÂN QUYỀN: cặp `('manage','task-template')` (seed mig 0527, is_sensitive=false) ─────────────────
 * Controller gate cặp qua PermissionGuard; service thêm DATA-SCOPE (lớp chặn thật, SPEC-10 §11):
 *   • `Company`/`System` ⇒ toàn tenant (đọc + ghi mọi template, kể cả dùng-chung);
 *   • `Department`       ⇒ ĐỌC template của phòng mình ∪ phòng mình phụ trách **và** template DÙNG CHUNG
 *                          (`department_id IS NULL` — tài sản chung, ai cũng cần thấy để phân rã);
 *                          GHI (tạo/sửa/xoá) CHỈ template neo vào phòng của mình. Sửa/xoá template
 *                          dùng-chung ở scope Department ⇒ 403: nó thuộc toàn công ty, một trưởng phòng
 *                          đổi tên/tắt nó là đổi công cụ của mọi phòng khác.
 * Ngoài phạm vi mà CÙNG tenant ⇒ **403** (quy ước minh bạch in-tenant của GOAL, §20.2); chéo tenant ⇒
 * **404** (repo luôn AND company_id).
 *
 * ⚠️ `departmentId` client gửi PHẢI resolve dưới company actor trước khi ghi (FK đơn cột KHÔNG ép
 * cùng-tenant — carry-forward finding gate S5-GOAL-DB-2). Không thấy ⇒ 404, KHÔNG để FK ném 500.
 *
 * BẤT BIẾN #2: xoá = soft-delete (header + cascade mềm xuống item trong CÙNG tx). Mọi thao tác quan
 * trọng ghi `audit_logs` object_type `'task_template'` (CHECK đã union-add ở mig 0528).
 */
@Injectable()
export class TaskTemplatesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TaskTemplatesRepository,
    private readonly goalsRepo: GoalsRepository,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
  ) {}

  // ── Đọc ──────────────────────────────────────────────────────────────────────

  async listTemplates(
    user: RequestUser,
    query: ListTaskTemplatesQueryRequest,
  ): Promise<TaskTemplateResponseDto[]> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.resolveActor(tx, user);
      const rows = await this.repo.listTx(
        tx,
        user.companyId,
        {
          departmentId: query.departmentId,
          isActive: query.isActive,
          q: query.q,
          limit: Math.min(query.limit ?? DEFAULT_LIST_LIMIT, GOAL_PAGE_LIMIT_MAX),
          offset: query.offset ?? 0,
        },
        this.buildReadScopeCond(actor),
      );
      return rows.map((row) => this.toListDto(row));
    });
  }

  /** GET /task-templates/:id — kèm items (màn hình quản lý danh mục + nguồn preview của wizard). */
  async getTemplate(user: RequestUser, id: string): Promise<TaskTemplateResponseDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.resolveActor(tx, user);
      const template = await this.loadReadableTx(tx, user, id, actor);
      const items = await this.repo.listItemsTx(tx, user.companyId, id);
      return this.toDto(tx, user.companyId, template, items);
    });
  }

  // ── Ghi — header ─────────────────────────────────────────────────────────────

  async createTemplate(
    user: RequestUser,
    dto: CreateTaskTemplateRequest,
  ): Promise<TaskTemplateResponseDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.resolveActor(tx, user);
      const departmentId = await this.resolveDepartmentForWrite(
        tx,
        user,
        actor,
        dto.departmentId ?? null,
      );
      if (await this.repo.findByNameTx(tx, user.companyId, dto.name)) {
        throw new ConflictException(TPL_ERR.NAME_TAKEN(dto.name));
      }

      const created = await this.repo.insertTx(tx, user.companyId, {
        name: dto.name,
        description: dto.description ?? null,
        departmentId,
        isActive: dto.isActive ?? true,
        createdBy: user.id,
      });
      // Tạo header + items TRONG CÙNG tx: template rỗng nửa vời không có ích cho ai (và phân rã sẽ chặn
      // nó bằng GOAL-ERR-009), nên "tạo kèm danh sách việc" phải là tất-cả-hoặc-không.
      for (const [index, item] of (dto.items ?? []).entries()) {
        await this.repo.insertItemTx(tx, user.companyId, {
          templateId: created.id,
          title: item.title,
          description: item.description ?? null,
          defaultPriority: item.defaultPriority ?? null,
          estimateHours:
            item.estimateHours === undefined ? null : this.toNumeric(item.estimateHours),
          checklist: item.checklist ?? null,
          sortOrder: item.sortOrder ?? index,
          createdBy: user.id,
        });
      }

      await this.audit.record(tx, {
        action: "TaskTemplateCreated",
        objectType: "task_template",
        objectId: created.id,
        actorUserId: user.id,
        after: {
          name: dto.name,
          departmentId,
          isActive: dto.isActive ?? true,
          itemCount: dto.items?.length ?? 0,
        },
      });
      return this.reload(tx, user.companyId, created.id);
    });
  }

  async updateTemplate(
    user: RequestUser,
    id: string,
    dto: UpdateTaskTemplateRequest,
  ): Promise<TaskTemplateResponseDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.resolveActor(tx, user);
      const before = await this.loadWritableTx(tx, user, id, actor);

      // Di dời template sang phòng khác cũng là một phép GHI vào phòng ĐÍCH ⇒ phải nằm trong phạm vi
      // của actor, y như lúc tạo. Bỏ vế này = trưởng phòng A đẩy được template sang phòng B.
      const departmentId =
        dto.departmentId === undefined
          ? undefined
          : await this.resolveDepartmentForWrite(tx, user, actor, dto.departmentId ?? null);
      if (
        dto.name !== undefined &&
        (await this.repo.findByNameTx(tx, user.companyId, dto.name, id))
      ) {
        throw new ConflictException(TPL_ERR.NAME_TAKEN(dto.name));
      }

      const updated = await this.repo.updateTx(
        tx,
        user.companyId,
        id,
        {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description ?? null } : {}),
          ...(departmentId !== undefined ? { departmentId } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        user.id,
      );
      if (!updated) throw new NotFoundException(TPL_ERR.NOT_FOUND);

      await this.audit.record(tx, {
        action: "TaskTemplateUpdated",
        objectType: "task_template",
        objectId: id,
        actorUserId: user.id,
        before: {
          name: before.name,
          departmentId: before.departmentId,
          isActive: before.isActive,
        },
        after: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(departmentId !== undefined ? { departmentId } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      return this.reload(tx, user.companyId, id);
    });
  }

  /** DELETE /task-templates/:id — xoá MỀM header + cascade mềm item (BẤT BIẾN #2). */
  async deleteTemplate(user: RequestUser, id: string): Promise<void> {
    await this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.resolveActor(tx, user);
      const before = await this.loadWritableTx(tx, user, id, actor);
      const removed = await this.repo.softDeleteTx(tx, user.companyId, id, user.id);
      if (!removed) throw new NotFoundException(TPL_ERR.NOT_FOUND);
      await this.audit.record(tx, {
        action: "TaskTemplateDeleted",
        objectType: "task_template",
        objectId: id,
        actorUserId: user.id,
        before: { name: before.name, departmentId: before.departmentId },
      });
    });
  }

  // ── Ghi — items ──────────────────────────────────────────────────────────────

  async listItems(user: RequestUser, templateId: string): Promise<TaskTemplateItemResponseDto[]> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.resolveActor(tx, user);
      await this.loadReadableTx(tx, user, templateId, actor);
      const items = await this.repo.listItemsTx(tx, user.companyId, templateId);
      return items.map((item) => this.toItemDto(item));
    });
  }

  async createItem(
    user: RequestUser,
    templateId: string,
    dto: CreateTaskTemplateItemRequest,
  ): Promise<TaskTemplateItemResponseDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.resolveActor(tx, user);
      await this.loadWritableTx(tx, user, templateId, actor);
      const count = await this.repo.countItemsTx(tx, user.companyId, templateId);
      if (count >= TASK_TEMPLATE_ITEMS_MAX) {
        throw new UnprocessableEntityException(TPL_ERR.ITEMS_LIMIT(TASK_TEMPLATE_ITEMS_MAX));
      }
      const created = await this.repo.insertItemTx(tx, user.companyId, {
        templateId,
        title: dto.title,
        description: dto.description ?? null,
        defaultPriority: dto.defaultPriority ?? null,
        estimateHours: this.toNumeric(dto.estimateHours),
        checklist: dto.checklist ?? null,
        sortOrder:
          dto.sortOrder ?? (await this.repo.nextSortOrderTx(tx, user.companyId, templateId)),
        createdBy: user.id,
      });
      await this.audit.record(tx, {
        action: "TaskTemplateItemCreated",
        objectType: "task_template",
        objectId: templateId,
        actorUserId: user.id,
        after: { itemId: created.id, title: dto.title },
      });
      const item = await this.repo.findItemTx(tx, user.companyId, templateId, created.id);
      if (!item) throw new NotFoundException(TPL_ERR.ITEM_NOT_FOUND);
      return this.toItemDto(item);
    });
  }

  async updateItem(
    user: RequestUser,
    templateId: string,
    itemId: string,
    dto: UpdateTaskTemplateItemRequest,
  ): Promise<TaskTemplateItemResponseDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.resolveActor(tx, user);
      await this.loadWritableTx(tx, user, templateId, actor);
      // Item phải thuộc ĐÚNG template đã authorize — nếu chỉ tra theo itemId thì actor sửa được item của
      // template phòng khác miễn là đoán đúng UUID (đường ghi vòng qua gate của header).
      const before = await this.repo.findItemTx(tx, user.companyId, templateId, itemId);
      if (!before) throw new NotFoundException(TPL_ERR.ITEM_NOT_FOUND);

      const updated = await this.repo.updateItemTx(
        tx,
        user.companyId,
        itemId,
        {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined ? { description: dto.description ?? null } : {}),
          ...(dto.defaultPriority !== undefined
            ? { defaultPriority: dto.defaultPriority ?? null }
            : {}),
          ...(dto.estimateHours !== undefined
            ? { estimateHours: this.toNumeric(dto.estimateHours) }
            : {}),
          ...(dto.checklist !== undefined ? { checklist: dto.checklist ?? null } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        },
        user.id,
      );
      if (!updated) throw new NotFoundException(TPL_ERR.ITEM_NOT_FOUND);
      await this.audit.record(tx, {
        action: "TaskTemplateItemUpdated",
        objectType: "task_template",
        objectId: templateId,
        actorUserId: user.id,
        before: { itemId, title: before.title },
        after: { itemId, ...(dto.title !== undefined ? { title: dto.title } : {}) },
      });
      const item = await this.repo.findItemTx(tx, user.companyId, templateId, itemId);
      if (!item) throw new NotFoundException(TPL_ERR.ITEM_NOT_FOUND);
      return this.toItemDto(item);
    });
  }

  async deleteItem(user: RequestUser, templateId: string, itemId: string): Promise<void> {
    await this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.resolveActor(tx, user);
      await this.loadWritableTx(tx, user, templateId, actor);
      const before = await this.repo.findItemTx(tx, user.companyId, templateId, itemId);
      if (!before) throw new NotFoundException(TPL_ERR.ITEM_NOT_FOUND);
      const removed = await this.repo.softDeleteItemTx(tx, user.companyId, itemId, user.id);
      if (!removed) throw new NotFoundException(TPL_ERR.ITEM_NOT_FOUND);
      await this.audit.record(tx, {
        action: "TaskTemplateItemDeleted",
        objectType: "task_template",
        objectId: templateId,
        actorUserId: user.id,
        before: { itemId, title: before.title },
      });
    });
  }

  // ── Dùng chung với phân rã (GoalDecomposeService) ─────────────────────────────

  /**
   * Template dùng được để PHÂN RÃ: chỉ cần phạm vi ĐỌC (`manage:task-template` vẫn là cổng cặp quyền ở
   * controller của route decompose? — KHÔNG: decompose gate `update:goal` + `create:task`, xem
   * GoalDecomposeService). Ở đây ta chỉ resolve dưới company_id: template của công ty khác ⇒ 404.
   *
   * CỐ Ý KHÔNG đòi `manage:task-template` để phân rã: người dùng danh mục (trưởng nhóm phân rã mục tiêu)
   * khác người quản trị danh mục (§11 — `manage` là quyền SỬA danh mục). Đòi thêm sẽ khoá luồng chính.
   */
  async loadTemplateForDecomposeTx(
    tx: TenantTx,
    companyId: string,
    templateId: string,
  ): Promise<TaskTemplate> {
    const template = await this.repo.findByIdTx(tx, companyId, templateId);
    if (!template) throw new NotFoundException(TPL_ERR.NOT_FOUND);
    return template;
  }

  // ── Nội bộ ───────────────────────────────────────────────────────────────────

  private async resolveActor(
    tx: TenantTx,
    user: RequestUser,
  ): Promise<{ scope: DataScope; deptOrgUnitIds: string[] }> {
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "manage",
      "task-template",
    );
    if (scope === "Company" || scope === "System") return { scope, deptOrgUnitIds: [] };
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    // Bậc phòng ban CHỈ có nghĩa với 'Department' (phòng mình ∪ phòng mình phụ trách — mirror
    // GoalAccessService.resolveActorScope). Own/Team để RỖNG: không nới quyền câm.
    const deptOrgUnitIds =
      scope === "Department"
        ? [...new Set([...(ctx.orgUnitId ? [ctx.orgUnitId] : []), ...(ctx.headedOrgUnitIds ?? [])])]
        : [];
    return { scope, deptOrgUnitIds };
  }

  /** Vị từ phạm vi ĐỌC: phòng của actor HOẶC template dùng-chung. undefined = toàn tenant. */
  private buildReadScopeCond(actor: {
    scope: DataScope;
    deptOrgUnitIds: string[];
  }): SQL | undefined {
    if (actor.scope === "Company" || actor.scope === "System") return undefined;
    if (actor.deptOrgUnitIds.length === 0) return sql`t.department_id is null`;
    return sql`(t.department_id is null or t.department_id in (${sql.join(
      actor.deptOrgUnitIds.map((id) => sql`${id}`),
      sql`, `,
    )}))`;
  }

  private async loadReadableTx(
    tx: TenantTx,
    user: RequestUser,
    id: string,
    actor: { scope: DataScope; deptOrgUnitIds: string[] },
  ): Promise<TaskTemplate> {
    const template = await this.repo.findByIdTx(tx, user.companyId, id);
    if (!template) throw new NotFoundException(TPL_ERR.NOT_FOUND);
    if (actor.scope === "Company" || actor.scope === "System") return template;
    const readable =
      template.departmentId === null || actor.deptOrgUnitIds.includes(template.departmentId);
    if (!readable) throw new ForbiddenException(TPL_ERR.FORBIDDEN);
    return template;
  }

  /** Phạm vi GHI: hẹp hơn ĐỌC — template dùng-chung CHỈ ĐỌC với scope < Company (docblock đầu file). */
  private async loadWritableTx(
    tx: TenantTx,
    user: RequestUser,
    id: string,
    actor: { scope: DataScope; deptOrgUnitIds: string[] },
  ): Promise<TaskTemplate> {
    const template = await this.repo.findByIdTx(tx, user.companyId, id);
    if (!template) throw new NotFoundException(TPL_ERR.NOT_FOUND);
    if (actor.scope === "Company" || actor.scope === "System") return template;
    if (template.departmentId === null) throw new ForbiddenException(TPL_ERR.FORBIDDEN_SHARED);
    if (!actor.deptOrgUnitIds.includes(template.departmentId)) {
      throw new ForbiddenException(TPL_ERR.FORBIDDEN);
    }
    return template;
  }

  /**
   * `departmentId` do CLIENT gửi ⇒ (a) resolve dưới company actor (404 nếu lạ — FK đơn cột không ép
   * cùng-tenant), (b) phải nằm trong phạm vi ghi của actor. `null` = template dùng-chung: chỉ
   * Company/System được tạo/di dời về dùng-chung.
   */
  private async resolveDepartmentForWrite(
    tx: TenantTx,
    user: RequestUser,
    actor: { scope: DataScope; deptOrgUnitIds: string[] },
    departmentId: string | null,
  ): Promise<string | null> {
    const isOrgWide = actor.scope === "Company" || actor.scope === "System";
    if (departmentId === null) {
      if (isOrgWide) return null;
      throw new ForbiddenException(TPL_ERR.FORBIDDEN_SHARED);
    }
    const found = await this.goalsRepo.resolveDepartmentTx(tx, user.companyId, departmentId);
    if (!found) throw new NotFoundException(TPL_ERR.REF_DEPARTMENT_NOT_FOUND);
    if (!isOrgWide && !actor.deptOrgUnitIds.includes(departmentId)) {
      throw new ForbiddenException(TPL_ERR.FORBIDDEN);
    }
    return departmentId;
  }

  private async reload(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<TaskTemplateResponseDto> {
    const template = await this.repo.findByIdTx(tx, companyId, id);
    if (!template) throw new NotFoundException(TPL_ERR.NOT_FOUND);
    const items = await this.repo.listItemsTx(tx, companyId, id);
    return this.toDto(tx, companyId, template, items);
  }

  private async toDto(
    tx: TenantTx,
    companyId: string,
    template: TaskTemplate,
    items: TaskTemplateItem[],
  ): Promise<TaskTemplateResponseDto> {
    const departmentName = template.departmentId
      ? ((await this.repo.findDepartmentNameTx(tx, companyId, template.departmentId)) ?? null)
      : null;
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      departmentId: template.departmentId,
      departmentName,
      isActive: template.isActive,
      itemCount: items.length,
      items: items.map((item) => this.toItemDto(item)),
      createdAt: this.toIso(template.createdAt),
      updatedAt: this.toIso(template.updatedAt),
    };
  }

  private toListDto(row: TaskTemplateListRow): TaskTemplateResponseDto {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      departmentId: row.departmentId,
      departmentName: row.departmentName,
      isActive: this.toBool(row.isActive),
      itemCount: Number(row.itemCount ?? 0),
      // Danh sách KHÔNG trả items (payload N×M) — màn hình mở chi tiết mới tải.
      items: [],
      createdAt: this.toIso(row.createdAt),
      updatedAt: this.toIso(row.updatedAt),
    };
  }

  private toItemDto(item: TaskTemplateItem): TaskTemplateItemResponseDto {
    return {
      id: item.id,
      templateId: item.templateId,
      title: item.title,
      description: item.description,
      // CHECK 0526 giữ giá trị trong enum contracts — cast là an toàn, giá trị lạ không vào được bảng.
      defaultPriority: (item.defaultPriority ??
        null) as TaskTemplateItemResponseDto["defaultPriority"],
      // numeric(8,2) về từ pg là STRING — Number ở biên, KHÔNG để chuỗi "8.00" lọt vào DTO số.
      estimateHours: item.estimateHours === null ? null : Number(item.estimateHours),
      checklist: normalizeChecklist(item.checklist),
      sortOrder: item.sortOrder,
    };
  }

  /** numeric(8,2): drizzle nhận STRING. undefined ⇒ null (bỏ trống), số ⇒ chuỗi cố định 2 chữ số thập phân. */
  private toNumeric(value: number | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    return value.toFixed(2);
  }

  private toIso(v: string | Date): string {
    return (v instanceof Date ? v : new Date(v)).toISOString();
  }

  private toBool(v: boolean | string): boolean {
    return v === true || v === "t" || v === "true";
  }
}

/**
 * `checklist` là JSONB tự do ở DB ⇒ đọc PHẢI phòng thủ: chỉ nhận mảng chuỗi, bỏ phần tử lạ. Trả `[]` khi
 * NULL/không phải mảng — DTO có `checklist: string[]` (không nullable) để FE không phải kiểm 2 lần.
 */
export function normalizeChecklist(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}
