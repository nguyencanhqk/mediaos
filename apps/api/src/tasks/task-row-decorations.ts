import { InternalServerErrorException } from "@nestjs/common";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import type { AvatarPresignService } from "../foundation/files/avatar-presign.service";
import type { CoverPresignService } from "../foundation/files/cover-presign.service";
import type { TaskCoreRepository, TaskCoreRow } from "./task-core.repository";
import {
  goalRefCandidates,
  signedUrlsForRow,
  toAvatarSubjects,
  toTaskCoreDto,
  type TaskRowDecorations,
} from "./task-core.mapper";
import type { GoalRefUser, GoalRefViewer, TaskGoalRefPolicy } from "./task-goal-ref.policy";

/**
 * S20-SEC-GOALNAMEDTO-1 — trang trí THEO LÔ một trang hàng việc (avatar · ảnh bìa · quyết định đọc mục
 * tiêu) + tải lại bản ghi vừa ghi. Một chỗ cho mọi đường trả `TaskCoreResponseDto` (list · chi tiết ·
 * việc của tôi · phản hồi tạo/sửa/move-state · phản hồi action) — trước đây `TaskActionsService.respond`
 * tự dựng URL riêng, là bản thứ hai sẽ quên trường trang trí mới.
 *
 * Nguồn quyết định mục tiêu (bắt buộc, không mặc định):
 *   · TRONG tx (`{ tx, viewer }`) — viewer đã resolve TRƯỚC tx (engine quyền mở kết nối riêng);
 *   · SAU tx đọc (`{ user }`)     — policy resolve lười rồi tự `withTenant`.
 */
export interface InTxGoalRefs {
  tx: TenantTx;
  viewer: GoalRefViewer;
}
export interface AfterTxGoalRefs {
  user: GoalRefUser;
}
export type GoalRefSource = InTxGoalRefs | AfterTxGoalRefs;

export interface TaskRowDecorationDeps {
  avatars: Pick<AvatarPresignService, "resolveEmployeeAvatars">;
  covers: Pick<CoverPresignService, "resolveTaskCovers">;
  goalRefs: Pick<TaskGoalRefPolicy, "visibleGoalIdsTx" | "visibleGoalIds">;
}

export interface TaskReloadDeps extends TaskRowDecorationDeps {
  coreRepo: Pick<TaskCoreRepository, "findScopedByIdTx">;
}

/**
 * ⚠️ CHẠY TUẦN TỰ, KHÔNG `Promise.all`. Khi có `tx`, các lời gọi dùng CHUNG một kết nối transaction;
 * một `pg` client KHÔNG chạy song song hai truy vấn trên cùng kết nối. Bọc `Promise.all` sẽ hỏng ngẫu
 * nhiên dưới tải. Phần đắt là ký HMAC cục bộ (không I/O mạng) nên tuần tự không phải nút cổ chai.
 */
export async function decorateTaskRows(
  deps: TaskRowDecorationDeps,
  companyId: string,
  rows: readonly TaskCoreRow[],
  src: GoalRefSource,
): Promise<TaskRowDecorations> {
  const tx = "tx" in src ? src.tx : undefined;
  const avatars = await deps.avatars.resolveEmployeeAvatars(companyId, toAvatarSubjects(rows), tx);
  const covers = await deps.covers.resolveTaskCovers(
    companyId,
    rows.map((r) => r.id),
    tx,
  );
  const candidates = goalRefCandidates(rows);
  const goals =
    "tx" in src
      ? await deps.goalRefs.visibleGoalIdsTx(src.tx, src.viewer, candidates)
      : await deps.goalRefs.visibleGoalIds(src.user, candidates);
  return { avatars, covers, goals };
}

/**
 * Tải lại bản ghi vừa ghi TRONG tx ghi và trả DTO đã trang trí. Ký ảnh ngay ở đường GHI: FE ghi đè
 * cache chi tiết bằng phản hồi này (TaskFormDrawer / useTaskActionMutation), trả null ở đây là ảnh vừa
 * hiện xong đã biến mất tới lần refetch sau — cùng lý do cho tham chiếu mục tiêu.
 */
export async function reloadTaskDtoTx(
  deps: TaskReloadDeps,
  at: InTxGoalRefs,
  taskId: string,
): Promise<TaskCoreResponseDto> {
  const companyId = at.viewer.companyId;
  const row = await deps.coreRepo.findScopedByIdTx(at.tx, companyId, taskId);
  if (!row) throw new InternalServerErrorException("Không tải lại được công việc vừa ghi.");
  const deco = await decorateTaskRows(deps, companyId, [row], at);
  return toTaskCoreDto(row, signedUrlsForRow(row, deco));
}
