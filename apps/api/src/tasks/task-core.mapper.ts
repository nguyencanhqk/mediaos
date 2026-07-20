import { InternalServerErrorException } from "@nestjs/common";
import type {
  ProjectStateGroupDto,
  TaskCorePriorityDto,
  TaskCoreResponseDto,
  TaskCoreStatusDto,
  TaskKanbanCardDto,
} from "@mediaos/contracts";
import type { TaskCoreRow } from "./task-core.repository";

/**
 * S4-TASK-BE-4 — projection dùng chung `TaskCoreRow → TaskCoreResponseDto` cho mọi READ mới (Kanban board).
 * Copy có kiểm soát của `TaskCoreService.toDto`/`TaskActionsService.toDto` (private, KHÔNG export) — tách
 * ra đây để BE-4 tái dùng mà không đụng 2 service crown hiện có (giảm bề mặt regression). Raw `tx.execute`
 * KHÔNG type-parse (drizzle không biết OID) ⇒ timestamptz về string, boolean về 't'/'f'|'true'/'false'.
 */

/**
 * S5-TASK-AVATAR-1 — gom "chủ hàng avatar" từ một trang task để resolve THEO LÔ.
 *
 * Bỏ task chưa giao (không có employeeId thì không có avatar để tra) và khử trùng lặp theo employee:
 * một người phụ trách 20 thẻ trên board vẫn chỉ là MỘT hàng cần ký, không phải 20.
 *
 * ⚠️ Kết quả PHẢI truyền cho `AvatarPresignService.resolveEmployeeAvatars`, và lời gọi đó phải nằm
 * NGOÀI transaction đọc chính (service đó tự mở `withTenant` — nested-tx trên PgBouncer sẽ treo).
 */
export function toAvatarSubjects(
  rows: readonly TaskCoreRow[],
): Array<{ employeeId: string; avatarUrl: string | null }> {
  const byEmployee = new Map<string, string | null>();
  for (const row of rows) {
    const employeeId = row.mainAssigneeEmployeeId;
    if (!employeeId) continue;
    if (!byEmployee.has(employeeId)) byEmployee.set(employeeId, row.assigneeAvatarRaw ?? null);
  }
  return [...byEmployee].map(([employeeId, avatarUrl]) => ({ employeeId, avatarUrl }));
}

/** Tra URL đã ký cho MỘT hàng — task chưa giao ⇒ null (fail-soft về chữ cái đầu). */
export function avatarForRow(
  row: TaskCoreRow,
  resolved: ReadonlyMap<string, string>,
): string | null {
  const employeeId = row.mainAssigneeEmployeeId;
  if (!employeeId) return null;
  return resolved.get(employeeId) ?? null;
}

/**
 * S5-TASK-COVER-1 — gom CẢ HAI URL đã ký cho một hàng thành object của `toTaskCoreDto`.
 *
 * Dùng helper này thay vì tự dựng object tại từng call-site: 6 đường đọc mà mỗi đường tự viết
 * `{ assigneeAvatarUrl: …, coverUrl: … }` là 6 cơ hội hoán vị nhầm hai giá trị cùng kiểu, hoặc quên
 * hẳn một vế (lỗi "field im lặng không tới FE ở một phần ba số đường" đã xảy ra 2 lần với
 * `parentTaskId`, 1 lần với `assigneeAvatarUrl`).
 *
 * Khoá TRA KHÁC NHAU và đó chính là chỗ dễ nhầm: avatar tra theo **employeeId** (một người phụ trách
 * N thẻ ⇒ 1 hàng ký), ảnh bìa tra theo **taskId** (mỗi task một bìa riêng).
 */
export function signedUrlsForRow(
  row: TaskCoreRow,
  avatars: ReadonlyMap<string, string>,
  covers: ReadonlyMap<string, string>,
): TaskCoreSignedUrls {
  return {
    assigneeAvatarUrl: avatarForRow(row, avatars),
    coverUrl: covers.get(row.id) ?? null,
  };
}

function toIso(v: string | Date | null): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function toBool(v: boolean | string): boolean {
  return v === true || v === "true" || v === "t";
}

/**
 * URL ĐÃ KÝ mà caller bơm vào DTO. CẢ HAI đều là ảnh phải qua tầng ký riêng — mapper KHÔNG tự suy ra.
 *
 * S5-TASK-COVER-1 đổi từ tham số vị trí sang OBJECT có chủ đích: `assigneeAvatarUrl` và `coverUrl`
 * cùng kiểu `string | null | undefined` nên hoán vị nhầm hai tham số liền nhau sẽ **không bị tsc bắt**
 * — ảnh đại diện hiện lên chỗ ảnh bìa và ngược lại, âm thầm.
 */
export interface TaskCoreSignedUrls {
  assigneeAvatarUrl?: string | null;
  coverUrl?: string | null;
}

/**
 * S5-TASK-AVATAR-1 (Nhóm C) + S5-TASK-COVER-1 — URL ĐÃ KÝ truyền vào từ caller, KHÔNG đọc từ row.
 *
 * Vì sao là THAM SỐ chứ không đọc cột:
 *  · `row.assigneeAvatarRaw` là fileId thô của cột ĐA-NGƯỜI-GHI (`employee_profiles.avatar_url`);
 *    chỉ `AvatarPresignService` mới biết cặp (employeeId, fileId) có hợp lệ không.
 *  · ảnh bìa còn không có cột nào trên `tasks` — nó nằm ở `file_links.is_primary`, cũng đa-người-ghi,
 *    và phải qua `CoverPresignService` (kiểm ảnh + Uploaded + scan sạch + độc quyền task).
 * Mapper đọc thẳng = ký mù = IDOR đọc file nội-tenant.
 *
 * Bỏ trống ⇒ `null` ⇒ FE vẽ chữ cái đầu / thẻ không bìa. Mặc định an toàn CÓ CHỦ ĐÍCH: đường nào quên
 * nối resolver thì MẤT ẢNH, KHÔNG BAO GIỜ lộ fileId.
 */
export function toTaskCoreDto(row: TaskCoreRow, urls?: TaskCoreSignedUrls): TaskCoreResponseDto {
  const createdAt = toIso(row.createdAt);
  const updatedAt = toIso(row.updatedAt);
  if (createdAt === null || updatedAt === null) {
    throw new InternalServerErrorException("Task thiếu timestamp bắt buộc (createdAt/updatedAt).");
  }
  return {
    id: row.id,
    companyId: row.companyId,
    title: row.title,
    description: row.description,
    taskType: row.taskType,
    status: (row.taskStatus as TaskCoreStatusDto | null) ?? null,
    priority: (row.taskPriority as TaskCorePriorityDto | null) ?? null,
    projectId: row.projectId,
    projectName: row.projectName,
    mainAssigneeEmployeeId: row.mainAssigneeEmployeeId,
    assigneeName: row.assigneeName,
    assigneeAvatarUrl: urls?.assigneeAvatarUrl ?? null,
    coverUrl: urls?.coverUrl ?? null,
    creatorUserId: row.creatorUserId,
    creatorName: row.creatorName,
    reporterEmployeeId: row.reporterEmployeeId,
    // S5-TASK-DETAIL-1 (GAP 3) — hàng từ đường chưa join reporter vẫn parse: điền null tường minh.
    reporterName: row.reporterName ?? null,
    departmentId: row.departmentId,
    dueAt: toIso(row.dueAt),
    startAt: toIso(row.startAt),
    completedAt: toIso(row.completedAt),
    isOverdue: toBool(row.isOverdue),
    createdBy: row.createdBy,
    createdAt,
    updatedAt,
    // S5-TASK-PIPELINE-1 (lane be-read) — cột pipeline resolved (schema optional: hàng từ đường
    // chưa join state vẫn parse; server điền null tường minh thay vì bỏ key).
    stateId: row.stateId ?? null,
    stateName: row.stateName ?? null,
    stateColor: row.stateColor ?? null,
    stateGroup: (row.stateGroup as ProjectStateGroupDto | null | undefined) ?? null,
    // S5-TASK-SUBTASK-1 (D-31) — NULL = task GỐC. subtaskTotal/Done KHÔNG điền ở đây: chúng là
    // aggregate, chỉ có ở đường board (toTaskKanbanCardDto) và getTask — mapper base không tự đoán 0
    // vì "0 việc con" và "chưa tính" là hai chuyện khác nhau trước mắt FE.
    parentTaskId: row.parentTaskId ?? null,
  };
}

/** Counts per-card cho Kanban (SPEC-06 §13.8) — aggregate GROUP BY task_id ở repo, KHÔNG N+1. */
export interface TaskKanbanCardCounts {
  commentCount: number;
  attachmentCount: number;
  checklistDone: number;
  checklistTotal: number;
  // S5-TASK-SUBTASK-1 (D-34) — tiến độ thẻ cha. `subtaskTotal` LOẠI con Cancelled (COUNTABLE_CHILD,
  // D-32). total = 0 ⇒ FE KHÔNG hiện % (task không có việc con thì không có tiến độ để nói).
  subtaskDone: number;
  subtaskTotal: number;
}

/**
 * S5-TASK-BE-6 — `toTaskCoreDto` + counts per-card. Tách khỏi `toTaskCoreDto` (KHÔNG sửa base) vì counts CHỈ
 * cần cho Kanban board — list/detail/my-tasks vẫn dùng `taskCoreResponseSchema` nguyên vẹn.
 */
export function toTaskKanbanCardDto(
  row: TaskCoreRow,
  counts: TaskKanbanCardCounts,
  urls?: TaskCoreSignedUrls,
): TaskKanbanCardDto {
  return { ...toTaskCoreDto(row, urls), ...counts };
}
