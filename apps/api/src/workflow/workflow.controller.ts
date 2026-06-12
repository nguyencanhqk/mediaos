import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { WorkflowService } from "./workflow.service";
import { ApprovalService } from "./approval.service";
import { AssignStepDto, StartWorkflowDto, SubmitStepDto } from "./workflow.dto";
import { ApproveDto, RequestRevisionDto } from "./approval.dto";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

@Controller("workflow")
@UsePipes(ZodValidationPipe)
export class WorkflowController {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly approval: ApprovalService,
  ) {}

  /** POST /workflow/start — tạo workflow instance cho content item */
  @Post("start")
  startWorkflow(@Req() req: AuthenticatedRequest, @Body() dto: StartWorkflowDto) {
    return this.workflow.startWorkflow(req.user.companyId, dto.contentItemId, req.user.id);
  }

  /** GET /workflow/approval-requests — hàng chờ duyệt (reviewer queue) */
  // PHẢI đặt trước @Get(":instanceId") để tránh "approval-requests" bị parse thành UUID.
  @Get("approval-requests")
  listApprovalRequests(@Req() req: AuthenticatedRequest) {
    return this.approval.listPending(req.user.companyId);
  }

  /** GET /workflow/by-content/:contentItemId — workflow của content (null nếu chưa start) */
  // PHẢI đặt trước @Get(":instanceId") để "by-content" không bị parse thành instanceId.
  @Get("by-content/:contentItemId")
  getWorkflowByContent(
    @Req() req: AuthenticatedRequest,
    @Param("contentItemId") contentItemId: string,
  ) {
    return this.workflow.getWorkflowByContent(req.user.companyId, contentItemId);
  }

  /** GET /workflow/steps/:stepId/checklist — checklist items + tick state cho 1 instance step (G7-4b FE).
   * Company-scoped read (no permission gate; workflow-internal) — mirror linkage của submit gate.
   * Đặt TRƯỚC @Get(":instanceId") cho rõ ràng (multi-segment nên không thực sự đụng :instanceId). */
  @Get("steps/:stepId/checklist")
  getStepChecklist(@Req() req: AuthenticatedRequest, @Param("stepId") stepId: string) {
    return this.workflow.getStepChecklist(req.user.companyId, stepId);
  }

  /** GET /workflow/:instanceId — lấy workflow + steps */
  @Get(":instanceId")
  getWorkflow(@Req() req: AuthenticatedRequest, @Param("instanceId") instanceId: string) {
    return this.workflow.getWorkflow(req.user.companyId, instanceId);
  }

  /** POST /workflow/steps/:stepId/assign — PM gán assignee + reviewer cho bước.
   * Method-level @UseGuards(PermissionGuard): các route workflow khác KHÔNG gắn guard này
   * (PermissionGuard fail-closed 403 nếu thiếu @RequirePermission). */
  @Post("steps/:stepId/assign")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "content")
  assignStep(
    @Req() req: AuthenticatedRequest,
    @Param("stepId") stepId: string,
    @Body() dto: AssignStepDto,
  ) {
    return this.workflow.assignStep(req.user.companyId, stepId, req.user.id, {
      assigneeUserId: dto.assigneeUserId,
      reviewerUserId: dto.reviewerUserId,
    });
  }

  /** POST /workflow/steps/:stepId/start — bắt đầu làm step (T1 / T5) */
  @Post("steps/:stepId/start")
  startStep(@Req() req: AuthenticatedRequest, @Param("stepId") stepId: string) {
    return this.workflow.startStep(req.user.companyId, stepId, req.user.id);
  }

  /** POST /workflow/steps/:stepId/submit — nộp work → waiting_review (T2) */
  @Post("steps/:stepId/submit")
  submitStep(
    @Req() req: AuthenticatedRequest,
    @Param("stepId") stepId: string,
    @Body() dto: SubmitStepDto,
  ) {
    return this.workflow.submitStep(req.user.companyId, stepId, req.user.id, {
      submissionUrl: dto.submissionUrl,
      submissionNote: dto.submissionNote,
    });
  }

  /** POST /workflow/steps/:stepId/checklist-items/:itemId — tick item (G7-4b submit gate).
   * Actor = step assignee (enforced in service); no separate permission gate (workflow-internal). */
  @Post("steps/:stepId/checklist-items/:itemId")
  checkItem(
    @Req() req: AuthenticatedRequest,
    @Param("stepId") stepId: string,
    @Param("itemId") itemId: string,
  ) {
    return this.workflow.checkItem(req.user.companyId, stepId, itemId, req.user.id);
  }

  /** DELETE /workflow/steps/:stepId/checklist-items/:itemId — un-tick item (G7-4b) */
  @Delete("steps/:stepId/checklist-items/:itemId")
  uncheckItem(
    @Req() req: AuthenticatedRequest,
    @Param("stepId") stepId: string,
    @Param("itemId") itemId: string,
  ) {
    return this.workflow.uncheckItem(req.user.companyId, stepId, itemId, req.user.id);
  }

  /** POST /workflow/approval-requests/:requestId/approve — T3: phê duyệt */
  @Post("approval-requests/:requestId/approve")
  approve(
    @Req() req: AuthenticatedRequest,
    @Param("requestId") requestId: string,
    @Body() dto: ApproveDto,
  ) {
    return this.approval.approve(req.user.companyId, requestId, req.user.id, dto.comment ?? undefined);
  }

  /** POST /workflow/approval-requests/:requestId/request-revision — T4: trả về sửa */
  @Post("approval-requests/:requestId/request-revision")
  requestRevision(
    @Req() req: AuthenticatedRequest,
    @Param("requestId") requestId: string,
    @Body() dto: RequestRevisionDto,
  ) {
    return this.approval.requestRevision(
      req.user.companyId,
      requestId,
      req.user.id,
      dto.description,
      dto.comment ?? undefined,
    );
  }
}
