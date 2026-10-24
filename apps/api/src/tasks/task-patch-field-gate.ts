import { Injectable, InternalServerErrorException } from "@nestjs/common";
import type { DataScope, UpdateTaskCoreRequest } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { DataScopeService } from "../permission/data-scope.service";
import { ProjectAccessService } from "./project-access.service";
import type { TaskCorePatchValues, TaskRawRow } from "./task-core.repository";

/**
 * S20-SEC-TASKPATCHGATE-1 — cổng TRƯỜNG của đường sửa chung `PATCH /tasks/:taskId`.
 *
 * Bất biến (docs/permission-matrix-spec.md §6 TASK; plan S20-SEC-TASKPATCHGATE-1 §1):
 *   I-1  cùng thay đổi, cùng quyết định quyền — PATCH làm trường F ĐỔI so với bản ghi hiện tại
 *        chỉ thành công khi người gọi có cặp chuyên trách P(F) (cặp của route `/assign` ·
 *        `/change-priority` · `/change-deadline`); thiếu ⇒ 403 cho CẢ request (không bỏ trường).
 *   I-2  cùng phạm vi — phần đổi F buộc theo phạm vi của CHÍNH P(F): việc phải nằm trong phạm vi
 *        ghi của P(F) (`assertTaskInScopeTx(…, "write")`, ngoài ⇒ 404 như route chuyên trách);
 *        người phụ trách mới buộc theo phạm vi `assign` (`assertTx` trả về). Không mượn phạm vi
 *        của `update:task`.
 *   I-3  không đổi thì không đòi VÀ không ghi — bất biến QUYỀN, không phải tối ưu: bản ghi hiện
 *        tại đọc không khoá hàng, nên ghi lại giá trị «không đổi» theo bản chụp cũ sẽ đè một thay
 *        đổi hợp lệ (qua route chuyên trách) commit chen giữa đọc và ghi = đổi F mà không có P(F).
 *        So sánh: hạn theo epoch ms (cùng phép so no-op của change-deadline); ưu tiên theo chuỗi;
 *        người phụ trách theo id không phân biệt hoa/thường (UUID — Postgres so theo giá trị).
 *        `null` (xoá hạn · bỏ ưu tiên · gỡ người phụ trách) là ĐỔI. Nhật ký `TASK_UPDATED` (activity
 *        + audit append-only) cũng chỉ khai trường thực sự ghi (`auditedPatchFields`).
 *   I-4  một hàm quyết định — cặp → phạm vi qua `DataScopeService.resolveManyOrNull` (cùng
 *        `decideStrongestScope` với `resolveAndAssert`), 403 qua `DataScopeService.assertGranted`,
 *        phạm vi việc qua `ProjectAccessService.assertTaskInScopeTx` — cùng hàm route chuyên trách.
 *
 * Điểm nối cho WO sau (plan §3.7): phát sự kiện / tính khả năng sửa từng trường dựa vào CÙNG
 * `TASK_PATCH_GATED_FIELDS` + `computeChanged` — không bảng ánh xạ thứ hai, không tự so lại.
 */

const TASK_RESOURCE = "task";

/** Bảng trường ↔ cặp chuyên trách — MỘT nơi. Thứ tự = thứ tự kiểm (ổn định cho lỗi trả về). */
export const TASK_PATCH_GATED_FIELDS = [
  { field: "dueAt", action: "update-deadline" },
  { field: "priority", action: "update-priority" },
  { field: "assigneeEmployeeId", action: "assign" },
] as const satisfies ReadonlyArray<{ field: keyof UpdateTaskCoreRequest; action: string }>;

export type TaskPatchGatedField = (typeof TASK_PATCH_GATED_FIELDS)[number]["field"];

/** Giá trị đang lưu của ba trường (từ `findRawByIdTx`). */
export type TaskPatchCurrent = Pick<
  TaskRawRow,
  "dueAt" | "taskPriority" | "mainAssigneeEmployeeId"
>;

/** Kết quả `prepare`: phạm vi của cặp chuyên trách cho từng trường CÓ MẶT (null = không có cặp). */
export interface TaskPatchFieldScope {
  field: TaskPatchGatedField;
  scope: DataScope | null;
}

export type TaskPatchGatedValues = Pick<
  TaskCorePatchValues,
  "dueAt" | "taskPriority" | "mainAssigneeEmployeeId" | "assigneeUserId"
>;

type GatedInput = Pick<UpdateTaskCoreRequest, TaskPatchGatedField>;

function toEpochMs(v: Date | string | null | undefined): number | null {
  if (v == null) return null;
  return v instanceof Date ? v.getTime() : Date.parse(v);
}

/** UUID chữ hoa và chữ thường là CÙNG một id (Postgres so theo giá trị, trả về chữ thường). */
function sameId(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a.toLowerCase() === b.toLowerCase();
}

/** I-3 — tập trường CÓ MẶT trong body mà giá trị KHÁC giá trị đang lưu. Trường vắng không xét. */
export function computeChanged(
  current: TaskPatchCurrent,
  dto: GatedInput,
): ReadonlySet<TaskPatchGatedField> {
  const changed = new Set<TaskPatchGatedField>();
  // Chuỗi không parse được ⇒ NaN ≠ mọi giá trị ⇒ tính là đổi ⇒ đòi cặp (fail-closed).
  if (dto.dueAt !== undefined && toEpochMs(dto.dueAt) !== toEpochMs(current.dueAt)) {
    changed.add("dueAt");
  }
  if (dto.priority !== undefined && dto.priority !== current.taskPriority) {
    changed.add("priority");
  }
  if (
    dto.assigneeEmployeeId !== undefined &&
    !sameId(dto.assigneeEmployeeId, current.mainAssigneeEmployeeId)
  ) {
    changed.add("assigneeEmployeeId");
  }
  return changed;
}

/**
 * I-3 vế «không ghi» — phần patch của ba trường: CHỈ trường thuộc `changed` có khoá. `assignee` là người
 * phụ trách mới đã resolve theo phạm vi `assign` (bắt buộc khi người phụ trách đổi sang một người).
 */
export function buildGatedPatch(
  dto: GatedInput,
  changed: ReadonlySet<TaskPatchGatedField>,
  assignee: { employeeId: string; userId: string } | null,
): TaskPatchGatedValues {
  const dueAt = changed.has("dueAt") ? { dueAt: dto.dueAt ?? null } : {};
  const priority = changed.has("priority") ? { taskPriority: dto.priority ?? null } : {};
  if (!changed.has("assigneeEmployeeId")) return { ...dueAt, ...priority };
  if (dto.assigneeEmployeeId == null) {
    return { ...dueAt, ...priority, mainAssigneeEmployeeId: null, assigneeUserId: null };
  }
  if (!assignee || !sameId(assignee.employeeId, dto.assigneeEmployeeId)) {
    // Lỗi lập trình (người gọi quên resolve theo phạm vi assign) — nổ to, không ghi người chưa kiểm.
    throw new InternalServerErrorException(
      "TASK-ERR-PATCH-GATE: người phụ trách mới chưa được resolve theo phạm vi assign.",
    );
  }
  return {
    ...dueAt,
    ...priority,
    mainAssigneeEmployeeId: assignee.employeeId,
    assigneeUserId: assignee.userId,
  };
}

/**
 * Đầu vào nhật ký `TASK_UPDATED` (activity + audit append-only): body trừ `stateId` (có bản ghi
 * `TASK_STATE_CHANGED` riêng), trừ trường có cổng KHÔNG đổi (I-3 không ghi ⇒ nhật ký không khai — kể cả
 * khi một route chuyên trách commit chen giữa: DB giữ giá trị của route đó, nhật ký PATCH không được nói
 * khác), trừ khoá vắng. Rỗng ⇒ người gọi không ghi dòng nhật ký nào.
 */
export function auditedPatchFields(
  dto: UpdateTaskCoreRequest,
  changed: ReadonlySet<TaskPatchGatedField>,
): Record<string, unknown> {
  const gated = new Set<string>(TASK_PATCH_GATED_FIELDS.map((g) => g.field));
  return Object.fromEntries(
    Object.entries(dto).filter(
      ([k, v]) =>
        v !== undefined &&
        k !== "stateId" &&
        (!gated.has(k) || changed.has(k as TaskPatchGatedField)),
    ),
  );
}

interface GateUser {
  id: string;
  companyId: string;
}

@Injectable()
export class TaskPatchFieldGate {
  constructor(
    private readonly dataScope: DataScopeService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /**
   * TRƯỚC tx (khuôn `prepareStateWrite` — không mở kết nối thứ hai trong tx): MỘT lượt đọc grant cho
   * đúng cặp của các trường CÓ MẶT. Kết quả mảng theo chỉ số ⇒ ghép với `present[i]` của CHÍNH mảng
   * `requests` đã lọc — không tra theo khoá cặp, không dùng chỉ số của bảng gốc.
   */
  async prepare(user: GateUser, dto: GatedInput): Promise<TaskPatchFieldScope[]> {
    const present = TASK_PATCH_GATED_FIELDS.filter((g) => dto[g.field] !== undefined);
    if (present.length === 0) return [];
    const requests = present.map((g) => ({ action: g.action, resourceType: TASK_RESOURCE }));
    const scopes = await this.dataScope.resolveManyOrNull(user.id, user.companyId, requests);
    return present.map((g, i) => ({ field: g.field, scope: scopes[i] ?? null }));
  }

  /**
   * TRONG tx, TRƯỚC mọi ghi: với mỗi trường ĐỔI — cặp (403, I-1) rồi phạm vi việc của chính cặp (404,
   * I-2). Mọi 403 đi trước mọi 404 (như guard route đi trước data-scope). Trường không đổi không đòi
   * gì (I-3). Trả phạm vi `assign` khi người phụ trách đổi (null nếu không) để người gọi resolve người
   * mới theo đúng phạm vi đó.
   */
  async assertTx(
    tx: TenantTx,
    user: GateUser,
    taskId: string,
    changed: ReadonlySet<TaskPatchGatedField>,
    prepared: readonly TaskPatchFieldScope[],
  ): Promise<DataScope | null> {
    const granted = TASK_PATCH_GATED_FIELDS.filter((g) => changed.has(g.field)).map((g) => ({
      field: g.field,
      // Trường đổi mà `prepare` không có ⇒ undefined ⇒ 403 (assertGranted so lỏng) — fail-closed.
      scope: this.dataScope.assertGranted(prepared.find((p) => p.field === g.field)?.scope),
    }));
    const checked = new Set<DataScope>();
    for (const { scope } of granted) {
      if (checked.has(scope)) continue;
      await this.projectAccess.assertTaskInScopeTx(tx, user, taskId, scope, "write");
      checked.add(scope);
    }
    return granted.find((g) => g.field === "assigneeEmployeeId")?.scope ?? null;
  }
}
