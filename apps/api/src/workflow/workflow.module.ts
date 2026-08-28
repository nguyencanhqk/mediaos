import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { WorkflowFsmService } from "./workflow-fsm.service";
import { WorkflowRepository } from "./workflow.repository";
import { LockPropagationService } from "./lock-propagation.service";
import { ApprovalService } from "./approval.service";

/**
 * WorkflowModule — PROVIDER-ONLY sau `S10-CLEAN-WORKFLOWPARK-1`. Bề mặt HTTP = **0**.
 *
 * Module này là tàn dư có chủ đích của engine workflow-DAG hướng cũ (de-media-fy, `docs/erd-current.md`
 * §A5 xếp vào "code CÒN bảng HƯỚNG CŨ — cần DỌN"). Hai controller của nó (`/workflow` 13 route +
 * `/workflow-templates` 16 route) đã bị gỡ: 0 hộ tiêu thụ ở cả 4 SPA, `apps/lms` và `scripts/`.
 *
 * ⛔ KHÔNG xoá nốt thư mục này. `ApprovalModule` (ĐANG SỐNG — `approval-inbox.controller.ts`) uỷ
 * quyền CẤP CUỐI cho `ApprovalService.approve()` / `.requestRevision()` nằm ở đây, và hai method đó
 * kéo theo `WorkflowFsmService` · `WorkflowRepository` · `LockPropagationService` · `workflow-dag`.
 * Đường ranh của bản dọn đi giữa "bề mặt API" và "engine `approval/` còn dùng", KHÔNG đi theo ranh
 * thư mục. Ca đối chứng: `test/foundation/workflow-surface-removed.unit-spec.ts` (3).
 *
 * Phần CÒN NỢ (WO sau, lane `db-migration` + FULL gate): DROP bảng `workflow_*`/`defects`, gỡ seed
 * permission `workflow.*`, gỡ `packages/contracts/src/workflow.ts`, gỡ method join bảng media trong
 * `workflow.repository.ts`.
 */
@Module({
  imports: [DatabaseModule, EventsModule, PermissionModule],
  providers: [WorkflowFsmService, WorkflowRepository, LockPropagationService, ApprovalService],
  controllers: [],
  exports: [ApprovalService],
})
export class WorkflowModule {}
